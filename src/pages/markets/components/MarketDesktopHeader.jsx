import { Columns3, LayoutGrid, Plus, RefreshCw, Search, SlidersHorizontal, Table2, X, ArrowUpDown } from 'lucide-react';
import { cx } from '../../../components/experience-ui.jsx';
import { MarketSymbolSearchBox } from '../MarketSymbolSearchBox.jsx';

export function MarketDesktopHeader({
  marketLabel, market, groups = [], activeGroupId, onSelectGroup, onCreateGroup,
  searchOpen, searchValue, searchResults, searchLoading, searchError, watchSymbols,
  onSearchToggle, onSearchChange, onSearchClear, onSearchResultSelect, onSearchResultAdd,
  onRefresh, refreshing, onColumnSettings, onFilter, onSort, onViewChange, view = 'table',
  filterCount = 0, filterLabels = [], onRemoveFilter, onClearFilters, resultCount = 0,
  isOtc = false, presets,
}) {
  return (
    <div className="market-desktop-header" data-market-desktop-header>
      <div className="market-desktop-header__title-row">
        <div className="market-desktop-title"><span className="market-desktop-title__eyebrow">市场行情</span><h1>{marketLabel}</h1></div>
        <div className="market-desktop-fund-tabs" role="tablist" aria-label="基金类型">
          {groups.map((group) => <button key={group.id} type="button" role="tab" aria-selected={group.id === activeGroupId} className={group.id === activeGroupId ? 'is-active' : ''} onClick={() => onSelectGroup?.(group.id)}>{group.name}</button>)}
          {market === 'cn' ? <><button type="button" disabled title="当前暂无可转债数据">可转债</button><button type="button" disabled title="当前暂无分级基金数据">分级基金</button></> : null}
          <button type="button" className="market-desktop-add-button" onClick={onCreateGroup} aria-label="新建行情分组" title="新建行情分组"><Plus size={15} /></button>
        </div>
      </div>
      <div className="market-desktop-toolbar">
        <div className="market-desktop-toolbar__search">{searchOpen ? <MarketSymbolSearchBox autoFocus compact inline searchValue={searchValue} searchResults={searchResults} searchLoading={searchLoading} searchError={searchError} watchSymbols={watchSymbols} marketLabel={marketLabel} onSearchChange={onSearchChange} onSearchClear={onSearchClear} onSearchResultSelect={onSearchResultSelect} onSearchResultAdd={onSearchResultAdd} /> : <button type="button" className="market-desktop-search-trigger" onClick={onSearchToggle}><Search size={15} />搜索代码、名称或简称</button>}</div>
        <div className="market-desktop-toolbar__actions" aria-label="行情工具">
          {onRefresh ? <button type="button" className="market-desktop-tool-button" onClick={onRefresh} title="刷新数据"><RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /><span>刷新</span></button> : null}
          <button type="button" className="market-desktop-tool-button" onClick={onColumnSettings} title="列设置"><Columns3 size={15} /><span>列设置</span></button>
          <button type="button" className={cx('market-desktop-tool-button', filterCount ? 'is-active' : '')} onClick={onFilter} title="筛选"><SlidersHorizontal size={15} /><span>{'筛选' + (filterCount ? ' ' + filterCount : '')}</span></button>
          <button type="button" className={cx('market-desktop-tool-button', view === 'cards' ? 'is-active' : '')} onClick={() => onViewChange?.('cards')} title="卡片视图"><LayoutGrid size={15} /><span>卡片</span></button>
          <button type="button" className={cx('market-desktop-tool-button', view === 'table' ? 'is-active' : '')} onClick={() => onViewChange?.('table')} title="表格视图"><Table2 size={15} /><span>表格</span></button>
          <button type="button" className="market-desktop-tool-button" onClick={onSort} title="排序"><ArrowUpDown size={15} /><span>排序</span></button>
        </div>
      </div>
      <div className="market-desktop-quick-row"><span>快捷筛选</span><button type="button" onClick={() => onFilter?.('quick', { id: isOtc ? 'subscriptionStatus' : 'status', value: isOtc ? 'open' : 'held' })}>{isOtc ? '可申购' : '持仓'}</button><button type="button" onClick={() => onFilter?.('quick', { id: isOtc ? 'limitRange' : 'changeRange', value: isOtc ? 'lte10000' : 'gt5' })}>{isOtc ? '限额 ≤ 1万' : '涨幅 > 5%'}</button><button type="button" onClick={() => onClearFilters?.()}>全部</button><span className="market-desktop-quick-row__count">{resultCount} 条</span></div>
      {filterLabels.length ? <div className="market-desktop-active-filters"><span>已选条件</span>{filterLabels.map((item) => <button key={item.key} type="button" onClick={() => onRemoveFilter?.(item.key)}>{item.label}<X size={12} /></button>)}<button type="button" className="clear" onClick={onClearFilters}>清空全部</button></div> : null}
      {presets ? <div className="market-desktop-presets">{presets}</div> : null}
    </div>
  );
}
