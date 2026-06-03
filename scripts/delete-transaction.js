/**
 * 浏览器控制台脚本：删除指定交易记录并刷新持仓纵览
 *
 * 使用方法：
 *   1. 打开 AI-DCA 应用页面
 *   2. F12 打开开发者工具 → Console
 *   3. 粘贴整个脚本并回车
 *   4. 按提示操作
 *
 * 支持两种 ledger：
 *   - 基金持仓台账 (aiDcaFundHoldingsLedger)
 *   - 股票交易台账 (aiDcaTradeLedger)
 */

;(function () {
  'use strict';

  const FUND_KEY = 'aiDcaFundHoldingsLedger';
  const TRADE_KEY = 'aiDcaTradeLedger';

  // ── 工具函数 ─────────────────────────────────────────────

  function readJSON(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function writeJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function pad(str, len) {
    return String(str).padEnd(len);
  }

  // ── 1. 列出所有交易记录 ──────────────────────────────────

  function listFundTransactions() {
    const state = readJSON(FUND_KEY);
    if (!state || !Array.isArray(state.transactions) || state.transactions.length === 0) {
      console.log('⚠️  未找到基金交易记录');
      return [];
    }
    const txs = state.transactions;
    console.log(`\n📋 基金交易记录（共 ${txs.length} 条）：`);
    console.log('─'.repeat(90));
    console.log(
      pad('序号', 6) +
      pad('ID', 24) +
      pad('代码', 8) +
      pad('名称', 14) +
      pad('类型', 6) +
      pad('日期', 12) +
      pad('价格', 10) +
      '份额'
    );
    console.log('─'.repeat(90));
    txs.forEach((tx, i) => {
      console.log(
        pad(i, 6) +
        pad(tx.id, 24) +
        pad(tx.code, 8) +
        pad(tx.name || '', 14) +
        pad(tx.type, 6) +
        pad(tx.date || '(无日期)', 12) +
        pad(tx.price, 10) +
        tx.shares
      );
    });
    console.log('─'.repeat(90));
    return txs;
  }

  function listStockTrades() {
    const trades = readJSON(TRADE_KEY);
    if (!Array.isArray(trades) || trades.length === 0) {
      console.log('⚠️  未找到股票交易记录');
      return [];
    }
    console.log(`\n📋 股票交易记录（共 ${trades.length} 条）：`);
    console.log('─'.repeat(80));
    console.log(
      pad('序号', 6) +
      pad('ID', 24) +
      pad('代码', 10) +
      pad('方向', 6) +
      pad('日期', 12) +
      pad('价格', 10) +
      '份额'
    );
    console.log('─'.repeat(80));
    trades.forEach((t, i) => {
      console.log(
        pad(i, 6) +
        pad(t.id, 24) +
        pad(t.symbol, 10) +
        pad(t.side, 6) +
        pad(t.date || '', 12) +
        pad(t.price, 10) +
        t.shares
      );
    });
    console.log('─'.repeat(80));
    return trades;
  }

  // ── 2. 删除基金交易记录 ──────────────────────────────────

  function deleteFundTransaction(txId) {
    const state = readJSON(FUND_KEY);
    if (!state || !Array.isArray(state.transactions)) {
      console.error('❌ 未找到基金交易台账');
      return false;
    }

    const tx = state.transactions.find((t) => t.id === txId);
    if (!tx) {
      console.error(`❌ 未找到 ID 为 ${txId} 的交易记录`);
      return false;
    }

    // 过滤掉目标记录，并清理关联的 switchPairId
    state.transactions = state.transactions
      .filter((t) => t.id !== txId)
      .map((t) => (t.switchPairId === txId ? { ...t, switchPairId: '' } : t));

    writeJSON(FUND_KEY, state);

    // 触发 ledger-updated 事件，让页面自动刷新
    try {
      window.dispatchEvent(
        new CustomEvent('holdings:ledger-updated', { detail: { state } })
      );
    } catch {}

    console.log(`✅ 已删除基金交易：${tx.code} ${tx.type} ${tx.shares} 份（${tx.date || '无日期'}）`);
    return true;
  }

  // ── 3. 删除股票交易记录 ──────────────────────────────────

  function deleteStockTrade(tradeId) {
    const trades = readJSON(TRADE_KEY);
    if (!Array.isArray(trades)) {
      console.error('❌ 未找到股票交易台账');
      return false;
    }

    const trade = trades.find((t) => t.id === tradeId);
    if (!trade) {
      console.error(`❌ 未找到 ID 为 ${tradeId} 的交易记录`);
      return false;
    }

    const filtered = trades.filter((t) => t.id !== tradeId);
    writeJSON(TRADE_KEY, filtered);

    // 触发事件
    try {
      window.dispatchEvent(
        new CustomEvent('trade-ledger:updated', { detail: { entries: filtered } })
      );
    } catch {}

    console.log(`✅ 已删除股票交易：${trade.symbol} ${trade.side} ${trade.shares} 股（${trade.date}）`);
    return true;
  }

  // ── 4. 刷新页面持仓纵览 ─────────────────────────────────

  function refreshHoldings() {
    // 方式1：触发 ledger-updated 事件（React 组件会自动响应）
    try {
      const state = readJSON(FUND_KEY);
      if (state) {
        window.dispatchEvent(
          new CustomEvent('holdings:ledger-updated', { detail: { state } })
        );
      }
    } catch {}

    // 方式2：如果当前就在持仓页面，触发 storage 事件也可以
    try {
      window.dispatchEvent(new Event('storage'));
    } catch {}

    console.log('🔄 已触发持仓数据刷新事件');
    console.log('   如果页面未自动更新，请手动切换到其他标签页再切回来，或刷新页面');
  }

  // ── 5. 交互式菜单 ────────────────────────────────────────

  function showHelp() {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║              AI-DCA 交易记录删除工具                          ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  基金交易操作：                                               ║
║    fund.list()           列出所有基金交易记录                   ║
║    fund.delete(id)       按 ID 删除一条基金交易                ║
║    fund.deleteByCode(code, type?, date?)                      ║
║                         按代码+类型+日期删除                    ║
║                                                              ║
║  股票交易操作：                                               ║
║    stock.list()          列出所有股票交易记录                   ║
║    stock.delete(id)      按 ID 删除一条股票交易                ║
║    stock.deleteBySymbol(symbol, side?, date?)                 ║
║                         按代码+方向+日期删除                    ║
║                                                              ║
║  通用操作：                                                   ║
║    refresh()             刷新持仓纵览                          ║
║    help()                显示此帮助信息                         ║
║                                                              ║
║  示例：                                                       ║
║    fund.list()                          # 先查看所有记录       ║
║    fund.delete('tx-lk4m2x-a7b3c9')     # 按 ID 删除          ║
║    fund.deleteByCode('110011', 'BUY')   # 按代码+类型删除      ║
║    stock.deleteBySymbol('AAPL', 'sell') # 删除某只股票的卖出    ║
║    refresh()                            # 刷新持仓纵览         ║
╚══════════════════════════════════════════════════════════════╝
`);
  }

  // ── 挂载到 window ────────────────────────────────────────

  window.fund = {
    list: listFundTransactions,
    delete: deleteFundTransaction,
    deleteByCode: function (code, type, date) {
      const state = readJSON(FUND_KEY);
      if (!state || !Array.isArray(state.transactions)) {
        console.error('❌ 未找到基金交易台账');
        return false;
      }
      const normalizedCode = String(code).replace(/\D/g, '').padStart(6, '0');
      let matches = state.transactions.filter((tx) => tx.code === normalizedCode);
      if (type) matches = matches.filter((tx) => tx.type === type.toUpperCase());
      if (date) matches = matches.filter((tx) => tx.date === date);

      if (matches.length === 0) {
        console.error(`❌ 未找到匹配的交易（代码=${normalizedCode}${type ? ', 类型=' + type : ''}${date ? ', 日期=' + date : ''}）`);
        return false;
      }
      if (matches.length > 1) {
        console.warn(`⚠️  找到 ${matches.length} 条匹配记录，请指定更精确的条件或使用 fund.delete(id)：`);
        matches.forEach((tx) => {
          console.log(`   ${tx.id}  ${tx.code} ${tx.type} ${tx.shares} 份 ${tx.date || '(无日期)'}`);
        });
        return false;
      }

      return deleteFundTransaction(matches[0].id);
    }
  };

  window.stock = {
    list: listStockTrades,
    delete: deleteStockTrade,
    deleteBySymbol: function (symbol, side, date) {
      const trades = readJSON(TRADE_KEY);
      if (!Array.isArray(trades)) {
        console.error('❌ 未找到股票交易台账');
        return false;
      }
      const upperSymbol = String(symbol).toUpperCase().trim();
      let matches = trades.filter((t) => t.symbol === upperSymbol);
      if (side) matches = matches.filter((t) => t.side === side.toLowerCase());
      if (date) matches = matches.filter((t) => t.date === date);

      if (matches.length === 0) {
        console.error(`❌ 未找到匹配的交易（代码=${upperSymbol}${side ? ', 方向=' + side : ''}${date ? ', 日期=' + date : ''}）`);
        return false;
      }
      if (matches.length > 1) {
        console.warn(`⚠️  找到 ${matches.length} 条匹配记录，请指定更精确的条件或使用 stock.delete(id)：`);
        matches.forEach((t) => {
          console.log(`   ${t.id}  ${t.symbol} ${t.side} ${t.shares} 股 ${t.date}`);
        });
        return false;
      }

      return deleteStockTrade(matches[0].id);
    }
  };

  window.refresh = refreshHoldings;
  window.help = showHelp;

  showHelp();
})();
