export function readColumnFilterValue(filters, id) {
  return (Array.isArray(filters) ? filters : []).find((item) => item?.id === id)?.value;
}
