export const TABLE_METRIC_GROUPS = [
  { label: 'Бизнес метрики', keys: ['fact_orders', 'orders', 'avg_price', 'profit', 'margin'] as const },
  { label: 'Реклама', keys: ['ad_spend', 'drr'] as const },
  { label: 'Воронка', keys: ['impressions', 'clicks', 'ctr', 'carts', 'cr_cart', 'cr_order'] as const },
  { label: 'Финансы', keys: ['revenue'] as const },
];

export type TableMetricKey = typeof TABLE_METRIC_GROUPS[number]['keys'][number];

export const TABLE_METRIC_LABELS: Record<TableMetricKey, string> = {
  impressions: 'Показы', clicks: 'Клики', ctr: 'CTR',
  carts: 'Корзины', cr_cart: 'CR корз', orders: 'Заказы, шт', cr_order: 'CR зак',
  fact_orders: 'Факт заказов', avg_price: 'Средняя цена',
  ad_spend: 'Расход', drr: 'ДРР',
  profit: 'Прибыль', margin: 'Рент-сть',
  revenue: 'Выручка',
};
