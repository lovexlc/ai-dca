# ETF切换策略V2 - 页面调试指南

## 🔍 如何在浏览器中检查数据

### 1. 打开浏览器开发者工具

按 `F12` 或右键 → 检查，打开开发者工具

### 2. 在控制台 (Console) 中运行以下命令

#### 查看当前状态
```javascript
// 读取存储的状态
const state = JSON.parse(localStorage.getItem('aiDcaQuantProjectState') || '{}');
console.log('当前状态：', state);
```

#### 查看V2配置
```javascript
const state = JSON.parse(localStorage.getItem('aiDcaQuantProjectState') || '{}');
console.log('useV2Logic:', state.settings?.useV2Logic);
console.log('enableEnhancedRiskControl:', state.settings?.enableEnhancedRiskControl);
```

#### 查看账户信息
```javascript
const state = JSON.parse(localStorage.getItem('aiDcaQuantProjectState') || '{}');
console.log('现金:', state.account?.cash);
console.log('持仓:', state.account?.positions);
```

#### 查看报价数据
```javascript
const state = JSON.parse(localStorage.getItem('aiDcaQuantProjectState') || '{}');
console.log('报价:', state.quotes);
```

#### 清空缓存重新开始
```javascript
localStorage.removeItem('aiDcaQuantProjectState');
console.log('缓存已清除，请刷新页面');
location.reload();
```

---

## 🐛 常见问题排查

### 问题1：页面显示"--"或没有数据

**原因**: localStorage中没有初始化数据

**解决方案**:
```javascript
// 方案1：清空缓存重新初始化
localStorage.removeItem('aiDcaQuantProjectState');
location.reload();

// 方案2：手动设置初始数据
const defaultState = {
  account: {
    cash: 60000,
    feeRate: 0.01,
    minFee: 0,
    tickSize: 0.001,
    slippageTicks: 1,
    positions: {
      '159513': { symbol: '159513', name: '纳指科技 ETF', shares: 20000, costPrice: 1.735 },
      '513100': { symbol: '513100', name: '纳指 ETF', shares: 8000, costPrice: 1.486 }
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
    '159513': { symbol: '159513', name: '纳指科技 ETF', bid: 1.772, bidSize: 83000, ask: 1.773, askSize: 64000, iopv: 1.762 },
    '513100': { symbol: '513100', name: '纳指 ETF', bid: 1.498, bidSize: 92000, ask: 1.499, askSize: 78000, iopv: 1.496 }
  },
  realtime: { enabled: false, autoExecute: false },
  settings: {
    dataSource: 'xueqiu',
    broker: 'paper',
    brokerAccount: 'PAPER-001',
    brokerApiKey: '',
    viewDensity: 'standard',
    paperTradeOnly: true,
    useV2Logic: true,
    enableEnhancedRiskControl: true
  },
  orders: []
};

localStorage.setItem('aiDcaQuantProjectState', JSON.stringify(defaultState));
console.log('初始数据已设置');
location.reload();
```

---

### 问题2：V2标记没有显示

**检查V2配置**:
```javascript
const state = JSON.parse(localStorage.getItem('aiDcaQuantProjectState') || '{}');
if (state.settings?.useV2Logic === true) {
  console.log('✅ V2已启用');
} else {
  console.log('❌ V2未启用，正在修复...');
  state.settings = state.settings || {};
  state.settings.useV2Logic = true;
  state.settings.enableEnhancedRiskControl = true;
  localStorage.setItem('aiDcaQuantProjectState', JSON.stringify(state));
  console.log('✅ V2已启用，请刷新页面');
  location.reload();
}
```

---

### 问题3：回测没有数据

**原因**: 回测需要点击"运行回测"按钮

**检查方法**:
```javascript
// 检查是否有回测结果
const hasBacktest = !!localStorage.getItem('aiDcaQuantBacktestResult');
console.log('是否有回测结果:', hasBacktest);

// 如果没有，点击页面上的"运行回测"按钮
```

---

### 问题4：风控预警一直显示

**检查风控状态**:
```javascript
const state = JSON.parse(localStorage.getItem('aiDcaQuantProjectState') || '{}');

// 检查报价是否异常
console.log('159513 溢价率:', ((state.quotes?.['159513']?.bid - state.quotes?.['159513']?.iopv) / state.quotes?.['159513']?.iopv * 100).toFixed(2) + '%');
console.log('513100 溢价率:', ((state.quotes?.['513100']?.bid - state.quotes?.['513100']?.iopv) / state.quotes?.['513100']?.iopv * 100).toFixed(2) + '%');

// 如果溢价率超过±3%，这是正常的风控预警
// 可以手动调整报价数据：
state.quotes['159513'].bid = 1.77;
state.quotes['159513'].iopv = 1.762;
state.quotes['513100'].bid = 1.50;
state.quotes['513100'].iopv = 1.496;
localStorage.setItem('aiDcaQuantProjectState', JSON.stringify(state));
location.reload();
```

---

## 📊 查看详细日志

在页面上打开开发者工具，切换到 Console 标签，可以看到：
- 状态初始化日志
- 订单计划生成日志
- 风控检查日志
- API请求日志

---

## 🧪 测试数据生成

如果想测试不同的市场情况，可以手动修改报价：

### 场景1：触发交易信号（差价较大）
```javascript
const state = JSON.parse(localStorage.getItem('aiDcaQuantProjectState') || '{}');
state.quotes['159513'].bid = 1.80;  // 高溢价
state.quotes['513100'].bid = 1.49;  // 低溢价
localStorage.setItem('aiDcaQuantProjectState', JSON.stringify(state));
location.reload();
```

### 场景2：观察状态（差价小）
```javascript
const state = JSON.parse(localStorage.getItem('aiDcaQuantProjectState') || '{}');
state.quotes['159513'].bid = 1.765;
state.quotes['513100'].bid = 1.498;
localStorage.setItem('aiDcaQuantProjectState', JSON.stringify(state));
location.reload();
```

### 场景3：触发风控预警（极端溢价）
```javascript
const state = JSON.parse(localStorage.getItem('aiDcaQuantProjectState') || '{}');
state.quotes['159513'].bid = 1.85;  // 极端高溢价 (>5%)
state.quotes['159513'].iopv = 1.762;
localStorage.setItem('aiDcaQuantProjectState', JSON.stringify(state));
location.reload();
```

---

## 📞 仍然有问题？

1. 检查浏览器控制台是否有错误信息
2. 尝试清空缓存重新加载：`localStorage.clear(); location.reload();`
3. 检查网络请求是否成功（Network 标签）
4. 运行本地测试：`node test-frontend-data.js`

---

## ✅ 预期行为

正常情况下，页面应该显示：

**核心指标卡片**
- 账户总资产: ¥107,424.00
- 持仓市值: ¥47,424.00
- 净差价: 0.33% (或其他值)
- 预估收益: ¥35.42 (如果可交易)

**交易信号**
- 状态徽章: "可交易" (绿色) 或 "观察中" (灰色)
- V2标记: 紫色小徽章
- 各项溢价率正常显示

**风控检查**
- 如果有预警，显示黄色/红色预警卡片
- 无预警时不显示风控卡片

**配置预设**
- 三个可选配置：保守型、平衡型、激进型
- 当前选中的配置有紫色边框

**回测功能**
- 点击"运行回测"后显示结果
- 包含：交易次数、总收益、胜率、最大回撤、夏普比率
