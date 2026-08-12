import type { CompetitorPositionRecord, CompetitorSearchRecord } from '../types';

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

export type TopMovementStatus = 'retained' | 'new' | 'exited' | 'intermittent';

export interface TopTimelinePoint {
  date: string;
  size: number;
  retained: number;
  entrants: number;
  exits: number;
  retentionRate: number | null;
}

export interface TopBrandStructure {
  key: string;
  brand: string;
  counts: number[];
  latest: number;
  delta: number;
}

export interface TopArticleMovement {
  article: string;
  brand: string;
  seller: string;
  positions: Array<number | null>;
  baseline: number | null;
  comparison: number | null;
  best: number;
  worst: number;
  days: number;
  delta: number | null;
  status: TopMovementStatus;
}

export interface CompetitorTopDynamics {
  dates: string[];
  timeline: TopTimelinePoint[];
  brandStructure: TopBrandStructure[];
  movements: TopArticleMovement[];
  stabilityRate: number;
  entrants: number;
  exits: number;
  averageMovement: number;
  brandsLatest: number;
}

export function calculateCompetitorTopDynamics(rows: ReadonlyArray<CompetitorPositionRecord>, topDepth: number): CompetitorTopDynamics {
  const depth = Math.max(1, Math.floor(topDepth));
  const dates = [...new Set(rows.map(row => row.date).filter(Boolean))].sort();
  const snapshots = new Map<string, Map<string, CompetitorPositionRecord>>();
  for (const date of dates) {
    const snapshot = new Map<string, CompetitorPositionRecord>();
    rows.filter(row => row.date === date && row.position > 0 && row.position <= depth)
      .sort((left, right) => left.position - right.position)
      .forEach(row => {
        const existing = snapshot.get(row.wb_article);
        if (!existing || row.position < existing.position) snapshot.set(row.wb_article, row);
      });
    snapshots.set(date, snapshot);
  }

  const timeline = dates.map((date, index): TopTimelinePoint => {
    const current = snapshots.get(date) || new Map();
    const previous = index > 0 ? snapshots.get(dates[index - 1]) || new Map() : null;
    if (!previous) return { date, size: current.size, retained: 0, entrants: 0, exits: 0, retentionRate: null };
    const retained = [...current.keys()].filter(article => previous.has(article)).length;
    return {
      date,
      size: current.size,
      retained,
      entrants: [...current.keys()].filter(article => !previous.has(article)).length,
      exits: [...previous.keys()].filter(article => !current.has(article)).length,
      retentionRate: previous.size ? retained / previous.size * 100 : 0,
    };
  });

  const first = snapshots.get(dates[0]) || new Map();
  const last = snapshots.get(dates.at(-1) || '') || new Map();
  const retainedArticles = [...first.keys()].filter(article => last.has(article));
  const entrants = [...last.keys()].filter(article => !first.has(article)).length;
  const exits = [...first.keys()].filter(article => !last.has(article)).length;
  const averageMovement = retainedArticles.length
    ? retainedArticles.reduce((sum, article) => sum + Math.abs(first.get(article)!.position - last.get(article)!.position), 0) / retainedArticles.length
    : 0;

  const brandMap = new Map<string, { brand: string; counts: number[] }>();
  dates.forEach((date, dateIndex) => {
    const counts = new Map<string, { brand: string; count: number }>();
    for (const row of (snapshots.get(date) || new Map()).values()) {
      const brand = row.brand.trim() || 'Без бренда';
      const key = brand.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/\s+/g, ' ');
      const current = counts.get(key) || { brand, count: 0 };
      current.count += 1;
      counts.set(key, current);
    }
    counts.forEach((value, key) => {
      const target = brandMap.get(key) || { brand: value.brand, counts: Array(dates.length).fill(0) };
      target.counts[dateIndex] = value.count;
      brandMap.set(key, target);
    });
  });
  const brandStructure = [...brandMap.entries()].map(([key, value]) => ({
    key,
    brand: value.brand,
    counts: value.counts,
    latest: value.counts.at(-1) || 0,
    delta: (value.counts.at(-1) || 0) - (value.counts[0] || 0),
  })).sort((left, right) => right.latest - left.latest || right.counts.reduce((sum, value) => sum + value, 0) - left.counts.reduce((sum, value) => sum + value, 0));

  const articleIds = [...new Set(dates.flatMap(date => [...(snapshots.get(date) || new Map()).keys()]))];
  const movements = articleIds.map((article): TopArticleMovement => {
    const positions = dates.map(date => snapshots.get(date)?.get(article)?.position ?? null);
    const observed = positions.filter((position): position is number => position !== null);
    const baseline = positions[0];
    const comparison = positions.at(-1) ?? null;
    const sample = dates.map(date => snapshots.get(date)?.get(article)).find(Boolean)!;
    const status: TopMovementStatus = baseline !== null && comparison !== null ? 'retained' : baseline === null && comparison !== null ? 'new' : baseline !== null ? 'exited' : 'intermittent';
    return {
      article,
      brand: sample.brand || 'Без бренда',
      seller: sample.seller,
      positions,
      baseline,
      comparison,
      best: Math.min(...observed),
      worst: Math.max(...observed),
      days: observed.length,
      delta: baseline !== null && comparison !== null ? baseline - comparison : null,
      status,
    };
  }).sort((left, right) => {
    const statusOrder: Record<TopMovementStatus, number> = { new: 0, exited: 1, retained: 2, intermittent: 3 };
    return statusOrder[left.status] - statusOrder[right.status]
      || (left.comparison ?? 999) - (right.comparison ?? 999)
      || Math.abs(right.delta || 0) - Math.abs(left.delta || 0);
  });

  return {
    dates,
    timeline,
    brandStructure,
    movements,
    stabilityRate: first.size ? retainedArticles.length / first.size * 100 : 0,
    entrants,
    exits,
    averageMovement,
    brandsLatest: new Set([...last.values()].map(row => row.brand.trim() || 'Без бренда')).size,
  };
}
