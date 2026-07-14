import { ArrowUpDown, Columns3, LayoutGrid, RefreshCw, Search, SlidersHorizontal, Table2, X } from 'lucide-react';
import { cx } from '../../../components/experience-ui.jsx';
import { MarketSymbolSearchBox } from '../MarketSymbolSearchBox.jsx';
import { MarketGroupTabs } from './MarketGroupTabs.jsx';

export function MarketDesktopHeader({
  marketLabel, market, onSelectMarket, groups = [], activeGroupId, onSelectGroup, onCreateGroup, onRenameGroup, onDeleteGroup,
  searchOpen, searchValue, searchResults, searchLoading, searchError, watchSymbols,
  onSearchToggle, onSearchChange, onSearchClear, onSearchResultSelect, onSearchResultAdd,
  onRefresh, refreshing, onColumnSettings, onFilter, onSort, onViewChange, onMore, view = 'table',
  filterCount = 0, filterLabels = [], onRemoveFilter, onClearFilters, resultCount = 0,
  isOtc = false,
  tableViewOptions = null,
  presetControls = null,
}) {
  return (
    <div className="market-desktop-header" data-market-desktop-header>
      <div className="market-desktop-market-tabs" role="tablist" aria-label="市场">
        <button type="button" role="tab" aria-selected={market === 'cn'} className={market === 'cn' ? 'is-active' : ''} onClick={() => onSelectMarket?.('cn')}>A 股行情</button>
        <button type="button" role="tab" aria-selected={market === 'us'} className={market === 'us' ? 'is-active' : ''} onClick={() => onSelectMarket?.('us')}>美股行情</button>
      </div>
      <div className="market-desktop-header__title-row">
        <div className="market-desktop-fund-tabs">
          <MarketGroupTabs groups={groups} activeGroupId={activeGroupId} onSelect={onSelectGroup} onCreate={onCreateGroup} onRename={onRenameGroup} onDelete={onDeleteGroup} />
          {market === 'cn' ? <><button type="button" disabled title="当前暂无可转债数据">可转债</button><button type="button" disabled title="当前暂无分级基金数据">分级基金</button></> : null}
        </div>
        <div className="market-desktop-toolbar__search">{searchOpen ? <div className="market-desktop-toolbar__search-open"><MarketSymbolSearchBox autoFocus compact inline searchValue={searchValue} searchResults={searchResults} searchLoading={searchLoading} searchError={searchError} watchSymbols={watchSymbols} marketLabel={marketLabel} onSearchChange={onSearchChange} onSearchClear={onSearchClear} onSearchResultSelect={onSearchResultSelect} onSearchResultAdd={onSearchResultAdd} /><button type="button" className="market-desktop-search-close" aria-label={market === 'cn' ? '关闭基金搜索' : '关闭标的搜索'} onClick={onSearchToggle}><X size={15} /></button></div> : <button type="button" className="market-desktop-search-trigger" aria-label={market === 'cn' ? '基金搜索' : '标的搜索'} onClick={onSearchToggle}><Search size={15} />搜索基金/代码/名称</button>}</div>
        <div className="market-desktop-toolbar__actions" aria-label="行情工具">
          {onRefresh ? <button type="button" className="market-desktop-tool-button" onClick={onRefresh} title="刷新数据"><RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /><span>刷新</span></button> : null}
          <button type="button" className="market-desktop-tool-button" onClick={onColumnSettings} title="列设置"><Columns3 size={15} /><span>列设置</span></button>
          <button type="button" className={cx('market-desktop-tool-button', filterCount ? 'is-active' : '')} onClick={onFilter} title="筛选"><SlidersHorizontal size={15} /><span>筛选{filterCount ? ` ${filterCount}` : ''}</span></button>
          <button type="button" className="market-desktop-tool-button" onClick={onSort} title="排序"><ArrowUpDown size={15} /><span>排序</span></button>
          <button type="button" className="market-desktop-tool-button" onClick={onMore} title="更多行情功能"><span>更多</span></button>
          <button type="button" className={cx('market-desktop-tool-button', view === 'cards' ? 'is-active' : '')} onClick={() => onViewChange?.('cards')} title="卡片视图"><LayoutGrid size={15} /><span>卡片</span></button>
          <button type="button" className={cx('market-desktop-tool-button', view === 'table' ? 'is-active' : '')} onClick={() => onViewChange?.('table')} title="表格视图"><Table2 size={15} /><span>表格</span></button>
        </div>
      </div>
      <div className="market-desktop-quick-row"><span>指数分类:</span>{(isOtc ? [["nasdaq100", "纳指100"], ["sp500", "标普500"], ["us50", "美国50"], ["dividend", "红利"]] : [["nasdaq100", "纳指100"], ["sp500", "标普500"], ["us50", "美国50"], ["nasdaqTech", "中概互联网"], ["globalTech", "全球科技"], ["dividend", "红利"]]).map(([value, label]) => <button type="button" key={value} className={filterLabels.some((item) => item.key === `index:${value}`) ? "is-selected" : ""} onClick={() => onFilter?.("quick", { id: "index", value })}>{label}</button>)}<button type="button" className="market-desktop-more-filter" onClick={onFilter}>更多 <span>⌄</span></button><span className="market-desktop-quick-row__count">共 {resultCount} 条</span></div>
      {filterLabels.length ? <div className="market-desktop-active-filters"><span>已选条件:</span>{filterLabels.map((item) => <button key={item.key} type="button" onClick={() => onRemoveFilter?.(item.key)}>{item.label}<X size={12} /></button>)}<button type="button" className="clear" onClick={onClearFilters}>清空全部</button></div> : null}
      {presetControls || tableViewOptions ? <div className="market-desktop-table-controls">{presetControls}<div className="market-desktop-table-controls__view">{tableViewOptions}</div></div> : null}
    </div>
  );
}
