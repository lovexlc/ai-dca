export const NASDAQ_INDEX = Object.freeze({
  key: 'nasdaq100',
  name: '纳斯达克100'
});

export const NASDAQ_ETFS = Object.freeze([
  { code: '159513', name: '大成纳斯达克100ETF(QDII)', index_key: 'nasdaq100' },
  { code: '159509', name: '景顺长城纳斯达克科技ETF(QDII)', index_key: 'nasdaq100' },
  { code: '159941', name: '广发纳斯达克100ETF', index_key: 'nasdaq100' },
  { code: '513100', name: '国泰纳斯达克100ETF', index_key: 'nasdaq100' },
  { code: '159696', name: '易方达纳斯达克100ETF(QDI)', index_key: 'nasdaq100' },
  { code: '159632', name: '华安纳斯达克100ETF(QDII)', index_key: 'nasdaq100' },
  { code: '513390', name: '博时纳斯达克100ETF(QDII)', index_key: 'nasdaq100' },
  { code: '513300', name: '华夏纳斯达克100ETF(QDII)', index_key: 'nasdaq100' },
  { code: '159501', name: '嘉实纳斯达克100ETF(QDII)', index_key: 'nasdaq100' },
  { code: '513870', name: '富国纳斯达克100ETF(QDII)', index_key: 'nasdaq100' },
  { code: '159660', name: '汇添富纳斯达克100ETF', index_key: 'nasdaq100' },
  { code: '513110', name: '华泰柏瑞纳斯达克100ETF(QDII)', index_key: 'nasdaq100' },
  { code: '159659', name: '招商纳斯达克100ETF(QDII)', index_key: 'nasdaq100' },
  { code: '161128', name: '易方达标普信息科技指数(QDII-LOF)A', index_key: 'nasdaq100' }
]);

export const SP500_ETFS = Object.freeze([
  { code: '513500', name: '博时标普500ETF(QDII)', index_key: 'sp500' },
  { code: '513650', name: '南方标普500ETF(QDII)', index_key: 'sp500' },
  { code: '159612', name: '国泰标普500ETF(QDII)', index_key: 'sp500' },
  { code: '159655', name: '华夏标普500ETF(QDII)', index_key: 'sp500' }
]);

export const US50_ETFS = Object.freeze([
  { code: '159577', name: '汇添富美国50ETF(QDII)', index_key: 'us50' },
  { code: '513850', name: '易方达美国50ETF(QDII)', index_key: 'us50' }
]);

export const SWITCH_STRATEGY_ETFS = Object.freeze([
  ...NASDAQ_ETFS,
  ...SP500_ETFS,
  ...US50_ETFS
]);

export const NASDAQ_OTC_FUNDS = Object.freeze([
  { code: '000834', name: '大成纳斯达克100ETF联接(QDII)A', index_key: 'nasdaq100', kind: 'etf_link', link_to: '159513', share_class: 'A', currency: 'CNY' },
  { code: '008971', name: '大成纳斯达克100ETF联接(QDII)C', index_key: 'nasdaq100', kind: 'etf_link', link_to: '159513', share_class: 'C', currency: 'CNY' },
  { code: '270042', name: '广发纳指100ETF联接(QDII)人民币A', index_key: 'nasdaq100', kind: 'etf_link', link_to: '159941', share_class: 'A', currency: 'CNY' },
  { code: '006479', name: '广发纳指100ETF联接(QDII)人民币C', index_key: 'nasdaq100', kind: 'etf_link', link_to: '159941', share_class: 'C', currency: 'CNY' },
  { code: '000055', name: '广发纳指100ETF联接(QDII)美元A', index_key: 'nasdaq100', kind: 'etf_link', link_to: '159941', share_class: 'A', currency: 'USD' },
  { code: '006480', name: '广发纳指100ETF联接(QDII)美元C', index_key: 'nasdaq100', kind: 'etf_link', link_to: '159941', share_class: 'C', currency: 'USD' },
  { code: '021778', name: '广发纳指100ETF联接(QDII)人民币F', index_key: 'nasdaq100', kind: 'etf_link', link_to: '159941', share_class: 'F', currency: 'CNY' },
  { code: '161130', name: '易方达纳斯达克100ETF联接(QDII-LOF)A人民币', index_key: 'nasdaq100', kind: 'etf_link', link_to: '159696', share_class: 'A', currency: 'CNY' },
  { code: '012870', name: '易方达纳斯达克100ETF联接(QDII-LOF)C人民币', index_key: 'nasdaq100', kind: 'etf_link', link_to: '159696', share_class: 'C', currency: 'CNY' },
  { code: '012871', name: '易方达纳斯达克100ETF联接(QDII-LOF)C美元现汇', index_key: 'nasdaq100', kind: 'etf_link', link_to: '159696', share_class: 'C', currency: 'USD' },
  { code: '003722', name: '易方达纳斯达克100ETF联接(QDII-LOF)A美元现汇', index_key: 'nasdaq100', kind: 'etf_link', link_to: '159696', share_class: 'A', currency: 'USD' },
  { code: '040046', name: '华安纳斯达克100ETF联接(QDII)A', index_key: 'nasdaq100', kind: 'etf_link', link_to: '159632', share_class: 'A', currency: 'CNY' },
  { code: '040047', name: '华安纳斯达克100ETF联接(QDII)A美元现钞', index_key: 'nasdaq100', kind: 'etf_link', link_to: '159632', share_class: 'A', currency: 'USD' },
  { code: '040048', name: '华安纳斯达克100ETF联接(QDII)A美元现汇', index_key: 'nasdaq100', kind: 'etf_link', link_to: '159632', share_class: 'A', currency: 'USD' },
  { code: '014978', name: '华安纳斯达克100ETF联接(QDII)C', index_key: 'nasdaq100', kind: 'etf_link', link_to: '159632', share_class: 'C', currency: 'CNY' },
  { code: '016055', name: '博时纳斯达克100ETF发起式联接(QDII)A人民币', index_key: 'nasdaq100', kind: 'etf_link', link_to: '513390', share_class: 'A', currency: 'CNY' },
  { code: '016057', name: '博时纳斯达克100ETF发起式联接(QDII)C人民币', index_key: 'nasdaq100', kind: 'etf_link', link_to: '513390', share_class: 'C', currency: 'CNY' },
  { code: '016056', name: '博时纳斯达克100ETF发起式联接(QDII)A美元', index_key: 'nasdaq100', kind: 'etf_link', link_to: '513390', share_class: 'A', currency: 'USD' },
  { code: '016058', name: '博时纳斯达克100ETF发起式联接(QDII)C美元', index_key: 'nasdaq100', kind: 'etf_link', link_to: '513390', share_class: 'C', currency: 'USD' },
  { code: '015299', name: '华夏纳斯达克100ETF发起式联接(QDII)A', index_key: 'nasdaq100', kind: 'etf_link', link_to: '513300', share_class: 'A', currency: 'CNY' },
  { code: '015300', name: '华夏纳斯达克100ETF发起式联接(QDII)C', index_key: 'nasdaq100', kind: 'etf_link', link_to: '513300', share_class: 'C', currency: 'CNY' },
  { code: '015518', name: '华夏纳斯达克100ETF发起式联接(QDII)A美元现汇', index_key: 'nasdaq100', kind: 'etf_link', link_to: '513300', share_class: 'A', currency: 'USD' },
  { code: '016532', name: '嘉实纳斯达克100ETF发起联接(QDII)A人民币', index_key: 'nasdaq100', kind: 'etf_link', link_to: '159501', share_class: 'A', currency: 'CNY' },
  { code: '016533', name: '嘉实纳斯达克100ETF发起联接(QDII)C人民币', index_key: 'nasdaq100', kind: 'etf_link', link_to: '159501', share_class: 'C', currency: 'CNY' },
  { code: '016534', name: '嘉实纳斯达克100ETF发起联接(QDII)A美元现汇', index_key: 'nasdaq100', kind: 'etf_link', link_to: '159501', share_class: 'A', currency: 'USD' },
  { code: '016535', name: '嘉实纳斯达克100ETF发起联接(QDII)C美元现汇', index_key: 'nasdaq100', kind: 'etf_link', link_to: '159501', share_class: 'C', currency: 'USD' },
  { code: '021838', name: '嘉实纳斯达克100ETF发起联接(QDII)I人民币', index_key: 'nasdaq100', kind: 'etf_link', link_to: '159501', share_class: 'I', currency: 'CNY' },
  { code: '018966', name: '汇添富纳斯达克100ETF发起式联接(QDII)人民币A', index_key: 'nasdaq100', kind: 'etf_link', link_to: '159660', share_class: 'A', currency: 'CNY' },
  { code: '018967', name: '汇添富纳斯达克100ETF发起式联接(QDII)人民币C', index_key: 'nasdaq100', kind: 'etf_link', link_to: '159660', share_class: 'C', currency: 'CNY' },
  { code: '018968', name: '汇添富纳斯达克100ETF发起式联接(QDII)美元现汇', index_key: 'nasdaq100', kind: 'etf_link', link_to: '159660', share_class: 'A', currency: 'USD' },
  { code: '018969', name: '汇添富纳斯达克100ETF发起式联接(QDII)美元现钞', index_key: 'nasdaq100', kind: 'etf_link', link_to: '159660', share_class: 'A', currency: 'USD' },
  { code: '019524', name: '华泰柏瑞纳斯达克100ETF发起式联接(QDII)A', index_key: 'nasdaq100', kind: 'etf_link', link_to: '513110', share_class: 'A', currency: 'CNY' },
  { code: '019525', name: '华泰柏瑞纳斯达克100ETF发起式联接(QDII)C', index_key: 'nasdaq100', kind: 'etf_link', link_to: '513110', share_class: 'C', currency: 'CNY' },
  { code: '019547', name: '招商纳斯达克100ETF发起式联接(QDII)A', index_key: 'nasdaq100', kind: 'etf_link', link_to: '159659', share_class: 'A', currency: 'CNY' },
  { code: '019548', name: '招商纳斯达克100ETF发起式联接(QDII)C', index_key: 'nasdaq100', kind: 'etf_link', link_to: '159659', share_class: 'C', currency: 'CNY' },
  { code: '160213', name: '国泰纳斯达克100指数(QDII)', index_key: 'nasdaq100', kind: 'standalone_qdii', link_to: null, share_class: 'A', currency: 'CNY' },
  { code: '019172', name: '摩根纳斯达克100指数(QDII)人民币A', index_key: 'nasdaq100', kind: 'standalone_qdii', link_to: null, share_class: 'A', currency: 'CNY' },
  { code: '019173', name: '摩根纳斯达克100指数(QDII)人民币C', index_key: 'nasdaq100', kind: 'standalone_qdii', link_to: null, share_class: 'C', currency: 'CNY' },
  { code: '019174', name: '摩根纳斯达克100指数(QDII)美元A', index_key: 'nasdaq100', kind: 'standalone_qdii', link_to: null, share_class: 'A', currency: 'USD' },
  { code: '019175', name: '摩根纳斯达克100指数(QDII)美元C', index_key: 'nasdaq100', kind: 'standalone_qdii', link_to: null, share_class: 'C', currency: 'USD' },
  { code: '019441', name: '万家纳斯达克100指数发起式(QDII)A', index_key: 'nasdaq100', kind: 'standalone_qdii', link_to: null, share_class: 'A', currency: 'CNY' },
  { code: '019442', name: '万家纳斯达克100指数发起式(QDII)C', index_key: 'nasdaq100', kind: 'standalone_qdii', link_to: null, share_class: 'C', currency: 'CNY' },
  { code: '019736', name: '宝盈纳斯达克100指数发起(QDII)A人民币', index_key: 'nasdaq100', kind: 'standalone_qdii', link_to: null, share_class: 'A', currency: 'CNY' },
  { code: '019737', name: '宝盈纳斯达克100指数发起(QDII)C人民币', index_key: 'nasdaq100', kind: 'standalone_qdii', link_to: null, share_class: 'C', currency: 'CNY' },
  { code: '019738', name: '宝盈纳斯达克100指数发起(QDII)A美元现汇', index_key: 'nasdaq100', kind: 'standalone_qdii', link_to: null, share_class: 'A', currency: 'USD' },
  { code: '019739', name: '宝盈纳斯达克100指数发起(QDII)C美元现汇', index_key: 'nasdaq100', kind: 'standalone_qdii', link_to: null, share_class: 'C', currency: 'USD' },
  { code: '016452', name: '南方纳斯达克100指数发起(QDII)A', index_key: 'nasdaq100', kind: 'standalone_qdii', link_to: null, share_class: 'A', currency: 'CNY' },
  { code: '016453', name: '南方纳斯达克100指数发起(QDII)C', index_key: 'nasdaq100', kind: 'standalone_qdii', link_to: null, share_class: 'C', currency: 'CNY' },
  { code: '021000', name: '南方纳斯达克100指数发起(QDII)I人民币', index_key: 'nasdaq100', kind: 'standalone_qdii', link_to: null, share_class: 'I', currency: 'CNY' },
  { code: '018043', name: '天弘纳斯达克100指数发起(QDII)A', index_key: 'nasdaq100', kind: 'standalone_qdii', link_to: null, share_class: 'A', currency: 'CNY' },
  { code: '018044', name: '天弘纳斯达克100指数发起(QDII)C', index_key: 'nasdaq100', kind: 'standalone_qdii', link_to: null, share_class: 'C', currency: 'CNY' },
  { code: '022525', name: '天弘纳斯达克100指数发起(QDII)D', index_key: 'nasdaq100', kind: 'standalone_qdii', link_to: null, share_class: 'D', currency: 'CNY' },
  { code: '539001', name: '建信纳斯达克100指数(QDII)A人民币', index_key: 'nasdaq100', kind: 'standalone_qdii', link_to: null, share_class: 'A', currency: 'CNY' },
  { code: '012751', name: '建信纳斯达克100指数(QDII)A美元现汇', index_key: 'nasdaq100', kind: 'standalone_qdii', link_to: null, share_class: 'A', currency: 'USD' },
  { code: '012752', name: '建信纳斯达克100指数(QDII)C人民币', index_key: 'nasdaq100', kind: 'standalone_qdii', link_to: null, share_class: 'C', currency: 'CNY' },
  { code: '012753', name: '建信纳斯达克100指数(QDII)C美元现汇', index_key: 'nasdaq100', kind: 'standalone_qdii', link_to: null, share_class: 'C', currency: 'USD' },
  { code: '023422', name: '建信纳斯达克100指数(QDII)D人民币', index_key: 'nasdaq100', kind: 'standalone_qdii', link_to: null, share_class: 'D', currency: 'CNY' },
  { code: '021773', name: '汇添富纳斯达克100ETF发起式联接(QDII)人民币E', index_key: 'nasdaq100', kind: 'etf_link', link_to: '159660', share_class: 'E', currency: 'CNY' },
  { code: '022664', name: '华泰柏瑞纳斯达克100ETF发起式联接(QDII)I', index_key: 'nasdaq100', kind: 'etf_link', link_to: '513110', share_class: 'I', currency: 'CNY' },
  { code: '024237', name: '博时纳斯达克100ETF发起式联接(QDII)I人民币', index_key: 'nasdaq100', kind: 'etf_link', link_to: '513390', share_class: 'I', currency: 'CNY' },
  { code: '017641', name: '摩根标普500指数(QDII)人民币A', index_key: 'sp500', kind: 'standalone_qdii', link_to: null, share_class: 'A', currency: 'CNY' },
  { code: '019305', name: '摩根标普500指数(QDII)人民币C', index_key: 'sp500', kind: 'standalone_qdii', link_to: null, share_class: 'C', currency: 'CNY' },
  { code: '017642', name: '摩根标普500指数(QDII)美钞', index_key: 'sp500', kind: 'standalone_qdii', link_to: null, share_class: 'A', currency: 'USD' },
  { code: '017643', name: '摩根标普500指数(QDII)美汇', index_key: 'sp500', kind: 'standalone_qdii', link_to: null, share_class: 'A', currency: 'USD' },
  { code: '017028', name: '国泰标普500ETF发起联接(QDII)A人民币', index_key: 'sp500', kind: 'etf_link', link_to: '159612', share_class: 'A', currency: 'CNY' },
  { code: '017030', name: '国泰标普500ETF发起联接(QDII)C人民币', index_key: 'sp500', kind: 'etf_link', link_to: '159612', share_class: 'C', currency: 'CNY' },
  { code: '018064', name: '华夏标普500ETF发起式联接(QDII)A人民币', index_key: 'sp500', kind: 'etf_link', link_to: '159655', share_class: 'A', currency: 'CNY' },
  { code: '018065', name: '华夏标普500ETF发起式联接(QDII)C人民币', index_key: 'sp500', kind: 'etf_link', link_to: '159655', share_class: 'C', currency: 'CNY' },
  { code: '018066', name: '华夏标普500ETF发起式联接(QDII)A美元现汇', index_key: 'sp500', kind: 'etf_link', link_to: '159655', share_class: 'A', currency: 'USD' },
  { code: '050025', name: '博时标普500ETF联接(QDII)A人民币', index_key: 'sp500', kind: 'etf_link', link_to: '513500', share_class: 'A', currency: 'CNY' },
  { code: '006075', name: '博时标普500ETF联接(QDII)C人民币', index_key: 'sp500', kind: 'etf_link', link_to: '513500', share_class: 'C', currency: 'CNY' },
  { code: '018738', name: '博时标普500ETF联接(QDII)E人民币', index_key: 'sp500', kind: 'etf_link', link_to: '513500', share_class: 'E', currency: 'CNY' },
  { code: '013425', name: '博时标普500ETF联接(QDII)A美元现汇', index_key: 'sp500', kind: 'etf_link', link_to: '513500', share_class: 'A', currency: 'USD' },
  { code: '013499', name: '博时标普500ETF联接(QDII)C美元现汇', index_key: 'sp500', kind: 'etf_link', link_to: '513500', share_class: 'C', currency: 'USD' },
  { code: '007721', name: '天弘标普500发起(QDII-FOF)A', index_key: 'sp500', kind: 'standalone_qdii', link_to: null, share_class: 'A', currency: 'CNY' },
  { code: '007722', name: '天弘标普500发起(QDII-FOF)C', index_key: 'sp500', kind: 'standalone_qdii', link_to: null, share_class: 'C', currency: 'CNY' },
  { code: '022523', name: '天弘标普500发起(QDII-FOF)D', index_key: 'sp500', kind: 'standalone_qdii', link_to: null, share_class: 'D', currency: 'CNY' },
  { code: '161125', name: '易方达标普500指数(QDII-LOF)A人民币', index_key: 'sp500', kind: 'standalone_qdii', link_to: null, share_class: 'A', currency: 'CNY' },
  { code: '012860', name: '易方达标普500指数(QDII-LOF)C人民币', index_key: 'sp500', kind: 'standalone_qdii', link_to: null, share_class: 'C', currency: 'CNY' },
  { code: '003718', name: '易方达标普500指数(QDII-LOF)A美元现汇', index_key: 'sp500', kind: 'standalone_qdii', link_to: null, share_class: 'A', currency: 'USD' },
  { code: '012861', name: '易方达标普500指数(QDII-LOF)C美元现汇', index_key: 'sp500', kind: 'standalone_qdii', link_to: null, share_class: 'C', currency: 'USD' }
]);

export const NASDAQ_OTC_FUND_MAP = Object.freeze(Object.fromEntries(
  NASDAQ_OTC_FUNDS.map((item) => [item.code, item])
));
