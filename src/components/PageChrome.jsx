import { TopTabs } from './TopTabs.jsx';
import { MaterialIcon } from './MaterialIcon.jsx';

export function WorkspaceShell({ brand = 'Axiom Trade', brandHref, tabs, activeTab, headerRight, sidebar, children }) {
  const fallbackHref = tabs.find((tab) => tab.key === 'home')?.href || './index.html';
  return (
    <div className="workspace-shell">
      <header className="workspace-topbar">
        <div className="workspace-topbar__left">
          <a className="workspace-wordmark" href={brandHref || fallbackHref}>
            {brand}
          </a>
          <TopTabs activeKey={activeTab} tabs={tabs} />
        </div>
        <div className="workspace-topbar__right">{headerRight}</div>
      </header>
      <div className="workspace-body">
        <aside className="workspace-sidebar">{sidebar}</aside>
        <main className="workspace-main">{children}</main>
      </div>
    </div>
  );
}

export function MinimalShell({ title, headerRight, children }) {
  return (
    <div className="minimal-shell">
      <header className="minimal-topbar">
        <div className="minimal-topbar__left">
          <button className="icon-button" type="button">
            <MaterialIcon className="icon-button__icon" name="arrow_back" />
          </button>
          <span className="minimal-topbar__title">{title}</span>
        </div>
        <div className="workspace-topbar__right">{headerRight}</div>
      </header>
      <main className="minimal-main">{children}</main>
    </div>
  );
}

export function SurfaceCard({ className = '', children }) {
  const nextClassName = ['surface-card', className].filter(Boolean).join(' ');
  return <section className={nextClassName}>{children}</section>;
}

export function MetricCard({ label, value, note, accent = 'default', progress }) {
  const className = accent === 'primary' ? 'metric-card metric-card--primary' : 'metric-card';
  return (
    <div className={className}>
      <div className="metric-card__label">{label}</div>
      <div className="metric-card__value">{value}</div>
      {note ? <div className="metric-card__note">{note}</div> : null}
      {typeof progress === 'number' ? (
        <div className="metric-card__progress">
          <div className="metric-card__progress-bar" style={{ width: `${Math.max(Math.min(progress, 100), 0)}%` }} />
        </div>
      ) : null}
    </div>
  );
}

export function StatusBadge({ tone = 'success', icon = 'check_circle', children }) {
  const className = tone === 'warning' ? 'status-badge status-badge--warning' : 'status-badge';
  return (
    <span className={className}>
      <MaterialIcon className="status-badge__icon" filled name={icon} />
      {children}
    </span>
  );
}
