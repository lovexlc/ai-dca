function cx(...classes) {
  return classes.filter(Boolean).join(' ');
}

export function PageContainer({ as: Component = 'div', className = '', children, ...props }) {
  return (
    <Component className={cx('page-container', className)} {...props}>
      {children}
    </Component>
  );
}
