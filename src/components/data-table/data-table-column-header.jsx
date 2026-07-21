"use client";
import * as React from "react";
import {
  ArrowDownAZ,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  ChevronsUpDown,
  EyeOff,
  ListFilter,
  Plus,
  Pin,
  PinOff,
  X,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function hasFilterValue(value) {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim() !== "";
  if (typeof value === "object") {
    return Object.values(value).some((item) => {
      if (item == null) return false;
      if (typeof item === "string") return item.trim() !== "";
      return true;
    });
  }
  return true;
}

function updateNumberFilter(column, key, rawValue) {
  const current = column.getFilterValue();
  const next = {
    ...(current && typeof current === "object" && !Array.isArray(current) ? current : {}),
    [key]: rawValue,
  };
  Object.keys(next).forEach((field) => {
    if (String(next[field] ?? "").trim() === "") delete next[field];
  });
  column.setFilterValue(Object.keys(next).length ? next : undefined);
}

function normalizeTextConditionDraft(value) {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return values.length ? values.map((item) => String(item ?? '')) : [''];
}

function compactTextConditions(conditions) {
  return conditions
    .map((condition) => String(condition?.value ?? '').trim())
    .filter(Boolean);
}

function FilterTextInput({ value, placeholder, onCommit }) {
  const [draft, setDraft] = React.useState(() => String(value ?? ''));
  const draftRef = React.useRef(draft);
  const composingRef = React.useRef(false);

  React.useEffect(() => {
    const nextValue = String(value ?? '');
    if (nextValue === draftRef.current) return;
    draftRef.current = nextValue;
    setDraft(nextValue);
  }, [value]);

  const updateDraft = (nextValue, { commit = true } = {}) => {
    draftRef.current = nextValue;
    setDraft(nextValue);
    if (commit) onCommit(nextValue);
  };

  return (
    <Input
      autoFocus
      placeholder={placeholder}
      value={draft}
      onChange={(event) => updateDraft(event.target.value, { commit: !composingRef.current })}
      onCompositionStart={() => {
        composingRef.current = true;
      }}
      onCompositionEnd={(event) => {
        composingRef.current = false;
        updateDraft(event.currentTarget.value);
      }}
      onKeyDown={(event) => {
        // Radix 的菜单会把普通按键当作 typeahead；输入框需要阻止它，Escape 仍交给菜单关闭。
        if (event.key !== 'Escape') event.stopPropagation();
      }}
      className="h-9"
    />
  );
}

function TextConditions({ column, label }) {
  const filterValue = column.getFilterValue();
  const [conditions, setConditions] = React.useState(() => (
    normalizeTextConditionDraft(filterValue).map((value, index) => ({ id: index, value }))
  ));
  const conditionsRef = React.useRef(conditions);
  const nextIdRef = React.useRef(conditions.length);
  const committedSignatureRef = React.useRef(JSON.stringify(compactTextConditions(conditions)));

  React.useEffect(() => {
    const values = normalizeTextConditionDraft(filterValue);
    const signature = JSON.stringify(values.map((value) => value.trim()).filter(Boolean));
    if (signature === committedSignatureRef.current) return;
    const next = values.map((value, index) => ({ id: index, value }));
    conditionsRef.current = next;
    nextIdRef.current = next.length;
    committedSignatureRef.current = signature;
    setConditions(next);
  }, [filterValue]);

  const commit = (next) => {
    const values = compactTextConditions(next);
    committedSignatureRef.current = JSON.stringify(values);
    column.setFilterValue(values.length ? values : undefined);
  };

  const updateCondition = (id, value) => {
    const next = conditionsRef.current.map((condition) => (
      condition.id === id ? { ...condition, value } : condition
    ));
    conditionsRef.current = next;
    setConditions(next);
    commit(next);
  };

  const addCondition = () => {
    const next = [...conditionsRef.current, { id: nextIdRef.current++, value: '' }];
    conditionsRef.current = next;
    setConditions(next);
  };

  const removeCondition = (id) => {
    const remaining = conditionsRef.current.filter((condition) => condition.id !== id);
    const next = remaining.length ? remaining : [{ id: nextIdRef.current++, value: '' }];
    conditionsRef.current = next;
    setConditions(next);
    commit(next);
  };

  return (
    <div className="flex flex-col gap-1.5">
      {conditions.map((condition, index) => (
        <div key={condition.id} className="flex min-w-0 items-center gap-1.5">
          <FilterTextInput
            value={condition.value}
            placeholder={index === 0 ? `搜索 ${label}` : '同时满足此条件'}
            onCommit={(value) => updateCondition(condition.id, value)}
          />
          {conditions.length > 1 ? (
            <button
              type="button"
              aria-label={`删除第 ${index + 1} 个过滤条件`}
              onClick={() => removeCondition(condition.id)}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
      ))}
      <button
        type="button"
        onClick={addCondition}
        className="inline-flex h-8 items-center justify-center gap-1 rounded-md border border-dashed px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Plus className="size-3.5" /> 添加条件
      </button>
      <p className="text-[11px] leading-4 text-muted-foreground">多个条件需同时满足</p>
    </div>
  );
}

function DataTableColumnHeader({ column, label, className, ...props }) {
  const variant = column.columnDef?.meta?.variant;
  const align = column.columnDef?.meta?.align;
  const centerAligned = align === "center";
  const canSort = column.getCanSort();
  const canFilter = column.getCanFilter() && Boolean(variant);
  const canHide = column.getCanHide();
  const pinningEnabled = Boolean(column?.columnDef?.accessorFn && column?.table?.options?.meta?.pinningEnabled);
  const pinTargetColumnId = column?.table?.options?.meta?.pinnedColumnId || '';
  const isPinTarget = pinTargetColumnId === column.id;
  const onPinColumn = column?.table?.options?.meta?.onPinColumn;

  const [open, setOpen] = React.useState(false);
  const [view, setView] = React.useState("menu");
  React.useEffect(() => {
    if (!open) setView("menu");
  }, [open]);

  const filterValue = column.getFilterValue();
  const isFiltered = hasFilterValue(filterValue);
  const sortDir = column.getIsSorted();

  if (!canSort && !canFilter && !canHide && !pinningEnabled) {
    return <div className={cn(className)}>{label}</div>;
  }

  const filterIcon = canFilter ? (
    <ListFilter
      className={cn(
        isFiltered ? "text-indigo-500" : "text-muted-foreground/60"
      )}
    />
  ) : null;
  const sortIcon = canSort ? (
    sortDir === "desc" ? (
      <ChevronDown className="text-muted-foreground" />
    ) : sortDir === "asc" ? (
      <ChevronUp className="text-muted-foreground" />
    ) : (
      <ChevronsUpDown className="text-muted-foreground" />
    )
  ) : null;
  const pinControl = pinningEnabled ? (
    <span
      role="button"
      tabIndex={0}
      aria-label={isPinTarget ? `取消固定${label}列` : `固定${label}列`}
      title={isPinTarget ? '取消固定列' : '固定此列'}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onPinColumn?.(isPinTarget ? '' : column.id);
        setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        onPinColumn?.(isPinTarget ? '' : column.id);
        setOpen(false);
      }}
      className={cn(
        "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border transition",
        !centerAligned && "ml-1",
        isPinTarget
          ? "border-indigo-200 bg-indigo-50 text-indigo-700"
          : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700"
      )}
    >
      {isPinTarget ? <PinOff className="size-3" /> : <Pin className="size-3" />}
    </span>
  ) : null;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className={cn(
          "h-8 rounded-md px-2 py-1.5 hover:bg-accent focus:outline-none focus:ring-1 focus:ring-ring data-[state=open]:bg-accent [&_svg]:size-4 [&_svg]:shrink-0",
          centerAligned
            ? "relative mx-auto flex w-full items-center justify-center text-center"
            : "-ml-1.5 flex items-center gap-1.5",
          className
        )}
        {...props}
      >
        {centerAligned ? (
          <>
            <span>{label}</span>
            <span className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
              {filterIcon}
              {sortIcon}
              {pinControl}
            </span>
          </>
        ) : (
          <>
            <span>{label}</span>
            {filterIcon}
            {sortIcon}
            {pinControl}
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-60 p-2"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {view === "menu" && (
          <div className="flex flex-col gap-1">
            {canFilter && (
              <button
                type="button"
                onClick={() => setView("filter")}
                className="flex items-center justify-between rounded-md px-3 py-2.5 text-sm hover:bg-accent"
              >
                <span className="flex items-center gap-2">
                  <ListFilter className="size-4" />
                  过滤
                </span>
                {isFiltered && (
                  <span className="text-xs text-indigo-600">已设置</span>
                )}
              </button>
            )}
            {canSort && (
              <button
                type="button"
                onClick={() => setView("sort")}
                className="flex items-center justify-between rounded-md px-3 py-2.5 text-sm hover:bg-accent"
              >
                <span className="flex items-center gap-2">
                  <ArrowDownAZ className="size-4" />
                  排序
                </span>
                {sortDir && (
                  <span className="text-xs text-indigo-600">
                    {sortDir === "asc" ? "升序" : "降序"}
                  </span>
                )}
              </button>
            )}
            {canHide && (
              <button
                type="button"
                onClick={() => {
                  column.toggleVisibility(false);
                  setOpen(false);
                }}
                className="flex items-center gap-2 rounded-md px-3 py-2.5 text-sm hover:bg-accent"
              >
                <EyeOff className="size-4" />
                隐藏列
              </button>
            )}
            {pinningEnabled && (
              <button
                type="button"
                onClick={() => {
                  onPinColumn?.(isPinTarget ? '' : column.id);
                  setOpen(false);
                }}
                className="flex items-center justify-between rounded-md px-3 py-2.5 text-sm hover:bg-accent"
              >
                <span className="flex items-center gap-2">
                  {isPinTarget ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                  {isPinTarget ? '取消固定列' : '固定此列'}
                </span>
                {isPinTarget && <span className="text-xs text-indigo-600">已选择</span>}
              </button>
            )}
          </div>
        )}

        {view === "filter" && canFilter && (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setView("menu")}
              className="flex items-center gap-1 self-start rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
            >
              <ChevronLeft className="size-3" />
              返回
            </button>
            {variant === "text" && column.columnDef?.meta?.allowMultipleConditions ? (
              <TextConditions column={column} label={label} />
            ) : null}
            {variant === "text" && !column.columnDef?.meta?.allowMultipleConditions ? (
              <FilterTextInput
                value={filterValue ?? ''}
                placeholder={`搜索 ${label}`}
                onCommit={(value) => column.setFilterValue(value || undefined)}
              />
            ) : null}
            {variant === "number" && (
              <div className="grid grid-cols-2 gap-2">
                <Input
                  autoFocus
                  type="number"
                  inputMode="decimal"
                  placeholder="最小值"
                  value={(filterValue && typeof filterValue === "object" && !Array.isArray(filterValue) ? filterValue.min : "") ?? ""}
                  onChange={(event) => updateNumberFilter(column, "min", event.target.value)}
                  className="h-9"
                />
                <Input
                  type="number"
                  inputMode="decimal"
                  placeholder="最大值"
                  value={(filterValue && typeof filterValue === "object" && !Array.isArray(filterValue) ? filterValue.max : "") ?? ""}
                  onChange={(event) => updateNumberFilter(column, "max", event.target.value)}
                  className="h-9"
                />
              </div>
            )}
            {(variant === "select" || variant === "multiSelect") && (
              <FacetedChoices
                column={column}
                options={column.columnDef?.meta?.options ?? []}
                multiple={variant === "multiSelect"}
              />
            )}
            {isFiltered && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => column.setFilterValue(undefined)}
              >
                <X className="size-3" /> 清空过滤
              </Button>
            )}
          </div>
        )}

        {view === "sort" && canSort && (
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => setView("menu")}
              className="flex items-center gap-1 self-start rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
            >
              <ChevronLeft className="size-3" />
              返回
            </button>
            <button
              type="button"
              onClick={() => {
                column.toggleSorting(false);
                setOpen(false);
              }}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2.5 text-sm hover:bg-accent",
                sortDir === "asc" && "bg-accent"
              )}
            >
              <ChevronUp className="size-4" />
              升序
            </button>
            <button
              type="button"
              onClick={() => {
                column.toggleSorting(true);
                setOpen(false);
              }}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2.5 text-sm hover:bg-accent",
                sortDir === "desc" && "bg-accent"
              )}
            >
              <ChevronDown className="size-4" />
              降序
            </button>
            {sortDir && (
              <button
                type="button"
                onClick={() => {
                  column.clearSorting();
                  setOpen(false);
                }}
                className="flex items-center gap-2 rounded-md px-3 py-2.5 text-sm text-muted-foreground hover:bg-accent"
              >
                <X className="size-4" />
                重置排序
              </button>
            )}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FacetedChoices({ column, options, multiple }) {
  const value = column.getFilterValue();
  const selectedSet = new Set(
    Array.isArray(value) ? value : value != null ? [value] : []
  );
  function toggle(optionValue) {
    if (multiple) {
      const next = new Set(selectedSet);
      if (next.has(optionValue)) next.delete(optionValue);
      else next.add(optionValue);
      column.setFilterValue(next.size ? Array.from(next) : undefined);
    } else {
      column.setFilterValue(
        selectedSet.has(optionValue) ? undefined : optionValue
      );
    }
  }
  return (
    <div className="flex max-h-48 flex-wrap gap-1.5 overflow-auto">
      {options.map((opt) => {
        const active = selectedSet.has(opt.value);
        return (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => toggle(opt.value)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs",
              active
                ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                : "border-slate-200 text-slate-600"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export { DataTableColumnHeader };
