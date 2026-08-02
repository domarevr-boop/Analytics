import { supabase } from '../../lib/supabaseClient';
import { lemmatizeRussianText } from './russianMorphology';

const VERSION = 'az-opencorpora-0.2.3';
const REVIEW_CHUNK = 200;
const FRAGMENT_CHUNK = 400;

export interface LemmaBackfillProgress {
  reviews: number;
  fragments: number;
  done: boolean;
}

export async function getLemmaBackfillPending() {
  const [reviews, fragments] = await Promise.all([
    supabase.from('reviews').select('*', { count: 'exact', head: true }).is('lemmatized_text', null),
    supabase.from('review_fragments').select('*', { count: 'exact', head: true }).is('lemmatized_text', null),
  ]);
  if (reviews.error) throw new Error(`[CX] подсчёт отзывов без лемм: ${reviews.error.message}`);
  if (fragments.error) throw new Error(`[CX] подсчёт фрагментов без лемм: ${fragments.error.message}`);
  return { reviews: reviews.count || 0, fragments: fragments.count || 0 };
}

export async function backfillReviewLemmas(onProgress?: (progress: LemmaBackfillProgress) => void) {
  let processedReviews = 0;
  let processedFragments = 0;
  while (true) {
    const [reviewResult, fragmentResult] = await Promise.all([
      supabase.from('reviews').select('id,normalized_text').is('lemmatized_text', null).order('id').limit(REVIEW_CHUNK),
      supabase.from('review_fragments').select('id,normalized_text').is('lemmatized_text', null).order('id').limit(FRAGMENT_CHUNK),
    ]);
    if (reviewResult.error) throw new Error(`[CX] выборка отзывов для лемматизации: ${reviewResult.error.message}`);
    if (fragmentResult.error) throw new Error(`[CX] выборка фрагментов для лемматизации: ${fragmentResult.error.message}`);
    const reviewRows = await Promise.all((reviewResult.data || []).map(async row => ({
      id: row.id, lemmatized_text: await lemmatizeRussianText(row.normalized_text || ''),
    })));
    const fragmentRows = await Promise.all((fragmentResult.data || []).map(async row => ({
      id: row.id, lemmatized_text: await lemmatizeRussianText(row.normalized_text || ''),
    })));
    if (reviewRows.length === 0 && fragmentRows.length === 0) break;
    const { data, error } = await supabase.rpc('backfill_cx_text_lemmas', {
      p_reviews: reviewRows, p_fragments: fragmentRows, p_version: VERSION,
    });
    if (error) throw new Error(`[CX] сохранение лемм: ${error.message}`);
    const result = Array.isArray(data) ? data[0] : data;
    processedReviews += Number(result?.updated_reviews) || 0;
    processedFragments += Number(result?.updated_fragments) || 0;
    onProgress?.({ reviews: processedReviews, fragments: processedFragments, done: false });
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  const progress = { reviews: processedReviews, fragments: processedFragments, done: true };
  onProgress?.(progress);
  return progress;
}
