-- Supabase schema migration for Wildberries Analytics Panel
-- Run this once in the Supabase SQL Editor (https://supabase.com/dashboard/project/ncqugkrhiwboobrnypxn/sql/new)

CREATE TABLE IF NOT EXISTS cabinets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS brands (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cabinet_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL,
  wb_sku TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT DEFAULT '',
  brand_id TEXT NOT NULL,
  cabinet_id TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS group_memberships (
  product_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  PRIMARY KEY (product_id, group_id)
);

CREATE TABLE IF NOT EXISTS daily_metrics (
  date TEXT NOT NULL,
  product_id TEXT NOT NULL,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  carts INTEGER DEFAULT 0,
  orders INTEGER DEFAULT 0,
  buyouts INTEGER DEFAULT 0,
  cancellations INTEGER DEFAULT 0,
  ordered_amount REAL DEFAULT 0,
  buyout_amount REAL DEFAULT 0,
  cancellation_amount REAL DEFAULT 0,
  ad_impressions INTEGER DEFAULT 0,
  ad_clicks INTEGER DEFAULT 0,
  ad_orders INTEGER DEFAULT 0,
  ad_spend REAL DEFAULT 0,
  stock REAL DEFAULT 0,
  plan_orders REAL DEFAULT 0,
  forecast_profit_per_order REAL DEFAULT 0,
  actual_profit REAL DEFAULT 0,
  actual_margin REAL DEFAULT 0,
  profit_revenue REAL DEFAULT 0,
  PRIMARY KEY (date, product_id)
);

-- Ensure profit_revenue column exists on existing tables (safe to re-run)
ALTER TABLE IF EXISTS daily_metrics ADD COLUMN IF NOT EXISTS profit_revenue REAL DEFAULT 0;

CREATE TABLE IF NOT EXISTS plans (
  entity_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  parent_id TEXT,
  name TEXT NOT NULL,
  orders_qty REAL DEFAULT 0,
  avg_price REAL DEFAULT 0,
  orders_sum REAL DEFAULT 0,
  profitability REAL DEFAULT 0,
  net_profit REAL DEFAULT 0,
  PRIMARY KEY (entity_id, entity_type)
);

CREATE TABLE IF NOT EXISTS import_logs (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  source TEXT NOT NULL,
  row_count INTEGER DEFAULT 0,
  uploaded_at TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  cabinet_id TEXT,
  cabinet_name TEXT,
  data_start TEXT,
  data_end TEXT,
  product_ids TEXT
);

CREATE TABLE IF NOT EXISTS monthly_plans (
  sku TEXT NOT NULL,
  month TEXT NOT NULL,
  avg_qty_per_day REAL DEFAULT 0,
  cost_price REAL DEFAULT 0,
  check_amount REAL DEFAULT 0,
  net_profit_per_unit REAL DEFAULT 0,
  total_net_profit REAL DEFAULT 0,
  profitability REAL DEFAULT 0,
  total_qty REAL DEFAULT 0,
  total_rubles REAL DEFAULT 0,
  buyout_rate REAL DEFAULT 85,
  PRIMARY KEY (sku, month)
);

CREATE TABLE IF NOT EXISTS profitability_reports (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  actual_profit REAL DEFAULT 0,
  actual_margin REAL DEFAULT 0,
  profit_revenue REAL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_profitability_product ON profitability_reports(product_id);
