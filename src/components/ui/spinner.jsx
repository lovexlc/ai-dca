import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// 可复用的加载指示组件，供用户账号相关操作（删除、保存、列表加载等）统一使用，
// 避免各页面重复手写 <Loader2 className="animate-spin" />。

const SIZE_CLASS = {
  sm: "size-3.5",
  default: "size-4",
  lg: "size-5",
};

// 行内 spinner：可放进按钮、表格行、标题旁。传 label 时会在旁边渲染文案，
// 否则仅提供屏幕阅读器可见的“加载中”提示。
const Spinner = React.forwardRef(function Spinner(
  { className, size = "default", label, ...props },
  ref,
) {
  return (
    <span
      ref={ref}
      role="status"
      aria-live="polite"
      data-slot="spinner"
      className={cn("inline-flex items-center gap-2", className)}
      {...props}
    >
      <Loader2 className={cn(SIZE_CLASS[size] || SIZE_CLASS.default, "animate-spin")} aria-hidden="true" />
      {label ? <span className="text-sm">{label}</span> : <span className="sr-only">加载中</span>}
    </span>
  );
});
Spinner.displayName = "Spinner";

// 区块级加载态：用于列表 / 面板在拉取数据时占位，替代空白或旧数据。
const ListLoading = React.forwardRef(function ListLoading(
  { className, label = "正在加载…", ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-slot="list-loading"
      className={cn(
        "flex min-h-24 w-full flex-col items-center justify-center gap-2 py-8 text-sm text-slate-500",
        className,
      )}
      {...props}
    >
      <Loader2 className="size-5 animate-spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
});
ListLoading.displayName = "ListLoading";

export { Spinner, ListLoading };
