import { Bookmark, ChartNoAxesCombined, RefreshCw, Search } from 'lucide-react';

export function MarketsMobileHeader({
  onRefresh,
  refreshing = false,
  onSearch,
  searchOpen = false,
  onSaveView,
}) {
  const openNavigation = () => {
    window.dispatchEvent(new CustomEvent('console:open-mobile-nav'));
  };

  return (
    <header className="markets-mobile-page-header lg:hidden">
      <button type="button" className="markets-mobile-page-header__title" onClick={openNavigation} aria-label="打开模块导航">
        <span className="markets-mobile-page-header__mark"><ChartNoAxesCombined size={15} aria-hidden="true" /></span>
        <strong>行情中心</strong>
      </button>
      <div className="markets-mobile-page-header__actions">
        <button type="button" onClick={onSaveView} aria-label="保存当前行情视图" title="保存当前行情视图">
          <Bookmark size={17} aria-hidden="true" />
        </button>
        <button type="button" onClick={onRefresh} aria-label="刷新行情" title="刷新行情" disabled={refreshing}>
          <RefreshCw size={17} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />
        </button>
        <button type="button" onClick={onSearch} aria-label={searchOpen ? '关闭基金搜索' : '搜索基金'} title={searchOpen ? '关闭基金搜索' : '搜索基金'} aria-pressed={searchOpen}>
          <Search size={17} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
