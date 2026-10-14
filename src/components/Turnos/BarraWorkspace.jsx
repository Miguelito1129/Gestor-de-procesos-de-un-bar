import { useEffect, useRef, useState } from "react";
import { C, s, COP } from "../../constants/theme.js";
import {
  localDispatchOrder,
  localFetch,
  localPrintOrder,
  localRejectOrder,
  localRegisterInventoryIntake,
  localUpdate,
} from "../../lib/localApi.js";
import { formatLocalTime } from "../../utils/dateTime.js";
import { Badge, Metric, SectionTitle } from "../common/index.jsx";
import { OrderPageTabs, visibleOrderPage } from "./OrderPagination.jsx";
import { useAuth } from "../../hooks/useAuth.jsx";
import { useTurnoData } from "../../hooks/useTurnoData.js";

const STATUS_LABEL = {
  enviada: "Esperando autorización",
  no_autorizada: "No autorizada por Barra",
  entregada_falta_pago: "Entregado (pedido anterior)",
  pagada: "Pagado",
  cancelada: "Cancelado",
};
const STATUS_COLOR = {
  enviada: C.amber,
  no_autorizada: C.sub,
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
  { id: "pagada", title: "Pagados y entregados", description: "Pedidos despachados y pagados." },
  { id: "cancelada", title: "Cancelados", description: "Pedidos cancelados; no cuentan como ventas." },
  { id: "otros", title: "Otros estados", description: "Pedidos con un estado distinto a los habituales." },
];
const INVENTORY_INTAKE_REASONS = ["Solicitud a proveedor", "Préstamo"];

export default function BarraWorkspace({ negocio, userName, userId }) {
  const { users } = useAuth();
  const { turno, setTurno, comandas, setComandas, productos, setProductos } = useTurnoData(negocio.id);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [rejectingOrderId, setRejectingOrderId] = useState("");
  const [itemDetails, setItemDetails] = useState({});
  const loadingDetails = useRef(new Set());
  const loadedOrderRevisions = useRef(new Map());
  const autoExpandedPending = useRef(new Set());
  const [meseroFilter, setMeseroFilter] = useState("todos");
  const [activeStatus, setActiveStatus] = useState("enviada");
  const [orderPage, setOrderPage] = useState(0);
  const [activeModule, setActiveModule] = useState("orders");
  const [intakeDescription, setIntakeDescription] = useState("");
  const [intakeItems, setIntakeItems] = useState([{ producto_id: "", cantidad: "1" }]);
  const [intakeMessage, setIntakeMessage] = useState("");
  const [savingIntake, setSavingIntake] = useState(false);
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
  const allPendingOrders = comandasVisibles.filter(comanda => comanda.estado === "enviada");
  const pending = allPendingOrders.length;
  const getStatusOrders = statusId => comandasVisibles.filter(comanda =>
    statusId === "otros"
      ? !STATUS_GROUPS.some(group => group.id !== "otros" && group.id === comanda.estado)
      : comanda.estado === statusId
  );
  const statusOrders = getStatusOrders(activeStatus);
  const visibleStatusOrders = visibleOrderPage(statusOrders, activeStatus, orderPage);
  const ventasTotal = comandasVisibles
    .filter(comanda => comanda.estado === "pagada")
    .reduce((sum, comanda) => sum + Number(comanda.total || 0), 0);

  const rejectOrder = async comanda => {
    if (rejectingOrderId || comanda.estado !== "enviada") return;
    setRejectingOrderId(comanda.id);
    setMessage("");
    try {
      const result = await localRejectOrder(comanda.id);
      const updated = result.comanda;
      if (!updated || updated.estado !== "no_autorizada") {
        throw new Error("La respuesta del servidor no confirmó el estado de no autorizada.");
      }
      setExpandedIds(current => {
        const next = new Set(current);
        next.delete(comanda.id);
        return next;
      });
      setComandas(current => current.map(order => order.id === comanda.id ? { ...order, ...updated } : order));
      setMessage(`Comanda #${comanda.consecutivo || "—"} marcada como no autorizada. Mesero puede consultarla en «Otros estados».`);
      setOrderPage(0);
    } catch (error) {
      setMessage(error.message || "No fue posible marcar la comanda como no autorizada.");
    } finally {
      setRejectingOrderId("");
    }
  };

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

  const updateIntakeItem = (index, changes) => {
    setIntakeItems(current => current.map((item, itemIndex) =>
      itemIndex === index ? { ...item, ...changes } : item
    ));
  };

  const registerInventoryIntake = async event => {
    event.preventDefault();
    if (!turno || savingIntake) return;
    const productsToReceive = intakeItems.map(item => ({
      producto_id: item.producto_id,
      cantidad: Number(item.cantidad),
    }));
    if (!INVENTORY_INTAKE_REASONS.includes(intakeDescription)
      || !productsToReceive.length
      || productsToReceive.some(item => !item.producto_id || !Number.isSafeInteger(item.cantidad) || item.cantidad <= 0)) {
      setIntakeMessage("Selecciona el motivo del ingreso y agrega productos existentes con cantidades enteras mayores que cero.");
      return;
    }
    setSavingIntake(true);
    setIntakeMessage("");
    try {
      const result = await localRegisterInventoryIntake(turno.id, {
        descripcion: intakeDescription.trim(),
        productos: productsToReceive,
      });
      setProductos(current => current.map(product => {
        const received = result.productos?.find(item => item.producto_id === product.id);
        return received ? { ...product, stock: received.stock } : product;
      }));
      setIntakeDescription("");
      setIntakeItems([{ producto_id: "", cantidad: "1" }]);
      setIntakeMessage(`✓ Ingreso registrado: ${result.productos.map(item => `${item.nombre} +${item.cantidad}`).join(", ")}.`);
    } catch (error) {
      setIntakeMessage(error.message || "No fue posible registrar el ingreso.");
    } finally {
      setSavingIntake(false);
    }
  };

  const getStockCheck = comanda => {
    const details = itemDetails[comanda.id] || [];
    const requestedByProduct = details.reduce((totals, item) => {
      const productId = String(item.producto_id);
      totals.set(productId, (totals.get(productId) || 0) + Number(item.cantidad || 0));
      return totals;
    }, new Map());
    return details.map(item => {
      const product = productos.find(row => row.id === item.producto_id);
      const stock = product ? Number(product.stock || 0) : 0;
      const requested = Number(item.cantidad || 0);
      return {
        ...item,
        stock,
        requested: requestedByProduct.get(String(item.producto_id)) || requested,
        available: Boolean(product) && stock >= (requestedByProduct.get(String(item.producto_id)) || requested),
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
    const pendingOrders = comandas.filter(comanda =>
      comanda.estado === "enviada"
    );
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
    try {
      const result = await localDispatchOrder(comanda.id);
      setProductos(current => current.map(product => {
        const updated = result.stock?.find(item => item.producto_id === product.id);
        return updated ? { ...product, stock: updated.stock } : product;
      }));
      setComandas(current => current.map(row => row.id === comanda.id
        ? { ...row, ...(result.comanda || {}), estado: "pagada" }
        : row));
      setItemDetails(current => {
        const courtesyRows = (result.comanda?.pagos_cortesia || []).map(item => ({
          id: `courtesy-${item.producto_id}`,
          producto_id: item.producto_id,
          cantidad: item.cantidad,
          precio_unitario: 0,
          descuento: 0,
          es_cortesia: 1,
          promociones_aplicadas: ["cortesia"],
          nombre: productos.find(product => product.id === item.producto_id)?.name || "Producto de cortesía",
        }));
        return { ...current, [comanda.id]: [...(current[comanda.id] || []), ...courtesyRows] };
      });
      try {
        const printResult = await localPrintOrder(comanda.id, userId);
        const warning = result.warnings?.length ? ` ${result.warnings.join(" ")}` : "";
        setMessage(`✓ Comanda entregada y pagada. ${printResult?.message || "Ticket enviado a imprimir."}${warning}`);
      } catch (error) {
        const warning = result.warnings?.length ? ` ${result.warnings.join(" ")}` : "";
        setMessage(`✓ Comanda entregada y pagada. No se pudo imprimir el ticket: ${error.message}${warning}`);
      }
    } catch (error) {
      setMessage(error.message || "No se pudo completar el despacho.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <SectionTitle>🍸 Cola de barra — {negocio.name}</SectionTitle>
      <p style={{ color: C.sub, fontSize: 13, marginTop: -10, marginBottom: 16 }}>Autoriza y entrega pedidos.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10, marginBottom: 16 }}>
        <Metric label="Turno" value={turno ? "Abierto" : "Sin turno"} color={turno ? C.green : C.red} icon="⏱" />
        <Metric label="Pendientes" value={pending} color={pending > 0 ? C.amber : C.sub} icon="🧾" />
        <Metric label="Ventas" value={COP(ventasTotal)} color={C.green} icon="💰" />
      </div>
      <div className="barra-module-tabs" role="tablist" aria-label="Módulos de Barra">
        <button type="button" role="tab" aria-selected={activeModule === "orders"} className={activeModule === "orders" ? "is-active" : ""} onClick={() => setActiveModule("orders")}>
          Cola de Barra
        </button>
        <button type="button" role="tab" aria-selected={activeModule === "income"} className={activeModule === "income" ? "is-active" : ""} onClick={() => { setActiveModule("income"); setIntakeMessage(""); }}>
          Ingresos
        </button>
        <button type="button" role="tab" aria-selected={activeModule === "waiters"} className={activeModule === "waiters" ? "is-active" : ""} onClick={() => setActiveModule("waiters")}>
          Meseros del turno <b>{authorizedMeseroIds.length}/{negocioMeseros.length}</b>
        </button>
      </div>
      {!turno ? (
        <section className="barra-waiter-access__notice" role="status">
          No tienes un turno abierto asignado en {negocio.name}. El gerente debe seleccionar tu cuenta de Barra al abrir la planilla.
        </section>
      ) : activeModule === "waiters" ? (
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
      ) : activeModule === "income" ? (
        <section className="barra-inventory-intake" aria-labelledby="barra-inventory-intake-title">
          <header className="barra-waiter-access__heading">
            <div>
              <h2 id="barra-inventory-intake-title">Ingreso de productos al inventario</h2>
              <p>Selecciona el motivo del ingreso y agrega uno o más productos existentes.</p>
            </div>
          </header>
          <form onSubmit={event => void registerInventoryIntake(event)}>
            <label className="barra-inventory-intake__description">
              <span>Motivo del ingreso</span>
              <select
                value={intakeDescription}
                onChange={event => setIntakeDescription(event.target.value)}
                disabled={savingIntake}
                required
              >
                <option value="">Seleccionar motivo</option>
                {INVENTORY_INTAKE_REASONS.map(reason => (
                  <option key={reason} value={reason}>{reason}</option>
                ))}
              </select>
            </label>
            <div className="barra-inventory-intake__items">
              {intakeItems.map((item, index) => (
                <div className="barra-inventory-intake__row" key={index}>
                  <label>
                    <span>Producto</span>
                    <select
                      value={item.producto_id}
                      onChange={event => updateIntakeItem(index, { producto_id: event.target.value })}
                      disabled={savingIntake}
                      required
                    >
                      <option value="">Seleccionar del inventario</option>
                      {productos.map(product => (
                        <option key={product.id} value={product.id}>{product.name} · stock {product.stock}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Cantidad recibida</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={item.cantidad}
                      onChange={event => updateIntakeItem(index, { cantidad: event.target.value })}
                      disabled={savingIntake}
                      required
                    />
                  </label>
                  {intakeItems.length > 1 && (
                    <button type="button" className="barra-inventory-intake__remove" disabled={savingIntake} onClick={() => setIntakeItems(current => current.filter((_, itemIndex) => itemIndex !== index))} aria-label="Quitar producto">
                      Quitar
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="barra-inventory-intake__actions">
              <button type="button" className="barra-inventory-intake__add" disabled={savingIntake} onClick={() => setIntakeItems(current => [...current, { producto_id: "", cantidad: "1" }])}>
                + Agregar otro producto
              </button>
              <button type="submit" style={s.btn("success")} disabled={savingIntake || !productos.length}>
                {savingIntake ? "Registrando ingreso…" : "Registrar ingreso"}
              </button>
            </div>
          </form>
          {intakeMessage && (
            <div className={`barra-inventory-intake__message${intakeMessage.startsWith("✓") ? " is-success" : " is-error"}`} role="status">
              {intakeMessage}
            </div>
          )}
        </section>
      ) : <>
      <div style={s.card}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <div style={{ fontWeight: 700, flex: 1 }}>Comandas</div>
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
              onClick={() => {
                setMeseroFilter("todos");
                setOrderPage(0);
              }}
            >
              <span>Todos</span><b>{comandas.length}</b>
            </button>
            {meseros.map(mesero => (
              <button
                key={mesero.id}
                type="button"
                className={`barra-waiter-chip ${meseroFilter === mesero.id ? "is-active" : ""}`}
                onClick={() => {
                  setMeseroFilter(mesero.id);
                  setOrderPage(0);
                }}
              >
                <span>{mesero.nombre}</span><b>{comandasPorMesero(mesero.id)}</b>
              </button>
            ))}
          </div>
        </div>
        {message && <div style={{ color: message.startsWith("✓") ? (message.includes("No se pudo imprimir") ? C.amber : C.green) : C.red, fontSize: 12, marginBottom: 10 }}>{message}</div>}
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
                onClick={() => {
                  setActiveStatus(group.id);
                  setOrderPage(0);
                }}
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
            <span>{statusOrders.length}</span>
          </header>
          <OrderPageTabs
            status={activeStatus}
            orderCount={statusOrders.length}
            page={orderPage}
            onPageChange={setOrderPage}
            idPrefix="barra-orders"
          />
          {!statusOrders.length && (
            <p className="barra-order-empty">No hay comandas en esta categoría.</p>
          )}
          <div className={["pagada", "cancelada"].includes(activeStatus) ? "order-page-grid" : undefined}>
          {visibleStatusOrders.map(comanda => {
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
                    {comanda.estado === "enviada" && (
                      <button
                        className="barra-order__details-button"
                        style={{ ...s.btn("ghost"), padding: "6px 10px" }}
                        type="button"
                        disabled={Boolean(rejectingOrderId)}
                        onClick={() => void rejectOrder(comanda)}
                      >
                        {rejectingOrderId === comanda.id ? "Guardando…" : "No autorizar"}
                      </button>
                    )}
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
          </div>
        </section>
      </div>
      </>}
    </div>
  );
}
