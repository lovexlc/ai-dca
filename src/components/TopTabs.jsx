import { topTabs } from '../app/links.js';

export function TopTabs({ activeKey }) {
  return (
    <nav className="top-tabs" aria-label="主导航">
      {topTabs.map((tab) => (
        <a
          key={tab.key}
          className={tab.key === activeKey ? 'top-tab is-active' : 'top-tab'}
          href={tab.href}
        >
          {tab.label}
        </a>
      ))}
    </nav>
  );
}
