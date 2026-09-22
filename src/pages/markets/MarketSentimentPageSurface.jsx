import { cx } from '../../components/experience-ui.jsx';
import { useMarketSentimentWeather } from './marketSentimentWeather.js';

export function MarketSentimentPageSurface({ children, className = '' }) {
  const { weather } = useMarketSentimentWeather();

  return (
    <div
      data-market-sentiment-background="true"
      className={cx(
        'relative min-h-[calc(100vh-var(--brand-bar-h,48px))] pb-[calc(72px+env(safe-area-inset-bottom))] transition-colors md:pb-0',
        weather.pageSurfaceClass,
        className,
      )}
    >
      <span
        className={cx(
          'pointer-events-none absolute right-4 top-4 select-none text-[8rem] leading-none opacity-20 sm:right-8 sm:top-8 sm:text-[11rem]',
          weather.decorClass,
        )}
        aria-hidden="true"
      >
        {weather.icon}
      </span>
      <span
        className={cx(
          'pointer-events-none absolute bottom-6 left-4 h-52 w-52 rounded-full blur-3xl',
          weather.orbClass,
        )}
        aria-hidden="true"
      />
      <div className="relative z-[1] pt-4">{children}</div>
    </div>
  );
}
