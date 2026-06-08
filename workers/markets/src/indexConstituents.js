// 主流美股指数成分股快照。仅用于给财报日历的 symbol 打标签。
// 数据按季度变更，列表可能略有滞后；遇到明显遗漏直接补本文件即可。
// 来源：公开信息汇总（Wikipedia / iShares / Invesco / Nasdaq 官方），snapshot 时间约 2026 上半年。

export const DJIA = new Set([
  'AAPL', 'AMGN', 'AMZN', 'AXP', 'BA', 'CAT', 'CRM', 'CSCO', 'CVX', 'DIS',
  'GS', 'HD', 'HON', 'IBM', 'JNJ', 'JPM', 'KO', 'MCD', 'MMM', 'MRK',
  'MSFT', 'NKE', 'NVDA', 'PG', 'SHW', 'TRV', 'UNH', 'V', 'VZ', 'WMT',
]);

export const NDX100 = new Set([
  'AAPL', 'ABNB', 'ADBE', 'ADI', 'ADP', 'ADSK', 'AEP', 'AMAT', 'AMD', 'AMGN',
  'AMZN', 'ANSS', 'APP', 'ARM', 'ASML', 'AVGO', 'AXON', 'AZN', 'BIIB', 'BKNG',
  'BKR', 'CCEP', 'CDNS', 'CDW', 'CEG', 'CHTR', 'CMCSA', 'COST', 'CPRT', 'CRWD',
  'CSCO', 'CSGP', 'CSX', 'CTAS', 'CTSH', 'DASH', 'DDOG', 'DLTR', 'DXCM', 'EA',
  'EXC', 'FAST', 'FANG', 'FTNT', 'GEHC', 'GFS', 'GILD', 'GOOG', 'GOOGL', 'HON',
  'IDXX', 'ILMN', 'INTC', 'INTU', 'ISRG', 'KDP', 'KHC', 'KLAC', 'LIN', 'LRCX',
  'LULU', 'MAR', 'MCHP', 'MDLZ', 'MELI', 'META', 'MNST', 'MRNA', 'MRVL', 'MSFT',
  'MSTR', 'MU', 'NFLX', 'NVDA', 'NXPI', 'ODFL', 'ON', 'ORLY', 'PANW', 'PAYX',
  'PCAR', 'PDD', 'PEP', 'PLTR', 'PYPL', 'QCOM', 'REGN', 'ROP', 'ROST', 'SBUX',
  'SNPS', 'TEAM', 'TMUS', 'TSLA', 'TTD', 'TTWO', 'TXN', 'VRSK', 'VRTX', 'WBD',
  'WDAY', 'XEL', 'ZS',
]);

export const SP500 = new Set([
  // Mega-cap & tech
  'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'GOOG', 'AMZN', 'META', 'TSLA', 'AVGO', 'ORCL',
  'CRM', 'ADBE', 'NFLX', 'CSCO', 'AMD', 'TXN', 'QCOM', 'INTU', 'INTC', 'AMAT',
  'NOW', 'MU', 'ADI', 'LRCX', 'PANW', 'KLAC', 'SNPS', 'CDNS', 'ANET', 'MSI',
  'CRWD', 'FTNT', 'MRVL', 'ROP', 'APH', 'ACN', 'IBM', 'HPQ', 'DELL', 'HPE',
  'WDC', 'STX', 'NTAP', 'ZBRA', 'TYL', 'TER', 'SWKS', 'EPAM', 'PAYC', 'GEN',
  'GLW', 'JBL', 'KEYS', 'GDDY', 'VRSN', 'VRSK', 'FICO', 'AKAM', 'JNPR', 'FFIV',
  'CTSH', 'IT', 'LDOS', 'CDW', 'ANSS', 'PTC', 'TRMB',
  // Communications & media
  'DIS', 'CMCSA', 'TMUS', 'VZ', 'T', 'CHTR', 'EA', 'TTWO', 'WBD',
  'PARA', 'FOX', 'FOXA', 'OMC', 'IPG', 'NWSA', 'NWS', 'MTCH', 'LYV', 'DASH',
  // Financials
  'JPM', 'BAC', 'WFC', 'MS', 'GS', 'C', 'AXP', 'BLK', 'SCHW', 'SPGI',
  'MMC', 'PGR', 'TRV', 'CB', 'AIG', 'ALL', 'HIG', 'MET', 'PRU', 'AFL',
  'AON', 'MCO', 'ICE', 'CME', 'COF', 'USB', 'PNC', 'TFC', 'BK', 'STT',
  'NTRS', 'CFG', 'RF', 'FITB', 'KEY', 'HBAN', 'MTB', 'CMA', 'FCNCA', 'ZION',
  'PYPL', 'V', 'MA', 'FIS', 'GPN', 'JKHY', 'EFX', 'BR', 'MKTX',
  // Healthcare
  'UNH', 'LLY', 'JNJ', 'ABBV', 'MRK', 'PFE', 'TMO', 'ABT', 'DHR', 'BMY',
  'AMGN', 'GILD', 'VRTX', 'REGN', 'CI', 'CVS', 'HUM', 'ELV', 'MCK', 'COR',
  'CAH', 'HCA', 'UHS', 'THC', 'DVA', 'ISRG', 'SYK', 'BSX', 'MDT', 'EW',
  'ZBH', 'BAX', 'BDX', 'HOLX', 'RMD', 'IDXX', 'DXCM', 'PODD', 'ALGN', 'STE',
  'IQV', 'ZTS', 'MRNA', 'BIIB', 'ILMN', 'INCY', 'BIO', 'TECH', 'WAT', 'MTD',
  'A', 'LH', 'DGX', 'CRL', 'CTLT', 'VTRS', 'MOH', 'CNC',
  // Consumer staples & discretionary
  'WMT', 'COST', 'HD', 'LOW', 'TGT', 'DG', 'DLTR', 'KR', 'SYY', 'WBA',
  'BBY', 'TJX', 'ROST', 'BURL', 'ULTA', 'LULU', 'NKE', 'TPR', 'RL',
  'VFC', 'HAS', 'MAT', 'LKQ', 'APTV', 'BWA', 'GPC', 'ORLY', 'AZO', 'POOL',
  'WSM', 'RH', 'LEN', 'PHM', 'DHI', 'NVR', 'TOL', 'MHK', 'WHR', 'LEG',
  'MGM', 'LVS', 'WYNN', 'MAR', 'HLT', 'BKNG', 'EXPE', 'ABNB', 'RCL', 'CCL',
  'NCLH', 'MCD', 'SBUX', 'YUM', 'CMG', 'DRI', 'DPZ',
  'PEP', 'KO', 'MDLZ', 'MNST', 'KDP', 'TAP', 'STZ',
  'PG', 'KMB', 'CL', 'EL', 'CHD', 'CLX', 'SJM', 'GIS', 'K', 'KHC',
  'HSY', 'MKC', 'HRL', 'TSN', 'CAG', 'CPB', 'LW', 'ADM', 'BG', 'MO',
  'PM',
  // Energy
  'XOM', 'CVX', 'COP', 'SLB', 'OXY', 'PSX', 'MPC', 'VLO', 'HES',
  'EOG', 'FANG', 'DVN', 'HAL', 'BKR', 'APA', 'MRO', 'EQT', 'CTRA',
  'WMB', 'OKE', 'KMI', 'TRGP', 'LNG',
  // Utilities
  'NEE', 'DUK', 'SO', 'D', 'AEP', 'EXC', 'XEL', 'SRE', 'PCG', 'EIX',
  'PEG', 'ED', 'WEC', 'ES', 'ETR', 'DTE', 'AEE', 'CMS', 'CNP', 'AWK',
  'NRG', 'VST', 'FE', 'PPL', 'ATO', 'EVRG', 'LNT', 'PNW', 'NI', 'AES',
  // Industrials
  'GE', 'RTX', 'CAT', 'BA', 'HON', 'LMT', 'NOC', 'GD', 'DE', 'EMR',
  'ETN', 'PH', 'ITW', 'MMM', 'CMI', 'FDX', 'UPS', 'UNP', 'CSX', 'NSC',
  'WM', 'RSG', 'LUV', 'UAL', 'DAL', 'AAL', 'ALK', 'JBHT', 'CHRW', 'ODFL',
  'KNX', 'XPO', 'SAIA', 'EXPD', 'PCAR', 'URI', 'HEI', 'TDG', 'TXT', 'BAH',
  'LHX', 'HII', 'OTIS', 'CARR', 'JCI', 'TT', 'ROK', 'AME', 'FTV',
  'DOV', 'XYL', 'PNR', 'ROL', 'MAS', 'ALLE', 'SWK', 'SNA', 'CFR', 'GWW',
  // Materials
  'LIN', 'APD', 'ECL', 'SHW', 'FCX', 'NEM', 'NUE', 'STLD', 'VMC', 'MLM',
  'CTVA', 'DD', 'DOW', 'PPG', 'CE', 'ALB', 'LYB', 'EMN', 'IFF', 'FMC',
  'MOS', 'CF', 'AVY', 'PKG', 'IP', 'AMCR', 'SEE',
  // Real Estate
  'PLD', 'AMT', 'EQIX', 'WELL', 'SPG', 'PSA', 'O', 'CCI', 'DLR', 'EXR',
  'AVB', 'EQR', 'MAA', 'UDR', 'ESS', 'CPT', 'INVH', 'SUI', 'ELS', 'VTR',
  'ARE', 'BXP', 'VNO', 'SLG', 'KIM', 'REG', 'FRT', 'BRX', 'HST',
  'IRM', 'WPC', 'LAMR', 'SBAC', 'VICI', 'GLPI', 'NLY', 'AGNC',
]);

export function tagIndices(symbol) {
  if (!symbol) return [];
  const out = [];
  if (NDX100.has(symbol)) out.push('Nasdaq 100');
  if (SP500.has(symbol)) out.push('S&P 500');
  if (DJIA.has(symbol)) out.push('Dow 30');
  return out;
}
