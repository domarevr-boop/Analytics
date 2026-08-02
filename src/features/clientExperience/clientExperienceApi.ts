import { supabase } from '../../lib/supabaseClient';

type RpcRow = Record<string, unknown>;

export interface CxFilters {
  start: string;
  end: string;
  cabinets: string[] | null;
  productIds: string[] | null;
  rating: number | null;
}

export interface CxSummary {
  totalReviews: number;
  textReviews: number;
  emptyReviews: number;
  averageRating: number;
  negativeReviews: number;
  answeredReviews: number;
  matchedReviews: number;
}

export interface CxTrendPoint {
  date: string;
  totalReviews: number;
  textReviews: number;
  emptyReviews: number;
  averageRating: number;
  negativeShare: number;
}

export interface CxRatingPoint {
  rating: number;
  reviewCount: number;
}

export interface CxProblemProduct {
  entityKey: string;
  localProductId: string | null;
  sellerSku: string;
  wbSku: string;
  productName: string;
  cabinetName: string;
  reviewCount: number;
  averageRating: number;
  negativeReviews: number;
  negativeShare: number;
}

export interface CxReviewRow {
  id: string;
  reviewDate: string;
  localProductId: string | null;
  cabinetName: string;
  sellerSku: string;
  wbSku: string;
  productName: string;
  productCategory: string;
  productGroupNames: string[];
  reportedBrand: string;
  rating: number;
  reviewText: string;
  advantages: string;
  disadvantages: string;
  sellerResponse: string;
  helpfulUp: number;
  helpfulDown: number;
  productMatchStatus: string;
}

export interface CxDashboard {
  summary: CxSummary;
  trend: CxTrendPoint[];
  ratings: CxRatingPoint[];
  problems: CxProblemProduct[];
}

export interface CxTopicSummary {
  textReviews: number;
  classifiedReviews: number;
  topicMentions: number;
  coverage: number;
  averageRating: number;
  negativeShare: number;
  neutralShare: number;
  positiveShare: number;
  topicScore: number;
}

export interface CxTopicMetric {
  id: string;
  name: string;
  groupName: string;
  reviewCount: number;
  ruleMatches: number;
  share: number;
  averageRating: number;
  negativeShare: number;
  neutralShare: number;
  positiveShare: number;
  topicScore: number;
}

export interface CxTopicTrendPoint {
  date: string;
  mentions: number;
  reviews: number;
  averageRating: number;
  negativeShare: number;
  neutralShare: number;
  positiveShare: number;
}

export interface CxTopicProduct {
  entityKey: string;
  localProductId: string | null;
  sellerSku: string;
  wbSku: string;
  productName: string;
  cabinetName: string;
  mentions: number;
  averageRating: number;
  negativeShare: number;
  positiveShare: number;
}

export interface CxTopicDashboard {
  version: number;
  selectedTopicId: string | null;
  summary: CxTopicSummary;
  topics: CxTopicMetric[];
  trend: CxTopicTrendPoint[];
  products: CxTopicProduct[];
}

function params(filters: CxFilters) {
  return {
    p_date_from: filters.start || null,
    p_date_to: filters.end || null,
    p_cabinets: filters.cabinets,
    p_product_ids: filters.productIds,
    p_rating: filters.rating,
  };
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function errorMessage(error: { message: string } | null, context: string) {
  return error ? new Error(`[CX] ${context}: ${error.message}`) : null;
}

export async function getCxDateBounds(): Promise<{ start: string; end: string }> {
  const [reviewMin, reviewMax, emptyMin, emptyMax] = await Promise.all([
    supabase.from('reviews').select('review_date').order('review_date', { ascending: true }).limit(1).maybeSingle(),
    supabase.from('reviews').select('review_date').order('review_date', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('empty_review_stats').select('review_date').order('review_date', { ascending: true }).limit(1).maybeSingle(),
    supabase.from('empty_review_stats').select('review_date').order('review_date', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const firstError = [reviewMin.error, reviewMax.error, emptyMin.error, emptyMax.error].find(Boolean);
  if (firstError) throw errorMessage(firstError, 'не удалось определить период данных')!;
  const starts = [reviewMin.data?.review_date, emptyMin.data?.review_date].filter(Boolean).sort();
  const ends = [reviewMax.data?.review_date, emptyMax.data?.review_date].filter(Boolean).sort();
  return { start: starts[0] || '', end: ends.at(-1) || '' };
}

export async function getCxDashboard(filters: CxFilters): Promise<CxDashboard> {
  const common = params(filters);
  const [summaryResult, trendResult, ratingsResult, problemsResult] = await Promise.all([
    supabase.rpc('get_cx_review_summary', common),
    supabase.rpc('get_cx_review_trend', common),
    supabase.rpc('get_cx_rating_distribution', common),
    supabase.rpc('get_cx_problem_products', { ...common, p_limit: 12 }),
  ]);
  const failed = [
    [summaryResult.error, 'сводка'], [trendResult.error, 'динамика'],
    [ratingsResult.error, 'рейтинг'], [problemsResult.error, 'товары'],
  ].find(([error]) => error);
  if (failed) throw errorMessage(failed[0] as { message: string }, String(failed[1]))!;

  const summaryRow = Array.isArray(summaryResult.data) ? summaryResult.data[0] : summaryResult.data;
  return {
    summary: {
      totalReviews: number(summaryRow?.total_reviews), textReviews: number(summaryRow?.text_reviews),
      emptyReviews: number(summaryRow?.empty_reviews), averageRating: number(summaryRow?.average_rating),
      negativeReviews: number(summaryRow?.negative_reviews), answeredReviews: number(summaryRow?.answered_reviews),
      matchedReviews: number(summaryRow?.matched_reviews),
    },
    trend: (trendResult.data || []).map((row: RpcRow) => ({
      date: String(row.review_date || ''), totalReviews: number(row.total_reviews), textReviews: number(row.text_reviews),
      emptyReviews: number(row.empty_reviews), averageRating: number(row.average_rating), negativeShare: number(row.negative_share),
    })),
    ratings: (ratingsResult.data || []).map((row: RpcRow) => ({ rating: number(row.rating), reviewCount: number(row.review_count) })),
    problems: (problemsResult.data || []).map((row: RpcRow) => ({
      entityKey: String(row.entity_key || ''), localProductId: row.local_product_id ? String(row.local_product_id) : null,
      sellerSku: String(row.seller_sku || ''), wbSku: String(row.wb_sku || ''),
      productName: String(row.product_name || ''), cabinetName: String(row.cabinet_name || ''), reviewCount: number(row.review_count),
      averageRating: number(row.average_rating), negativeReviews: number(row.negative_reviews), negativeShare: number(row.negative_share),
    })),
  };
}

export async function getCxTopicDashboard(filters: CxFilters, topicId: string | null): Promise<CxTopicDashboard> {
  const { data, error } = await supabase.rpc('get_cx_topic_dashboard', {
    ...params(filters),
    p_topic_id: topicId,
  });
  if (error) throw errorMessage(error, 'дашборд тем')!;
  const payload = (data || {}) as RpcRow;
  const summary = (payload.summary || {}) as RpcRow;
  const rows = (value: unknown) => Array.isArray(value) ? value as RpcRow[] : [];
  return {
    version: number(payload.version),
    selectedTopicId: payload.selected_topic_id ? String(payload.selected_topic_id) : null,
    summary: {
      textReviews: number(summary.text_reviews),
      classifiedReviews: number(summary.classified_reviews),
      topicMentions: number(summary.topic_mentions),
      coverage: number(summary.coverage),
      averageRating: number(summary.average_rating),
      negativeShare: number(summary.negative_share),
      neutralShare: number(summary.neutral_share),
      positiveShare: number(summary.positive_share),
      topicScore: number(summary.topic_score),
    },
    topics: rows(payload.topics).map(row => ({
      id: String(row.id || ''), name: String(row.name || ''), groupName: String(row.group_name || ''),
      reviewCount: number(row.review_count), ruleMatches: number(row.rule_matches), share: number(row.share),
      averageRating: number(row.average_rating), negativeShare: number(row.negative_share), neutralShare: number(row.neutral_share),
      positiveShare: number(row.positive_share), topicScore: number(row.topic_score),
    })),
    trend: rows(payload.trend).map(row => ({
      date: String(row.date || ''), mentions: number(row.mentions), reviews: number(row.reviews),
      averageRating: number(row.average_rating), negativeShare: number(row.negative_share),
      neutralShare: number(row.neutral_share), positiveShare: number(row.positive_share),
    })),
    products: rows(payload.products).map(row => ({
      entityKey: String(row.entity_key || ''), localProductId: row.local_product_id ? String(row.local_product_id) : null,
      sellerSku: String(row.seller_sku || ''), wbSku: String(row.wb_sku || ''), productName: String(row.product_name || ''),
      cabinetName: String(row.cabinet_name || ''), mentions: number(row.mentions),
      averageRating: number(row.average_rating), negativeShare: number(row.negative_share), positiveShare: number(row.positive_share),
    })),
  };
}

export async function getCxReviewsPage(
  filters: CxFilters,
  page: number,
  pageSize: number,
  search: string,
): Promise<{ rows: CxReviewRow[]; total: number }> {
  if (filters.productIds && filters.productIds.length === 0) return { rows: [], total: 0 };
  const { data, error } = await supabase.rpc('get_cx_reviews_page', {
    ...params(filters),
    p_search: search.trim().toLocaleLowerCase('ru-RU') || null,
    p_limit: pageSize,
    p_offset: Math.max(0, page) * pageSize,
  });
  if (error) throw errorMessage(error, 'таблица отзывов')!;
  const sourceRows = data || [];
  return {
    total: number(sourceRows[0]?.total_count),
    rows: sourceRows.map((row: RpcRow) => ({
      id: String(row.id || ''), reviewDate: String(row.review_date || ''),
      localProductId: row.local_product_id ? String(row.local_product_id) : null,
      cabinetName: String(row.cabinet_name || ''), sellerSku: String(row.seller_sku || ''), wbSku: String(row.wb_sku || ''),
      productName: String(row.product_name || ''), productCategory: String(row.product_category || ''),
      productGroupNames: Array.isArray(row.product_group_names) ? row.product_group_names.map(String) : [],
      reportedBrand: String(row.reported_brand || ''), rating: number(row.rating), reviewText: String(row.review_text || ''),
      advantages: String(row.advantages || ''), disadvantages: String(row.disadvantages || ''), sellerResponse: String(row.seller_response || ''),
      helpfulUp: number(row.helpful_up), helpfulDown: number(row.helpful_down), productMatchStatus: String(row.product_match_status || 'unmatched'),
    })),
  };
}
