export function SideNav({ title, subtitle, items, footer }) {
  return (
    <aside className="side-nav">
      <div className="side-nav__brand">
        <div className="side-nav__brand-mark">AT</div>
        <div>
          <div className="side-nav__brand-title">Axiom Trade</div>
          <div className="side-nav__brand-subtitle">{subtitle || '策略控制台'}</div>
        </div>
      </div>
      <div className="side-nav__section-label">{title}</div>
      <nav className="side-nav__items">
        {items.map((item) => (
          <a
            key={item.label}
            className={item.active ? 'side-nav__item is-active' : 'side-nav__item'}
            href={item.href || '#'}
          >
            <span className="side-nav__icon">{item.icon}</span>
            <span>{item.label}</span>
          </a>
        ))}
      </nav>
      {footer ? <div className="side-nav__footer">{footer}</div> : null}
    </aside>
  );
}
