import { supabase } from '../lib/supabaseClient';
import { isCloudStorage } from '../database/db';

const STORAGE_KEY = 'profitability_extra_expenses_v2';
let _version = 0;
const _listeners = new Set<() => void>();
let cache = loadLocal();

function loadLocal(): Record<string, Record<string, number>> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveLocal(data: Record<string, Record<string, number>>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function notify() {
  _version++;
  _listeners.forEach(fn => fn());
}

export function subscribeExtraExpenses(fn: () => void) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

export function getExtraExpensesVersion() { return _version; }

export function getExtraExpenses(month: string): Record<string, number> {
  return { ...(cache[month] || {}) };
}

export function setExtraExpense(month: string, cabinetId: string, pct: number) {
  if (!cache[month]) cache[month] = {};
  if (pct === 0) delete cache[month][cabinetId];
  else cache[month][cabinetId] = pct;

  saveLocal(cache);
  notify();

  if (isCloudStorage) {
    const mutation = pct === 0
      ? supabase.from('monthly_fixed_expenses').delete().eq('month', month).eq('cabinet_id', cabinetId)
      : supabase.from('monthly_fixed_expenses').upsert(
        { month, cabinet_id: cabinetId, percent: pct, updated_at: new Date().toISOString() },
        { onConflict: 'month,cabinet_id' },
      );
    void mutation.then(({ error }) => {
      if (error) console.error('[profitability] fixed expense sync failed', error.message);
    });
  }
}

export function getCabinetExtraExpense(month: string, cabinetId: string): number {
  return cache[month]?.[cabinetId] || 0;
}

export function getAllExtraExpenses(): Record<string, Record<string, number>> {
  return JSON.parse(JSON.stringify(cache)) as Record<string, Record<string, number>>;
}

export async function replaceExtraExpenses(next: Record<string, Record<string, number>>) {
  cache = JSON.parse(JSON.stringify(next)) as Record<string, Record<string, number>>;
  saveLocal(cache);

  if (isCloudStorage) {
    const { error: deleteError } = await supabase
      .from('monthly_fixed_expenses')
      .delete()
      .gte('month', '0000-01');
    if (deleteError) throw deleteError;

    const rows = Object.entries(cache).flatMap(([month, byCabinet]) =>
      Object.entries(byCabinet)
        .filter(([, percent]) => Number(percent) > 0)
        .map(([cabinetId, percent]) => ({ month, cabinet_id: cabinetId, percent })),
    );
    if (rows.length) {
      const { error: uploadError } = await supabase
        .from('monthly_fixed_expenses')
        .upsert(rows, { onConflict: 'month,cabinet_id' });
      if (uploadError) throw uploadError;
    }
  }
  notify();
}

export async function initializeExtraExpenses() {
  if (!isCloudStorage) return;

  const localData = loadLocal();
  const { data, error } = await supabase
    .from('monthly_fixed_expenses')
    .select('month,cabinet_id,percent');
  if (error) throw error;

  if (!data?.length) {
    const rows = Object.entries(localData).flatMap(([month, byCabinet]) =>
      Object.entries(byCabinet).map(([cabinetId, percent]) => ({ month, cabinet_id: cabinetId, percent })),
    );
    if (rows.length) {
      const { error: uploadError } = await supabase
        .from('monthly_fixed_expenses')
        .upsert(rows, { onConflict: 'month,cabinet_id' });
      if (uploadError) throw uploadError;
    }
    cache = localData;
  } else {
    cache = data.reduce<Record<string, Record<string, number>>>((result, row) => {
      if (!result[row.month]) result[row.month] = {};
      result[row.month][row.cabinet_id] = Number(row.percent) || 0;
      return result;
    }, {});
  }
  saveLocal(cache);
  notify();
}
