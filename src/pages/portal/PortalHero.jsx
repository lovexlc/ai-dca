import { useState } from 'react';
import { IconArrowUpRight, IconSearch, IconSparkles } from '@tabler/icons-react';

const HOT_SYMBOLS = ['159509', '513500', '159577', '513300'];

export function PortalHero({ stats = [], onSearch, onOpenTab }) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();
    const value = String(query || '').trim();
    if (!value || !onSearch) return;
    setSearching(true);
    setSearchError('');
    const found = await onSearch(value);
    if (!found) setSearchError('没有找到匹配标的，请尝试输入 6 位基金代码');
    setSearching(false);
  }

  return (
    <section className="portal-hero" aria-labelledby="portal-hero-title">
      <div className="portal-hero__content">
        <div className="portal-hero__eyebrow">
          <IconSparkles className="h-3.5 w-3.5" aria-hidden="true" />
          ETF 轮动策略 · 场内基金监控
        </div>
        <h1 id="portal-hero-title">捕捉场内基金轮动机会</h1>
        <p>实时监控美股指数基金的溢价折价与回撤深度，策略引擎自动生成换仓与出场信号。</p>
        <form className="portal-hero__search" onSubmit={handleSubmit} role="search">
          <label className="sr-only" htmlFor="portal-fund-search">搜索基金代码或名称</label>
          <IconSearch className="portal-hero__search-icon" aria-hidden="true" />
          <input
            id="portal-fund-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索基金代码或名称，例如 513100、纳指ETF"
            autoComplete="off"
          />
          <button type="submit" disabled={searching}>{searching ? '搜索中' : '搜索'}</button>
        </form>
        {searchError ? <div className="portal-hero__search-error" role="status">{searchError}</div> : null}
        <div className="portal-hero__hot">
          <span>热门</span>
          {HOT_SYMBOLS.map((symbol) => (
            <button key={symbol} type="button" onClick={() => onSearch?.(symbol)}>{symbol}</button>
          ))}
          <button type="button" className="portal-hero__text-link" onClick={() => onOpenTab?.('backtest')}>
            用户策略合集 <IconArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="portal-stats" aria-label="账户与市场统计">
        {stats.map((stat) => (
          <div key={stat.key} className="portal-stat">
            <strong>{stat.value}</strong>
            <span>{stat.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
