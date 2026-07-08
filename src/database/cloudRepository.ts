import { supabase } from '../lib/supabaseClient';
import type { DataSnapshot, IDataRepository, Cabinet, Brand, ProductGroup, Product, GroupMembership, DailyMetrics, PlanRecord, MonthlyPlanRecord, ImportFileLog, ProfitabilityRecord, SaveResult } from '../types';

interface MetricsRow { date: string; product_id: string; impressions: number; clicks: number; carts: number; orders: number; buyouts: number; cancellations: number; ordered_amount: number; buyout_amount: number; cancellation_amount: number; ad_impressions: number; ad_clicks: number; ad_orders: number; ad_spend: number; stock: number; plan_orders: number; forecast_profit_per_order: number; actual_profit: number; actual_margin: number; profit_revenue: number }
interface PlanRow { entity_id: string; entity_type: 'cabinet' | 'group' | 'product'; parent_id: string | null; name: string; orders_qty: number; avg_price: number; orders_sum: number; profitability: number; net_profit: number }
interface MonthlyPlanRow { sku: string; month: string; avg_qty_per_day: number; cost_price: number; check_amount: number; net_profit_per_unit: number; total_net_profit: number; profitability: number; total_qty: number; total_rubles: number; buyout_rate: number }
interface ProfitabilityRow { id: string; product_id: string; period_start: string; period_end: string; actual_profit: number; actual_margin: number; profit_revenue: number }
interface ImportLogRow { id: string; file_name: string; source: string; row_count: number; uploaded_at: string; status: string; error: string | null; cabinet_id: string | null; cabinet_name: string | null; data_start: string | null; data_end: string | null; product_ids: string | null }

export class CloudRepository implements IDataRepository {
  private readonly DEV = import.meta.env.DEV;
  readonly name = 'cloud';
  private _ready = false;

  get isReady() { return this._ready; }

  async initialize(): Promise<void> {
    const { error } = await supabase.from('cabinets').select('id').limit(1);
    if (error) {
      console.warn('[cloud] Supabase tables not ready — run supabase/migration.sql');
      console.warn('[cloud] error:', error.message);
      return;
    }
    this._ready = true;
    if (this.DEV) console.log('[cloud] connected');
  }

  async loadAll(): Promise<DataSnapshot> {
    if (!this._ready) throw new Error('CloudRepository not initialized');
    const c = supabase;

    const [cabinets, brands, groups, products, memberships, metrics, plans, monthlyPlans, profitability, importLogs] = await Promise.all([
      c.from('cabinets').select('id,name').order('name'),
      c.from('brands').select('id,name').order('name'),
      c.from('product_groups').select('id,name,cabinet_id').order('name'),
      c.from('products').select('id,sku,wb_sku,name,category,brand_id,cabinet_id').order('name'),
      c.from('group_memberships').select('product_id,group_id'),
      c.from('daily_metrics').select('*').order('date'),
      c.from('plans').select('entity_id,entity_type,parent_id,name,orders_qty,avg_price,orders_sum,profitability,net_profit'),
      c.from('monthly_plans').select('sku,month,avg_qty_per_day,cost_price,check_amount,net_profit_per_unit,total_net_profit,profitability,total_qty,total_rubles,buyout_rate').order('month,sku'),
      c.from('profitability_reports').select('*').order('period_start'),
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
    if (profitability.error) throw profitability.error;
    if (importLogs.error) throw importLogs.error;

    const toMetrics = (r: MetricsRow): DailyMetrics => ({
      date: r.date, product_id: r.product_id,
      impressions: r.impressions, clicks: r.clicks, carts: r.carts,
      orders: r.orders, buyouts: r.buyouts, cancellations: r.cancellations,
      ordered_amount: r.ordered_amount, buyout_amount: r.buyout_amount,
      cancellation_amount: r.cancellation_amount,
      ad_impressions: r.ad_impressions, ad_clicks: r.ad_clicks,
      ad_orders: r.ad_orders, ad_spend: r.ad_spend,
      stock: r.stock, plan_orders: r.plan_orders,
      forecast_profit_per_order: r.forecast_profit_per_order,
      actual_profit: r.actual_profit, actual_margin: r.actual_margin, profit_revenue: r.profit_revenue || 0,
    });

    const toPlan = (r: PlanRow): PlanRecord => ({
      entityId: r.entity_id, entityType: r.entity_type,
      parentId: r.parent_id, name: r.name,
      ordersQty: r.orders_qty, avgPrice: r.avg_price,
      ordersSum: r.orders_sum, profitability: r.profitability,
      netProfit: r.net_profit,
    });

    const toMonthlyPlan = (r: MonthlyPlanRow): MonthlyPlanRecord => ({
      sku: r.sku, month: r.month,
      avgQtyPerDay: r.avg_qty_per_day, costPrice: r.cost_price,
      checkAmount: r.check_amount, netProfitPerUnit: r.net_profit_per_unit,
      totalNetProfit: r.total_net_profit, profitability: r.profitability,
      totalQty: r.total_qty, totalRubles: r.total_rubles,
      buyoutRate: r.buyout_rate,
    });

    const toProfitability = (r: ProfitabilityRow): ProfitabilityRecord => ({
      id: r.id, product_id: r.product_id,
      period_start: r.period_start, period_end: r.period_end,
      actual_profit: r.actual_profit, actual_margin: r.actual_margin,
      profit_revenue: r.profit_revenue || 0,
    });

    const toImportLog = (r: ImportLogRow): ImportFileLog => ({
      id: r.id, fileName: r.file_name, source: r.source as ImportFileLog['source'],
      rowCount: r.row_count, uploadedAt: r.uploaded_at,
      status: r.status as ImportFileLog['status'], error: r.error || undefined,
      cabinetId: r.cabinet_id || undefined,
      cabinetName: r.cabinet_name || undefined,
      dataStart: r.data_start || undefined,
      dataEnd: r.data_end || undefined,
      productIds: r.product_ids ? JSON.parse(r.product_ids) : undefined,
    });

    return {
      cabinets: (cabinets.data || []) as Cabinet[],
      brands: (brands.data || []) as Brand[],
      groups: (groups.data || []) as ProductGroup[],
      products: (products.data || []) as Product[],
      memberships: (memberships.data || []) as GroupMembership[],
      metrics: (metrics.data || []).map(r => toMetrics(r as MetricsRow)),
      plans: (plans.data || []).map(r => toPlan(r as PlanRow)),
      monthlyPlans: (monthlyPlans.data || []).map(r => toMonthlyPlan(r as MonthlyPlanRow)),
      profitability: (profitability.data || []).map(r => toProfitability(r as ProfitabilityRow)),
      importLogs: (importLogs.data || []).map(r => toImportLog(r as ImportLogRow)),
    };
  }

  async deleteMetrics(opts: { productIds: string[]; dateStart?: string; dateEnd?: string }): Promise<void> {
    if (!this._ready) return;
    let query = supabase.from('daily_metrics').delete().in('product_id', opts.productIds);
    if (opts.dateStart) query = query.gte('date', opts.dateStart);
    if (opts.dateEnd) query = query.lte('date', opts.dateEnd);
    const { error } = await query;
    if (error) throw error;
  }

  async deleteImportLog(logId: string): Promise<void> {
    if (!this._ready) return;
    const { error } = await supabase.from('import_logs').delete().eq('id', logId);
    if (error) throw error;
  }

  async deleteProfitability(productId: string): Promise<void> {
    if (!this._ready) return;
    const { error } = await supabase.from('profitability_reports').delete().eq('product_id', productId);
    if (error) throw error;
  }

  async saveAll(data: DataSnapshot): Promise<SaveResult> {
    const errors: string[] = [];
    const dev = this.DEV;

    const upsert = async (table: string, rows: unknown[], conflict: string) => {
      if (!rows || rows.length === 0) return;
      const { error } = await supabase.from(table as any).upsert(rows as any, { onConflict: conflict });
      if (error) {
        const msg = `[cloud] ${table} upsert failed: ${error.message}`;
        errors.push(msg);
        console.warn(msg);
      } else if (dev) {
        console.log('[cloud] ' + table + ' upserted ' + rows.length + ' rows');
      }
    };

    await Promise.all([
      upsert('cabinets', data.cabinets, 'id'),
      upsert('brands', data.brands, 'id'),
      upsert('product_groups', data.groups.map(g => ({ id: g.id, name: g.name, cabinet_id: g.cabinet_id })), 'id'),
      upsert('products', data.products.map(p => ({
        id: p.id, sku: p.sku, wb_sku: p.wb_sku, name: p.name,
        category: p.category, brand_id: p.brand_id, cabinet_id: p.cabinet_id,
      })), 'id'),
      upsert('group_memberships', data.memberships, 'product_id,group_id'),
      upsert('daily_metrics', data.metrics.map(m => ({
        date: m.date, product_id: m.product_id,
        impressions: m.impressions, clicks: m.clicks, carts: m.carts,
        orders: m.orders, buyouts: m.buyouts, cancellations: m.cancellations,
        ordered_amount: m.ordered_amount, buyout_amount: m.buyout_amount,
        cancellation_amount: m.cancellation_amount,
        ad_impressions: m.ad_impressions, ad_clicks: m.ad_clicks,
        ad_orders: m.ad_orders, ad_spend: m.ad_spend,
        stock: m.stock, plan_orders: m.plan_orders,
        forecast_profit_per_order: m.forecast_profit_per_order,
        actual_profit: m.actual_profit, actual_margin: m.actual_margin, profit_revenue: m.profit_revenue || 0,
      })), 'date,product_id'),
      upsert('plans', data.plans.map(p => ({
        entity_id: p.entityId, entity_type: p.entityType,
        parent_id: p.parentId, name: p.name,
        orders_qty: p.ordersQty, avg_price: p.avgPrice,
        orders_sum: p.ordersSum, profitability: p.profitability,
        net_profit: p.netProfit,
      })), 'entity_id,entity_type'),
      upsert('monthly_plans', data.monthlyPlans.map(p => ({
        sku: p.sku, month: p.month,
        avg_qty_per_day: p.avgQtyPerDay, cost_price: p.costPrice,
        check_amount: p.checkAmount, net_profit_per_unit: p.netProfitPerUnit,
        total_net_profit: p.totalNetProfit, profitability: p.profitability,
        total_qty: p.totalQty, total_rubles: p.totalRubles,
        buyout_rate: p.buyoutRate,
      })), 'sku,month'),
      upsert('profitability_reports', data.profitability.map(r => ({
        id: r.id, product_id: r.product_id,
        period_start: r.period_start, period_end: r.period_end,
        actual_profit: r.actual_profit, actual_margin: r.actual_margin,
        profit_revenue: r.profit_revenue || 0,
      })), 'id'),
      upsert('import_logs', data.importLogs.map(l => ({
        id: l.id, file_name: l.fileName, source: l.source,
        row_count: l.rowCount, uploaded_at: l.uploadedAt,
        status: l.status, error: l.error || null,
        cabinet_id: l.cabinetId || null, cabinet_name: l.cabinetName || null,
        data_start: l.dataStart || null, data_end: l.dataEnd || null,
        product_ids: l.productIds ? JSON.stringify(l.productIds) : null,
      })), 'id'),
    ]);

    return { ok: errors.length === 0, errors };
  }
}
