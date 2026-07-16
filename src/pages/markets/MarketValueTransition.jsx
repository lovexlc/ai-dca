import { useEffect, useRef, useState } from 'react';
import { cx } from '../../components/experience-ui.jsx';

export function MarketValueTransition({ valueKey, children, className = '' }) {
  const [changing, setChanging] = useState(false);
  const mountedRef = useRef(false);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return undefined;
    }
    if (valueKey === undefined || valueKey === null) return undefined;
    setChanging(true);
    const timer = window.setTimeout(() => setChanging(false), 560);
    return () => window.clearTimeout(timer);
  }, [valueKey]);

  return <span className={cx('market-value-transition', changing && 'is-changing', className)}>{children}</span>;
}
