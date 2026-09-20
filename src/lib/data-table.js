// Adapted from sadmann7/tablecn (MIT) — only the helpers we actually use.
export function getColumnPinningStyle({ column, withBorder = false }) {
  const isPinned = column.getIsPinned();
  const isLastLeftPinnedColumn = isPinned === 'left' && column.getIsLastColumn('left');
  const isFirstRightPinnedColumn = isPinned === 'right' && column.getIsFirstColumn('right');
  return {
    boxShadow: isLastLeftPinnedColumn
      ? '4px 0 8px -2px rgba(15, 23, 42, 0.08)'
      : isFirstRightPinnedColumn
        ? '-4px 0 8px -2px rgba(15, 23, 42, 0.08)'
        : undefined,
    left: isPinned === 'left' ? `${column.getStart('left')}px` : undefined,
    right: isPinned === 'right' ? `${column.getAfter('right')}px` : undefined,
    position: isPinned ? 'sticky' : undefined,
    background: isPinned ? '#ffffff' : undefined,
    width: column.getSize(),
    minWidth: column.getSize(),
    maxWidth: column.getSize(),
    zIndex: isPinned ? 20 : undefined,
  };
}
