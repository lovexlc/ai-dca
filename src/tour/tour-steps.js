// 引导步骤定义。
// 每个步骤可选字段：
//   key:        唯一标识
//   tab:        切换到哪个 sidebar tab；不填则保持当前 tab
//   target:     CSS selector，[data-tour=...] 形式；不填或不存在则居中显示无高亮
//   title:      标题
//   body:       正文（字符串）
//   placement:  'center' 强制居中显示；其他值或不填走自动定位（右/下/上/左）
export const TOUR_STEPS = [
  {
    key: 'welcome',
    title: '欢迎使用 ai-dca 👋',
    body: '我带你 30 秒走一遍主要功能。共 8 步，可随时跳过——右下角「新手引导」按钮可以再次打开。',
    placement: 'center'
  },
  {
    key: 'holdings',
    tab: 'holdings',
    target: '[data-tour="sidebar-holdings"]',
    title: '第 1 步 · 录入持仓',
    body:
      '《持仓总览》是所有数据的起点。支持手动录入、粘贴 Excel、截图 OCR 三种方式导入历史交易。先把已有的基金 / 股票账本同步进来，后面所有提醒都基于这份账本。'
  },
  {
    key: 'tradePlans',
    tab: 'tradePlans',
    target: '[data-tour="sidebar-tradePlans"]',
    title: '第 2 步 · 配建仓 / 定投',
    body:
      '《交易计划》同时管理建仓策略与定投模板。所有买卖信号都源自这里——没有计划，到点也不会有提醒。先建一条基础策略再说。'
  },
  {
    key: 'fundSwitch',
    tab: 'fundSwitch',
    target: '[data-tour="sidebar-fundSwitch"]',
    title: '第 3 步 · 基金切换',
    body:
      '记录历史切换链路、对比切换前后的收益口径、用截图 OCR 一键导入切换明细。如果你做基金调仓比较频繁，会常逛这里。'
  },
  {
    key: 'history',
    tab: 'history',
    target: '[data-tour="sidebar-history"]',
    title: '第 4 步 · 交易历史',
    body:
      '跨账户的成交回顾，按时间线翻所有买入 / 卖出 / 切换记录。复盘和核对账时来这里。'
  },
  {
    key: 'notify',
    tab: 'notify',
    target: '[data-tour="sidebar-notify"]',
    title: '第 5 步 · 设置消息通知',
    body:
      '推送通道（iOS Bark / Android 配对）和提醒策略都集中在这里。务必先绑一个通道——否则交易信号触发了也只会沉在浏览器里、发不到手机上。'
  },
  {
    key: 'backup',
    tab: 'backup',
    target: '[data-tour="sidebar-backup"]',
    title: '第 6 步 · 备份与恢复',
    body:
      '所有数据存在浏览器 localStorage。强烈建议第一天就配好 WebDAV 同步，避免清缓存或换设备时丢账本。也支持本地导出 / 文件恢复。'
  },
  {
    key: 'done',
    title: '完成 ✨',
    body:
      '随时可以点击右下角的「新手引导」按钮重开这趟流程。祝定投顺利、风控到位。',
    placement: 'center'
  }
];

export const TOUR_STORAGE_KEY = 'aiDcaTourCompleted';
