import type { CompetitorSearchRecord } from '../types';

export function weightedBuyoutRate(rows: ReadonlyArray<{ orders: number; buyout_rate: number }>): number {
  const valid = rows.filter(row => Number.isFinite(row.buyout_rate) && row.buyout_rate >= 0);
  const weight = valid.reduce((sum, row) => sum + Math.max(row.orders, 0), 0);
  if (weight > 0) return valid.reduce((sum, row) => sum + row.buyout_rate * Math.max(row.orders, 0), 0) / weight;
  return valid.length ? valid.reduce((sum, row) => sum + row.buyout_rate, 0) / valid.length : 0;
}

export interface CompetitorQuerySummary {
  query: string;
  requests: number;
  requestsPrevious: number;
  articles: number;
}

export function aggregateCompetitorQueries(rows: ReadonlyArray<Pick<CompetitorSearchRecord, 'query' | 'requests' | 'requests_previous' | 'wb_article'>>): CompetitorQuerySummary[] {
  const groups = new Map<string, CompetitorQuerySummary & { articleIds: Set<string> }>();
  for (const row of rows) {
    const key = row.query.trim().toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/\s+/g, ' ');
    if (!key) continue;
    const group = groups.get(key) || { query: row.query.trim(), requests: 0, requestsPrevious: 0, articles: 0, articleIds: new Set<string>() };
    group.requests = Math.max(group.requests, row.requests);
    group.requestsPrevious = Math.max(group.requestsPrevious, row.requests_previous);
    group.articleIds.add(row.wb_article);
    group.articles = group.articleIds.size;
    groups.set(key, group);
  }
  return [...groups.values()].map(group => ({
    query: group.query,
    requests: group.requests,
    requestsPrevious: group.requestsPrevious,
    articles: group.articles,
  })).sort((left, right) => right.requests - left.requests);
}
