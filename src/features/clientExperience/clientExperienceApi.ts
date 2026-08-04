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

export type CxTopicSentiment = 'positive' | 'neutral' | 'negative';
export type CxTopicGranularity = 'day' | 'week' | 'month';

export interface CxTopicReviewRow extends CxReviewRow {
  sentiment: CxTopicSentiment;
  matchedRules: Array<{ id: string; type: string; pattern: string }>;
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
  evaluativeShare: number;
  topicScore: number | null;
}

export interface CxTopicMetric {
  id: string;
  name: string;
  groupCode: string;
  groupName: string;
  reviewCount: number;
  ruleMatches: number;
  share: number;
  weight: number;
  averageRating: number;
  negativeShare: number;
  neutralShare: number;
  positiveShare: number;
  evaluativeShare: number;
  topicScore: number | null;
  negativeDelta: number;
  cxiContribution: number | null;
  evaluativeMentions: number;
  groupWeight: number;
  overallWeight: number;
  previousTopicScore: number | null;
  contributionDelta: number | null;
  problemIndex: number;
  risk: 'low' | 'medium' | 'high';
}

export interface CxTopicGroupSummary {
  code: string;
  name: string;
  activeTopics: number;
  mentions: number;
  cxi: number | null;
  delta: number | null;
  strongestTopic: string;
  problemTopic: string;
}

export interface CxTopicAttention {
  id: string;
  name: string;
  groupName: string;
  reviewCount: number;
  negativeShare: number;
  negativeDelta: number;
  problemIndex: number;
  risk: 'low' | 'medium' | 'high';
}

export interface CxTopicReason {
  pattern: string;
  mentions: number;
}

export interface CxTopicExample {
  sentiment: CxTopicSentiment;
  reviewId: string;
  reviewDate: string;
  sellerSku: string;
  wbSku: string;
  productName: string;
  rating: number;
  reviewText: string;
  advantages: string;
  disadvantages: string;
}

export interface CxTopicTrendPoint {
  date: string;
  textReviews: number;
  classifiedReviews: number;
  mentions: number;
  reviews: number;
  topicShare: number;
  averageRating: number;
  negativeShare: number;
  neutralShare: number;
  positiveShare: number;
  evaluativeShare: number;
  topicScore: number | null;
}

export interface CxTopicComparison {
  current: number | null;
  previous: number | null;
  delta: number | null;
  deltaPercent: number;
}

export interface CxTopicComparisons {
  textReviews: CxTopicComparison;
  classifiedReviews: CxTopicComparison;
  mentions: CxTopicComparison;
  topicScore: CxTopicComparison;
  evaluativeShare: CxTopicComparison;
  negativeShare: CxTopicComparison;
  averageRating: CxTopicComparison;
}

export interface CxTopicProduct {
  entityKey: string;
  localProductId: string | null;
  sellerSku: string;
  wbSku: string;
  productName: string;
  cabinetName: string;
  mentions: number;
  mentionShare: number;
  averageRating: number;
  negativeShare: number;
  neutralShare: number;
  positiveShare: number;
}

export interface CxTopicDashboard {
  workspaceVersion: number;
  version: number;
  selectedTopicId: string | null;
  granularity: CxTopicGranularity;
  mapMedians: { share: number; topicScore: number | null };
  overallCxi: { value: number | null; previous: number | null; delta: number | null; evaluativeMentions: number };
  comparisons: CxTopicComparisons;
  summary: CxTopicSummary;
  groups: CxTopicGroupSummary[];
  attention: CxTopicAttention[];
  topics: CxTopicMetric[];
  trend: CxTopicTrendPoint[];
  products: CxTopicProduct[];
  negativeReasons: CxTopicReason[];
  examples: CxTopicExample[];
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

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sentiment(row: RpcRow) {
  const positiveShare = number(row.positive_share);
  const negativeShare = number(row.negative_share);
  const topicScore = nullableNumber(row.topic_score);
  const explicitNeutral = number(row.neutral_share);
  return {
    positiveShare,
    negativeShare,
    neutralShare: explicitNeutral,
    evaluativeShare: number(row.evaluative_share),
    topicScore,
  };
}

function errorMessage(error: { message: string } | null, context: string) {
  return error ? new Error(`[CX] ${context}: ${error.message}`) : null;
}

function mapReviewRow(row: RpcRow): CxReviewRow {
  return {
    id: String(row.id || ''), reviewDate: String(row.review_date || ''),
    localProductId: row.local_product_id ? String(row.local_product_id) : null,
    cabinetName: String(row.cabinet_name || ''), sellerSku: String(row.seller_sku || ''), wbSku: String(row.wb_sku || ''),
    productName: String(row.product_name || ''), productCategory: String(row.product_category || ''),
    productGroupNames: Array.isArray(row.product_group_names) ? row.product_group_names.map(String) : [],
    reportedBrand: String(row.reported_brand || ''), rating: number(row.rating), reviewText: String(row.review_text || ''),
    advantages: String(row.advantages || ''), disadvantages: String(row.disadvantages || ''), sellerResponse: String(row.seller_response || ''),
    helpfulUp: number(row.helpful_up), helpfulDown: number(row.helpful_down), productMatchStatus: String(row.product_match_status || 'unmatched'),
  };
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

export async function getCxTopicDashboard(
  filters: CxFilters,
  topicId: string | null,
  granularity: CxTopicGranularity,
): Promise<CxTopicDashboard> {
  const rpcParams = {
    ...params(filters),
    p_topic_id: topicId,
  };
  const [workspaceResult, initialTimeseriesResult, cxiResult] = await Promise.all([
    supabase.rpc('get_cx_topics_workspace_v2', rpcParams),
    supabase.rpc('get_cx_topic_timeseries_v2', {
      ...rpcParams,
      p_granularity: granularity,
    }),
    supabase.rpc('get_cx_cxi_summary', params(filters)),
  ]);
  let timeseriesResult = initialTimeseriesResult;
  let { data, error } = workspaceResult;
  if (error && (error.code === 'PGRST202' || error.message.includes('get_cx_topics_workspace_v2'))) {
    ({ data, error } = await supabase.rpc('get_cx_topics_workspace', rpcParams));
  }
  if (error) throw errorMessage(error, 'дашборд тем')!;
  const payload = (data || {}) as RpcRow;
  const timeseriesMissing = timeseriesResult.error
    && (timeseriesResult.error.code === 'PGRST202' || timeseriesResult.error.message.includes('get_cx_topic_timeseries_v2'));
  if (timeseriesMissing) {
    timeseriesResult = await supabase.rpc('get_cx_topic_timeseries', { ...rpcParams, p_granularity: granularity });
  }
  if (timeseriesResult.error) throw errorMessage(timeseriesResult.error, 'динамика тем')!;
  const cxiMissing = cxiResult.error
    && (cxiResult.error.code === 'PGRST202' || cxiResult.error.message.includes('get_cx_cxi_summary'));
  if (cxiResult.error && !cxiMissing) throw errorMessage(cxiResult.error, 'сводка CXI')!;
  const timeseries = (timeseriesResult.data || {}) as RpcRow;
  const summary = (payload.summary || {}) as RpcRow;
  const rows = (value: unknown) => Array.isArray(value) ? value as RpcRow[] : [];
  const summarySentiment = sentiment(summary);
  const comparison = (value: unknown): CxTopicComparison => {
    const row = value && typeof value === 'object' ? value as RpcRow : {};
    return {
      current: nullableNumber(row.current), previous: nullableNumber(row.previous), delta: nullableNumber(row.delta), deltaPercent: number(row.delta_percent),
    };
  };
  const comparisons = (timeseries.comparisons || {}) as RpcRow;
  const medians = (timeseries.medians || {}) as RpcRow;
  const trendSource = rows(timeseries.trend).length ? rows(timeseries.trend) : rows(payload.trend);
  const cxiPayload = (cxiResult.data || {}) as RpcRow;
  const cxiTopicRows = rows(cxiPayload.topics);
  const cxiTopics = new Map(cxiTopicRows.map(row => [String(row.id || ''), row]));
  const cxiGroups = new Map(rows(cxiPayload.groups).map(row => [String(row.code || ''), row]));
  const mappedTopics = rows(payload.topics).map(row => {
    const cxi = cxiTopics.get(String(row.id || '')) || {};
    return {
      id: String(row.id || ''), name: String(row.name || ''), groupCode: String(row.group_code || ''),
      groupName: String(row.group_name || ''), reviewCount: number(row.review_count), ruleMatches: number(row.rule_matches),
      share: number(row.share), weight: number(row.weight), averageRating: number(row.average_rating), ...sentiment(row),
      negativeDelta: number(row.negative_delta), cxiContribution: nullableNumber(cxi.contribution ?? row.cxi_contribution),
      evaluativeMentions: number(cxi.evaluative_mentions), groupWeight: number(cxi.group_weight),
      overallWeight: number(cxi.overall_weight), previousTopicScore: nullableNumber(cxi.previous_tonality),
      contributionDelta: nullableNumber(cxi.contribution_delta),
      problemIndex: number(row.problem_index), risk: String(row.risk || 'low') as CxTopicMetric['risk'],
    };
  });
  const overall = (cxiPayload.overall || {}) as RpcRow;
  const fallbackOverall = mappedTopics.reduce((sum, topic) => sum + (topic.cxiContribution || 0), 0);
  const mappedGroups = rows(payload.groups).map(row => {
    const cxi = cxiGroups.get(String(row.code || '')) || {};
    return {
      code: String(row.code || ''), name: String(row.name || ''), activeTopics: number(row.active_topics),
      mentions: number(row.mentions), cxi: nullableNumber(cxi.cxi ?? row.cxi), delta: nullableNumber(cxi.delta ?? row.delta),
      strongestTopic: String(row.strongest_topic || '—'), problemTopic: String(row.problem_topic || '—'),
    };
  });
  return {
    workspaceVersion: number(payload.workspace_version),
    version: number(payload.version),
    selectedTopicId: payload.selected_topic_id ? String(payload.selected_topic_id) : null,
    granularity: String(timeseries.granularity || granularity) as CxTopicGranularity,
    mapMedians: { share: number(medians.share), topicScore: nullableNumber(medians.topic_score) },
    overallCxi: {
      value: nullableNumber(overall.cxi) ?? (mappedTopics.some(topic => topic.cxiContribution !== null) ? fallbackOverall : null),
      previous: nullableNumber(overall.previous_cxi), delta: nullableNumber(overall.delta),
      evaluativeMentions: number(overall.evaluative_mentions),
    },
    comparisons: {
      textReviews: comparison(comparisons.text_reviews), classifiedReviews: comparison(comparisons.classified_reviews),
      mentions: comparison(comparisons.mentions), topicScore: comparison(comparisons.topic_score),
      evaluativeShare: comparison(comparisons.evaluative_share),
      negativeShare: comparison(comparisons.negative_share), averageRating: comparison(comparisons.average_rating),
    },
    summary: {
      textReviews: number(summary.text_reviews),
      classifiedReviews: number(summary.classified_reviews),
      topicMentions: number(summary.topic_mentions),
      coverage: number(summary.coverage),
      averageRating: number(summary.average_rating),
      ...summarySentiment,
    },
    groups: mappedGroups,
    attention: rows(payload.attention).map(row => ({
      id: String(row.id || ''), name: String(row.name || ''), groupName: String(row.group_name || ''),
      reviewCount: number(row.review_count), negativeShare: number(row.negative_share), negativeDelta: number(row.negative_delta),
      problemIndex: number(row.problem_index), risk: String(row.risk || 'low') as CxTopicAttention['risk'],
    })),
    topics: mappedTopics,
    trend: trendSource.map(row => ({
      date: String(row.date || ''), textReviews: number(row.text_reviews), classifiedReviews: number(row.classified_reviews),
      mentions: number(row.mentions), reviews: number(row.reviews), topicShare: number(row.topic_share),
      averageRating: number(row.average_rating), ...sentiment(row),
    })),
    products: rows(payload.products).map(row => ({
      entityKey: String(row.entity_key || ''), localProductId: row.local_product_id ? String(row.local_product_id) : null,
      sellerSku: String(row.seller_sku || ''), wbSku: String(row.wb_sku || ''), productName: String(row.product_name || ''),
      cabinetName: String(row.cabinet_name || ''), mentions: number(row.mentions), mentionShare: number(row.mention_share),
      averageRating: number(row.average_rating), negativeShare: number(row.negative_share), neutralShare: number(row.neutral_share), positiveShare: number(row.positive_share),
    })),
    negativeReasons: rows(payload.negative_reasons).map(row => ({
      pattern: String(row.pattern || ''), mentions: number(row.mentions),
    })),
    examples: rows(payload.examples).map(row => ({
      sentiment: String(row.sentiment || 'neutral') as CxTopicSentiment,
      reviewId: String(row.review_id || ''), reviewDate: String(row.review_date || ''),
      sellerSku: String(row.seller_sku || ''), wbSku: String(row.wb_sku || ''), productName: String(row.product_name || ''),
      rating: number(row.rating), reviewText: String(row.review_text || ''), advantages: String(row.advantages || ''),
      disadvantages: String(row.disadvantages || ''),
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
    rows: sourceRows.map((row: RpcRow) => mapReviewRow(row)),
  };
}

export async function getCxTopicReviewsPage(
  filters: CxFilters,
  topicId: string,
  sentimentFilter: CxTopicSentiment,
  page: number,
  pageSize = 20,
): Promise<{ rows: CxTopicReviewRow[]; total: number }> {
  if (filters.productIds && filters.productIds.length === 0) return { rows: [], total: 0 };
  const { data, error } = await supabase.rpc('get_cx_topic_reviews_page', {
    ...params(filters),
    p_topic_id: topicId,
    p_sentiment: sentimentFilter,
    p_limit: pageSize,
    p_offset: Math.max(0, page) * pageSize,
  });
  if (error) throw errorMessage(error, 'детализация тональности')!;
  const sourceRows = data || [];
  return {
    total: number(sourceRows[0]?.total_count),
    rows: sourceRows.map((row: RpcRow) => ({
      ...mapReviewRow(row),
      sentiment: String(row.sentiment || 'neutral') as CxTopicSentiment,
      matchedRules: Array.isArray(row.matched_rules) ? row.matched_rules.map(rule => {
        const source = rule && typeof rule === 'object' ? rule as RpcRow : {};
        return { id: String(source.id || ''), type: String(source.type || ''), pattern: String(source.pattern || '') };
      }) : [],
    })),
  };
}
