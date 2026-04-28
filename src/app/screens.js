export const PROJECT_ID = '4075224789216868860';
export const PROJECT_TITLE = '股票建仓策略看板';

// 主 tab 顺序与元数据：所有页面都通过 WorkspacePage（侧边栏 + ?tab=）展示。
// 加仓计划（home）和定投计划（dca）已并入交易计划 tab，作为其二级 tab，不再独立出现在侧边栏。
export const PRIMARY_TAB_ORDER = ['holdings', 'tradePlans', 'fundSwitch', 'history', 'notify', 'backup'];

export const PRIMARY_TAB_META = {
  tradePlans: { label: '交易计划', hrefKey: 'tradePlans' },
  fundSwitch: { label: '基金切换', hrefKey: 'fundSwitch' },
  history: { label: '交易历史', hrefKey: 'history' },
  holdings: { label: '持仓总览', hrefKey: 'holdings' },
  newPlan: { label: '新建计划', hrefKey: 'newPlan' },
  notify: { label: '通知', hrefKey: 'notify' },
  backup: { label: '数据同步 / 备份', hrefKey: 'backup' }
};

// Legacy ?tab=home / ?tab=dca 进来时映射到 tradePlans 的对应二级视图。
// WorkspacePage 在 mount 时读取 query，将其重写到 ?tab=tradePlans 并把 hash 设为 LEGACY_TAB_HASH 中的值。
export const LEGACY_TAB_REDIRECTS = {
  home: { tab: 'tradePlans', hash: '#home' },
  dca: { tab: 'tradePlans', hash: '#dca' }
};

// 所有链接都指向唯一的 index.html，通过 ?tab= 查询参数切换。
// 兼容性：原本的 accumNew/accumEdit/addLevel 独立页已合并到主入口，重定向到对应 tab；
// links.home / links.dca 现在都指向交易计划 tab 的二级视图。
export function createPageLinks({ inPagesDir = false } = {}) {
  const indexHref = inPagesDir ? '../index.html' : './index.html';
  return {
    home: indexHref,
    tradePlans: `${indexHref}?tab=tradePlans`,
    tradePlansHome: `${indexHref}?tab=tradePlans#home`,
    dca: `${indexHref}?tab=tradePlans#dca`,
    fundSwitch: `${indexHref}?tab=fundSwitch`,
    history: `${indexHref}?tab=history`,
    holdings: `${indexHref}?tab=holdings`,
    newPlan: `${indexHref}?tab=newPlan`,
    notify: `${indexHref}?tab=notify`,
    backup: `${indexHref}?tab=backup`,
    // 旧入口已并入交易计划 tab 的 #new 子视图
    accumNew: `${indexHref}?tab=tradePlans#new`,
    accumEdit: indexHref,
    addLevel: indexHref,
    catalog: indexHref
  };
}

export function getPrimaryTabs(links) {
  return PRIMARY_TAB_ORDER.map((key) => ({
    key,
    label: PRIMARY_TAB_META[key].label,
    href: links[PRIMARY_TAB_META[key].hrefKey]
  }));
}

export function isWorkspaceGroup(group = '') {
  return PRIMARY_TAB_ORDER.includes(group);
}
