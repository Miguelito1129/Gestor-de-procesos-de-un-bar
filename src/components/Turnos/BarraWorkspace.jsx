import { useState } from "react";
import { C, s, COP } from "../../constants/theme.js";
import { localFetch, localInsert, localUpdate } from "../../lib/localApi.js";
import { uid } from "../../utils/helpers.js";
import { Badge, Metric, SectionTitle } from "../common/index.jsx";
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

export default function BarraWorkspace({ negocio, userName }) {
  const { turno, comandas, setComandas, productos, setProductos } = useTurnoData(negocio.id);
  const [entry, setEntry] = useState({ productoId: "", cantidad: "", justificacion: "", comprobante: "" });
  const [entryFileName, setEntryFileName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const [itemDetails, setItemDetails] = useState({});
  const pending = comandas.filter(comanda => comanda.estado === "enviada").length;
  const ventasTotal = comandas.reduce((sum, comanda) => sum + Number(comanda.total || 0), 0);

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

  const toggleDetails = async comanda => {
    if (expandedId === comanda.id) {
      setExpandedId(null);
      return;
    }
    if (!itemDetails[comanda.id]) {
      const rows = await localFetch("comanda_items", `comanda_id=eq.${comanda.id}&select=*`);
      if (!rows) {
        setMessage("No fue posible cargar los productos de la comanda.");
        return;
      }
      const names = new Map(productos.map(product => [product.id, product.name]));
      setItemDetails(current => ({
        ...current,
        [comanda.id]: rows.map(row => ({
          ...row,
          nombre: names.get(row.producto_id) || "Producto no disponible",
        })),
      }));
    }
    setExpandedId(comanda.id);
  };

  const dispatch = async comanda => {
    if (busy || comanda.estado !== "enviada") return;
    setBusy(true);
    setMessage("");
    const details = await localFetch("comanda_items", `comanda_id=eq.${comanda.id}&select=*`);
    const insufficient = (details || []).some(detail => {
      const product = productos.find(item => item.id === detail.producto_id);
      return !product || Number(product.stock) < Number(detail.cantidad);
    });
    if (insufficient) {
      setMessage("Stock insuficiente para despachar esta comanda.");
      setBusy(false);
      return;
    }
    const results = [];
    for (const detail of details || []) {
      const product = productos.find(item => item.id === detail.producto_id);
      const newStock = Number(product.stock) - Number(detail.cantidad);
      const stockOk = await localUpdate("productos", { id: product.id }, { stock: newStock });
      const movOk = await localInsert("movimientos_inventario", {
        id: uid(), negocio_id: negocio.id, turno_id: turno.id, producto_id: product.id,
        tipo: "venta", cantidad: -Number(detail.cantidad), motivo: `Comanda ${comanda.id}`,
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
        {message && <div style={{ color: message.startsWith("✓") ? C.green : C.red, fontSize: 12, marginBottom: 10 }}>{message}</div>}
        {!turno && <p style={{ color: C.sub, fontSize: 13 }}>No hay turno abierto.</p>}
        {turno && comandas.length === 0 && <p style={{ color: C.sub, fontSize: 13 }}>Sin comandas en este turno.</p>}
        {comandas.map(comanda => (
          <div key={comanda.id} className="waiter-order-row">
            {(() => {
              const stockCheck = getStockCheck(comanda);
              const hasInsufficientStock = stockCheck.length > 0 && stockCheck.some(item => !item.available);
              return (
                <>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>Comanda #{comanda.consecutivo || "—"}</div>
              <div style={{ color: C.text2, fontSize: 12 }}>Mesero: {comanda.mesero_nombre || comanda.mesero_id}</div>
              <div style={{ color: C.sub, fontSize: 11 }}>{new Date(comanda.creado_en).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
            </div>
            <Badge color={STATUS_COLOR[comanda.estado] || C.sub} small>{STATUS_LABEL[comanda.estado] || comanda.estado}</Badge>
            <strong style={{ color: C.green, fontSize: 13 }}>{COP(comanda.total)}</strong>
            <button style={{ ...s.btn("ghost"), padding: "6px 10px" }} type="button" disabled={busy} onClick={() => toggleDetails(comanda)}>
              {expandedId === comanda.id ? "Ocultar productos" : "Ver productos"}
            </button>
            {expandedId === comanda.id && hasInsufficientStock && <Badge color={C.red} small>Stock insuficiente</Badge>}
            {comanda.estado === "enviada" && <button style={{ ...s.btn("success"), padding: "6px 10px" }} type="button" disabled={busy || hasInsufficientStock} onClick={() => dispatch(comanda)}>Autorizar y entregar</button>}
            {expandedId === comanda.id && (
              <div style={{ flexBasis: "100%", marginTop: 8, padding: "8px 10px", borderRadius: 8, background: C.surface, border: `1px solid ${C.border}` }}>
                <div style={{ color: C.sub, fontSize: 11, marginBottom: 6 }}>Comparación contra el inventario actual</div>
                {stockCheck.map(item => (
                  <div key={item.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto", alignItems: "center", gap: 8, fontSize: 12, padding: "5px 0", borderBottom: `1px solid ${C.border}50` }}>
                    <span>{item.nombre}</span>
                    <span style={{ color: item.available ? C.green : C.red, whiteSpace: "nowrap" }}>
                      Pide {item.requested} · Stock {item.stock}
                    </span>
                    <strong style={{ color: C.green }}>{COP(item.requested * Number(item.precio_unitario))}</strong>
                  </div>
                ))}
                {hasInsufficientStock && <div style={{ color: C.red, fontSize: 11, marginTop: 7 }}>No se puede autorizar hasta registrar entrada o ajustar el pedido.</div>}
              </div>
            )}
                </>
              );
            })()}
          </div>
        ))}
      </div>
    </div>
  );
}
