import { useEffect, useRef, useState } from "react";
import { C, s, COP } from "../../constants/theme.js";
import { localFetch, localInsert, localUpdate } from "../../lib/localApi.js";
import { uid } from "../../utils/helpers.js";
import { formatLocalTime } from "../../utils/dateTime.js";
import { Badge, Metric, SectionTitle } from "../common/index.jsx";
import { useAuth } from "../../hooks/useAuth.jsx";
import { useTurnoData } from "../../hooks/useTurnoData.js";

const STATUS_LABEL = {
  enviada: "Esperando autorización",
  entregada_falta_pago: "Entregado · falta pago",
  pagada: "Pagado",
  cancelada: "Cancelado",
};
const STATUS_COLOR = {
  enviada: C.amber,
  entregada_falta_pago: C.amber,
  pagada: C.green,
  cancelada: C.red,
};
const PROMOTION_LABEL = {
  "2x1": "2×1",
  precio_especial: "Precio especial",
  combo: "Combo",
  cortesia: "Cortesía",
  producto_mas_cortesia: "Producto + cortesía",
};

const promotionTypesOf = value => {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};
const STATUS_GROUPS = [
  { id: "enviada", title: "Pendientes por autorizar", description: "Pedidos nuevos que esperan revisión de stock y autorización." },
  { id: "entregada_falta_pago", title: "Entregados · falta pago", description: "Pedidos despachados que esperan confirmación de pago del mesero." },
  { id: "pagada", title: "Pagados", description: "Pedidos cuyo pago ya fue confirmado." },
  { id: "cancelada", title: "Cancelados", description: "Pedidos cancelados; no cuentan como ventas." },
  { id: "otros", title: "Otros estados", description: "Pedidos con un estado distinto a los habituales." },
];

export default function BarraWorkspace({ negocio, userName }) {
  const { users } = useAuth();
  const { turno, setTurno, comandas, setComandas, productos, setProductos } = useTurnoData(negocio.id);
  const [entry, setEntry] = useState({ productoId: "", cantidad: "", justificacion: "", comprobante: "" });
  const [entryFileName, setEntryFileName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [itemDetails, setItemDetails] = useState({});
  const loadingDetails = useRef(new Set());
  const loadedOrderRevisions = useRef(new Map());
  const autoExpandedPending = useRef(new Set());
  const [meseroFilter, setMeseroFilter] = useState("todos");
  const [activeStatus, setActiveStatus] = useState("enviada");
  const [activeModule, setActiveModule] = useState("orders");
  const [savingWaiters, setSavingWaiters] = useState(false);
  const [waiterAccessMessage, setWaiterAccessMessage] = useState("");
  const authorizedMeseroIds = Array.isArray(turno?.meseros_ids) ? turno.meseros_ids.map(String) : [];
  const negocioMeseros = (users || []).filter(account => {
    if (account.role !== "mesero") return false;
    if (account.negocios === "all") return true;
    if (Array.isArray(account.negocios)) return account.negocios.some(id => String(id) === String(negocio.id));
    if (typeof account.negocios === "string") {
      try {
        const businessIds = JSON.parse(account.negocios);
        return Array.isArray(businessIds) && businessIds.some(id => String(id) === String(negocio.id));
      } catch {
        return account.negocios === negocio.id;
      }
    }
    return false;
  }).sort((first, second) =>
    String(first.name || "").localeCompare(String(second.name || ""), "es")
  );
  const meseros = [...new Map(comandas.map(comanda => {
    const id = String(comanda.mesero_id || comanda.mesero_nombre || "sin_mesero");
    const nombre = String(comanda.mesero_nombre || comanda.mesero_id || "Sin mesero");
    return [id, { id, nombre }];
  })).values()].sort((first, second) =>
    String(first?.nombre || "").localeCompare(String(second?.nombre || ""), "es")
  );
  const comandasVisibles = meseroFilter === "todos"
    ? comandas
    : comandas.filter(comanda => (comanda.mesero_id || comanda.mesero_nombre || "sin_mesero") === meseroFilter);
  const comandasPorMesero = meseroId => comandas.filter(comanda =>
    (comanda.mesero_id || comanda.mesero_nombre || "sin_mesero") === meseroId
  ).length;
  const pending = comandasVisibles.filter(comanda => comanda.estado === "enviada").length;
  const getStatusOrders = statusId => comandasVisibles.filter(comanda =>
    statusId === "otros"
      ? !STATUS_GROUPS.some(group => group.id !== "otros" && group.id === comanda.estado)
      : comanda.estado === statusId
  );
  const ventasTotal = comandasVisibles
    .filter(comanda => comanda.estado !== "cancelada")
    .reduce((sum, comanda) => sum + Number(comanda.total || 0), 0);

  const toggleWaiterAccess = async (account, enabled) => {
    if (!turno || savingWaiters) return;
    setSavingWaiters(true);
    setWaiterAccessMessage("");
    const nextIds = enabled
      ? [...new Set([...authorizedMeseroIds, String(account.id)])]
      : authorizedMeseroIds.filter(id => id !== String(account.id));
    const saved = await localUpdate("turnos", { id: turno.id }, { meseros_ids: nextIds });
    if (saved) {
      setTurno(current => current?.id === turno.id ? { ...current, meseros_ids: nextIds } : current);
      setWaiterAccessMessage(`${account.name || "Mesero"} ${enabled ? "activado" : "desactivado"} para este turno.`);
    } else {
      setWaiterAccessMessage("No fue posible actualizar los permisos del turno.");
    }
    setSavingWaiters(false);
  };

  const getStockCheck = comanda => {
    const details = itemDetails[comanda.id] || [];
    return details.map(item => {
      const product = productos.find(row => row.id === item.producto_id);
      const stock = product ? Number(product.stock || 0) : 0;
      const requested = Number(item.cantidad || 0);
      return {
        ...item,
        stock,
        requested,
        available: Boolean(product) && stock >= requested,
      };
    });
  };

  const loadComandaDetails = async (comanda, force = false) => {
    if ((!force && itemDetails[comanda.id]) || loadingDetails.current.has(comanda.id)) return false;
    loadingDetails.current.add(comanda.id);
    try {
      const rows = await localFetch("comanda_items", `comanda_id=eq.${comanda.id}&select=*`);
      if (!rows) {
        setMessage("No fue posible cargar los productos de la comanda.");
        return false;
      }
      const names = new Map(productos.map(product => [product.id, product.name]));
      setItemDetails(current => ({
        ...current,
        [comanda.id]: rows.map(row => ({
          ...row,
          nombre: names.get(row.producto_id) || "Producto no disponible",
          promociones_aplicadas: promotionTypesOf(row.promociones_aplicadas),
        })),
      }));
      return true;
    } finally {
      loadingDetails.current.delete(comanda.id);
    }
  };

  useEffect(() => {
    const pendingOrders = comandas.filter(comanda => comanda.estado === "enviada");
    const arrivingOrders = pendingOrders.filter(comanda => !autoExpandedPending.current.has(comanda.id));
    if (arrivingOrders.length) {
      arrivingOrders.forEach(comanda => autoExpandedPending.current.add(comanda.id));
      setExpandedIds(current => new Set([...current, ...arrivingOrders.map(comanda => comanda.id)]));
    }
    pendingOrders.forEach(comanda => {
      const revision = comanda.actualizada_en;
      const previousRevision = loadedOrderRevisions.current.get(comanda.id);
      const needsRefresh = !itemDetails[comanda.id]
        || (revision && previousRevision && revision !== previousRevision);
      if (needsRefresh) {
        void loadComandaDetails(comanda, Boolean(itemDetails[comanda.id])).then(loaded => {
          if (loaded && revision) loadedOrderRevisions.current.set(comanda.id, revision);
        });
      } else if (revision && !previousRevision) {
        loadedOrderRevisions.current.set(comanda.id, revision);
      }
    });
  }, [comandas, productos, itemDetails]);

  const toggleDetails = async comanda => {
    if (expandedIds.has(comanda.id)) {
      setExpandedIds(current => {
        const next = new Set(current);
        next.delete(comanda.id);
        return next;
      });
      return;
    }
    if (!itemDetails[comanda.id] && !await loadComandaDetails(comanda)) return;
    setExpandedIds(current => new Set([...current, comanda.id]));
  };

  const dispatch = async comanda => {
    if (busy || comanda.estado !== "enviada") return;
    setBusy(true);
    setMessage("");
    const [details, promociones] = await Promise.all([
      localFetch("comanda_items", `comanda_id=eq.${comanda.id}&select=*`),
      localFetch("promociones", `negocio_id=eq.${negocio.id}&activo=eq.true&select=*`),
    ]);
    const deductions = new Map();
    (details || []).forEach(detail => deductions.set(detail.producto_id, Number(detail.cantidad || 0)));
    (details || []).forEach(detail => {
      (promociones || []).filter(promotion => promotion.tipo === "cortesia" && promotion.producto_principal_id === detail.producto_id).forEach(promotion => {
        const quantity = Number(detail.cantidad || 0) * Math.max(1, Number(promotion.cantidad_cortesia) || 1);
        deductions.set(promotion.producto_cortesia_id, (deductions.get(promotion.producto_cortesia_id) || 0) + quantity);
      });
    });
    const insufficient = [...deductions].some(([productId, quantity]) => {
      const product = productos.find(item => item.id === productId);
      return !product || Number(product.stock) < quantity;
    });
    if (insufficient) {
      setMessage("Stock insuficiente para despachar esta comanda.");
      setBusy(false);
      return;
    }
    const results = [];
    for (const [productId, quantity] of deductions) {
      const product = productos.find(item => item.id === productId);
      const newStock = Number(product.stock) - quantity;
      const stockOk = await localUpdate("productos", { id: product.id }, { stock: newStock });
      const movOk = await localInsert("movimientos_inventario", {
        id: uid(), negocio_id: negocio.id, turno_id: turno.id, producto_id: product.id,
        tipo: "venta", cantidad: -quantity, motivo: `Comanda ${comanda.id}`,
      });
      results.push({ productoId: product.id, newStock, ok: stockOk && movOk });
    }
    const allOk = results.every(result => result.ok);
    const dispatched = allOk && await localUpdate("comandas", { id: comanda.id }, {
      estado: "entregada_falta_pago",
      confirmado_en: new Date().toISOString(),
      despachado_en: new Date().toISOString(),
    });
    if (!dispatched) {
      setMessage("No se pudo completar el despacho.");
    } else {
      setProductos(current => current.map(product => {
        const result = results.find(item => item.productoId === product.id);
        return result ? { ...product, stock: result.newStock } : product;
      }));
      setComandas(current => current.map(row => row.id === comanda.id ? { ...row, estado: "entregada_falta_pago" } : row));
      setMessage("✓ Comanda entregada. Queda pendiente de confirmar el pago.");
    }
    setBusy(false);
  };

  const registerEntry = async () => {
    const quantity = Number(entry.cantidad);
    const product = productos.find(item => item.id === entry.productoId);
    if (busy) return;
    if (!turno) { setMessage("No hay turno abierto."); return; }
    if (!product || !Number.isInteger(quantity) || quantity < 1) { setMessage("Selecciona producto y cantidad válida."); return; }
    if (!entry.justificacion.trim()) { setMessage("La justificación es obligatoria."); return; }
    setBusy(true);
    setMessage("");
    const movementCreated = await localInsert("movimientos_inventario", {
      id: uid(), negocio_id: negocio.id, turno_id: turno.id, producto_id: product.id,
      tipo: "entrada_urgente", cantidad: quantity, motivo: entry.justificacion.trim(),
      comprobante_url: entry.comprobante || null, creado_por: userName || null,
    });
    const nextStock = Number(product.stock || 0) + quantity;
    const stockUpdated = movementCreated && await localUpdate("productos", { id: product.id }, { stock: nextStock });
    if (!stockUpdated) {
      setMessage("No fue posible registrar la entrada urgente.");
    } else {
      setProductos(current => current.map(item => item.id === product.id ? { ...item, stock: nextStock } : item));
      setEntry({ productoId: "", cantidad: "", justificacion: "", comprobante: "" });
      setEntryFileName("");
      setMessage("✓ Entrada urgente registrada.");
    }
    setBusy(false);
  };

  const handleFile = event => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 1500000) { setMessage("Archivo máximo 1.5 MB."); event.target.value = ""; return; }
    const reader = new FileReader();
    reader.onload = () => setEntry(current => ({ ...current, comprobante: String(reader.result || "") }));
    reader.onerror = () => setMessage("No fue posible leer el archivo.");
    reader.readAsDataURL(file);
    setEntryFileName(file.name);
  };

  return (
    <div>
      <SectionTitle>🍸 Cola de barra — {negocio.name}</SectionTitle>
      <p style={{ color: C.sub, fontSize: 13, marginTop: -10, marginBottom: 16 }}>Confirma pagos, despacha pedidos y gestiona el inventario.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10, marginBottom: 16 }}>
        <Metric label="Turno" value={turno ? "Abierto" : "Sin turno"} color={turno ? C.green : C.red} icon="⏱" />
        <Metric label="Pendientes" value={pending} color={pending > 0 ? C.amber : C.sub} icon="🧾" />
        <Metric label="Ventas" value={COP(ventasTotal)} color={C.green} icon="💰" />
      </div>
      <div className="barra-module-tabs" role="tablist" aria-label="Módulos de Barra">
        <button type="button" role="tab" aria-selected={activeModule === "orders"} className={activeModule === "orders" ? "is-active" : ""} onClick={() => setActiveModule("orders")}>
          Comandas
        </button>
        <button type="button" role="tab" aria-selected={activeModule === "waiters"} className={activeModule === "waiters" ? "is-active" : ""} onClick={() => setActiveModule("waiters")}>
          Meseros del turno <b>{authorizedMeseroIds.length}/{negocioMeseros.length}</b>
        </button>
      </div>
      {activeModule === "waiters" ? (
        <section className="barra-waiter-access">
          <header className="barra-waiter-access__heading">
            <div>
              <h2>Acceso de meseros</h2>
              <p>Activa únicamente las cuentas autorizadas para enviar pedidos en este turno.</p>
            </div>
            <span>{authorizedMeseroIds.length} activos</span>
          </header>
          {!turno && <div className="barra-waiter-access__notice">No hay un turno abierto. El gerente debe abrir la planilla antes de habilitar meseros.</div>}
          {waiterAccessMessage && <div role="status" className={`barra-waiter-access__message${waiterAccessMessage.startsWith("No fue") ? " is-error" : ""}`}>{waiterAccessMessage}</div>}
          {!negocioMeseros.length
            ? <div className="barra-waiter-access__empty">No hay cuentas de mesero asociadas a este negocio. El administrador maestro o el gerente pueden asignarlas desde Gestión de Usuarios.</div>
            : <div className="barra-waiter-access__list">
              {negocioMeseros.map(account => {
                const enabled = authorizedMeseroIds.includes(String(account.id));
                return (
                  <label key={account.id} className={`barra-waiter-access__item${enabled ? " is-enabled" : ""}`}>
                    <span className="barra-waiter-access__identity">
                      <strong>{account.name || "Mesero"}</strong>
                      <small>{account.email}</small>
                    </span>
                    <span className="barra-waiter-access__toggle">
                      <input
                        type="checkbox"
                        checked={enabled}
                        disabled={!turno || savingWaiters}
                        onChange={event => void toggleWaiterAccess(account, event.target.checked)}
                      />
                      <span>{enabled ? "Activo" : "Inactivo"}</span>
                    </span>
                  </label>
                );
              })}
            </div>}
        </section>
      ) : <>
      <details style={{ ...s.card, marginBottom: 16 }}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>➕ Entrada urgente de inventario</summary>
        <div style={{ color: C.sub, fontSize: 12, margin: "8px 0 12px" }}>Justificación obligatoria. Factura opcional (máx. 1.5 MB).</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 110px", gap: 8, marginBottom: 8 }}>
          <select style={s.sel} value={entry.productoId} onChange={event => setEntry(current => ({ ...current, productoId: event.target.value }))}>
            <option value="">Producto recibido</option>
            {productos.map(product => <option key={product.id} value={product.id}>{product.name} (stock: {product.stock})</option>)}
          </select>
          <input style={s.inp} type="number" min="1" step="1" placeholder="Cantidad" value={entry.cantidad} onChange={event => setEntry(current => ({ ...current, cantidad: event.target.value }))} />
        </div>
        <textarea style={{ ...s.inp, minHeight: 64, resize: "vertical", marginBottom: 8 }} placeholder="Justificación obligatoria" value={entry.justificacion} onChange={event => setEntry(current => ({ ...current, justificacion: event.target.value }))} />
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <label style={{ fontSize: 13, color: C.sub, cursor: "pointer" }}>📎 {entryFileName || "Adjuntar factura"}<input type="file" accept="image/*,.pdf" onChange={handleFile} style={{ display: "none" }} /></label>
          <button style={{ ...s.btn("primary"), marginLeft: "auto" }} onClick={registerEntry} disabled={busy}>Registrar entrada</button>
        </div>
      </details>
      <div style={s.card}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <div style={{ fontWeight: 700, flex: 1 }}>Comandas</div>
          <span style={{ color: C.sub, fontSize: 12 }}>La barra entrega; el mesero confirma el pago.</span>
        </div>
        <div className="barra-waiter-filter">
          <div className="barra-waiter-filter__label">
            <span>Vista por mesero</span>
            <span>{comandasVisibles.length} comandas</span>
          </div>
          <div className="barra-waiter-filter__chips" role="group" aria-label="Filtrar comandas por mesero">
            <button
              type="button"
              className={`barra-waiter-chip ${meseroFilter === "todos" ? "is-active" : ""}`}
              onClick={() => setMeseroFilter("todos")}
            >
              <span>Todos</span><b>{comandas.length}</b>
            </button>
            {meseros.map(mesero => (
              <button
                key={mesero.id}
                type="button"
                className={`barra-waiter-chip ${meseroFilter === mesero.id ? "is-active" : ""}`}
                onClick={() => setMeseroFilter(mesero.id)}
              >
                <span>{mesero.nombre}</span><b>{comandasPorMesero(mesero.id)}</b>
              </button>
            ))}
          </div>
        </div>
        {message && <div style={{ color: message.startsWith("✓") ? C.green : C.red, fontSize: 12, marginBottom: 10 }}>{message}</div>}
        {!turno && <p style={{ color: C.sub, fontSize: 13 }}>No hay turno abierto.</p>}
        {turno && comandas.length === 0 && <p style={{ color: C.sub, fontSize: 13 }}>Sin comandas en este turno.</p>}
        {turno && comandas.length > 0 && comandasVisibles.length === 0 && <p style={{ color: C.sub, fontSize: 13 }}>No hay comandas de este mesero.</p>}
        <div className="barra-order-tabs" role="tablist" aria-label="Filtrar comandas por estado">
          {STATUS_GROUPS.map(group => {
            const count = getStatusOrders(group.id).length;
            return (
              <button
                key={group.id}
                id={`barra-tab-${group.id}`}
                type="button"
                role="tab"
                aria-selected={activeStatus === group.id}
                aria-controls="barra-orders-panel"
                className={`barra-order-tab barra-order-tab--${group.id}${activeStatus === group.id ? " is-active" : ""}`}
                onClick={() => setActiveStatus(group.id)}
              >
                <span>{group.title}</span><b>{count}</b>
              </button>
            );
          })}
        </div>
        <section
          id="barra-orders-panel"
          role="tabpanel"
          aria-labelledby={`barra-tab-${activeStatus}`}
          className={`barra-order-group barra-order-group--${activeStatus}`}
        >
          <header className="barra-order-group__header">
            <div>
              <h3>{STATUS_GROUPS.find(group => group.id === activeStatus)?.title}</h3>
              <p>{STATUS_GROUPS.find(group => group.id === activeStatus)?.description}</p>
            </div>
            <span>{getStatusOrders(activeStatus).length}</span>
          </header>
          {!getStatusOrders(activeStatus).length && (
            <p className="barra-order-empty">No hay comandas en esta categoría.</p>
          )}
          {getStatusOrders(activeStatus).map(comanda => {
            const stockCheck = getStockCheck(comanda);
            const hasInsufficientStock = stockCheck.length > 0 && stockCheck.some(item => !item.available);
            return (
              <div key={comanda.id} className="barra-order">
                <div className="barra-order__summary">
                  <div className="barra-order__identity">
                    <strong>Comanda #{comanda.consecutivo || "—"}</strong>
                    <span>Mesero: {comanda.mesero_nombre || comanda.mesero_id}</span>
                    <time>{formatLocalTime(comanda.creado_en)}</time>
                  </div>
                  <div className="barra-order__status">
                    <Badge color={STATUS_COLOR[comanda.estado] || C.sub} small>
                      {STATUS_LABEL[comanda.estado] || comanda.estado}
                    </Badge>
                  </div>
                  <strong className="barra-order__total">{COP(comanda.total)}</strong>
                  <div className="barra-order__actions">
                    <button
                      className="barra-order__details-button"
                      style={{ ...s.btn("ghost"), padding: "6px 10px" }}
                      type="button"
                      disabled={busy}
                      onClick={() => toggleDetails(comanda)}
                    >
                      {expandedIds.has(comanda.id) ? "Ocultar productos" : "Ver productos"}
                    </button>
                    <div className="barra-order__authorize-slot">
                      {comanda.estado === "enviada" ? (
                        <button
                          style={{ ...s.btn("success"), padding: "6px 10px" }}
                          type="button"
                          disabled={busy || hasInsufficientStock}
                          onClick={() => dispatch(comanda)}
                        >
                          Autorizar y entregar
                        </button>
                      ) : <span aria-hidden="true" />}
                    </div>
                  </div>
                </div>
                {expandedIds.has(comanda.id) && (
                  <div className="barra-order-details">
                    <div className="barra-order-details__title">Productos · comparación con inventario</div>
                    <div className="barra-order-details__header" aria-hidden="true">
                      <span>Producto</span>
                      <span>Solicitado</span>
                      <span>Stock actual</span>
                      <span>Subtotal</span>
                    </div>
                    {stockCheck.map(item => (
                      <div key={item.id} className={`barra-order-details__row${item.available ? "" : " is-insufficient"}`}>
                        <span className="barra-order-details__product">
                          <span>{item.nombre}</span>
                          {promotionTypesOf(item.promociones_aplicadas).map(type => (
                            <span key={type} className="barra-order-details__promotion">
                              {PROMOTION_LABEL[type] || "Promoción"}
                            </span>
                          ))}
                          {!promotionTypesOf(item.promociones_aplicadas).length && Number(item.descuento) > 0 && (
                            <span className="barra-order-details__promotion" title="El tipo de promoción no quedó registrado en este pedido">
                              Promoción
                            </span>
                          )}
                        </span>
                        <span className="barra-order-details__quantity">{item.requested}</span>
                        <span className={`barra-order-details__stock${item.available ? "" : " is-insufficient"}`}>
                          {item.stock}
                        </span>
                        <strong className="barra-order-details__subtotal">
                          {COP(item.requested * Number(item.precio_unitario))}
                        </strong>
                      </div>
                    ))}
                    {hasInsufficientStock && (
                      <div style={{ color: C.red, fontSize: 11, marginTop: 7 }}>
                        No se puede autorizar hasta registrar entrada o ajustar el pedido.
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      </div>
      </>}
    </div>
  );
}
