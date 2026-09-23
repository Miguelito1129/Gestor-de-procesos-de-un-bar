import { useEffect, useMemo, useState } from "react";
import { C, s } from "../../constants/theme.js";
import { localDelete, localFetch, localInsert, localUpdate } from "../../lib/localApi.js";
import { uid } from "../../utils/helpers.js";
import { Badge, SectionTitle } from "../common/index.jsx";

const EMPTY_FORM = {
  nombre: "",
  tipo: "2x1",
  producto_principal_id: "",
  producto_cortesia_id: "",
  cantidad_compra: "2",
  cantidad_cortesia: "1",
  precio_promocional: "",
};
const COURTESY_NAMES = ["agua", "gatorade", "gaseosa"];

const promotionDescription = (promotion, names) => {
  const main = names.get(promotion.producto_principal_id) || "Producto eliminado";
  if (promotion.tipo === "2x1") return `Lleva ${promotion.cantidad_compra || 2} de ${main} y paga 1.`;
  if (promotion.tipo === "precio_especial") return `${main} por precio especial de $${Number(promotion.precio_promocional || 0).toLocaleString("es-CO")}.`;
  if (promotion.tipo === "combo") {
    const comboItems = Array.isArray(promotion.productos_combo)
      ? promotion.productos_combo
      : (() => {
        try { return JSON.parse(promotion.productos_combo || "[]"); } catch { return []; }
      })();
    return comboItems.map(item => `${item.cantidad} × ${names.get(item.producto_id) || "Producto eliminado"}`).join(" + ");
  }
  const gift = names.get(promotion.producto_cortesia_id) || "producto de cortesía";
  return `Por cada ${main}, entrega ${promotion.cantidad_cortesia || 1} ${gift}.`;
};

export default function Promociones({ negocio }) {
  const [promociones, setPromociones] = useState([]);
  const [productos, setProductos] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [comboItems, setComboItems] = useState([{ producto_id: "", cantidad: "1" }, { producto_id: "", cantidad: "1" }]);

  const productNames = useMemo(() => new Map(productos.map(product => [product.id, product.name])), [productos]);

  const load = async () => {
    setLoading(true);
    const [promoRows, productRows] = await Promise.all([
      localFetch("promociones", `negocio_id=eq.${negocio.id}&select=*&order=created_at.desc`),
      localFetch("productos", `negocio_id=eq.${negocio.id}&select=id,name,stock&order=name.asc`),
    ]);
    setPromociones(promoRows || []);
    setProductos(productRows || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [negocio.id]);

  const save = async event => {
    event.preventDefault();
    const requiredGift = form.tipo === "cortesia";
    const normalizedCombo = comboItems
      .filter(item => item.producto_id)
      .map(item => ({ producto_id: item.producto_id, cantidad: Math.max(1, Number(item.cantidad) || 1) }));
    const mainProduct = form.tipo === "combo" ? normalizedCombo[0]?.producto_id : form.producto_principal_id;
    const comboHasDuplicate = new Set(normalizedCombo.map(item => item.producto_id)).size !== normalizedCombo.length;
    const comboPrice = Number(form.precio_promocional);
    if (!form.nombre.trim() || !mainProduct || (requiredGift && !form.producto_cortesia_id) || (form.tipo === "combo" && (normalizedCombo.length < 2 || comboHasDuplicate || !Number.isFinite(comboPrice) || comboPrice < 0)) || (form.tipo === "precio_especial" && (!Number.isFinite(comboPrice) || comboPrice < 0))) {
      setMessage(form.tipo === "combo" && comboHasDuplicate
        ? "Un combo debe tener productos diferentes."
        : "Completa el nombre, selecciona al menos dos productos diferentes y define el precio del combo.");
      return;
    }
    const quantity = Math.max(2, Number(form.cantidad_compra) || 2);
    const giftQuantity = Math.max(1, Number(form.cantidad_cortesia) || 1);
    const payload = {
      id: uid(), negocio_id: negocio.id, nombre: form.nombre.trim(), tipo: form.tipo,
      producto_principal_id: mainProduct,
      producto_cortesia_id: requiredGift ? form.producto_cortesia_id : null,
      cantidad_compra: quantity, cantidad_cortesia: giftQuantity, activo: true,
    };
    if (form.tipo === "combo") payload.productos_combo = normalizedCombo;
    if (["combo", "precio_especial"].includes(form.tipo)) payload.precio_promocional = Math.max(0, Number(form.precio_promocional) || 0);
    const saved = await localInsert("promociones", payload);
    if (!saved) { setMessage("No fue posible crear la promoción."); return; }
    setForm(EMPTY_FORM);
    setComboItems([{ producto_id: "", cantidad: "1" }, { producto_id: "", cantidad: "1" }]);
    setShowForm(false);
    setMessage("✓ Promoción creada y activa.");
    load();
  };

  const toggle = async promotion => {
    const activo = !promotion.activo;
    const saved = await localUpdate("promociones", { id: promotion.id }, { activo });
    if (!saved) { setMessage("No fue posible actualizar la promoción."); return; }
    setPromociones(current => current.map(item => item.id === promotion.id ? { ...item, activo } : item));
  };

  const remove = async promotion => {
    if (!window.confirm(`¿Eliminar la promoción “${promotion.nombre}”? Esta acción no se puede deshacer.`)) return;
    const deleted = await localDelete("promociones", { id: promotion.id });
    if (!deleted) { setMessage("No fue posible eliminar la promoción."); return; }
    setPromociones(current => current.filter(item => item.id !== promotion.id));
  };

  return (
    <div>
      <SectionTitle>🏷️ Promociones — {negocio.name}</SectionTitle>
      <p style={{ color: C.sub, fontSize: 13, marginTop: -10, marginBottom: 16 }}>
        Define descuentos y cortesías. Las promociones activas se aplican al momento de despachar la comanda.
      </p>

      <div className="promotion-help">
        <span>2×1</span><p>Descuenta dos unidades del inventario y cobra una.</p>
        <span>🎁 Cortesía</span><p>Solo Agua, Gatorade o Gaseosa; se descuenta al despachar.</p>
        <span>Combo</span><p>Combina varias cantidades de productos con un precio único.</p>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <Badge color={C.green} small>{promociones.filter(item => item.activo).length} activas</Badge>
        <button type="button" style={s.btn("primary")} onClick={() => { setShowForm(value => !value); setMessage(""); }}>
          {showForm ? "Cancelar" : "＋ Nueva promoción"}
        </button>
      </div>

      {showForm && (
        <form className="promotion-form" onSubmit={save}>
          <div>
            <label style={s.label}>Nombre visible</label>
            <input style={s.inp} value={form.nombre} placeholder="Ej.: 2×1 Cervezas viernes" onChange={event => setForm(current => ({ ...current, nombre: event.target.value }))} />
          </div>
          <div>
            <label style={s.label}>Tipo</label>
            <select style={s.sel} value={form.tipo} onChange={event => setForm(current => ({ ...current, tipo: event.target.value }))}>
              <option value="2x1">2 × 1</option>
              <option value="cortesia">Producto + cortesía</option>
              <option value="precio_especial">Precio especial</option>
              <option value="combo">Combo</option>
            </select>
          </div>
          {form.tipo !== "combo" && <div>
            <label style={s.label}>Producto principal</label>
            <select style={s.sel} value={form.producto_principal_id} onChange={event => setForm(current => ({ ...current, producto_principal_id: event.target.value }))}>
              <option value="">Seleccionar producto</option>
              {productos.map(product => <option key={product.id} value={product.id}>{product.name} · stock {product.stock}</option>)}
            </select>
          </div>}
          {form.tipo === "2x1" ? (
            <div>
              <label style={s.label}>Unidades que salen</label>
              <input style={s.inp} type="number" min="2" value={form.cantidad_compra} onChange={event => setForm(current => ({ ...current, cantidad_compra: event.target.value }))} />
            </div>
          ) : form.tipo === "cortesia" ? <>
            <div>
              <label style={s.label}>Producto de cortesía</label>
              <select style={s.sel} value={form.producto_cortesia_id} onChange={event => setForm(current => ({ ...current, producto_cortesia_id: event.target.value }))}>
                <option value="">Seleccionar cortesía</option>
                {productos.filter(product => product.id !== form.producto_principal_id && COURTESY_NAMES.some(name => product.name.toLowerCase().includes(name))).map(product => <option key={product.id} value={product.id}>{product.name} · stock {product.stock}</option>)}
              </select>
            </div>
            <div>
              <label style={s.label}>Unidades de cortesía</label>
              <input style={s.inp} type="number" min="1" value={form.cantidad_cortesia} onChange={event => setForm(current => ({ ...current, cantidad_cortesia: event.target.value }))} />
            </div>
          </> : form.tipo === "precio_especial" ? <div>
            <label style={s.label}>Precio promocional</label>
            <input style={s.inp} type="number" min="0" value={form.precio_promocional} onChange={event => setForm(current => ({ ...current, precio_promocional: event.target.value }))} />
          </div> : <div className="promotion-combo-builder">
            <div style={s.label}>Productos y cantidades del combo</div>
            {comboItems.map((item, index) => <div key={index} className="promotion-combo-row">
              <select style={s.sel} value={item.producto_id} onChange={event => setComboItems(current => current.map((row, rowIndex) => rowIndex === index ? { ...row, producto_id: event.target.value } : row))}>
                <option value="">Producto</option>{productos.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}
              </select>
              <input style={s.inp} type="number" min="1" value={item.cantidad} onChange={event => setComboItems(current => current.map((row, rowIndex) => rowIndex === index ? { ...row, cantidad: event.target.value } : row))} />
              {comboItems.length > 2 && <button type="button" onClick={() => setComboItems(current => current.filter((_, rowIndex) => rowIndex !== index))}>×</button>}
            </div>)}
            <button type="button" className="promotion-add-row" onClick={() => setComboItems(current => [...current, { producto_id: "", cantidad: "1" }])}>+ Agregar producto</button>
          </div>}
          {form.tipo === "combo" && <div>
            <label style={s.label}>Precio del combo</label>
            <input style={s.inp} type="number" min="0" value={form.precio_promocional} onChange={event => setForm(current => ({ ...current, precio_promocional: event.target.value }))} />
          </div>}
          <button style={{ ...s.btn("success"), alignSelf: "end" }} type="submit">Guardar promoción</button>
        </form>
      )}

      {message && <div style={{ color: message.startsWith("✓") ? C.green : C.red, fontSize: 12, marginBottom: 10 }}>{message}</div>}
      {loading ? <p style={{ color: C.sub, fontSize: 13 }}>Cargando promociones...</p> : promociones.length === 0 ? (
        <div style={{ ...s.card, color: C.sub, textAlign: "center", fontSize: 13 }}>Aún no hay promociones configuradas.</div>
      ) : <div className="promotion-list">
        {promociones.map(promotion => (
          <article key={promotion.id} className={`promotion-card ${promotion.activo ? "is-active" : ""}`}>
            <div className="promotion-card__top">
              <div><strong>{promotion.tipo === "2x1" ? "2×1" : promotion.tipo === "cortesia" ? "🎁 Cortesía" : promotion.tipo === "combo" ? "🍻 Combo" : "🏷️ Precio especial"}</strong><h3>{promotion.nombre}</h3></div>
              <Badge color={promotion.activo ? C.green : C.muted} small>{promotion.activo ? "Activa" : "Inactiva"}</Badge>
            </div>
            <p>{promotionDescription(promotion, productNames)}{["combo", "precio_especial"].includes(promotion.tipo) && <><br /><b>Precio: ${Number(promotion.precio_promocional || 0).toLocaleString("es-CO")}</b></>}</p>
            <div className="promotion-card__actions">
              <button type="button" onClick={() => toggle(promotion)}>{promotion.activo ? "Pausar" : "Activar"}</button>
              <button type="button" className="is-danger" onClick={() => remove(promotion)}>Eliminar</button>
            </div>
          </article>
        ))}
      </div>}
    </div>
  );
}
