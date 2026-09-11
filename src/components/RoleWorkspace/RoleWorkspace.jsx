import { useEffect, useState } from "react";
import { C, s, COP } from "../../constants/theme.js";
import { localFetch, localInsert, localUpdate } from "../../lib/localApi.js";
import { uid } from "../../utils/helpers.js";
import { Badge, Metric, SectionTitle } from "../common/index.jsx";

const ROLE_COPY = {
  mesero: { title: "Mi turno", subtitle: "Registra comandas y consulta su estado.", icon: "🧾" },
  barra: { title: "Cola de barra", subtitle: "Confirma pagos y despacha pedidos.", icon: "🍸" },
};

export default function RoleWorkspace({ role, negocio, userName }) {
  const [turno, setTurno] = useState(null);
  const [comandas, setComandas] = useState([]);
  const [productos, setProductos] = useState([]);
  const [mesa, setMesa] = useState("");
  const [selectedProduct, setSelectedProduct] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [items, setItems] = useState([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [paymentType, setPaymentType] = useState("efectivo");
  const [productSearch, setProductSearch] = useState("");
  const [entry, setEntry] = useState({ productoId: "", cantidad: "", justificacion: "", comprobante: "" });
  const [entryFileName, setEntryFileName] = useState("");
  const copy = ROLE_COPY[role];

  useEffect(() => {
    let active = true;
    let channel;
    (async () => {
      const turnos = await localFetch(
        "turnos",
        `negocio_id=eq.${negocio.id}&estado=eq.abierto&select=*&order=fecha_apertura.desc&limit=1`,
      );
      if (!active || !turnos?.[0]) return;
      setTurno(turnos[0]);
      const products = await localFetch(
        "productos",
        `negocio_id=eq.${negocio.id}&select=*&order=name.asc`,
      );
      if (active) setProductos(products || []);
      const rows = await localFetch(
        "comandas",
        `turno_id=eq.${turnos[0].id}&select=*&order=creado_en.desc`,
      );
      if (active) setComandas(rows || []);
      const poll = window.setInterval(async () => {
        const latest = await localFetch("comandas", `turno_id=eq.${turnos[0].id}&select=*&order=creado_en.desc`);
        if (active && latest) setComandas(latest);
      }, 3000);
      channel = { unsubscribe: () => window.clearInterval(poll) };
    })();
    return () => {
      active = false;
      if (channel) channel.unsubscribe();
    };
  }, [negocio.id]);

  const addItem = (productId = selectedProduct) => {
    const product = productos.find(p => p.id === productId);
    const count = Number(quantity);
    if (!product || !Number.isInteger(count) || count < 1) return;
    setItems(current => {
      const existing = current.find(item => item.producto_id === product.id);
      if (existing) return current.map(item => item.producto_id === product.id
        ? { ...item, cantidad: item.cantidad + count }
        : item);
      return [...current, {
        producto_id: product.id,
        nombre: product.name,
        cantidad: count,
        precio_unitario: Number(product.price || 0),
      }];
    });
    setSelectedProduct("");
    setQuantity(1);
  };

  const changeItemQuantity = (productId, delta) => {
    setItems(current => current
      .map(item => item.producto_id === productId
        ? { ...item, cantidad: item.cantidad + delta }
        : item)
      .filter(item => item.cantidad > 0));
  };

  const createComanda = async () => {
    if (!turno || !mesa.trim() || !items.length || busy) return;
    setBusy(true);
    setMessage("");
    const total = items.reduce((sum, item) => sum + item.precio_unitario * item.cantidad, 0);
    const staff = await localFetch(
      "staff",
      `negocio_id=eq.${negocio.id}&rol=eq.mesero&select=id,name&order=name.asc&limit=20`,
    );
    const assigned = (staff || []).find(person => person.name.toLowerCase() === (userName || "").toLowerCase()) || staff?.[0];
    if (!assigned) {
      setMessage("No hay un mesero configurado para este negocio.");
      setBusy(false);
      return;
    }
    const comandaId = uid();
    const created = await localInsert("comandas", {
      id: comandaId,
      turno_id: turno.id,
      mesa: mesa.trim(),
      mesero_id: assigned.id,
      estado: "enviada",
      subtotal: total,
      total,
    });
    const detailCreated = created && await localInsert("comanda_items", items.map(item => ({
      id: uid(),
      comanda_id: comandaId,
      producto_id: item.producto_id,
      cantidad: item.cantidad,
      precio_unitario: item.precio_unitario,
    })));
    if (!created || !detailCreated) {
      setMessage("No fue posible guardar la comanda. Revisa la conexión con el servidor local.");
    } else {
      setComandas(current => [{
        id: comandaId, turno_id: turno.id, mesa: mesa.trim(), estado: "enviada",
        total, creado_en: new Date().toISOString(),
      }, ...current]);
      setMesa("");
      setItems([]);
      setMessage("✓ Comanda enviada a barra.");
    }
    setBusy(false);
  };

  const dispatchComanda = async comanda => {
    if (busy || comanda.estado !== "enviada") return;
    setBusy(true);
    setMessage("");
    const details = await localFetch("comanda_items", `comanda_id=eq.${comanda.id}&select=*`);
    const insufficient = (details || []).some(detail => {
      const product = productos.find(item => item.id === detail.producto_id);
      return !product || Number(product.stock) < Number(detail.cantidad);
    });
    if (insufficient) {
      setMessage("No hay inventario suficiente para despachar esta comanda.");
      setBusy(false);
      return;
    }
    const paymentCreated = await localInsert("pagos", {
      id: uid(), comanda_id: comanda.id, tipo: paymentType, monto: comanda.total, verificado: true,
    });
    const inventoryUpdated = [];
    for (const detail of details || []) {
      const product = productos.find(item => item.id === detail.producto_id);
      const stockUpdated = await localUpdate("productos", { id: product.id }, {
        stock: Number(product.stock) - Number(detail.cantidad),
      });
      const movementCreated = await localInsert("movimientos_inventario", {
        id: uid(), negocio_id: negocio.id, turno_id: turno.id, producto_id: product.id,
        tipo: "venta", cantidad: -Number(detail.cantidad), motivo: `Comanda ${comanda.id}`,
      });
      inventoryUpdated.push(stockUpdated && movementCreated);
    }
    const dispatched = paymentCreated && inventoryUpdated.every(Boolean) &&
      await localUpdate("comandas", { id: comanda.id }, {
        estado: "pagada", modo_pago: paymentType,
        confirmado_en: new Date().toISOString(),
        despachado_en: new Date().toISOString(),
        pagado_en: new Date().toISOString(),
      });
    if (!dispatched) {
      setMessage("No se pudo completar el despacho. Verifica stock y permisos.");
    } else {
      const refreshed = await localFetch("productos", `negocio_id=eq.${negocio.id}&select=*&order=name.asc`);
      if (refreshed) setProductos(refreshed);
      setComandas(current => current.map(row => row.id === comanda.id ? { ...row, estado: "pagada" } : row));
      setMessage("✓ Pedido autorizado: inventario descontado y comanda despachada.");
    }
    setBusy(false);
  };

  const cancelComanda = async comanda => {
    if (busy || comanda.estado !== "enviada") return;
    setBusy(true);
    const cancelled = await localUpdate("comandas", { id: comanda.id }, {
      estado: "cancelada",
      confirmado_en: new Date().toISOString(),
    });
    if (cancelled) {
      setComandas(current => current.map(row => row.id === comanda.id ? { ...row, estado: "cancelada" } : row));
      setMessage("Pedido cancelado.");
    } else {
      setMessage("No fue posible cancelar el pedido.");
    }
    setBusy(false);
  };

  const registerUrgentEntry = async () => {
    const quantityToAdd = Number(entry.cantidad);
    const product = productos.find(item => item.id === entry.productoId);
    if (busy) return;
    if (!turno) {
      setMessage("No puedes registrar una entrada sin un turno abierto.");
      return;
    }
    if (!product || !Number.isInteger(quantityToAdd) || quantityToAdd < 1) {
      setMessage("Selecciona un producto y una cantidad válida.");
      return;
    }
    if (!entry.justificacion.trim()) {
      setMessage("La justificación es obligatoria para ingresar inventario.");
      return;
    }
    setBusy(true);
    setMessage("");
    const movementCreated = await localInsert("movimientos_inventario", {
      id: uid(),
      negocio_id: negocio.id,
      turno_id: turno?.id || null,
      producto_id: product.id,
      tipo: "entrada_urgente",
      cantidad: quantityToAdd,
      motivo: entry.justificacion.trim(),
      comprobante_url: entry.comprobante || null,
      creado_por: userName || null,
    });
    const nextStock = Number(product.stock || 0) + quantityToAdd;
    const stockUpdated = movementCreated && await localUpdate("productos", { id: product.id }, { stock: nextStock });
    if (!stockUpdated) {
      setMessage("No fue posible registrar la entrada urgente.");
    } else {
      setProductos(current => current.map(item => item.id === product.id ? { ...item, stock: nextStock } : item));
      setEntry({ productoId: "", cantidad: "", justificacion: "", comprobante: "" });
      setEntryFileName("");
      setMessage("✓ Entrada urgente registrada y stock actualizado.");
    }
    setBusy(false);
  };

  const handleEntryFile = event => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 1500000) {
      setMessage("La factura no puede superar 1.5 MB.");
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setEntry(current => ({ ...current, comprobante: String(reader.result || "") }));
      setEntryFileName(file.name);
    };
    reader.onerror = () => setMessage("No fue posible leer la factura.");
    reader.readAsDataURL(file);
  };

  const pending = comandas.filter(c => c.estado === "enviada").length;
  const total = comandas.reduce((sum, c) => sum + Number(c.total || 0), 0);
  const visibleProducts = productos.filter(product => product.name.toLowerCase().includes(productSearch.toLowerCase()));
  const statusLabel = estado => ({
    enviada: "Falta confirmación de barra",
    pagada: "Pagado",
    cancelada: "Pedido cancelado",
  }[estado] || estado);
  const statusColor = estado => estado === "pagada" ? C.green : estado === "cancelada" ? C.red : C.amber;

  return (
    <div>
      <SectionTitle>{copy.icon} {copy.title} — {negocio.name}</SectionTitle>
      <div style={{ color: C.sub, fontSize: 13, marginTop: -12, marginBottom: 16 }}>{copy.subtitle}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginBottom: 16 }}>
        <Metric label="Turno activo" value={turno ? "Abierto" : "Sin turno"} color={turno ? C.green : C.red} icon="⏱" />
        <Metric label={role === "barra" ? "Pendientes" : "Mis comandas"} value={role === "barra" ? pending : comandas.length} color={C.amber} icon="🧾" />
        <Metric label="Ventas del turno" value={COP(total)} color={C.green} icon="💰" />
      </div>

      <div style={s.card}>
        {role === "barra" && (
          <div style={{ ...s.card, marginBottom: 16, background: C.surface }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Entrada urgente de inventario</div>
            <div style={{ color: C.sub, fontSize: 12, marginBottom: 12 }}>
              Registra compras urgentes de productos ya creados. La justificación es obligatoria.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 110px", gap: 8 }}>
              <select style={s.sel} value={entry.productoId} onChange={event => setEntry(current => ({ ...current, productoId: event.target.value }))}>
                <option value="">Producto recibido</option>
                {productos.map(product => <option key={product.id} value={product.id}>{product.name} (stock: {product.stock})</option>)}
              </select>
              <input style={s.inp} type="number" min="1" step="1" placeholder="Cantidad" value={entry.cantidad} onChange={event => setEntry(current => ({ ...current, cantidad: event.target.value }))} />
            </div>
            <textarea style={{ ...s.inp, marginTop: 8, minHeight: 72, resize: "vertical" }} placeholder="Justificación obligatoria" value={entry.justificacion} onChange={event => setEntry(current => ({ ...current, justificacion: event.target.value }))} />
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <input type="file" accept="image/*,.pdf" onChange={handleEntryFile} />
              {entryFileName && <span style={{ color: C.sub, fontSize: 11 }}>{entryFileName}</span>}
              <button style={{ ...s.btn("primary"), marginLeft: "auto" }} onClick={registerUrgentEntry} disabled={busy}>Registrar entrada</button>
            </div>
          </div>
        )}
        {role === "mesero" && (
          <div className="waiter-order" style={{ marginBottom: 18 }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>Nuevo pedido</div>
            <input style={{ ...s.inp, marginBottom: 10 }} placeholder="Buscar producto..." value={productSearch} onChange={event => setProductSearch(event.target.value)} />
            <input style={{ ...s.inp, marginBottom: 10 }} placeholder="Mesa" value={mesa} onChange={event => setMesa(event.target.value)} />
            <div className="waiter-products">
              {visibleProducts.map(product => (
                <button key={product.id} type="button" className="waiter-product" onClick={() => {
                  addItem(product.id);
                }}>
                  <span>{product.name}</span>
                  <strong>{COP(product.price)}</strong>
                </button>
              ))}
            </div>
            {items.length > 0 && (
              <div className="waiter-cart">
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Pedido actual</div>
                {items.map(item => (
                  <div key={item.producto_id} className="waiter-cart-row">
                    <span>{item.nombre}</span>
                    <div className="waiter-quantity">
                      <button type="button" onClick={() => changeItemQuantity(item.producto_id, -1)}>−</button>
                      <strong>{item.cantidad}</strong>
                      <button type="button" onClick={() => changeItemQuantity(item.producto_id, 1)}>+</button>
                    </div>
                    <strong>{COP(item.precio_unitario * item.cantidad)}</strong>
                  </div>
                ))}
                <div className="waiter-total"><span>Total</span><strong>{COP(items.reduce((sum, item) => sum + item.precio_unitario * item.cantidad, 0))}</strong></div>
              </div>
            )}
            <button style={{ ...s.btn("primary"), width: "100%", marginTop: 10 }} type="button" disabled={busy || !turno || !mesa.trim() || !items.length} onClick={createComanda}>
              {busy ? "Guardando..." : "Enviar pedido a barra"}
            </button>
          </div>
        )}
        {message && <div style={{ color: message.startsWith("✓") ? C.green : C.red, fontSize: 12, marginBottom: 10 }}>{message}</div>}
        <div style={{ fontWeight: 700, marginBottom: 10 }}>{role === "barra" ? "Comandas pendientes de atención" : "Comandas recientes"}</div>
        {role === "barra" && (
          <select style={{ ...s.sel, maxWidth: 220, marginBottom: 10 }} value={paymentType} onChange={event => setPaymentType(event.target.value)}>
            <option value="efectivo">Pago en efectivo</option>
            <option value="transferencia">Pago por transferencia</option>
          </select>
        )}
        {!turno && <div style={{ color: C.sub, fontSize: 13 }}>El administrador aún no ha abierto un turno.</div>}
        {turno && comandas.length === 0 && <div style={{ color: C.sub, fontSize: 13 }}>No hay comandas registradas en este turno.</div>}
        {comandas.map(comanda => (
          <div key={comanda.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: `1px solid ${C.border}40` }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>Mesa {comanda.mesa}</div>
              <div style={{ color: C.sub, fontSize: 11 }}>{new Date(comanda.creado_en).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
            </div>
            <Badge color={statusColor(comanda.estado)} small>{statusLabel(comanda.estado)}</Badge>
            <strong style={{ color: C.green, fontSize: 13 }}>{COP(comanda.total)}</strong>
            {role === "mesero" && comanda.estado === "enviada" && (
              <button style={{ ...s.btn("danger"), padding: "5px 9px" }} type="button" disabled={busy} onClick={() => cancelComanda(comanda)}>
                Cancelar
              </button>
            )}
            {role === "barra" && comanda.estado === "enviada" && (
              <button style={{ ...s.btn("success"), padding: "5px 9px" }} type="button" disabled={busy} onClick={() => dispatchComanda(comanda)}>
                Autorizar y descontar inventario
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
