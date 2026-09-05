export interface Cabinet {
  id: string;
  name: string;
}

export interface Brand {
  id: string;
  name: string;
}

export interface ProductGroup {
  id: string;
  name: string;
  cabinet_id: string;
}

export interface Product {
  id: string;
  sku: string;
  wb_sku: string;
  name: string;
  category: string;
  brand_id: string;
  cabinet_id: string;
  aliases?: string[];
  status?: 'active' | 'archived';
  data_source?: 'import' | 'manual' | 'seed';
  updated_at?: string;
}

export interface GroupMembership {
  product_id: string;
  group_id: string;
}

export interface GroupMembershipHistory {
  date: string;
  product_id: string;
  group_id: string;
  source: 'import' | 'manual' | 'legacy';
}

export interface DailyMetrics {
  date: string;
  product_id: string;
  impressions: number;
  clicks: number;
  carts: number;
  orders: number;
  buyouts: number;
  cancellations: number;
  ordered_amount: number;
  buyout_amount: number;
  cancellation_amount: number;
  ad_impressions: number;
  ad_clicks: number;
  ad_orders: number;
  ad_spend: number;
  stock: number;
  plan_orders: number;
  forecast_profit_per_order: number;
  actual_profit: number;
  actual_margin: number;
  profit_revenue: number;
  cost: number;
  agent_fee: number;
  logistics_cost: number;
  marketing_cost: number;
  storage_cost: number;
}

export interface MetricValues {
  impressions: number;
  clicks: number;
  ctr: number;
  carts: number;
  cr_cart: number;
  orders: number;
  avg_price: number;
  cr_order: number;
  ad_spend: number;
  ad_clicks: number;
  ad_orders: number;
  cpc: number;
  cpo: number;
  drr: number;
  drrForecast: number;
  drrActual: number;
  plan_orders: number;
  plan_orders_qty: number;
  plan_sum: number;
  plan_price: number;
  plan_net_profit: number;
  plan_profitability: number;
  plan_revenue: number;
  fact_orders: number;
  plan_pct: number;
  revenue: number;
  effectiveRevenue: number;
  buyout_amount: number;
  profit: number;
  margin: number;
  stock: number;
}

export type RowType = 'cabinet' | 'category' | 'group' | 'product';

export interface TableRow {
  id: string;
  type: RowType;
  name: string;
  sku?: string;
  productId?: string;
  groupId?: string;
  depth: number;
  parent: string | null;
  current: MetricValues;
  previous: MetricValues;
}

export type EntityType = 'cabinet' | 'group' | 'product';

export type PageName = 'dashboard' | 'import' | 'dictionary' | 'planning' | 'profitability' | 'admin' | 'dev'
  | 'funnel' | 'entry-points' | 'search-phrases' | 'market' | 'geography' | 'client-experience' | 'competitors' | 'reporting' | 'product';

export interface PlanRecord {
  entityId: string;
  entityType: 'cabinet' | 'group' | 'product';
  parentId: string | null;
  name: string;
  ordersQty: number;
  avgPrice: number;
  ordersSum: number;
  profitability: number;
  netProfit: number;
}

export interface ProfitabilityRecord {
  id: string;
  product_id: string;
  period_start: string;
  period_end: string;
  actual_profit: number;
  actual_margin: number;
  profit_revenue: number;
}

export interface MonthlyPlanRecord {
  sku: string;
  month: string;
  avgQtyPerDay: number;
  costPrice: number;
  checkAmount: number;
  netProfitPerUnit: number;
  totalNetProfit: number;
  profitability: number;
  totalQty: number;
  totalRubles: number;
  buyoutRate: number;
}

export type AggregatePlanKind = 'fixed' | 'scenario' | 'backup';
export type AggregatePlanScope = 'category' | 'brand';

export interface AggregateMonthlyPlanRecord {
  id: string;
  kind: AggregatePlanKind;
  month: string;
  scope: AggregatePlanScope;
  cabinet_id: string;
  entity_id: string;
  entity_name: string;
  orders_sum: number | null;
  avg_qty_per_day: number | null;
  avg_check: number | null;
  buyout_rate: number | null;
  payout_rate: number | null;
  profitability: number | null;
  updated_at: string;
}

export interface PlanningSettingsRecord {
  id: 'global';
  prefer_aggregate_plan: boolean;
}

export interface GeographyOrderRecord {
  date: string;
  product_id: string;
  region: string;
  area: string;
  city: string;
  delivery_hours: number | null;
  orders_total: number;
  product_local_orders: number;
  product_nonlocal_orders: number;
  wb_local_orders: number;
  wb_nonlocal_orders: number;
  marketplace_local_orders: number;
  marketplace_nonlocal_orders: number;
}

export interface GeographyPlanRecord {
  month: string;
  local_share_target: number | null;
  delivery_hours_target: number | null;
}

export interface EntryPointRecord {
  date: string;
  product_id: string;
  section: string;
  entry_point: string;
  impressions: number;
  clicks: number;
  carts: number;
  orders: number;
  product_orders_total?: number;
  product_ordered_amount?: number;
  product_net_profit?: number;
  product_profit_revenue?: number;
  product_profitability?: number;
  product_ad_spend?: number;
}

export interface SearchQueryRecord {
  date: string;
  query: string;
  category: string;
  requests: number;
  requests_previous: number;
  avg_daily_requests: number;
  avg_daily_requests_previous: number;
  card_clicks: number;
  card_clicks_previous: number;
  carts: number;
  carts_previous: number;
  cart_conversion: number;
  cart_conversion_previous: number;
  orders: number;
  orders_previous: number;
  order_conversion: number;
  order_conversion_previous: number;
  ordered_subjects: number;
  ordered_subjects_previous: number;
  products: number;
  products_previous: number;
}

export interface NicheDynamicsRecord {
  date: string;
  category: string;
  subject: string;
  sellers: number;
  active_sellers: number;
  active_sellers_previous: number;
  monopolization: number;
  monopolization_previous: number;
  revenue: number;
  revenue_previous: number;
  avg_check: number;
  avg_check_previous: number;
  product_cards: number;
  active_product_cards: number;
  active_product_cards_previous: number;
  active_product_cards_share: number;
  weekly_turnover_days: number;
  availability: string;
  avg_stock: number;
  buyout_rate: number;
  buyout_rate_previous: number;
  avg_rating: number;
}

export interface MarketDynamicsRecord {
  date: string;
  market_ordered_amount: number;
  own_ordered_amount: number;
  amount_share: number;
  market_orders: number;
  own_orders: number;
  orders_share: number;
  own_avg_check: number;
  market_avg_check: number;
}

export interface CompetitorFunnelRecord {
  date: string;
  position: number;
  wb_article: string;
  seller: string;
  brand: string;
  ordered_amount: number;
  discounted_price: number;
  buyer_median_price: number;
  avg_search_position: number;
  impressions: number;
  clicks: number;
  ctr: number;
  carts: number;
  cart_conversion: number;
  orders: number;
  order_conversion: number;
  buyouts: number;
  buyout_rate: number;
}

export interface CompetitorSearchRecord {
  date: string;
  wb_article: string;
  query: string;
  requests: number;
  requests_previous: number;
  cart_conversion: number;
  cart_conversion_previous: number;
  order_conversion: number;
  order_conversion_previous: number;
}

export interface CompetitorStockRecord {
  date: string;
  name: string;
  wb_article: string;
  subject: string;
  brand: string;
  region: string;
  warehouse: string;
  stock: number;
  in_transit_to_customer: number;
  in_transit_from_customer: number;
  avg_daily_orders: number;
}

export interface CompetitorPositionRecord {
  date: string;
  position: number;
  wb_article: string;
  seller: string;
  brand: string;
}

export type ImportSource = 'wb_funnel' | 'xway' | 'profitability' | 'geography' | 'entry_points' | 'search_queries' | 'niche_dynamics' | 'market_dynamics' | 'competitors' | 'reviews' | 'plan_template' | 'group_history';

export interface ImportFileLog {
  id: string;
  fileName: string;
  source: ImportSource;
  rowCount: number;
  uploadedAt: string;
  status: 'processing' | 'success' | 'error';
  error?: string;
  cabinetId?: string;
  cabinetName?: string;
  dataStart?: string;
  dataEnd?: string;
  productIds?: string[];
}

export interface DataSnapshot {
  cabinets: Cabinet[];
  brands: Brand[];
  groups: ProductGroup[];
  products: Product[];
  memberships: GroupMembership[];
  groupHistory: GroupMembershipHistory[];
  metrics: DailyMetrics[];
  plans: PlanRecord[];
  monthlyPlans: MonthlyPlanRecord[];
  aggregatePlans: AggregateMonthlyPlanRecord[];
  planningSettings: PlanningSettingsRecord[];
  profitability: ProfitabilityRecord[];
  geography: GeographyOrderRecord[];
  geographyPlans: GeographyPlanRecord[];
  entryPoints: EntryPointRecord[];
  searchQueries: SearchQueryRecord[];
  nicheDynamics: NicheDynamicsRecord[];
  marketDynamics: MarketDynamicsRecord[];
  competitorFunnel: CompetitorFunnelRecord[];
  competitorSearch: CompetitorSearchRecord[];
  competitorStocks: CompetitorStockRecord[];
  competitorPositions: CompetitorPositionRecord[];
  importLogs: ImportFileLog[];
}

export interface DataChanges {
  cabinets: ChangeSet<Cabinet>;
  brands: ChangeSet<Brand>;
  groups: ChangeSet<ProductGroup>;
  products: ChangeSet<Product>;
  memberships: ChangeSet<GroupMembership>;
  groupHistory: ChangeSet<GroupMembershipHistory>;
  metrics: ChangeSet<DailyMetrics>;
  plans: ChangeSet<PlanRecord>;
  monthlyPlans: ChangeSet<MonthlyPlanRecord>;
  aggregatePlans: ChangeSet<AggregateMonthlyPlanRecord>;
  planningSettings: ChangeSet<PlanningSettingsRecord>;
  profitability: ChangeSet<ProfitabilityRecord>;
  geography: ChangeSet<GeographyOrderRecord>;
  geographyPlans: ChangeSet<GeographyPlanRecord>;
  entryPoints: ChangeSet<EntryPointRecord>;
  searchQueries: ChangeSet<SearchQueryRecord>;
  nicheDynamics: ChangeSet<NicheDynamicsRecord>;
  marketDynamics: ChangeSet<MarketDynamicsRecord>;
  competitorFunnel: ChangeSet<CompetitorFunnelRecord>;
  competitorSearch: ChangeSet<CompetitorSearchRecord>;
  competitorStocks: ChangeSet<CompetitorStockRecord>;
  competitorPositions: ChangeSet<CompetitorPositionRecord>;
  importLogs: ChangeSet<ImportFileLog>;
}

export interface ChangeSet<T> {
  upserts: T[];
  deletes: IDBValidKey[];
}

export interface SaveResult {
  ok: boolean;
  errors: string[];
}

export interface IDataRepository {
  readonly name: string;
  initialize(): Promise<void>;
  loadAll(): Promise<DataSnapshot>;
  saveAll(data: DataSnapshot): Promise<SaveResult>;
  saveChanges(data: DataChanges): Promise<SaveResult>;
  deleteMetrics?(opts: { productIds: string[]; dateStart?: string; dateEnd?: string }): Promise<void>;
  deleteImportLog?(logId: string): Promise<void>;
  deleteProfitability?(productId: string): Promise<void>;
}
