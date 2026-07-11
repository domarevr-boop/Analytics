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
}

export interface GroupMembership {
  product_id: string;
  group_id: string;
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

export type RowType = 'cabinet' | 'group' | 'product';

export interface TableRow {
  id: string;
  type: RowType;
  name: string;
  sku?: string;
  depth: number;
  parent: string | null;
  current: MetricValues;
  previous: MetricValues;
}

export type EntityType = 'cabinet' | 'group' | 'product';

export type PageName = 'dashboard' | 'import' | 'dictionary' | 'planning' | 'profitability' | 'admin'
  | 'funnel' | 'entry-points' | 'search-phrases';

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

export type ImportSource = 'wb_funnel' | 'xway' | 'profitability' | 'plan_template';

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
  metrics: DailyMetrics[];
  plans: PlanRecord[];
  monthlyPlans: MonthlyPlanRecord[];
  profitability: ProfitabilityRecord[];
  importLogs: ImportFileLog[];
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
  deleteMetrics?(opts: { productIds: string[]; dateStart?: string; dateEnd?: string }): Promise<void>;
  deleteImportLog?(logId: string): Promise<void>;
  deleteProfitability?(productId: string): Promise<void>;
}
