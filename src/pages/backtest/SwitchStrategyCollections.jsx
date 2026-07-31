import { useSwitchStrategyCollections } from './useSwitchStrategyCollections.js';

function ruleCodes(rule = {}) {
  const codes = Array.from(new Set([
    ...(Array.isArray(rule.benchmarkCodes) ? rule.benchmarkCodes : []),
    ...(Array.isArray(rule.candidateFundCodes) ? rule.candidateFundCodes : [])
  ])).slice(0, 5);
  return codes.join(' · ');
}

function CollectionCard({ collection = {} }) {
  const rules = Array.isArray(collection.rules) ? collection.rules : [];
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-bold text-slate-900">{collection.title || '用户策略合集'}</h3>
          <p className="mt-1 text-xs text-slate-500">{Number(collection.strategyCount) || rules.length} 条切换规则</p>
        </div>
        <span className="shrink-0 rounded-full bg-[var(--brand-tint)] px-2 py-1 text-[11px] font-semibold text-[var(--brand-text)]">公开合集</span>
      </div>
      <div className="mt-3 space-y-2">
        {rules.slice(0, 4).map((rule, index) => (
          <div key={rule.id || `rule-${index}`} className="rounded-xl bg-slate-50 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs font-semibold text-slate-800">{rule.name || `切换规则 ${index + 1}`}</span>
              <span className="shrink-0 text-[10px] text-slate-400">{rule.enabled ? '启用' : '停用'}</span>
            </div>
            {ruleCodes(rule) ? <div className="mt-1 truncate font-mono text-[10px] text-slate-500">{ruleCodes(rule)}</div> : null}
          </div>
        ))}
        {rules.length > 4 ? <div className="text-[11px] text-slate-400">另有 {rules.length - 4} 条规则</div> : null}
      </div>
    </article>
  );
}

export function SwitchStrategyCollections() {
  const { collections, loading, error } = useSwitchStrategyCollections();

  return (
    <section aria-labelledby="switch-strategy-collections-title" className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="switch-strategy-collections-title" className="text-base font-bold text-slate-900">用户策略合集</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">仅展示已关联账号的公开切换规则，不包含匿名设备数据、持仓数量或金额。</p>
        </div>
        <span className="text-[11px] font-semibold text-slate-400">回测仍在本机完成</span>
      </div>

      {loading ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2" aria-label="正在加载策略合集">
          {[0, 1].map((item) => <div key={item} className="h-32 animate-pulse rounded-2xl border border-slate-200 bg-white" />)}
        </div>
      ) : error ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs leading-5 text-amber-800" role="status">
          暂时无法加载策略合集，回测工具仍可正常使用。
        </div>
      ) : collections.length ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {collections.map((collection) => <CollectionCard key={collection.id} collection={collection} />)}
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-white px-3 py-4 text-xs leading-5 text-slate-500">
          暂未有可展示的公开策略合集。创建并登录后，策略才会进入公开合集。
        </div>
      )}
    </section>
  );
}
