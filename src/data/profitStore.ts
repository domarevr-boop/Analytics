const STORAGE_KEY = 'profitability_extra_expenses';
let _version = 0;
const _listeners = new Set<() => void>();

function load(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function save(data: Record<string, number>) {
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

export function getExtraExpenses(): Record<string, number> {
  return { ...load() };
}

export function setExtraExpense(cabinetId: string, pct: number) {
  const data = load();
  if (pct === 0) {
    delete data[cabinetId];
  } else {
    data[cabinetId] = pct;
  }
  save(data);
  notify();
}

export function getWeightedExtraExpenses(revenueByCabinet: Record<string, number>): number {
  const data = load();
  let totalRev = 0;
  let weightedSum = 0;
  for (const [cabId, rev] of Object.entries(revenueByCabinet)) {
    const pct = data[cabId] || 0;
    if (pct) {
      totalRev += rev;
      weightedSum += rev * pct;
    }
  }
  return totalRev ? weightedSum / totalRev : 0;
}

export function getCabinetExtraExpense(cabinetId: string): number {
  return load()[cabinetId] || 0;
}
