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

-- ── Row Level Security ──
-- Enable RLS + allow anon access on all tables.
-- Without these policies, anyone with the anon key (visible in browser DevTools)
-- can read/write the entire database.

ALTER TABLE cabinets ENABLE ROW LEVEL SECURITY;
ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_logs ENABLE ROW LEVEL SECURITY;

-- SECURITY NOTE:
-- This app is admin-only.
-- All read/write access is restricted to authenticated admins.

CREATE TABLE IF NOT EXISTS app_admins (
  user_id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_session_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  email TEXT,
  event TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_admins a
    WHERE a.user_id = auth.uid()
  );
$$;

ALTER TABLE app_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_session_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_all" ON cabinets;
DROP POLICY IF EXISTS "admin_all" ON brands;
DROP POLICY IF EXISTS "admin_all" ON product_groups;
DROP POLICY IF EXISTS "admin_all" ON products;
DROP POLICY IF EXISTS "admin_all" ON group_memberships;
DROP POLICY IF EXISTS "admin_all" ON daily_metrics;
DROP POLICY IF EXISTS "admin_all" ON plans;
DROP POLICY IF EXISTS "admin_all" ON monthly_plans;
DROP POLICY IF EXISTS "admin_all" ON import_logs;
DROP POLICY IF EXISTS "admin_all" ON app_admins;
DROP POLICY IF EXISTS "admin_all" ON auth_session_events;

CREATE POLICY "admin_all" ON cabinets FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "admin_all" ON brands FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "admin_all" ON product_groups FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "admin_all" ON products FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "admin_all" ON group_memberships FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "admin_all" ON daily_metrics FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "admin_all" ON plans FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "admin_all" ON monthly_plans FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "admin_all" ON import_logs FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "admin_all" ON app_admins FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY "admin_all" ON auth_session_events FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
