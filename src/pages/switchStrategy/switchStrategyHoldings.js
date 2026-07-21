export function filterExchangeSwitchHoldings(holdings = []) {
  if (!Array.isArray(holdings)) return [];
  return holdings.filter((holding) => holding?.kind === 'exchange');
}
