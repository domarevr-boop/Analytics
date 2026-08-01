import { getBrands, getCabinets, getGroups, getMemberships, getProducts } from '../../data/store';
import { normalizeImportDate } from '../../data/dateUtils';
import { supabase } from '../../lib/supabaseClient';

const SOURCE = 'wb_reviews';
const BUCKET = 'cx-review-imports';
const PARSER_VERSION = 'reviews-v1';
const CHUNK_SIZE = 500;

export interface ReviewImportProgress {
  processed: number;
  total: number;
  stage: 'uploading' | 'processing' | 'verifying' | 'cleaning';
}

export interface ReviewImportResult {
  batchId: string;
  totalRows: number;
  textRows: number;
  emptyRows: number;
  duplicateRows: number;
  rejectedRows: number;
  unmatchedProductRows: number;
  fileDeleted: boolean;
}

export interface ReviewImportSummary {
  id: string;
  fileName: string;
  importedAt: string;
  status: string;
  totalRows: number;
  textRows: number;
  emptyRows: number;
  duplicateRows: number;
  rejectedRows: number;
  fileDeletedAt: string | null;
  errorMessage: string | null;
}

interface ReviewCandidate {
  key: string;
  registry: Record<string, unknown>;
  review?: Record<string, unknown>;
  fragments: Array<{ fragment_type: string; fragment_text: string; normalized_text: string }>;
  emptyKey?: string;
  emptyStat?: Record<string, unknown>;
}

function clean(value: unknown): string {
  return String(value ?? '').split('\u0000').join('').replace(/\r\n/g, '\n').trim();
}

function normalizeText(value: string): string {
  return value.toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ').trim();
}

function hasMeaningfulText(value: string): boolean {
  return /[\p{L}\p{N}]/u.test(value);
}

function parseInteger(value: unknown): number {
  const parsed = Number(clean(value).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function parseRating(value: unknown): number {
  const rating = Number(clean(value).replace(',', '.'));
  return Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : 0;
}

function safeFileName(name: string): string {
  const extension = name.split('.').pop()?.toLocaleLowerCase('en-US').replace(/[^a-z0-9]/g, '');
  return extension ? `reviews.${extension}` : 'reviews.xlsx';
}

async function sha256(value: string | ArrayBuffer): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function textHash(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}

function chunks<T>(items: T[], size = CHUNK_SIZE): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

export async function getLatestReviewImport(): Promise<ReviewImportSummary | null> {
  const { data, error } = await supabase.from('review_import_batches')
    .select('id,file_name,imported_at,status,total_rows,text_rows,empty_rows,duplicate_rows,rejected_rows,file_deleted_at,error_message')
    .order('imported_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  if (!data) return null;
  return {
    id: data.id,
    fileName: data.file_name,
    importedAt: data.imported_at,
    status: data.status,
    totalRows: data.total_rows,
    textRows: data.text_rows,
    emptyRows: data.empty_rows,
    duplicateRows: data.duplicate_rows,
    rejectedRows: data.rejected_rows,
    fileDeletedAt: data.file_deleted_at,
    errorMessage: data.error_message,
  };
}

async function updateBatch(batchId: string, values: Record<string, unknown>) {
  const { error } = await supabase.from('review_import_batches').update(values).eq('id', batchId);
  if (error) throw new Error(`[reviews] batch update failed: ${error.message}`);
}

function buildProductLookup() {
  const products = getProducts();
  const cabinets = new Map(getCabinets().map(cabinet => [cabinet.id, cabinet.name]));
  const brands = new Map(getBrands().map(brand => [brand.id, brand.name]));
  const groups = new Map(getGroups().map(group => [group.id, group.name]));
  const groupIdsByProduct = new Map<string, string[]>();
  for (const membership of getMemberships()) {
    const current = groupIdsByProduct.get(membership.product_id) || [];
    current.push(membership.group_id);
    groupIdsByProduct.set(membership.product_id, current);
  }

  const bySellerSku = new Map<string, typeof products[number]>();
  const byWbSku = new Map<string, typeof products[number]>();
  for (const product of products) {
    if (product.sku) bySellerSku.set(product.sku.trim().toLocaleLowerCase('ru-RU'), product);
    if (product.wb_sku) byWbSku.set(product.wb_sku.trim(), product);
    for (const alias of product.aliases || []) {
      if (alias) bySellerSku.set(alias.trim().toLocaleLowerCase('ru-RU'), product);
    }
  }

  return {
    match(sellerSku: string, wbSku: string) {
      const product = (wbSku && byWbSku.get(wbSku)) || (sellerSku && bySellerSku.get(sellerSku.toLocaleLowerCase('ru-RU')));
      if (!product) return null;
      return {
        id: product.id,
        name: product.name,
        category: product.category,
        cabinetName: cabinets.get(product.cabinet_id) || '',
        brandName: brands.get(product.brand_id) || '',
        groupNames: (groupIdsByProduct.get(product.id) || []).map(id => groups.get(id)).filter(Boolean),
      };
    },
  };
}

export async function importReviewsToSupabase(
  file: File,
  rows: Record<string, string>[],
  mappingConfig: Record<string, string>,
  onProgress?: (progress: ReviewImportProgress) => void,
): Promise<ReviewImportResult> {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) throw new Error('Для импорта отзывов требуется авторизация в Supabase');

  const batchId = crypto.randomUUID();
  const storagePath = `${authData.user.id}/${batchId}/${safeFileName(file.name)}`;
  const fileBuffer = await file.arrayBuffer();
  const fileHash = await sha256(fileBuffer);

  const { error: batchError } = await supabase.from('review_import_batches').insert({
    id: batchId,
    source: SOURCE,
    file_name: file.name,
    file_hash: fileHash,
    file_size: file.size,
    storage_path: storagePath,
    imported_by: authData.user.id,
    status: 'processing',
    total_rows: rows.length,
    mapping_config: mappingConfig,
    parser_version: PARSER_VERSION,
  });
  if (batchError) throw new Error(`[reviews] cannot create import batch: ${batchError.message}`);

  try {
    onProgress?.({ processed: 0, total: rows.length, stage: 'uploading' });
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });
    if (uploadError) throw new Error(`[reviews] source upload failed: ${uploadError.message}`);

    const lookup = buildProductLookup();
    const candidates: ReviewCandidate[] = [];
    let rejectedRows = 0;
    let invalidDateRows = 0;
    let invalidRatingRows = 0;
    let unmatchedProductRows = 0;

    for (const [index, row] of rows.entries()) {
      const sourceReviewId = clean(row.review_id);
      const reportedCabinet = clean(row.review_cabinet);
      const sellerSku = clean(row.sku);
      const wbSku = clean(row.wb_sku);
      const reviewDate = normalizeImportDate(row.date, new Date().getFullYear());
      const rating = parseRating(row.review_rating);
      if (!sourceReviewId || !reportedCabinet || !reviewDate || !rating) {
        rejectedRows++;
        if (!reviewDate) invalidDateRows++;
        if (!rating) invalidRatingRows++;
        if ((index + 1) % 250 === 0 || index + 1 === rows.length) {
          onProgress?.({ processed: index + 1, total: rows.length, stage: 'processing' });
        }
        continue;
      }

      const product = lookup.match(sellerSku, wbSku);
      if (!product) unmatchedProductRows++;
      const cabinetName = reportedCabinet || product?.cabinetName || 'Не определён';
      const reviewText = clean(row.review_text);
      const advantages = clean(row.review_advantages);
      const disadvantages = clean(row.review_disadvantages);
      const fragments = [
        { fragment_type: 'text', fragment_text: reviewText },
        { fragment_type: 'advantage', fragment_text: advantages },
        { fragment_type: 'disadvantage', fragment_text: disadvantages },
      ].filter(fragment => hasMeaningfulText(fragment.fragment_text))
        .map(fragment => ({ ...fragment, normalized_text: normalizeText(fragment.fragment_text) }));
      const normalized = fragments.map(fragment => fragment.normalized_text).join('\n');
      const key = `${cabinetName}\u0000${sourceReviewId}`;
      const common = {
        import_batch_id: batchId,
        source: SOURCE,
        cabinet_name: cabinetName,
        source_review_id: sourceReviewId,
      };

      const candidate: ReviewCandidate = {
        key,
        registry: { ...common, has_text: fragments.length > 0 },
        fragments,
      };

      if (fragments.length > 0) {
        candidate.review = {
          ...common,
          review_date: reviewDate,
          local_product_id: product?.id || null,
          seller_sku: sellerSku || null,
          wb_sku: wbSku || null,
          product_name: product?.name || null,
          product_category: product?.category || null,
          product_group_names: product?.groupNames || [],
          reported_brand: clean(row.review_brand) || product?.brandName || null,
          rating,
          review_text: reviewText || null,
          advantages: advantages || null,
          disadvantages: disadvantages || null,
          normalized_text: normalized,
          text_hash: textHash(normalized),
          author_name: clean(row.review_author) || null,
          country_code: clean(row.review_country).toLocaleLowerCase('ru-RU') || null,
          color: clean(row.review_color) || null,
          size: clean(row.review_size) || null,
          helpful_down: parseInteger(row.review_helpful_down),
          helpful_up: parseInteger(row.review_helpful_up),
          barcode: clean(row.review_barcode) || null,
          seller_response: clean(row.review_response) || null,
          initial_review_id: clean(row.review_initial_id) || null,
          additional_review_id: clean(row.review_additional_id) || null,
          product_match_status: product ? 'matched' : 'unmatched',
          raw_payload: row,
        };
      } else {
        const emptyKey = [reviewDate, cabinetName, sellerSku, wbSku, rating].join('\u0000');
        candidate.emptyKey = emptyKey;
        candidate.emptyStat = {
          import_batch_id: batchId,
          source: SOURCE,
          review_date: reviewDate,
          local_product_id: product?.id || null,
          cabinet_name: cabinetName,
          seller_sku: sellerSku || null,
          wb_sku: wbSku || null,
          rating,
          review_count: 1,
        };
      }
      candidates.push(candidate);
      if ((index + 1) % 250 === 0 || index + 1 === rows.length) {
        onProgress?.({ processed: index + 1, total: rows.length, stage: 'processing' });
      }
    }

    const duplicateKeys = new Set<string>();
    for (const candidateChunk of chunks(candidates)) {
      const ids = [...new Set(candidateChunk.map(item => String(item.registry.source_review_id)))];
      const { data, error } = await supabase.from('review_row_registry')
        .select('cabinet_name,source_review_id')
        .eq('source', SOURCE)
        .in('source_review_id', ids);
      if (error) throw new Error(`[reviews] duplicate check failed: ${error.message}`);
      for (const item of data || []) duplicateKeys.add(`${item.cabinet_name}\u0000${item.source_review_id}`);
    }

    const accepted: ReviewCandidate[] = [];
    const acceptedKeys = new Set<string>();
    let duplicateRows = 0;
    for (const candidate of candidates) {
      if (duplicateKeys.has(candidate.key) || acceptedKeys.has(candidate.key)) {
        duplicateRows++;
        continue;
      }
      acceptedKeys.add(candidate.key);
      accepted.push(candidate);
    }

    for (const candidateChunk of chunks(accepted)) {
      const { error } = await supabase.from('review_row_registry').insert(candidateChunk.map(item => item.registry));
      if (error) throw new Error(`[reviews] registry insert failed: ${error.message}`);
    }

    const textCandidates = accepted.filter(candidate => candidate.review);
    for (const candidateChunk of chunks(textCandidates)) {
      const { data, error } = await supabase.from('reviews')
        .insert(candidateChunk.map(item => item.review!))
        .select('id,cabinet_name,source_review_id');
      if (error) throw new Error(`[reviews] review insert failed: ${error.message}`);
      const idByKey = new Map((data || []).map(item => [`${item.cabinet_name}\u0000${item.source_review_id}`, item.id]));
      const fragmentRows = candidateChunk.flatMap(candidate => {
        const reviewId = idByKey.get(candidate.key);
        return reviewId ? candidate.fragments.map(fragment => ({ review_id: reviewId, ...fragment })) : [];
      });
      if (fragmentRows.length) {
        const { error: fragmentError } = await supabase.from('review_fragments').insert(fragmentRows);
        if (fragmentError) throw new Error(`[reviews] fragment insert failed: ${fragmentError.message}`);
      }
    }

    const emptyStats = new Map<string, Record<string, unknown>>();
    for (const candidate of accepted) {
      if (!candidate.emptyKey || !candidate.emptyStat) continue;
      const current = emptyStats.get(candidate.emptyKey);
      if (current) current.review_count = Number(current.review_count) + 1;
      else emptyStats.set(candidate.emptyKey, { ...candidate.emptyStat });
    }
    for (const statChunk of chunks([...emptyStats.values()])) {
      const { error } = await supabase.from('empty_review_stats').insert(statChunk);
      if (error) throw new Error(`[reviews] empty stats insert failed: ${error.message}`);
    }

    const textRows = textCandidates.length;
    const emptyRows = accepted.length - textRows;
    await updateBatch(batchId, {
      status: 'verifying',
      text_rows: textRows,
      empty_rows: emptyRows,
      duplicate_rows: duplicateRows,
      rejected_rows: rejectedRows,
      unmatched_product_rows: unmatchedProductRows,
      invalid_date_rows: invalidDateRows,
      invalid_rating_rows: invalidRatingRows,
    });

    onProgress?.({ processed: rows.length, total: rows.length, stage: 'verifying' });
    const { data: verificationRows, error: verificationError } = await supabase.rpc('verify_review_import_batch', { batch_uuid: batchId });
    if (verificationError) throw new Error(`[reviews] verification failed: ${verificationError.message}`);
    const verification = Array.isArray(verificationRows) ? verificationRows[0] : verificationRows;
    if (!verification?.verified) throw new Error(`[reviews] ${verification?.message || 'row reconciliation failed'}`);

    onProgress?.({ processed: rows.length, total: rows.length, stage: 'cleaning' });
    const { error: removeError } = await supabase.storage.from(BUCKET).remove([storagePath]);
    if (removeError) {
      await updateBatch(batchId, { status: 'cleanup_failed', error_message: removeError.message });
      return { batchId, totalRows: rows.length, textRows, emptyRows, duplicateRows, rejectedRows, unmatchedProductRows, fileDeleted: false };
    }
    await updateBatch(batchId, { file_deleted_at: new Date().toISOString(), error_message: null });
    return { batchId, totalRows: rows.length, textRows, emptyRows, duplicateRows, rejectedRows, unmatchedProductRows, fileDeleted: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase.from('empty_review_stats').delete().eq('import_batch_id', batchId);
    await supabase.from('reviews').delete().eq('import_batch_id', batchId);
    await supabase.from('review_row_registry').delete().eq('import_batch_id', batchId);
    await supabase.from('review_import_batches').update({ status: 'failed', error_message: message }).eq('id', batchId);
    throw error;
  }
}
