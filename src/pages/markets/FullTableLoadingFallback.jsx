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
