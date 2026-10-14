const ORDERS_PER_PAGE = 8;
const PAGINATED_STATUSES = new Set(["pagada", "cancelada"]);

export function visibleOrderPage(orders, status, page) {
  if (!PAGINATED_STATUSES.has(status)) return orders;
  const pageCount = Math.ceil(orders.length / ORDERS_PER_PAGE);
  const safePage = Math.min(page, Math.max(0, pageCount - 1));
  return orders.slice(safePage * ORDERS_PER_PAGE, (safePage + 1) * ORDERS_PER_PAGE);
}

export function OrderPageTabs({ status, orderCount, page, onPageChange, idPrefix }) {
  const pageCount = PAGINATED_STATUSES.has(status)
    ? Math.ceil(orderCount / ORDERS_PER_PAGE)
    : 0;
  if (pageCount <= 1) return null;

  const safePage = Math.min(page, pageCount - 1);
  return (
    <div className="order-page-tabs" role="tablist" aria-label="Páginas de comandas">
      {Array.from({ length: pageCount }, (_, index) => (
        <button
          key={index}
          id={`${idPrefix}-page-${index + 1}`}
          type="button"
          role="tab"
          aria-selected={safePage === index}
          aria-controls={`${idPrefix}-panel`}
          className={`order-page-tab${safePage === index ? " is-active" : ""}`}
          onClick={() => onPageChange(index)}
        >
          {index + 1}
        </button>
      ))}
    </div>
  );
}
