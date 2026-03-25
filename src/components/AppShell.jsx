import { TopTabs } from './TopTabs.jsx';
import { SideNav } from './SideNav.jsx';

export function AppShell({ activeTab, sideNav, headerMeta, children }) {
  return (
    <div className="app-shell">
      <SideNav {...sideNav} />
      <div className="app-shell__main">
        <header className="app-header">
          <div>
            <div className="app-header__eyebrow">投资策略面板</div>
            <TopTabs activeKey={activeTab} />
          </div>
          <div className="app-header__meta">
            {headerMeta?.map((item) => (
              <div key={item.label} className="app-header__pill">
                <span className="app-header__pill-label">{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        </header>
        <main className="app-content">{children}</main>
      </div>
    </div>
  );
}
