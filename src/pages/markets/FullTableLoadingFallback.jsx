export function FullTableLoadingFallback() {
  return (
    <div className="hidden min-h-0 flex-1 flex-col lg:flex">
      <div className="min-h-0 flex-1 overflow-hidden rounded-2xl bg-[#f8fafd] p-3">
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

export function MarketsSidebarLoadingFallback() {
  return (
    <aside className="order-2 hidden flex-col gap-3 lg:order-1 lg:flex lg:h-full lg:min-h-0 lg:overflow-hidden">
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden pr-1">
        <div className="h-10 w-44 animate-pulse rounded-lg bg-slate-100" />
        <div className="grid gap-2">
          {Array.from({ length: 8 }).map((_item, index) => (
            <div key={index} className="h-12 animate-pulse rounded-md bg-slate-100" />
          ))}
        </div>
      </div>
    </aside>
  );
}
