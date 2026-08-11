export function orderShare(orders: number, denominator: number) {
  return denominator > 0 ? orders / denominator * 100 : 0;
}
