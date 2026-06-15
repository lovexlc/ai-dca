/**
 * ETF切换策略V2 - 浏览器快速初始化脚本
 *
 * 使用方法：
 * 1. 打开浏览器开发者工具（F12）
 * 2. 切换到 Console 标签
 * 3. 复制粘贴此脚本并回车
 * 4. 刷新页面
 */

(function() {
  console.log('========================================');
  console.log('ETF切换策略V2 - 初始化脚本');
  console.log('========================================\n');

  // 检查当前状态
  const existingState = localStorage.getItem('aiDcaQuantProjectState');
  if (existingState) {
    console.log('⚠️  检测到已有数据');
    const parsed = JSON.parse(existingState);
    console.log('- 现金:', parsed.account?.cash);
    console.log('- useV2Logic:', parsed.settings?.useV2Logic);
    console.log('- enableEnhancedRiskControl:', parsed.settings?.enableEnhancedRiskControl);

    const shouldReinit = confirm('检测到已有数据。是否要重新初始化？\n（当前数据将被覆盖）');
    if (!shouldReinit) {
      console.log('\n❌ 初始化已取消');
      return;
    }
  }

  // 完整的初始状态
  const defaultState = {
    account: {
      cash: 60000,
      feeRate: 0.01,
      minFee: 0,
      tickSize: 0.001,
      slippageTicks: 1,
      positions: {
        '159513': {
          symbol: '159513',
          name: '纳指科技 ETF',
          shares: 20000,
          costPrice: 1.735
        },
        '513100': {
          symbol: '513100',
          name: '纳指 ETF',
          shares: 8000,
          costPrice: 1.486
        }
      }
    },
    strategy: {
      name: '纳指 ETF 溢价差',
      sellSymbol: '159513',
      buySymbol: '513100',
      triggerSpreadPct: 0.3,
      closeSpreadPct: 0.12,
      feeBufferPct: 0.04,
      maxOrderCash: 16000,
      minOrderCash: 1000,
      lotSize: 100,
      cooldownDays: 2
    },
    quotes: {
      '159513': {
        symbol: '159513',
        name: '纳指科技 ETF',
        bid: 1.772,
        bidSize: 83000,
        ask: 1.773,
        askSize: 64000,
        iopv: 1.762,
        price: 1.772,
        asOf: '',
        source: 'manual',
        marketState: '',
        cached: false
      },
      '513100': {
        symbol: '513100',
        name: '纳指 ETF',
        bid: 1.498,
        bidSize: 92000,
        ask: 1.499,
        askSize: 78000,
        iopv: 1.496,
        price: 1.498,
        asOf: '',
        source: 'manual',
        marketState: '',
        cached: false
      }
    },
    realtime: {
      enabled: false,
      autoExecute: false,
      onlyTradingSession: true,
      refreshIntervalSec: 10,
      maxExecutionsPerDay: 1,
      executionsToday: 0,
      lastExecutionDate: '',
      lastExecutionAt: '',
      lastRefreshAt: '',
      lastQuoteAt: '',
      lastStatus: 'idle',
      lastError: ''
    },
    settings: {
      dataSource: 'xueqiu',
      broker: 'paper',
      brokerAccount: 'PAPER-001',
      brokerApiKey: '',
      viewDensity: 'standard',
      paperTradeOnly: true,
      useV2Logic: true,              // ✅ 启用V2逻辑
      enableEnhancedRiskControl: true // ✅ 启用增强风控
    },
    orders: []
  };

  // 保存到localStorage
  try {
    localStorage.setItem('aiDcaQuantProjectState', JSON.stringify(defaultState));
    console.log('\n✅ 初始化成功！');
    console.log('\n已设置的数据：');
    console.log('- 账户总资产: ¥107,424');
    console.log('  - 现金: ¥60,000');
    console.log('  - 159513持仓: 20,000股 @ ¥1.735');
    console.log('  - 513100持仓: 8,000股 @ ¥1.486');
    console.log('');
    console.log('- 策略配置:');
    console.log('  - 触发线: 0.3%');
    console.log('  - 费用缓冲: 0.04%');
    console.log('  - 单次最大金额: ¥16,000');
    console.log('');
    console.log('- V2配置:');
    console.log('  - useV2Logic: ✅ true');
    console.log('  - enableEnhancedRiskControl: ✅ true');
    console.log('');
    console.log('📍 当前报价:');
    console.log('  - 159513: bid=1.772, iopv=1.762, 溢价率=0.57%');
    console.log('  - 513100: bid=1.498, iopv=1.496, 溢价率=0.13%');
    console.log('  - 净差价: 0.44% (接近触发线 0.3%)');
    console.log('');
    console.log('🔄 请刷新页面查看效果！');

    const shouldReload = confirm('初始化完成！是否立即刷新页面？');
    if (shouldReload) {
      location.reload();
    }
  } catch (error) {
    console.error('❌ 初始化失败:', error);
  }

  console.log('\n========================================');
})();
