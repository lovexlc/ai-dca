export function FullTableLoadingFallback() {
  return (
    <div className="hidden h-full min-h-0 flex-1 flex-col lg:flex">
      <div className="min-h-0 flex-1 overflow-hidden border-y border-[#e8eaed] bg-white">
        <div className="mb-3 h-12 animate-pulse rounded-xl bg-white" />
        <div className="grid gap-2">
          {Array.from({ length: 8 }).map((_item, index) => (
            <div key={index} className="h-10 animate-pulse rounded-lg bg-white" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function MarketsSidebarLoadingFallback({ activeName = '列表', rowCount = 6, rows = [] }) {
  const count = Math.max(1, Math.min(Number(rowCount) || 6, 8));
  const fallbackRows = Array.isArray(rows) && rows.length ? rows.slice(0, 8) : Array.from({ length: count });
  return (
    <>
      <aside className="order-2 flex flex-col gap-2 lg:hidden">
        <div className="px-1">
          <div className="flex items-center justify-between pt-1">
            <div className="inline-flex min-h-9 max-w-[min(62vw,18rem)] items-center gap-1 rounded-md px-2 py-1 text-[17px] font-normal leading-6 tracking-tight text-[#1f1f1f] sm:max-w-none sm:text-[20px] sm:leading-7">
              <span className="truncate whitespace-nowrap">{activeName || '列表'}</span>
            </div>
            <div className="h-10 w-10 rounded-full bg-[#f1f3f4]" />
          </div>
          <div className="mt-1 h-px w-full bg-[#e8eaed]" />
        </div>
        <div className="px-1">
          <div className="flex items-center justify-between py-2">
            <h3 className="text-base font-semibold text-[#1f1f1f]">监控列表</h3>
            <div className="h-9 w-9 rounded-full bg-[#f1f3f4]" />
          </div>
          <ul className="divide-y divide-[#e8eaed]">
            {fallbackRows.map((row, index) => (
              <li key={index} className="flex items-center gap-3 rounded-2xl px-2 py-3.5">
                <div className="min-w-0 flex-1">
                  {row?.symbol ? (
                    <>
                      <div className="truncate text-base font-semibold leading-tight text-[#1f1f1f]">{row.symbol}</div>
                      {row.name ? <div className="truncate text-sm leading-tight text-[#5f6368]">{row.name}</div> : null}
                    </>
                  ) : (
                    <>
                      <div className="h-5 w-20 rounded bg-[#f1f3f4]" />
                      <div className="mt-1.5 h-4 w-28 rounded bg-[#f8fafd]" />
                    </>
                  )}
                </div>
                <div className="h-[32px] w-[86px] rounded bg-[#f8fafd]" />
                <div className="h-10 w-16 rounded bg-[#f1f3f4]" />
              </li>
            ))}
          </ul>
        </div>
      </aside>
      <aside className="order-2 hidden flex-col gap-3 lg:order-1 lg:flex lg:h-full lg:min-h-0 lg:overflow-hidden">
        <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden pr-1">
          <div className="h-10 w-44 rounded-lg bg-slate-100" />
          <div className="grid gap-2">
            {Array.from({ length: 8 }).map((_item, index) => (
              <div key={index} className="h-12 rounded-md bg-slate-100" />
            ))}
          </div>
        </div>
      </aside>
    </>
  );
}
