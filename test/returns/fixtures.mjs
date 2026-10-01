export const tx = (id, code, type, date, amount, shares = 100, extra = {}) => ({
  id,
  code,
  type,
  date,
  amount,
  shares,
  price: amount / shares,
  kind: 'exchange',
  ...extra
});
export const base = {
  from: '2025-01-01',
  to: '2025-01-31',
  transactions: [
    tx('initial', '510001', 'BUY', '2024-12-01', 1000),
    tx('sell', '510001', 'SELL', '2025-01-15', 1100),
    tx('buy', '510002', 'BUY', '2025-01-15', 1100)
  ],
  pricesByCode: { 510001: [{ date: '2024-12-31', price: 10 }], 510002: [{ date: '2025-01-31', price: 12.1 }] }
};