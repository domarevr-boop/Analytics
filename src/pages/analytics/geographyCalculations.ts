export function orderShare(orders: number, denominator: number) {
  return denominator > 0 ? orders / denominator * 100 : 0;
}

export function toMillions(amount: number) {
  return amount / 1_000_000;
}

export function amountShare(amount: number, denominator: number) {
  return denominator > 0 ? amount / denominator * 100 : 0;
}

export function topFiveWithOther(rows: { name: string; value: number }[], denominator = rows.reduce((sum, row) => sum + row.value, 0)) {
  const top = [...rows].sort((left, right) => right.value - left.value).slice(0, 5);
  const topValue = top.reduce((sum, row) => sum + row.value, 0);
  const rest = Math.max(0, denominator - topValue);
  const result = rest > 0 ? [...top, { name: 'Остальные', value: rest }] : top;
  return result.map(row => ({ ...row, share: amountShare(row.value, denominator) }));
}
