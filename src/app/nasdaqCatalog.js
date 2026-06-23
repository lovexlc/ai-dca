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

export const SWITCH_STRATEGY_ETFS = Object.freeze([
  ...NASDAQ_ETFS,
  ...SP500_ETFS
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
  { code: '003722', name: '易方达纳斯达克100ETF联接(QDII-LOF)A美元现汇', index_key: 'nasdaq100', kind: 'etf_link', link_to: '159696', share_class: 'A', currency: 'USD' },
  { code: '040046', name: '华安纳斯达克100ETF联接(QDII)A', index_key: 'nasdaq100', kind: 'etf_link', link_to: '159632', share_class: 'A', currency: 'CNY' },
  { code: '014978', name: '华安纳斯达克100ETF联接(QDII)C', index_key: 'nasdaq100', kind: 'etf_link', link_to: '159632', share_class: 'C', currency: 'CNY' },
  { code: '016055', name: '博时纳斯达克100ETF发起式联接(QDII)A人民币', index_key: 'nasdaq100', kind: 'etf_link', link_to: '513390', share_class: 'A', currency: 'CNY' },
  { code: '016057', name: '博时纳斯达克100ETF发起式联接(QDII)C人民币', index_key: 'nasdaq100', kind: 'etf_link', link_to: '513390', share_class: 'C', currency: 'CNY' },
  { code: '016056', name: '博时纳斯达克100ETF发起式联接(QDII)A美元', index_key: 'nasdaq100', kind: 'etf_link', link_to: '513390', share_class: 'A', currency: 'USD' },
  { code: '016058', name: '博时纳斯达克100ETF发起式联接(QDII)C美元', index_key: 'nasdaq100', kind: 'etf_link', link_to: '513390', share_class: 'C', currency: 'USD' },
  { code: '015299', name: '华夏纳斯达克100ETF发起式联接(QDII)A', index_key: 'nasdaq100', kind: 'etf_link', link_to: '513300', share_class: 'A', currency: 'CNY' },
  { code: '015300', name: '华夏纳斯达克100ETF发起式联接(QDII)C', index_key: 'nasdaq100', kind: 'etf_link', link_to: '513300', share_class: 'C', currency: 'CNY' },
  { code: '016532', name: '嘉实纳斯达克100ETF发起联接(QDII)A人民币', index_key: 'nasdaq100', kind: 'etf_link', link_to: '159501', share_class: 'A', currency: 'CNY' },
  { code: '016533', name: '嘉实纳斯达克100ETF发起联接(QDII)C人民币', index_key: 'nasdaq100', kind: 'etf_link', link_to: '159501', share_class: 'C', currency: 'CNY' },
  { code: '016534', name: '嘉实纳斯达克100ETF发起联接(QDII)A美元现汇', index_key: 'nasdaq100', kind: 'etf_link', link_to: '159501', share_class: 'A', currency: 'USD' },
  { code: '016535', name: '嘉实纳斯达克100ETF发起联接(QDII)C美元现汇', index_key: 'nasdaq100', kind: 'etf_link', link_to: '159501', share_class: 'C', currency: 'USD' },
  { code: '021838', name: '嘉实纳斯达克100ETF发起联接(QDII)I人民币', index_key: 'nasdaq100', kind: 'etf_link', link_to: '159501', share_class: 'I', currency: 'CNY' },
  { code: '018966', name: '汇添富纳斯达克100ETF发起式联接(QDII)人民币A', index_key: 'nasdaq100', kind: 'etf_link', link_to: '159660', share_class: 'A', currency: 'CNY' },
  { code: '018967', name: '汇添富纳斯达克100ETF发起式联接(QDII)人民币C', index_key: 'nasdaq100', kind: 'etf_link', link_to: '159660', share_class: 'C', currency: 'CNY' },
  { code: '019524', name: '华泰柏瑞纳斯达克100ETF发起式联接(QDII)A', index_key: 'nasdaq100', kind: 'etf_link', link_to: '513110', share_class: 'A', currency: 'CNY' },
  { code: '019525', name: '华泰柏瑞纳斯达克100ETF发起式联接(QDII)C', index_key: 'nasdaq100', kind: 'etf_link', link_to: '513110', share_class: 'C', currency: 'CNY' },
  { code: '019547', name: '招商纳斯达克100ETF发起式联接(QDII)A', index_key: 'nasdaq100', kind: 'etf_link', link_to: '159659', share_class: 'A', currency: 'CNY' },
  { code: '019548', name: '招商纳斯达克100ETF发起式联接(QDII)C', index_key: 'nasdaq100', kind: 'etf_link', link_to: '159659', share_class: 'C', currency: 'CNY' },
  { code: '160213', name: '国泰纳斯达克100指数(QDII)', index_key: 'nasdaq100', kind: 'standalone_qdii', link_to: null, share_class: 'A', currency: 'CNY' },
  { code: '019172', name: '摩根纳斯达克100指数(QDII)人民币A', index_key: 'nasdaq100', kind: 'standalone_qdii', link_to: null, share_class: 'A', currency: 'CNY' },
  { code: '019173', name: '摩根纳斯达克100指数(QDII)人民币C', index_key: 'nasdaq100', kind: 'standalone_qdii', link_to: null, share_class: 'C', currency: 'CNY' },
  { code: '019174', name: '摩根纳斯达克100指数(QDII)美元A', index_key: 'nasdaq100', kind: 'standalone_qdii', link_to: null, share_class: 'A', currency: 'USD' },
  { code: '019736', name: '宝盈纳斯达克100指数发起(QDII)A人民币', index_key: 'nasdaq100', kind: 'standalone_qdii', link_to: null, share_class: 'A', currency: 'CNY' },
  { code: '019737', name: '宝盈纳斯达克100指数发起(QDII)C人民币', index_key: 'nasdaq100', kind: 'standalone_qdii', link_to: null, share_class: 'C', currency: 'CNY' },
  { code: '021000', name: '南方纳斯达克100指数发起(QDII)I人民币', index_key: 'nasdaq100', kind: 'standalone_qdii', link_to: null, share_class: 'I', currency: 'CNY' },
  { code: '017641', name: '摩根标普500指数(QDII)人民币A', index_key: 'sp500', kind: 'standalone_qdii', link_to: null, share_class: 'A', currency: 'CNY' },
  { code: '019305', name: '摩根标普500指数(QDII)人民币C', index_key: 'sp500', kind: 'standalone_qdii', link_to: null, share_class: 'C', currency: 'CNY' },
  { code: '017028', name: '国泰标普500ETF发起联接(QDII)A人民币', index_key: 'sp500', kind: 'etf_link', link_to: '159612', share_class: 'A', currency: 'CNY' },
  { code: '017030', name: '国泰标普500ETF发起联接(QDII)C人民币', index_key: 'sp500', kind: 'etf_link', link_to: '159612', share_class: 'C', currency: 'CNY' },
  { code: '018064', name: '华夏标普500ETF发起式联接(QDII)A人民币', index_key: 'sp500', kind: 'etf_link', link_to: '159655', share_class: 'A', currency: 'CNY' },
  { code: '018065', name: '华夏标普500ETF发起式联接(QDII)C人民币', index_key: 'sp500', kind: 'etf_link', link_to: '159655', share_class: 'C', currency: 'CNY' },
  { code: '050025', name: '博时标普500ETF联接(QDII)A人民币', index_key: 'sp500', kind: 'etf_link', link_to: '513500', share_class: 'A', currency: 'CNY' },
  { code: '006075', name: '博时标普500ETF联接(QDII)C人民币', index_key: 'sp500', kind: 'etf_link', link_to: '513500', share_class: 'C', currency: 'CNY' },
  { code: '018738', name: '博时标普500ETF联接(QDII)E人民币', index_key: 'sp500', kind: 'etf_link', link_to: '513500', share_class: 'E', currency: 'CNY' },
  { code: '007721', name: '天弘标普500发起(QDII-FOF)A', index_key: 'sp500', kind: 'standalone_qdii', link_to: null, share_class: 'A', currency: 'CNY' },
  { code: '007722', name: '天弘标普500发起(QDII-FOF)C', index_key: 'sp500', kind: 'standalone_qdii', link_to: null, share_class: 'C', currency: 'CNY' },
  { code: '022523', name: '易方达标普500指数(QDII-LOF)A人民币', index_key: 'sp500', kind: 'standalone_qdii', link_to: null, share_class: 'A', currency: 'CNY' },
  { code: '012860', name: '易方达标普500指数(QDII-LOF)C人民币', index_key: 'sp500', kind: 'standalone_qdii', link_to: null, share_class: 'C', currency: 'CNY' }
]);

export const NASDAQ_OTC_FUND_MAP = Object.freeze(Object.fromEntries(
  NASDAQ_OTC_FUNDS.map((item) => [item.code, item])
));
