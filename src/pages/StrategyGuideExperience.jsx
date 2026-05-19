import { useMemo, useState } from 'react';
import { Bell, BookOpen, Database, LineChart, RefreshCw, Trash2, Wallet } from 'lucide-react';
import { clearDemoData, hasPotentialUserData, installDemoData, readDemoDataMeta } from '../app/demoData.js';
import { persistWorkspacePrefs, readWorkspacePrefs } from '../app/workspacePrefs.js';
import { Card, PageHero, Pill, SectionHeading, SelectField, cx, primaryButtonClass, secondaryButtonClass, subtleButtonClass } from '../components/experience-ui.jsx';

const HOME_OPTIONS = [
  { value: 'strategy', label: '策略指南' },
  { value: 'holdings', label: '持仓总览' },
  { value: 'tradePlans', label: '交易计划' },
  { value: 'notify', label: '通知设置' },
  { value: 'markets', label: '行情中心' },
  { value: 'fundSwitch', label: '基金切换' },
  { value: 'backup', label: '数据同步 / 备份' }
];

const QUICK_ENTRIES = [
  { key: 'holdings', title: '持仓总览', icon: Wallet, note: '真实资产底账、成本、收益、三账户分配' },
  { key: 'tradePlans', title: '交易计划', icon: BookOpen, note: '宽基/个股加仓、定投、卖出计划' },
  { key: 'notify', title: '通知设置', icon: Bell, note: '配置 iOS / Android / PC 推送提醒' },
  { key: 'markets', title: '行情中心', icon: LineChart, note: '关注标的、市场指数和 VIX 信号' },
  { key: 'fundSwitch', title: '基金切换', icon: RefreshCw, note: '比较同类基金和替代标的切换机会' },
  { key: 'backup', title: '数据备份', icon: Database, note: '导出、恢复和迁移本地数据' }
];

function GuideButton({ children, onClick, variant = 'primary' }) {
  return (
    <button type="button" onClick={onClick} className={variant === 'primary' ? primaryButtonClass : secondaryButtonClass}>
      {children}
    </button>
  );
}

function SimpleTable({ headers, rows }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
          <tr>{headers.map((header) => <th key={header} className="px-4 py-3">{header}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white text-slate-600">
          {rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex} className="px-4 py-3">{cell}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}

function ScreenshotPlaceholder({ title, children }) {
  return (
    <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500">
      <div className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-slate-400">截图说明</div>
      <div className="text-base font-bold text-slate-800">{title}</div>
      <p className="mt-2 leading-6">{children}</p>
    </div>
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

export function StrategyGuideExperience({ links, onNavigate, onDemoDataChange }) {
  const [demoMeta, setDemoMeta] = useState(() => readDemoDataMeta());
  const [prefs, setPrefs] = useState(() => readWorkspacePrefs());
  const [message, setMessage] = useState('');
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
    if (hasUserData && !window.confirm('检测到已有本地数据。生成演示数据会覆盖当前持仓、计划和定投数据。建议先到“数据同步 / 备份”导出备份。确认继续？')) {
      return;
    }
    const meta = installDemoData();
    setMessage('演示数据已生成。下一步建议配置手机通知，完整体验“计划触发 → 手机提醒”的流程。');
    setDemoMeta(meta);
    onDemoDataChange?.(meta);
  }

  function handleClearDemo() {
    if (!window.confirm('确认清除演示数据？这会删除由 Demo 生成的持仓、计划、定投、账户分配和关注列表。')) {
      return;
    }
    clearDemoData();
    setMessage('演示数据已清除。你可以重新生成 Demo，或开始录入真实数据。');
    refreshDemoMeta();
  }

  function handleSaveHome() {
    const next = persistWorkspacePrefs({ homepageTab: prefs.homepageTab });
    setPrefs(next);
    setMessage(`已将“${HOME_OPTIONS.find((item) => item.value === next.homepageTab)?.label || '策略指南'}”设为默认首页。`);
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHero
        eyebrow="美股投资工具箱"
        title="美股策略助手"
        description="把公开投资文章中的美股定投、金字塔加仓、持仓管理和通知提醒流程整理成可执行工具。"
        badges={[<Pill key="a" tone="indigo">策略指南</Pill>, <Pill key="b" tone="emerald">演示数据</Pill>, <Pill key="c" tone="amber">手机通知</Pill>, <Pill key="d" tone="slate">三账户体系</Pill>]}
      >
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
          策略内容由公开的金渐成公众号文章整理总结而来。本工具与金渐成本人及其公众号无官方关联，不构成投资建议。
        </div>
      </PageHero>

      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-6 sm:px-6">
        {message ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}

        <Card className="border-indigo-100 bg-indigo-50/70">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div>
              <SectionHeading eyebrow="新用户快速体验" title="一键生成演示数据" description="还没有真实持仓？先生成一套随机 Demo，体验持仓、交易计划、Smart DCA 资金池、三账户体系和通知提醒流程。Demo 数据只保存在本地。" />
              {demoMeta ? <p className="mt-4 text-sm text-indigo-700">当前 Demo：{demoMeta.seed} · {new Date(demoMeta.generatedAt).toLocaleString('zh-CN', { hour12: false })}</p> : null}
            </div>
            <div className="flex flex-wrap gap-3">
              <GuideButton onClick={handleInstallDemo}>{demoMeta ? '重新生成演示数据' : '生成演示数据'}</GuideButton>
              {demoMeta ? <GuideButton variant="secondary" onClick={handleClearDemo}><Trash2 className="h-4 w-4" />清除演示数据</GuideButton> : null}
            </div>
          </div>
          {demoMeta ? (
            <div className="mt-5 flex flex-wrap gap-3">
              <GuideButton onClick={() => navigate('notify')}>配置通知</GuideButton>
              <GuideButton variant="secondary" onClick={() => navigate('tradePlans')}>查看交易计划</GuideButton>
              <GuideButton variant="secondary" onClick={() => navigate('holdings')}>查看持仓</GuideButton>
            </div>
          ) : null}
        </Card>

        <section className="space-y-5">
          <SectionHeading eyebrow="刚需功能" title="先把手机通知配好" description="策略触发时能不能提醒到手机，是这个工具从“看板”变成“执行助手”的关键。复制完整链接也可以，系统会自动解析。" />
          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <Pill tone="indigo">iOS Bark</Pill>
              <h3 className="mt-4 text-lg font-bold text-slate-900">复制完整 Bark 链接</h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">打开 Bark，复制 api.day.app 开头的完整链接，或只复制 Device Key。粘贴到通知页后，系统会自动提取可用 Key。</p>
              <ScreenshotPlaceholder title="Bark 示例">例如 https://api.day.app/Kkbv.../推送内容，整段复制即可。</ScreenshotPlaceholder>
              <button type="button" className={cx(primaryButtonClass, 'mt-5 w-full')} onClick={() => navigate('notify')}>去配置 iOS 通知</button>
            </Card>
            <Card>
              <Pill tone="emerald">Android</Pill>
              <h3 className="mt-4 text-lg font-bold text-slate-900">复制完整测试 URL</h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">打开 Android 推送 App，可以复制灰色框里的消息推送 ID，也可以复制完整测试 URL。系统会自动提取 android- 开头 ID。</p>
              <ScreenshotPlaceholder title="Android 示例">例如 android-04b416451c30dccc，或包含该 ID 的完整 URL。</ScreenshotPlaceholder>
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
          <SectionHeading eyebrow="快捷入口" title="从这里进入各功能" />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {QUICK_ENTRIES.map((entry) => {
              const Icon = entry.icon;
              return (
                <button key={entry.key} type="button" onClick={() => navigate(entry.key)} className="group text-left transition hover:-translate-y-0.5">
                  <Card className="h-full transition group-hover:shadow-lg">
                    <Icon className="h-5 w-5 text-indigo-500" />
                    <h3 className="mt-4 text-base font-bold text-slate-900">{entry.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-500">{entry.note}</p>
                  </Card>
                </button>
              );
            })}
          </div>
        </section>

        <section className="space-y-5">
          <SectionHeading eyebrow="资产配置" title="三账户体系" />
          <div className="grid gap-4 md:grid-cols-3">
            {[['red', '进取型', 'Mag7 + TSMC 等高成长个股', '追求高收益，承受高波动。AAPL / MSFT / GOOGL / AMZN / NVDA / META / TSLA / TSM'], ['indigo', '稳健型', 'QQQ / SPY / VOO 宽基指数，占比 68%+', '长期持有，只买不卖，金字塔加仓。QQQ / SPY / VOO / IVV'], ['emerald', '防守型', '国债、BRK、KO、JNJ、SCHD', '稳定分红，抗跌防御。BRK.B / KO / JNJ / SCHD / 国债 ETF']].map(([tone, title, subtitle, text]) => (
              <Card key={title}><Pill tone={tone}>{title}</Pill><h3 className="mt-4 font-bold text-slate-900">{subtitle}</h3><p className="mt-2 text-sm leading-6 text-slate-500">{text}</p></Card>
            ))}
          </div>
          <GuideButton onClick={() => navigate('holdings')}>前往持仓总览 →</GuideButton>
        </section>

        <section className="space-y-5">
          <SectionHeading eyebrow="只买不卖" title="宽基指数 ETF 策略" />
          <Card className="space-y-5">
            <p className="text-sm leading-6 text-slate-500">宽基 ETF 是稳健账户核心：长期持有、只买不卖，按回撤金字塔分批加仓；高位少买，低位多买。</p>
            <SimpleTable headers={['', 'QQQ（纳指100）', 'SPY/VOO（标普500）']} rows={[[ '首买跌幅', '9%', '6.5%（指南参考）' ], [ '每档间隔', '3.5%', '2.5-3%（指南参考）' ], [ '档数', '7', '6（指南参考）' ], [ '倍数', '1-1-1.5-1.5-2-2-3', '同左' ]]} />
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">SPY/VOO 的 6.5% / 6 档仅作为指南参考，当前系统计划生成仍以统一宽基参数为准。</div>
            <SimpleTable headers={['VIX', '等级', '操作']} rows={[[ '<25', '平静', '常规定投' ], [ '25-30', '警戒', '保持定投 + 准备备用资金' ], [ '30-40', '中高恐慌', '加仓宽基' ], [ '40-50', '高恐慌', '宽基 + 个股全开' ], [ '≥50', '极端恐慌', '重仓，资金至少打 50%' ]]} />
            <GuideButton onClick={() => navigate('tradePlans')}>前往交易计划 →</GuideButton>
          </Card>
        </section>

        <section className="space-y-5">
          <SectionHeading eyebrow="第一兼唯一" title="个股投资策略" />
          <Card className="space-y-5">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {['第一兼唯一 — 行业第一或有唯一性护城河', '营收/利润持续增长 — 连续亏损 3 年一票否决', '资产负债健康 — 现金 ≥ 负债', '经营现金流为正 — 非靠借钱度日', '行业前景好 — 市场大 + 风口 + 竞争优势', '估值合理 — PE 历史百分位 < 70%'].map((item) => <div key={item} className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">{item}</div>)}
            </div>
            <SimpleTable headers={['规则', '参数']} rows={[[ '买入参数', '首买跌 30%（优质公司 20%+），每档 4-5%，≥6 档，1-1-1.5-2-2-2.5' ], [ '仓位规则', '单只上限 50%，总仓位 7-8.5 成，70% 底仓 + 30% 做 T' ], [ '减仓节点', '+15% / +25% / +35% 分档减仓' ]]} />
            <GuideButton onClick={() => navigate('tradePlans')}>前往交易计划 →</GuideButton>
          </Card>
        </section>

        <section className="space-y-5">
          <SectionHeading eyebrow="终极目标" title="做 T 与负成本持股" />
          <Card><ul className="space-y-3 text-sm leading-6 text-slate-600"><li>做 T 目的：腾出资金和仓位 &gt; 降低成本。</li><li>负成本路径：做 T + 逢高减仓 → 最终负成本长期持有。</li><li>安全边际 = 仓位 + 资金 + 成本。</li></ul></Card>
          <SectionHeading eyebrow="铁律" title="操作纪律" />
          <Card><ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-600">{['基本面恶化一票否决 — 无论多便宜都不买', '不追高 — 宁可错过，不可追高被套', '档差要拉开 — 不要几块钱就加仓', '不梭哈 — 逢跌分批买入', '永远留仓位 — 应对意外机会', '高位少买，低位多买 — 聪明定投核心', '做 T 目的 — 腾资金仓位 > 降低成本'].map((item) => <li key={item}>{item}</li>)}</ol></Card>
        </section>

        <section className="space-y-5">
          <SectionHeading eyebrow="全站 README" title="每个功能页能做什么" />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <ReadmeCard title="持仓总览" description="记录真实资产底账，管理交易流水、成本、收益、市值和三账户分配。" bullets={['新增或导入交易流水', '确认成本与收益', '分配进取/稳健/防守账户']} cta="前往持仓总览" onClick={() => navigate('holdings')} />
            <ReadmeCard title="交易计划" description="把策略变成可执行清单，包括加仓计划、定投计划和卖出计划。" bullets={['宽基金字塔加仓', '个股 checklist', 'Smart DCA 资金池']} cta="前往交易计划" onClick={() => navigate('tradePlans')} />
            <ReadmeCard title="通知设置" description="配置 iOS Bark、Android 推送 App 或 PC 浏览器通知，让策略触发时主动提醒你。" bullets={['复制完整链接自动解析', '发送测试通知', '同步交易计划规则']} cta="前往通知设置" onClick={() => navigate('notify')} />
            <ReadmeCard title="行情中心" description="查看关注标的、市场指数和 VIX 风险信号。" bullets={['维护美股关注列表', '观察指数和恐慌信号', '辅助判断是否进入加仓区']} cta="前往行情中心" onClick={() => navigate('markets')} />
            <ReadmeCard title="基金切换" description="辅助比较同类基金、ETF 或替代标的之间的切换机会。" bullets={['比较候选标的', '分析切换收益', '只在差异足够大时执行']} cta="前往基金切换" onClick={() => navigate('fundSwitch')} />
            <ReadmeCard title="数据同步 / 备份" description="备份和恢复本地数据，避免浏览器清理或换设备导致数据丢失。" bullets={['导出当前数据', '恢复历史备份', '换设备前先备份']} cta="前往备份" onClick={() => navigate('backup')} />
          </div>
        </section>

        <Card>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px_auto] lg:items-end">
            <SectionHeading eyebrow="个性化" title="默认打开哪个页面？" description="选择下次无 tab 参数打开网站时默认进入的页面。带 ?tab= 的链接仍会优先打开指定页面。" />
            <SelectField options={HOME_OPTIONS} value={prefs.homepageTab} onChange={(event) => setPrefs((current) => ({ ...current, homepageTab: event.target.value }))} />
            <GuideButton onClick={handleSaveHome}>保存默认主页</GuideButton>
          </div>
        </Card>

        <Card className="border-slate-300 bg-white">
          <SectionHeading eyebrow="免责声明" title="非官方、非投资建议" />
          <p className="mt-4 text-sm leading-7 text-slate-500">本工具中的策略说明由公开的金渐成公众号文章整理、总结和结构化而来，仅用于个人学习、记录和辅助决策。本工具与金渐成本人及其公众号无官方关联、无授权关系，也不代表金渐成本人观点或服务。页面中的计划、提醒、演示数据和计算结果均为辅助工具输出，不构成任何投资建议。投资有风险，请独立判断并自行承担决策结果。</p>
          {demoMeta ? <div className="mt-5"><GuideButton variant="secondary" onClick={handleClearDemo}><Trash2 className="h-4 w-4" />体验完成，清除演示数据</GuideButton></div> : null}
        </Card>
      </main>
    </div>
  );
}
