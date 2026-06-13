import { Bot, CheckCircle2, Clock3, Code2, Database, FileText, ShieldCheck } from 'lucide-react';
import { Card, cx, secondaryButtonClass, subtleButtonClass } from '../components/experience-ui.jsx';
import { showToast } from '../app/toast.js';

const COMMAND = [
  'cp config/quant-premium.example.yaml config/quant-premium.yaml',
  'python3 -m pip install -r requirements-quant.txt',
  'python3 scripts/quant_premium_runner.py --config config/quant-premium.yaml'
].join('\n');

const METRICS = [
  { label: '轮询频率', value: '1 秒', note: '盘中循环读取最新盘口' },
  { label: '行情接口', value: 'fund-metrics', note: '复用现有 markets worker' },
  { label: '策略模型', value: 'H/L', note: 'H 溢价 - L 溢价' },
  { label: '执行方式', value: '模拟成交', note: '不发送实盘订单' }
];

const STRATEGY_ROWS = [
  { code: '159513', name: '纳指科技 ETF', klass: 'H', role: '高溢价腿' },
  { code: '513100', name: '纳指 ETF', klass: 'L', role: '低溢价腿' },
  { code: '159501', name: '纳指 ETF 嘉实', klass: 'L', role: '低溢价候选' }
];

const FLOW = [
  { title: '拉行情', text: '每秒请求 markets worker 的 fund-metrics，读取价格、盘口、iOPV 或净值字段。', Icon: Database },
  { title: '算差价', text: '按每只 ETF 的 H/L 分类计算 H 溢价 - L 溢价，并套用规则阈值。', Icon: Bot },
  { title: '写模拟成交', text: '触发后按持仓、现金、交易单位、滑点和手续费生成本地订单记录。', Icon: ShieldCheck }
];

const OUTPUT_FILES = [
  { path: 'data/quant/signals.jsonl', note: '每次评估、触发和跳过原因' },
  { path: 'data/quant/orders.jsonl', note: '模拟买卖成交明细' },
  { path: 'data/quant/state.json', note: '现金、持仓、冷却和每日触发次数' }
];

function Metric({ label, value, note }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-bold text-slate-400">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
      <div className="mt-1 text-xs leading-5 text-slate-500">{note}</div>
    </div>
  );
}

function StatusPill({ children, tone = 'slate' }) {
  const toneClass = tone === 'emerald'
    ? 'bg-emerald-50 text-emerald-700'
    : tone === 'indigo'
      ? 'bg-indigo-50 text-indigo-700'
      : 'bg-slate-100 text-slate-600';
  return <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold', toneClass)}>{children}</span>;
}

export function QuantTradingExperience({ embedded = false } = {}) {
  function copyCommand() {
    navigator.clipboard?.writeText(COMMAND).then(() => {
      showToast({ title: '启动命令已复制', tone: 'emerald' });
    }).catch(() => {
      showToast({ title: '复制失败', description: '请手动选择命令文本。', tone: 'amber' });
    });
  }

  return (
    <div className={cx('mx-auto max-w-7xl space-y-4', embedded ? 'px-4 sm:px-6' : 'px-6')}>
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600">
            <Bot className="h-3.5 w-3.5" />
            量化研究
          </div>
          <h1 className="mt-3 text-2xl font-bold text-slate-900 sm:text-3xl">Python 溢价差执行器</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
            本页对应一个本地 Python CLI：盘中每秒获取 ETF 价格、盘口和 iOPV，按 H/L 溢价差规则判断是否触发，并先写入模拟成交记录。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a className={secondaryButtonClass} href="https://github.com/lovexlc/ai-dca/blob/main/config/quant-premium.example.yaml" target="_blank" rel="noreferrer">
            <FileText className="h-4 w-4" />
            配置样例
          </a>
          <button type="button" className={subtleButtonClass} onClick={copyCommand}>
            <Code2 className="h-4 w-4" />
            复制命令
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {METRICS.map((item) => <Metric key={item.label} {...item} />)}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="space-y-4 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-slate-400">CLI</div>
              <h2 className="mt-1 text-lg font-bold text-slate-900">本地启动命令</h2>
            </div>
            <StatusPill tone="emerald"><CheckCircle2 className="h-3.5 w-3.5" />模拟模式</StatusPill>
          </div>
          <pre className="overflow-x-auto rounded-2xl bg-slate-950 p-4 text-sm leading-6 text-slate-100"><code>{COMMAND}</code></pre>
          <div className="grid gap-3 text-sm text-slate-600 sm:grid-cols-3">
            <div className="rounded-2xl bg-slate-50 p-3">
              <div className="font-bold text-slate-900">单次试跑</div>
              <div className="mt-1 text-xs leading-5">加 `--once --allow-off-session` 可在非盘中验证配置。</div>
            </div>
            <div className="rounded-2xl bg-slate-50 p-3">
              <div className="font-bold text-slate-900">盘中运行</div>
              <div className="mt-1 text-xs leading-5">默认只在 09:30-11:30、13:00-15:00 循环。</div>
            </div>
            <div className="rounded-2xl bg-slate-50 p-3">
              <div className="font-bold text-slate-900">执行保护</div>
              <div className="mt-1 text-xs leading-5">第一版只写模拟订单，不接券商实盘 API。</div>
            </div>
          </div>
        </Card>

        <Card className="space-y-4 p-5 sm:p-6">
          <div>
            <div className="text-xs font-bold text-slate-400">RULE</div>
            <h2 className="mt-1 text-lg font-bold text-slate-900">H/L 溢价差规则</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">`gap = H 溢价 - L 溢价`。基准为 L 时看差价收窄，基准为 H 时看差价扩大。</p>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50 text-xs font-bold text-slate-400">
                <tr>
                  <th className="px-4 py-3 text-left">代码</th>
                  <th className="px-4 py-3 text-left">名称</th>
                  <th className="px-4 py-3 text-left">分类</th>
                  <th className="px-4 py-3 text-left">角色</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {STRATEGY_ROWS.map((row) => (
                  <tr key={row.code}>
                    <td className="px-4 py-3 font-semibold text-slate-900">{row.code}</td>
                    <td className="px-4 py-3 text-slate-600">{row.name}</td>
                    <td className="px-4 py-3"><StatusPill tone={row.klass === 'H' ? 'indigo' : 'slate'}>{row.klass}</StatusPill></td>
                    <td className="px-4 py-3 text-slate-600">{row.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {FLOW.map(({ title, text, Icon }) => (
          <Card key={title} className="p-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-700">
              <Icon className="h-5 w-5" />
            </div>
            <h3 className="mt-4 text-base font-bold text-slate-900">{title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">{text}</p>
          </Card>
        ))}
      </div>

      <Card className="space-y-4 p-5 sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs font-bold text-slate-400">OUTPUT</div>
            <h2 className="mt-1 text-lg font-bold text-slate-900">本地输出文件</h2>
          </div>
          <StatusPill><Clock3 className="h-3.5 w-3.5" />每轮追加</StatusPill>
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          {OUTPUT_FILES.map((item) => (
            <div key={item.path} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="font-mono text-sm font-semibold text-slate-900">{item.path}</div>
              <div className="mt-2 text-xs leading-5 text-slate-500">{item.note}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
