import { useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { AlertCircle, Bell, BookOpen, CloudUpload, ListChecks, Wallet, Info, Trash2, X } from 'lucide-react';
import { clearDemoData, hasPotentialUserData, installDemoData, readDemoDataMeta } from '../app/demoData.js';
import { persistWorkspacePrefs, readWorkspacePrefs } from '../app/workspacePrefs.js';
import { Card, PageHero, Pill, NavPill, DisclosureBanner, SectionHeading, SelectField, cx, primaryButtonClass, secondaryButtonClass, subtleButtonClass } from '../components/experience-ui.jsx';

const HOME_OPTIONS = [
  { value: 'strategy', label: '策略指南' },
  { value: 'holdings', label: '持仓总览' },
  { value: 'tradePlans', label: '交易计划' },
  { value: 'notify', label: '通知设置' },
  { value: 'markets', label: '行情中心' },
  { value: 'fundSwitch', label: '基金切换' },
  { value: 'backup', label: '数据同步' }
];

const ACCOUNT_CARDS = [
  {
    title: '进取型',
    tone: 'red',
    sentence: '追求高收益，承受高波动',
    examples: 'AAPL / MSFT / GOOGL / AMZN / NVDA / META / TSLA / TSM',
    details: [
      ['进取型账户', ['清一色美股七巨头 + 台积电 + 博通 + AMD。', '英伟达占比最大，其次是谷歌，苹果/亚马逊/台积电/Meta 各占一部分。', '特斯拉仓位较小，280 美元以内再考虑加仓。', '追求高收益，承受高波动，是“改变未来的资产”。']]
    ]
  },
  {
    title: '稳健型',
    tone: 'indigo',
    sentence: '长期持有，只买不卖，金字塔加仓',
    examples: 'QQQ / SPY / VOO / IVV',
    details: [
      ['稳健型账户', ['纳指100和标普500 ETF 为核心，目标占比约 70%。', '叠加消费龙头，如 Costco、沃尔玛、麦当劳、宝洁。', '叠加医药保健，如礼来、强生、联合健康、诺和诺德。', '只买不卖，金字塔加仓，是资产配置的压舱石。']]
    ]
  },
  {
    title: '防守型',
    tone: 'emerald',
    sentence: '稳定分红，抗跌防御，构筑现金流',
    examples: 'BRK.B / KO / JNJ / SCHD / 国债 ETF',
    details: [
      ['防守型账户', ['美债及相关 ETF 占比较高，核心是吃利息。', '伯克希尔、可口可乐、强生、SCHD、VISA 构成防守权益资产。', '核心作用：吃派息分红 + 防守。', '每个月产生的现金流，用于机会出现时加仓宽基指数和科技股。']],
      ['为什么要配置防守型？', ['成功的交易员，不是赚得最多，是市场转向的时候还能活下来。', '具备足够多的心理安全感，才能没有顾虑地去做进取型。', '进取型、稳健型、防守型三者平衡，层层递进。']],
      ['设计哲学', ['从保单、不动产、宽基指数、伯克希尔等防守型资产起步。', '有了安全垫之后，才配置七巨头 + 台积电等进取型资产。', '层层递进，构筑现金流：主业、副业、投资收益的高位套现。', '不是一成不变的，要结合自身情况实时调整。']]
    ]
  }
];

const INDEX_DETAILS = [
  ['金字塔加仓法详解', ['事先算好准备用在标普500和纳指100上的总资金。', '跌到首买线后开始买入，之后每跌一个档位加仓一次。', '倍数 1-1-1.5-1.5-2-2-3，最后的“3”会动用额外资金，属于大跌大买。', '资金安排从小到大：小跌小买，大跌大买，把握重大机会。']],
  ['实例：100万资金分配', ['按 1-1-1.5-2-2-2.5 比例分配：690 美元安排 10 万，650 安排 10 万，625 安排 15 万，600 安排 20 万，585 安排 20 万，565 安排 25 万。', '如果只跌到 600，资金消耗 55 万，属于小跌小买。', '如果跌到 565，资金刚好打完，属于大跌大买。']],
  ['实例：英伟达金字塔买入', ['100 美元买 200 股，95 买 300 股，90 买 450 股，85 买 700 股，80 买 1400 股，76 防守节点买 3000 股。', '合计资金 49.65 万元，买入数量倍数前期 1.5 倍、后期 2 倍。', '越跌越买，把 6050 股成本摊低到 82 美元。']],
  ['简单理解：下跌时买入', ['100 元买 30 股，90 元买 50 股，80 元买 80 股，70 元买 120 股。', '随着下跌增加买入量，成本从 100 元降到 79.64 元。', '只要反弹回 80 元，就开始账面浮盈。']],
  ['高位少买规则', ['高点时减少定投金额，继续定投。', '原来每天 5-10 万，高点时降到每天 5000 元。', '保持在场，但不追高，攒下资金等大跌时再大举买入。']],
  ['VIX 恐慌指数信号', ['VIX 达到 30：捞一些宽基指数进来。', 'VIX 达到 40：开始买入个股和两个宽基指数 ETF。', 'VIX 达到 50：重点加仓，资金最少打掉 50% 以上。', 'VIX 在 50-90：属于很好的买入节点，但不是唯一参考指标。', '实际操作：VIX 到 30，两个宽基又跌到 6.5%+ 和 9%+，就第一次出手加仓。']]
];

const STOCK_DETAILS = [
  ['“第一兼唯一”选股原则', ['投资选个股，跟选伴侣一样难：优秀特质很难全部兼得。', '龙头个股是少数兼具规模和市场地位领先（第一），同时拥有核心技术/壁垒/不可替代性（唯一）的资产。', '最好兼具“第一和唯一”，这样的个股买入后有信心长期持有。', '不喜欢追高，看中的个股大多数在下跌时买入，不刮彩票。']],
  ['选股前提：看得懂、够了解', ['做投资的前提是风险控制。', '尽量买看得懂/足够了解的个股，起码错了知道掉哪个坑。', '不碰自己没把握/不了解的个股。', '投资首要前提是风险控制/保本，其次才是增值/收益。']],
  ['买入规则详解', ['先看基本面有没有恶化，如果没有，个股下跌 30% 左右开始买入。', '极个别非常优质公司会区别对待，下跌 20%+ 就动手买入。', '之后每下跌 4-5% 左右加仓一次，买入次数一般大于 6 次。', '抄底时出手，资金至少分 5 次，从少到多，不贪多，没买到就留着当下一次机会成本。']],
  ['实例：Meta 金字塔买入', ['安排给 Meta 的是 100 万美元。', '690 美元安排 10%，650 安排 10 万，625 安排 15 万，600 安排 20 万，585 安排 20 万，565 安排 25 万。', '如果 Meta 只跌到 600，资金消耗 55 万，属于小跌小买。', '如果 Meta 跌到 565，资金刚好打完，属于大跌大买。']],
  ['实例：英伟达操作全流程', ['130 以内开始买入，129 买 5%，120 买 10%，110 买 15%，100 买 20%，95 买 20%。', '中间 110-120 震荡时做了 T，之后又跌得远超预期。', '86 重仓买入近 80%，设置 76 防守价（未触发）。', '整体买入量远超预期，后来做 T 控制安全边际。', '留下 7 成底仓长期持有至 175-200 才开始第一阶段减仓。']],
  ['实例：联合健康操作', ['420 买 10%，400 买 10%，387 买 15%，325 买 15%，280 买 20%，260 买 25%。', '后来 250 又买入 43%，设置 227 大量买入（未触发）。', '导致整体持仓占比太高，买得远超预期。', '教训：个股跌得太深时，要控制单只仓位上限。']]
];

const T_DETAILS = [
  ['做T的核心目的', ['最重要的目的，是腾出资金和仓位，其次才是降低成本。', '腾出资金和仓位，是为了后续继续下跌时手头上有弹药可以继续抄底。', '这样能不断加固安全边际，让自己长久地留在牌桌上。']],
  ['做T的规则', ['7 成的底仓（核心仓位）不做 T，只有 3 成可以用于波段套利。', '技术高的可以 4-5 成做 T，留 5-6 成底仓。', '尽量在震荡行情中做 T，不要在单边上涨行情中做 T。', '如果计划正常、仓位和资金足够、没有告急，一般可以不做 T。', '一般做正 T（先买后卖），不做反 T（先卖后买），反 T 很考验技术。']],
  ['做T的实际操作', ['震荡下行时，金字塔加仓法买入。', '随着上涨，逐步分批卖掉做 T 的 3 成仓。', '这样能降低 7 成底仓的成本。', '如果下跌势头太猛，预计可能击穿防守价，就在回升到成本线上时卖掉一部分，腾出仓位和资金。']],
  ['倒金字塔卖出法（负成本路径）', ['一般在股价上涨 30% 以上再考虑卖出。', '例如 82 成本的英伟达：到 107 美元开始卖出 10%，上涨 40% 时卖出 15%，上涨 50% 时卖出 20%。', '如此直至低成本或负成本，尽可能吃到涨幅。', '“2-3-3-2”法：第一阶段上涨 30-50% 卖掉 20%，第二阶段上涨 50-80% 卖掉 30%，剩余分批卖出。', '负成本后反而会持有不卖，等股价创新高再看情况落袋为安。']],
  ['实例与总结', ['台积电：190、195、200、210 分批卖出，合计约 20%；后续再按 215-250 区间计划卖出。', 'Meta：720-730 卖掉 20%，735-750 准备卖 30%，但没有全部成交就下跌了。', '整体操作：金字塔加仓法逢低买入，倒金字塔减仓法逢高减仓，过程中做 T 控制安全边际，最终目标是负成本长期持有。']]
];

const DISCIPLINE_DETAILS = [
  ['安全边际三要素：资金、仓位、成本', ['不满仓，控制好安全边际，能不断提升资金利用率。', '永远不满仓，就是给自己留机会。', '做个懂进退的投资者，不让自己陷入被动。', '上杠杆要非常谨慎，除非把握很大。']],
  ['7-7.5成仓规则', ['一般 7-7.5 成仓，最少留足 30% 备用金。', '极个别情况下会 8 成仓。', '如果加仓消耗资金太多，就做 T 或从其他地方调资金过来，维持比例。']],
  ['仓位管理实例', ['如果满仓带融资：大概率在大暴跌中被爆仓。', '如果满仓：很难吃到暴跌中的低点福利，收益率普遍偏低。', '如果 7 成仓、低成本：下跌过程中做 T 控制好仓位和资金，收益率基本超 50%+，甚至 100%。']],
  ['抄底纪律', ['抄底时出手，资金至少分 5 次，从少到多。', '不贪多，没买到就留着当下一次的机会成本。', '不要两三次就打完，急性子的快枪手很容易让自己陷入被动。']],
  ['止损条件', ['基本面恶化 = 一票否决，无论价格多便宜都不买。', '连续亏损 3 年且看不到盈利希望 = 一票否决。', '现金 < 刚性债务 = 高风险。', '靠借钱度日 = 暴雷风险。']],
  ['负成本的意义', ['新手经过时间考验，才会知道控制安全边际有多重要。', '不贪多，不追高，不满仓，耐心等待机会。', '做低成本/负成本，会让投资整体更从容，进退有度。', '低成本/负成本能让人没有心理负担，心态更平和地持有。']]
];

function GuideButton({ children, onClick, variant = 'primary' }) {
  return (
    <button type="button" onClick={onClick} className={variant === 'primary' ? primaryButtonClass : secondaryButtonClass}>
      {children}
    </button>
  );
}

function InfoPopover({ title, sections }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 shadow-sm transition hover:border-indigo-200 hover:text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200"
          aria-label={`查看${title}详细说明`}
        >
          <Info className="h-4 w-4" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 w-80 max-h-80 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-xl outline-none"
        >
          <div className="mb-3 pr-6 text-sm font-bold text-slate-900">{title}</div>
          <div className="space-y-4">
            {sections.map(([heading, bullets]) => (
              <blockquote key={heading} className="border-l-2 border-indigo-200 pl-3">
                <div className="font-semibold text-slate-900">{heading}</div>
                <ul className="mt-2 space-y-1.5 leading-6">
                  {bullets.map((item) => <li key={item}>• {item}</li>)}
                </ul>
              </blockquote>
            ))}
          </div>
          <Popover.Arrow className="fill-white" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function SimpleTable({ headers, rows }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
          <tr>{headers.map((header) => <th key={header} className="px-4 py-3.5">{header}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100 text-slate-600">
          {rows.map((row, index) => <tr key={index} className="even:bg-slate-50/70">{row.map((cell, cellIndex) => <td key={cellIndex} className={cx('px-4 py-3.5 leading-6', cellIndex > 0 && 'tabular-nums')}>{cell}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}

function ScreenshotImage({ src, alt, caption }) {
  const [zoomed, setZoomed] = useState(false);
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-xs leading-5 text-slate-500">截图占位：{caption}</div>;
  }
  return (
    <>
      <figure className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <button type="button" onClick={() => setZoomed(true)} className="group block w-full cursor-zoom-in" aria-label={`点击放大查看：${alt}`}>
          <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} className="mx-auto block max-h-44 w-auto object-contain transition group-hover:opacity-90" />
        </button>
        {caption ? <figcaption className="px-4 py-2 text-xs text-slate-500">{caption} <span className="text-slate-400">（点图放大）</span></figcaption> : null}
      </figure>
      {zoomed ? (
        <div role="dialog" aria-modal="true" onClick={() => setZoomed(false)} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <img src={src} alt={alt} className="max-h-[92vh] max-w-[92vw] cursor-zoom-out rounded-lg object-contain shadow-2xl" onClick={(event) => event.stopPropagation()} />
          <button type="button" onClick={() => setZoomed(false)} className="absolute right-4 top-4 rounded-full bg-white/90 px-3 py-1 text-sm font-semibold text-slate-700 shadow hover:bg-white">关闭</button>
        </div>
      ) : null}
    </>
  );
}

function ReadmeCard({ title, description, bullets = [], cta, onClick }) {
  return (
    <Card className="flex h-full flex-col justify-between">
      <div>
        <h3 className="text-base font-bold text-slate-900">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
        {bullets.length ? (
          <ul className="mt-4 space-y-2 text-sm text-slate-600">
            {bullets.map((item) => <li key={item} className="flex gap-2"><span className="text-indigo-500">•</span><span>{item}</span></li>)}
          </ul>
        ) : null}
      </div>
      <button type="button" onClick={onClick} className={cx(subtleButtonClass, 'mt-5 w-full')}>{cta}</button>
    </Card>
  );
}

function AccountCard({ account }) {
  return (
    <Card className="relative h-full pr-14">
      <InfoPopover title={`${account.title}账户`} sections={account.details} />
      <Pill tone={account.tone}>{account.title}</Pill>
      <h3 className="mt-4 text-base font-bold text-slate-900">{account.sentence}</h3>
      <p className="mt-3 text-sm leading-6 text-slate-500">{account.examples}</p>
    </Card>
  );
}

function ToolStatusCard({ icon: Icon, title, value, note, action, onClick }) {
  return (
    <Card className="flex min-h-[148px] flex-col justify-between p-5 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <Pill tone="slate">{value}</Pill>
      </div>
      <div>
        <h2 className="mt-4 text-base font-bold text-slate-900">{title}</h2>
        <p className="mt-1 text-sm leading-5 text-slate-500">{note}</p>
      </div>
      <button type="button" onClick={onClick} className={cx(subtleButtonClass, 'mt-4 min-h-10 w-full px-3 py-2 text-xs')}>
        {action}
      </button>
    </Card>
  );
}

export function StrategyGuideExperience({ links, onNavigate, onDemoDataChange }) {
  const [demoMeta, setDemoMeta] = useState(() => readDemoDataMeta());
  const [prefs, setPrefs] = useState(() => readWorkspacePrefs());
  const [message, setMessage] = useState('');
  const [showQrModal, setShowQrModal] = useState(false);
  const hasUserData = useMemo(() => hasPotentialUserData(), []);

  function navigate(tabKey) {
    if (onNavigate) {
      onNavigate(tabKey);
      return;
    }
    if (typeof window !== 'undefined') {
      window.location.href = links?.[tabKey] || './index.html';
    }
  }

  function refreshDemoMeta() {
    const next = readDemoDataMeta();
    setDemoMeta(next);
    onDemoDataChange?.(next);
    return next;
  }

  function handleInstallDemo() {
    if (hasUserData && !window.confirm('检测到已有本地数据。生成演示数据会覆盖当前持仓、计划和定投数据。建议先到“数据同步”导出备份。确认继续？')) return;
    const meta = installDemoData();
    setMessage('演示数据已生成。下一步建议配置手机通知，完整体验“计划触发 → 手机提醒”的流程。');
    setDemoMeta(meta);
    onDemoDataChange?.(meta);
  }

  function handleClearDemo() {
    if (!window.confirm('确认清除演示数据？这会删除由 Demo 生成的持仓、计划、定投、账户分配和关注列表。')) return;
    clearDemoData();
    setMessage('演示数据已清除。你可以重新生成 Demo，或开始录入真实数据。');
    refreshDemoMeta();
  }

  function handleSaveHome() {
    const next = persistWorkspacePrefs({ homepageTab: prefs.homepageTab });
    setPrefs(next);
    setMessage(`已将“${HOME_OPTIONS.find((item) => item.value === next.homepageTab)?.label || '策略指南'}”设为默认首页。`);
  }

  const dashboardStatus = (() => {
    if (typeof window === 'undefined') {
      return { holdings: '待录入', plans: '0 个', notify: '未配置', backup: '未配置' };
    }
    function readJson(key) {
      try { return JSON.parse(window.localStorage.getItem(key) || 'null'); } catch { return null; }
    }
    const ledger = readJson('aiDcaFundHoldingsLedger');
    const txCount = Array.isArray(ledger?.transactions) ? ledger.transactions.length : 0;
    const planStore = readJson('aiDcaPlanStore');
    const planCount = Array.isArray(planStore?.plans) ? planStore.plans.length : 0;
    const dca = readJson('aiDcaDcaState');
    const hasDca = Boolean(dca && dca.source);
    const notify = readJson('aiDcaNotifyClientConfig');
    const hasNotify = Boolean(notify?.barkDeviceKey || notify?.notifyClientId);
    const webdav = readJson('aiDcaWebDavConfig');
    const hasBackup = Boolean(webdav?.baseUrl || webdav?.username);
    return {
      holdings: txCount ? `${txCount} 笔` : '待录入',
      plans: `${planCount + (hasDca ? 1 : 0)} 个`,
      notify: hasNotify ? '已配置' : '未配置',
      backup: hasBackup ? '已配置' : '未配置'
    };
  })();

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHero>
        <DisclosureBanner
          icon={<AlertCircle className="h-4 w-4" />}
          summary={<span><strong className="font-semibold">免责声明</strong>·本工具不构成投资建议，点击展开查看详情</span>}
          details={(
            <div className="space-y-3">
              <p>部分策略内容由公开的金渐成公众号文章整理总结而来。本工具与金渐成本人及其公众号无官方关联，不构成投资建议。仅供个人记录与学习使用，投资有风险、请独立判断。</p>
            </div>
          )}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="inline-flex min-h-9 items-center justify-center rounded-xl border border-indigo-200 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 transition-colors hover:border-indigo-400 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-2 whitespace-nowrap"
            onClick={() => setShowQrModal(true)}
          >
            点击加入群聊
          </button>
        </div>
      </PageHero>

      <main className="mx-auto flex max-w-6xl flex-col gap-10 px-5 py-8 sm:px-6">
        {message ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}

        <section className="space-y-5" aria-labelledby="dashboard-title">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Workspace</div>
              <h2 id="dashboard-title" className="mt-1 text-xl font-bold tracking-tight text-slate-900">今天从哪里开始？</h2>
            </div>
            <GuideButton onClick={() => navigate('holdings')}>新增交易</GuideButton>
          </div>
          <div id="tools-entry" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <ToolStatusCard icon={Wallet} title="持仓总览" value={dashboardStatus.holdings} note="资产、成本、收益和三账户分配" action="查看持仓" onClick={() => navigate('holdings')} />
            <ToolStatusCard icon={ListChecks} title="交易计划" value={dashboardStatus.plans} note="加仓、定投、卖出和 VIX 信号" action="新建加仓策略" onClick={() => navigate('tradePlans', { hash: '#new' })} />
            <ToolStatusCard icon={Bell} title="通知状态" value={dashboardStatus.notify} note="iOS、Android、PC 浏览器提醒" action="配置通知" onClick={() => navigate('notify')} />
            <ToolStatusCard icon={CloudUpload} title="数据同步" value={dashboardStatus.backup} note="WebDAV 备份与恢复" action="保存配置" onClick={() => navigate('backup')} />
          </div>
        </section>

        <Card className="border-indigo-100 bg-indigo-50/70 p-5 sm:p-6">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div id="demo-zone"><SectionHeading eyebrow="新手辅助" title="需要一套示例数据吗？" description="生成随机 Demo，快速理解持仓、交易计划、通知和账户体系。" /></div>
            <div className="flex flex-wrap gap-3">
              <GuideButton variant="secondary" onClick={handleInstallDemo}>{demoMeta ? '重新生成 Demo' : '生成演示数据'}</GuideButton>
              {demoMeta ? <GuideButton variant="secondary" onClick={handleClearDemo}><Trash2 className="h-4 w-4" />清除 Demo</GuideButton> : null}
            </div>
          </div>
        </Card>

        <Card id="home-preferences" className="border-slate-200 bg-white">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px_auto] lg:items-end">
            <SectionHeading eyebrow="偏好设置" title="默认打开哪个页面？" description="带 ?tab= 的链接仍会优先打开指定页面。" />
            <SelectField options={HOME_OPTIONS} value={prefs.homepageTab} onChange={(event) => setPrefs((current) => ({ ...current, homepageTab: event.target.value }))} />
            <GuideButton onClick={handleSaveHome}>保存默认主页</GuideButton>
          </div>
        </Card>

        <details data-scroll-card="true" data-scroll-card-title="指南索引与折叠详情" className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left">
            <span>
              <span className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Guide</span>
              <span className="mt-1 block text-xl font-bold tracking-tight text-slate-900">指南索引与折叠详情</span>
            </span>
            <BookOpen className="h-5 w-5 text-indigo-500 transition group-open:rotate-6" aria-hidden="true" />
          </summary>
          <div className="mt-6 space-y-8">
            <div className="sticky top-[52px] z-20 -mx-5 -mt-2 mb-2 flex items-center justify-between border-y border-slate-200 bg-white/95 px-5 py-2 text-xs font-bold text-slate-600 shadow-sm backdrop-blur sm:hidden">
              <span>指南索引与折叠详情</span>
              <span className="text-indigo-500">浏览中</span>
            </div>
            <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
              <h3 className="text-sm font-bold text-indigo-900">指南索引</h3>
              <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-indigo-700">
                {['手机通知', '三账户体系', '宽基 ETF', '个股策略', '做 T / 负成本', '操作纪律', '全站 README'].map((item) => <span key={item} className="rounded-full bg-white px-3 py-1">{item}</span>)}
              </div>
            </div>

        <section className="space-y-5">
          <SectionHeading eyebrow="刚需功能" title="先把手机通知配好" description="策略触发时能不能提醒到手机，是这个工具从“看板”变成“执行助手”的关键。复制完整链接也可以，系统会自动解析。" />
          <div className="grid gap-6 lg:grid-cols-3">
            <Card>
              <Pill tone="indigo">iOS Bark</Pill>
              <h3 className="mt-4 text-lg font-bold text-slate-900">复制完整 Bark 链接</h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">打开 Bark，复制 api.day.app 开头的完整链接，或只复制 Device Key。粘贴到通知页后，系统会自动提取可用 Key。</p>
              <ScreenshotImage src="/strategy-guide/bark-example.png" alt="iOS Bark 复制推送链接示例" caption="例如 https://api.day.app/Kkbv.../推送内容，整段复制粘到通知页即可。" />
              <button type="button" className={cx(primaryButtonClass, 'mt-5 w-full')} onClick={() => navigate('notify')}>去配置 iOS 通知</button>
            </Card>
            <Card>
              <Pill tone="emerald">Android</Pill>
              <h3 className="mt-4 text-lg font-bold text-slate-900">复制完整测试 URL</h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">打开 Android 推送 App，可以复制灰色框里的消息推送 ID，也可以复制完整测试 URL。系统会自动提取 android- 开头 ID。</p>
              <ScreenshotImage src="/strategy-guide/android-example.jpg" alt="Android 复制推送 ID 示例" caption="复制灰色框里的 android-... ID，或下方完整测试 URL、系统会自动提取。" />
              <button type="button" className={cx(primaryButtonClass, 'mt-5 w-full')} onClick={() => navigate('notify')}>去绑定 Android 设备</button>
            </Card>
            <Card>
              <Pill tone="slate">PC 浏览器</Pill>
              <h3 className="mt-4 text-lg font-bold text-slate-900">授权桌面通知</h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">适合电脑常开网页。授权后网页前台轮询事件并弹出桌面提醒；关闭网页后不作为后台推送运行。</p>
              <ul className="mt-4 space-y-2 text-sm text-slate-600"><li>1. 打开通知设置</li><li>2. 授权浏览器通知</li><li>3. 发送本地测试通知</li></ul>
              <button type="button" className={cx(primaryButtonClass, 'mt-5 w-full')} onClick={() => navigate('notify')}>去配置 PC 通知</button>
            </Card>
          </div>
        </section>

        <section className="space-y-5">
          <SectionHeading eyebrow="资产配置" title="三账户体系" />
          <div className="grid gap-6 md:grid-cols-3">
            {ACCOUNT_CARDS.map((account) => <AccountCard key={account.title} account={account} />)}
          </div>
          <GuideButton onClick={() => navigate('holdings')}>前往持仓总览 →</GuideButton>
        </section>

        <section className="space-y-5">
          <SectionHeading eyebrow="只买不卖" title="宽基指数 ETF 策略" />
          <Card className="relative space-y-5 pr-14">
            <InfoPopover title="宽基指数 ETF 策略" sections={INDEX_DETAILS} />
            <p className="text-sm leading-6 text-slate-500">核心原则：长期持有、只买不卖，按回撤金字塔分批加仓；高位少买，低位多买。</p>
            <SimpleTable headers={['', 'QQQ（纳指100）', 'SPY/VOO（标普500）']} rows={[[ '首买跌幅', '9%', '6.5%（指南参考）' ], [ '每档间隔', '3.5%', '2.5-3%（指南参考）' ], [ '档数', '7', '6（指南参考）' ], [ '倍数', '1-1-1.5-1.5-2-2-3', '同左' ]]} />
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">高位少买：距高点 &lt; 9% 时仅投计划金额的 10%，其余入资金池等大跌。SPY/VOO 的 6.5% / 6 档仅作为指南参考。</div>
            <SimpleTable headers={['VIX', '等级', '操作']} rows={[[ '<25', '平静', '常规定投，不追高' ], [ '25-30', '警戒', '保持定投 + 准备备用资金' ], [ '30-40', '中高恐慌', '加仓宽基' ], [ '40-50', '高恐慌', '宽基 + 个股全开' ], [ '≥50', '极端恐慌', '重仓，资金至少打 50%' ]]} />
            <GuideButton onClick={() => navigate('tradePlans')}>前往交易计划 →</GuideButton>
          </Card>
        </section>

        <section className="space-y-5">
          <SectionHeading eyebrow="第一兼唯一" title="个股投资策略" />
          <Card className="relative space-y-5 pr-14">
            <InfoPopover title="个股投资策略" sections={STOCK_DETAILS} />
            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {['第一兼唯一 — 行业第一或有唯一性护城河', '营收/利润持续增长 — 连续亏损 3 年一票否决', '资产负债健康 — 现金 ≥ 负债', '经营现金流为正 — 非靠借钱度日', '行业前景好 — 市场大 + 风口 + 竞争优势', '估值合理 — PE 历史百分位 < 70%'].map((item) => <div key={item} className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">{item}</div>)}
            </div>
            <SimpleTable headers={['规则', '参数']} rows={[[ '买入', '首买跌 30%（优质 20%+），每档 4-5%，≥6 档，1-1-1.5-2-2-2.5' ], [ '仓位', '单只上限 50%，总仓位 7-8.5 成，70% 底仓 + 30% 做 T' ], [ '减仓', '+15% / +25% / +35% 分档减仓' ]]} />
            <GuideButton onClick={() => navigate('tradePlans')}>前往交易计划 →</GuideButton>
          </Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-5">
            <SectionHeading eyebrow="终极目标" title="做 T 与负成本持股" />
            <Card className="relative pr-14">
              <InfoPopover title="做 T 与负成本" sections={T_DETAILS} />
              <ul className="space-y-3 text-sm leading-6 text-slate-600"><li>做 T 目的：腾出资金和仓位 &gt; 降低成本。</li><li>负成本路径：做 T + 逢高减仓（倒金字塔卖出法）→ 最终负成本长期持有。</li><li>安全边际：仓位 + 资金 + 成本，三者缺一不可。</li></ul>
            </Card>
          </div>
          <div className="space-y-5">
            <SectionHeading eyebrow="铁律" title="操作纪律" />
            <Card className="relative pr-14">
              <InfoPopover title="操作纪律" sections={DISCIPLINE_DETAILS} />
              <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-600">{['基本面恶化一票否决 — 无论多便宜都不买', '不追高 — 宁可错过，不可追高被套', '档差要拉开 — 不要几块钱就加仓', '不梭哈 — 逢跌分批买入', '永远留仓位 — 应对意外机会', '高位少买，低位多买 — 聪明定投核心', '做 T 目的 — 腾资金仓位 > 降低成本'].map((item) => <li key={item}>{item}</li>)}</ol>
            </Card>
          </div>
        </section>

        <section className="space-y-5">
          <SectionHeading eyebrow="全站 README" title="每个功能页能做什么" />
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            <ReadmeCard title="持仓总览" description="记录真实资产底账，管理交易流水、成本、收益、市值和三账户分配。" bullets={['新增或导入交易流水', '确认成本与收益', '分配进取/稳健/防守账户']} cta="前往持仓总览" onClick={() => navigate('holdings')} />
            <ReadmeCard title="交易计划" description="把策略变成可执行清单，包括加仓计划、定投计划和卖出计划。" bullets={['宽基金字塔加仓', '个股 checklist', 'Smart DCA 资金池']} cta="前往交易计划" onClick={() => navigate('tradePlans')} />
            <ReadmeCard title="通知设置" description="配置 iOS Bark、Android 推送 App 或 PC 浏览器通知，让策略触发时主动提醒你。" bullets={['复制完整链接自动解析', '发送测试通知', '同步交易计划规则']} cta="前往通知设置" onClick={() => navigate('notify')} />
            <ReadmeCard title="行情中心" description="查看关注标的、市场指数和 VIX 风险信号。" bullets={['维护美股关注列表', '观察指数和恐慌信号', '辅助判断是否进入加仓区']} cta="前往行情中心" onClick={() => navigate('markets')} />
            <ReadmeCard title="基金切换" description="辅助比较同类基金、ETF 或替代标的之间的切换机会。" bullets={['比较候选标的', '分析切换收益', '只在差异足够大时执行']} cta="前往基金切换" onClick={() => navigate('fundSwitch')} />
            <ReadmeCard title="数据同步" description="备份和恢复本地数据，避免浏览器清理或换设备导致数据丢失。" bullets={['导出当前数据', '恢复历史备份', '换设备前先备份']} cta="前往备份" onClick={() => navigate('backup')} />
          </div>
        </section>

          </div>
        </details>

        <Card className="border-slate-300 bg-white">
          <SectionHeading eyebrow="免责声明" title="非官方、非投资建议" />
          <p className="mt-4 text-sm leading-7 text-slate-500">本工具中的策略说明由公开的金渐成公众号文章整理、总结和结构化而来，仅用于个人学习、记录和辅助决策。本工具与金渐成本人及其公众号无官方关联、无授权关系，也不代表金渐成本人观点或服务。页面中的计划、提醒、演示数据和计算结果均为辅助工具输出，不构成任何投资建议。投资有风险，请独立判断并自行承担决策结果。</p>
          {demoMeta ? <div className="mt-5"><GuideButton variant="secondary" onClick={handleClearDemo}><Trash2 className="h-4 w-4" />体验完成，清除演示数据</GuideButton></div> : null}
        </Card>
      </main>

      {showQrModal ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="加入群聊二维码"
          onClick={() => setShowQrModal(false)}
        >
          <div
            className="relative max-w-sm w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              aria-label="关闭"
              className="absolute -top-3 -right-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-700 shadow-md transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
              onClick={() => setShowQrModal(false)}
            >
              <X className="h-4 w-4" />
            </button>
            <div className="overflow-hidden rounded-2xl bg-white shadow-2xl">
              <img
                src="https://img.remit.ee/api/file/BQACAgUAAyEGAASHRsPbAAEUUA9qDZ5H_XnPECnDzzMGTTIc2b_5_gAC8B4AAtk5cFTHSrIufYF2bDsE.jpg"
                alt="加入群聊二维码"
                className="block w-full"
              />
              <p className="px-4 py-3 text-center text-xs text-slate-600">使用微信 / QQ 扫码加入群聊</p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
