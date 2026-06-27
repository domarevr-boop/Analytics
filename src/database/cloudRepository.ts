import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DataSnapshot, IDataRepository, Cabinet, Brand, ProductGroup, Product, GroupMembership, DailyMetrics, PlanRecord, MonthlyPlanRecord, ImportFileLog } from '../types';

export class CloudRepository implements IDataRepository {
  readonly name = 'cloud';
  private client: SupabaseClient | null = null;
  private _ready = false;

  get isReady() { return this._ready; }

  async initialize(): Promise<void> {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !key) {
      console.warn('[cloud] Supabase credentials not configured');
      return;
    }
    this.client = createClient(url, key);

    const { error } = await this.client.from('cabinets').select('id').limit(1);
    if (error) {
      console.warn('[cloud] Supabase tables not ready — run supabase/migration.sql');
      console.warn('[cloud] error:', error.message);
      return;
    }
    this._ready = true;
    console.log('[cloud] connected');
  }

  private check() {
    if (!this.client || !this._ready) throw new Error('CloudRepository not initialized');
  }

  async loadAll(): Promise<DataSnapshot> {
    this.check();
    const c = this.client!;

    const [cabinets, brands, groups, products, memberships, metrics, plans, monthlyPlans, importLogs] = await Promise.all([
      c.from('cabinets').select('id,name').order('name'),
      c.from('brands').select('id,name').order('name'),
      c.from('product_groups').select('id,name,cabinet_id').order('name'),
      c.from('products').select('id,sku,wb_sku,name,category,brand_id,cabinet_id').order('name'),
      c.from('group_memberships').select('product_id,group_id'),
      c.from('daily_metrics').select('*').order('date'),
      c.from('plans').select('entity_id,entity_type,parent_id,name,orders_qty,avg_price,orders_sum,profitability,net_profit'),
      c.from('monthly_plans').select('sku,month,avg_qty_per_day,cost_price,check_amount,net_profit_per_unit,total_net_profit,profitability,total_qty,total_rubles,buyout_rate').order('month,sku'),
      c.from('import_logs').select('id,file_name,source,row_count,uploaded_at,status,error,cabinet_id,cabinet_name,data_start,data_end,product_ids').order('uploaded_at', { ascending: false }),
    ]);

    if (cabinets.error) throw cabinets.error;
    if (brands.error) throw brands.error;
    if (groups.error) throw groups.error;
    if (products.error) throw products.error;
    if (memberships.error) throw memberships.error;
    if (metrics.error) throw metrics.error;
    if (plans.error) throw plans.error;
    if (monthlyPlans.error) throw monthlyPlans.error;
    if (importLogs.error) throw importLogs.error;

    return {
      cabinets: (cabinets.data || []) as Cabinet[],
      brands: (brands.data || []) as Brand[],
      groups: (groups.data || []) as ProductGroup[],
      products: (products.data || []) as Product[],
      memberships: (memberships.data || []) as GroupMembership[],
      metrics: (metrics.data || []).map((r: any) => ({
        date: r.date, product_id: r.product_id,
        impressions: r.impressions, clicks: r.clicks, carts: r.carts,
        orders: r.orders, buyouts: r.buyouts, cancellations: r.cancellations,
        ordered_amount: r.ordered_amount, buyout_amount: r.buyout_amount,
        cancellation_amount: r.cancellation_amount,
        ad_impressions: r.ad_impressions, ad_clicks: r.ad_clicks,
        ad_orders: r.ad_orders, ad_spend: r.ad_spend,
        stock: r.stock, plan_orders: r.plan_orders,
        forecast_profit_per_order: r.forecast_profit_per_order,
        actual_profit: r.actual_profit, actual_margin: r.actual_margin,
      })) as DailyMetrics[],
      plans: (plans.data || []).map((r: any) => ({
        entityId: r.entity_id, entityType: r.entity_type,
        parentId: r.parent_id, name: r.name,
        ordersQty: r.orders_qty, avgPrice: r.avg_price,
        ordersSum: r.orders_sum, profitability: r.profitability,
        netProfit: r.net_profit,
      })) as PlanRecord[],
      monthlyPlans: (monthlyPlans.data || []).map((r: any) => ({
        sku: r.sku, month: r.month,
        avgQtyPerDay: r.avg_qty_per_day, costPrice: r.cost_price,
        checkAmount: r.check_amount, netProfitPerUnit: r.net_profit_per_unit,
        totalNetProfit: r.total_net_profit, profitability: r.profitability,
        totalQty: r.total_qty, totalRubles: r.total_rubles,
        buyoutRate: r.buyout_rate,
      })) as MonthlyPlanRecord[],
      importLogs: (importLogs.data || []).map((r: any) => ({
        id: r.id, fileName: r.file_name, source: r.source,
        rowCount: r.row_count, uploadedAt: r.uploaded_at,
        status: r.status, error: r.error || undefined,
        cabinetId: r.cabinet_id || undefined,
        cabinetName: r.cabinet_name || undefined,
        dataStart: r.data_start || undefined,
        dataEnd: r.data_end || undefined,
        productIds: r.product_ids ? JSON.parse(r.product_ids) : undefined,
      })) as ImportFileLog[],
    };
  }

  async saveAll(data: DataSnapshot): Promise<void> {
    if (!this._ready) return;
    this.check();
    const c = this.client!;

    const results = await Promise.allSettled([
      c.from('cabinets').upsert(data.cabinets, { onConflict: 'id' }),
      c.from('brands').upsert(data.brands, { onConflict: 'id' }),
      c.from('product_groups').upsert(data.groups.map(g => ({ id: g.id, name: g.name, cabinet_id: g.cabinet_id })), { onConflict: 'id' }),
      c.from('products').upsert(data.products.map(p => ({
        id: p.id, sku: p.sku, wb_sku: p.wb_sku, name: p.name,
        category: p.category, brand_id: p.brand_id, cabinet_id: p.cabinet_id,
      })), { onConflict: 'id' }),
      c.from('group_memberships').upsert(data.memberships, { onConflict: 'product_id,group_id' }),
      c.from('daily_metrics').upsert(data.metrics.map(m => ({
        date: m.date, product_id: m.product_id,
        impressions: m.impressions, clicks: m.clicks, carts: m.carts,
        orders: m.orders, buyouts: m.buyouts, cancellations: m.cancellations,
        ordered_amount: m.ordered_amount, buyout_amount: m.buyout_amount,
        cancellation_amount: m.cancellation_amount,
        ad_impressions: m.ad_impressions, ad_clicks: m.ad_clicks,
        ad_orders: m.ad_orders, ad_spend: m.ad_spend,
        stock: m.stock, plan_orders: m.plan_orders,
        forecast_profit_per_order: m.forecast_profit_per_order,
        actual_profit: m.actual_profit, actual_margin: m.actual_margin,
      })), { onConflict: 'date,product_id' }),
      c.from('plans').upsert(data.plans.map(p => ({
        entity_id: p.entityId, entity_type: p.entityType,
        parent_id: p.parentId, name: p.name,
        orders_qty: p.ordersQty, avg_price: p.avgPrice,
        orders_sum: p.ordersSum, profitability: p.profitability,
        net_profit: p.netProfit,
      })), { onConflict: 'entity_id,entity_type' }),
      c.from('monthly_plans').upsert(data.monthlyPlans.map(p => ({
        sku: p.sku, month: p.month,
        avg_qty_per_day: p.avgQtyPerDay, cost_price: p.costPrice,
        check_amount: p.checkAmount, net_profit_per_unit: p.netProfitPerUnit,
        total_net_profit: p.totalNetProfit, profitability: p.profitability,
        total_qty: p.totalQty, total_rubles: p.totalRubles,
        buyout_rate: p.buyoutRate,
      })), { onConflict: 'sku,month' }),
      c.from('import_logs').upsert(data.importLogs.map(l => ({
        id: l.id, file_name: l.fileName, source: l.source,
        row_count: l.rowCount, uploaded_at: l.uploadedAt,
        status: l.status, error: l.error || null,
        cabinet_id: l.cabinetId || null, cabinet_name: l.cabinetName || null,
        data_start: l.dataStart || null, data_end: l.dataEnd || null,
        product_ids: l.productIds ? JSON.stringify(l.productIds) : null,
      })), { onConflict: 'id' }),
    ]);

    for (const r of results) {
      if (r.status === 'rejected') {
        console.warn('[cloud] sync error:', r.reason);
      }
    }
  }
}
