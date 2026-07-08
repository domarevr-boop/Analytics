import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Read credentials from .env file in project root
const envPath = resolve(import.meta.dirname, '..', '.env');
const envContent = readFileSync(envPath, 'utf-8');
const SUPABASE_URL = envContent.match(/VITE_SUPABASE_URL=(.+)/)?.[1]?.trim() || '';
const SUPABASE_ANON_KEY = envContent.match(/VITE_SUPABASE_ANON_KEY=(.+)/)?.[1]?.trim() || '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env');
  process.exit(1);
}

async function main() {
  const password = process.argv[2];
  if (!password) {
    console.error('Usage: node scripts/cleanSupabase.mjs <password>');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Sign in as admin
  const { data: session, error: authError } = await supabase.auth.signInWithPassword({
    email: 'domarevr@gmail.com',
    password,
  });
  if (authError) {
    console.error('Auth error:', authError.message);
    process.exit(1);
  }
  console.log('Signed in as admin');

  // Delete all rows from each table (avoid FK issues: memberships first, metrics/logs first)
  // Tables with composite keys need a column reference for the filter
  const clears = [
    { table: 'group_memberships', col: 'product_id' },
    { table: 'daily_metrics', col: 'date' },
    { table: 'import_logs', col: 'id' },
    { table: 'monthly_plans', col: 'sku' },
    { table: 'profitability_reports', col: 'id' },
    { table: 'plans', col: 'entity_id' },
    { table: 'products', col: 'id' },
    { table: 'product_groups', col: 'id' },
    { table: 'brands', col: 'id' },
    { table: 'cabinets', col: 'id' },
  ];

  for (const { table, col } of clears) {
    const { error } = await supabase.from(table).delete().neq(col, '');
    if (error) {
      console.error(`Error deleting from ${table}:`, error.message);
    } else {
      console.log(`Cleared ${table}`);
    }
  }

  // Re-seed default data
  const { error: cabErr } = await supabase.from('cabinets').upsert([
    { id: 'cab-1', name: 'Светпланет' },
    { id: 'cab-2', name: 'Ледситипро' },
  ]);
  if (cabErr) console.error('Seed cabinets error:', cabErr.message);
  else console.log('Seeded cabinets');

  const { error: brErr } = await supabase.from('brands').upsert([
    { id: 'br-1', name: 'Светпланет' },
  ]);
  if (brErr) console.error('Seed brands error:', brErr.message);
  else console.log('Seeded brands');

  const groups = [
    { id: 'grp-1', name: 'Бра', cabinet_id: 'cab-1' },
    { id: 'grp-2', name: 'Лофт', cabinet_id: 'cab-1' },
    { id: 'grp-3', name: 'Геометрия_1', cabinet_id: 'cab-1' },
    { id: 'grp-4', name: 'Геометрия_2_Ромбы', cabinet_id: 'cab-1' },
    { id: 'grp-5', name: 'Геометрия_3_Квадраты', cabinet_id: 'cab-1' },
    { id: 'grp-6', name: 'Скандинавия_1', cabinet_id: 'cab-1' },
    { id: 'grp-7', name: 'Геометрия_4_Круги', cabinet_id: 'cab-1' },
    { id: 'grp-8', name: 'Сетка_1', cabinet_id: 'cab-1' },
    { id: 'grp-9', name: 'Лепестки_2', cabinet_id: 'cab-1' },
    { id: 'grp-10', name: 'Монолиты', cabinet_id: 'cab-1' },
    { id: 'grp-11', name: 'Тарелки', cabinet_id: 'cab-1' },
    { id: 'grp-12', name: 'Цветки', cabinet_id: 'cab-2' },
    { id: 'grp-13', name: 'Слоеные тарелки', cabinet_id: 'cab-2' },
    { id: 'grp-14', name: 'Монолиты_2', cabinet_id: 'cab-2' },
    { id: 'grp-15', name: 'Ромбы_2', cabinet_id: 'cab-2' },
    { id: 'grp-16', name: 'Gx53', cabinet_id: 'cab-2' },
    { id: 'grp-17', name: 'Квадраты_2', cabinet_id: 'cab-2' },
    { id: 'grp-18', name: 'Рожковые', cabinet_id: 'cab-2' },
    { id: 'grp-99', name: 'Без склейки', cabinet_id: '' },
  ];
  const { error: grErr } = await supabase.from('product_groups').upsert(groups, { onConflict: 'id' });
  if (grErr) console.error('Seed groups error:', grErr.message);
  else console.log('Seeded groups');

  console.log('Done. Now reload the app and re-import your files.');
}

main().catch(console.error);
