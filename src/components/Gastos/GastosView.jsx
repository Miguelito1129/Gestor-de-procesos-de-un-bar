import { useCallback, useEffect, useMemo, useState } from "react";
import { C, s, COP } from "../../constants/theme.js";
import { CAT_COLORS as PRODUCT_CATEGORIES } from "../../constants/roles.js";
import { uid } from "../../utils/helpers.js";
import { localFetch, localFetchOrThrow, localInsert, localDelete, localRegisterSupplyExpense } from "../../lib/localApi.js";
import { Badge } from "../common/index.jsx";
import UploadGasto from "../common/UploadGasto.jsx";

const CATS = ['Insumos','Nómina','Mantenimiento','Servicios','Proveedores','Arriendo','Comisión','CxC','Otros'];
const CAT_COLORS = { Insumos:C.indigo, Nómina:C.green, Mantenimiento:C.amber, Servicios:C.purple, Proveedores:C.cyan, Arriendo:C.red, Comisión:'#ec4899', CxC:C.red, Otros:C.sub };
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

function getClosedExpenseIds(businessId) {
  try {
    const closures = JSON.parse(localStorage.getItem("gesbar_cierres_v2") || "{}");
    return new Set((closures[businessId] || []).flatMap(closure => closure.gastoIds || []));
  } catch (error) {
    console.error("No fue posible leer los cierres guardados:", error);
    return new Set();
  }
}

export default function GastosView({ negocio, onUpdateNegocio }) {
  const [gastos, setGastos] = useState([]);
  const [productos, setProductos] = useState([]);
  const [supplyLoading, setSupplyLoading] = useState(true);
  const [supplyError, setSupplyError] = useState("");
  const [turnoAbierto, setTurnoAbierto] = useState(false);
  const [closedExpenseIds, setClosedExpenseIds] = useState(() => getClosedExpenseIds(negocio.id));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [receipt, setReceipt] = useState(null);
  const [form, setForm] = useState({ desc: "", monto: "", cat: "Insumos", fecha: today() });
  const [supplyItems, setSupplyItems] = useState(() => [{
    id: uid(),
    mode: "existing",
    productId: "",
    quantity: "1",
    costoUnitario: "",
    newProduct: { name: "", cat: "Bebida", price: "", min: "0" },
  }]);
  const [filters, setFilters] = useState({ search: "", cat: "Todas", desde: "", hasta: "", cierre: "todos" });

  const loadExpenses = useCallback(async () => {
    setLoading(true);
    setError("");
    const data = await localFetch("gastos", `negocio_id=eq.${encodeURIComponent(negocio.id)}&order=fecha.desc&select=*`);
    if (!data) {
      setError("No fue posible cargar los gastos. Revisa que el servidor local esté funcionando e inténtalo de nuevo.");
      setLoading(false);
      return;
    }
    setGastos(data.map(gasto => ({
      ...gasto,
      fecha: gasto.fecha || "",
      desc: gasto.desc || gasto.descripcion || "",
      monto: Number(gasto.monto) || 0,
      cat: gasto.cat || "Otros",
      insumos_detalle: Array.isArray(gasto.insumos_detalle) ? gasto.insumos_detalle : [],
    })));
    setClosedExpenseIds(getClosedExpenseIds(negocio.id));
    setLoading(false);
  }, [negocio.id]);

  useEffect(() => { loadExpenses(); }, [loadExpenses]);

  useEffect(() => {
    let active = true;
    let refreshTimer;
    const refreshSupplyData = async () => {
      try {
        const [inventory, openTurns] = await Promise.all([
          localFetchOrThrow("productos", `negocio_id=eq.${encodeURIComponent(negocio.id)}&select=id,name,cat,price,stock,min&order=name.asc`),
          localFetchOrThrow("turnos", `negocio_id=eq.${encodeURIComponent(negocio.id)}&estado=eq.abierto&select=id&limit=1`),
        ]);
        if (!Array.isArray(inventory) || !Array.isArray(openTurns)) {
          throw new Error("La respuesta del inventario o los turnos no es válida.");
        }
        if (active) {
          setProductos(inventory);
          setTurnoAbierto(openTurns.length > 0);
          setSupplyError("");
          setSupplyLoading(false);
        }
      } catch (loadError) {
        console.error("No fue posible cargar el inventario para el registro de insumos:", loadError);
        if (active) {
          setSupplyError(loadError.message || "No fue posible verificar el inventario y el turno.");
          setSupplyLoading(false);
        }
      } finally {
        if (active) refreshTimer = window.setTimeout(refreshSupplyData, 3000);
      }
    };
    setSupplyLoading(true);
    setSupplyError("");
    void refreshSupplyData();
    return () => {
      active = false;
      if (refreshTimer) window.clearTimeout(refreshTimer);
    };
  }, [negocio.id]);

  const filteredExpenses = useMemo(() => {
    const search = filters.search.trim().toLocaleLowerCase("es");
    return gastos.filter(gasto => {
      const isClosed = closedExpenseIds.has(gasto.id);
      return (!search || `${gasto.desc} ${gasto.cat}`.toLocaleLowerCase("es").includes(search))
        && (filters.cat === "Todas" || gasto.cat === filters.cat)
        && (!filters.desde || gasto.fecha >= filters.desde)
        && (!filters.hasta || gasto.fecha <= filters.hasta)
        && (filters.cierre === "todos" || (filters.cierre === "incluidos" ? isClosed : !isClosed));
    });
  }, [gastos, filters, closedExpenseIds]);

  const filteredTotal = useMemo(() => filteredExpenses.reduce((total, gasto) => total + gasto.monto, 0), [filteredExpenses]);
  const categoryTotals = useMemo(() => CATS
    .map(cat => ({ cat, total: filteredExpenses.filter(gasto => gasto.cat === cat).reduce((sum, gasto) => sum + gasto.monto, 0) }))
    .filter(item => item.total > 0), [filteredExpenses]);

  const isSupplyExpense = form.cat === "Insumos";
  const calculatedSupplyTotal = supplyItems.reduce((total, item) => {
    const quantity = Number(item.quantity);
    const unitCost = Number(item.costoUnitario);
    const lineTotal = quantity * unitCost;
    const nextTotal = total + lineTotal;
    return Number.isSafeInteger(quantity) && quantity > 0 && Number.isSafeInteger(unitCost) && unitCost >= 0
      && Number.isSafeInteger(lineTotal) && Number.isSafeInteger(nextTotal)
      ? nextTotal
      : Number.NaN;
  }, 0);

  const saveManualExpense = async event => {
    event.preventDefault();
    const amount = isSupplyExpense ? calculatedSupplyTotal : Number(form.monto);
    const isSupply = isSupplyExpense;
    if ((!form.desc.trim() && !isSupply) || !Number.isSafeInteger(amount) || amount <= 0 || !form.fecha || saving) {
      setError("Completa una descripción (salvo que registres insumos), fecha y monto entero mayor que cero.");
      return;
    }
    if (isSupply && (supplyLoading || supplyError || turnoAbierto)) {
      setError(turnoAbierto
        ? "Cierra el turno abierto antes de aumentar existencias desde Gastos. Durante el turno, los ajustes se hacen desde la planilla."
        : supplyError || "Espera a que termine la verificación del inventario.");
      return;
    }
    const resolvedSupplyItems = [];
    if (isSupply) {
      if (!supplyItems.length) {
        setError("Agrega al menos un producto al ingreso de insumos.");
        return;
      }
      for (const item of supplyItems) {
        const productQuantity = Number(item.quantity);
        if (!Number.isSafeInteger(productQuantity) || productQuantity <= 0) {
          setError("Indica una cantidad entera mayor que cero para cada producto.");
          return;
        }
        const unitCost = Number(item.costoUnitario);
        if (item.costoUnitario === "" || !Number.isSafeInteger(unitCost) || unitCost < 0) {
          setError("Indica el costo unitario de compra de cada producto.");
          return;
        }
        if (item.mode === "existing") {
          const selectedProduct = productos.find(product => String(product.id) === String(item.productId));
          if (!selectedProduct) {
            setError("Selecciona un producto válido del inventario en cada fila.");
            return;
          }
          resolvedSupplyItems.push({
            nombre: selectedProduct.name,
            payload: { producto_id: selectedProduct.id, cantidad: productQuantity, costo_unitario: unitCost },
          });
        } else {
          const product = item.newProduct;
          if (!product.name.trim() || product.name.trim().length > 120
            || !product.cat || product.price === "" || !Number.isSafeInteger(Number(product.price)) || Number(product.price) < 0
            || product.min === "" || !Number.isSafeInteger(Number(product.min)) || Number(product.min) < 0) {
            setError("Para cada producto nuevo, indica nombre, categoría, precio de venta y stock mínimo válido.");
            return;
          }
          resolvedSupplyItems.push({
            nombre: product.name.trim(),
            payload: {
              producto_nuevo: {
                id: uid(),
                name: product.name.trim(),
                cat: product.cat,
                price: Number(product.price),
                min: Number(product.min),
              },
              cantidad: productQuantity,
              costo_unitario: unitCost,
            },
          });
        }
      }
    }

    setSaving(true);
    setError("");
    setMessage("");
    const newExpense = {
      id: uid(),
      negocio_id: negocio.id,
      fecha: form.fecha,
      desc: form.desc.trim() || (isSupply
        ? `Compra de insumos: ${resolvedSupplyItems.map(item => `${item.nombre} x${item.payload.cantidad}`).join(", ")}`.slice(0, 160)
        : ""),
      monto: amount,
      cat: form.cat,
      foto_url: null,
      procesado: false,
      ...(isSupply ? {
        insumos_detalle: resolvedSupplyItems.map(item => ({
          nombre: item.nombre,
          cantidad: item.payload.cantidad,
          costo_unitario: item.payload.costo_unitario,
          subtotal: item.payload.cantidad * item.payload.costo_unitario,
        })),
      } : {}),
    };
    let savedProducts = [];
    try {
      if (isSupply) {
        const result = await localRegisterSupplyExpense({
          gasto: newExpense,
          productos: resolvedSupplyItems.map(item => item.payload),
        });
        if (!Array.isArray(result?.productos) || !result.gasto) throw new Error("El servidor no confirmó el registro del gasto y el inventario.");
        savedProducts = result.productos;
        setProductos(current => {
          const updated = new Map(current.map(product => [String(product.id), product]));
          savedProducts.forEach(product => updated.set(String(product.id), product));
          return [...updated.values()].sort((first, second) => String(first.name).localeCompare(String(second.name), "es"));
        });
        onUpdateNegocio({
          ...negocio,
          productos: (() => {
            const updated = new Map(negocio.productos.map(product => [String(product.id), product]));
            savedProducts.forEach(product => updated.set(String(product.id), product));
            return [...updated.values()];
          })(),
        });
      } else {
        const saved = await localInsert("gastos", newExpense);
        if (!saved) throw new Error("El servidor no guardó el gasto. Revisa la conexión e inténtalo de nuevo.");
      }
      setForm(current => ({ ...current, desc: "", monto: "" }));
      if (isSupply) {
        setSupplyItems([{
          id: uid(),
          mode: "existing",
          productId: "",
          quantity: "1",
          costoUnitario: "",
          newProduct: { name: "", cat: "Bebida", price: "", min: "0" },
        }]);
        setMessage(`Gasto guardado y se actualizaron las existencias de ${savedProducts.map(product => product.name).join(", ")}.`);
      } else {
        setMessage("Gasto guardado correctamente.");
      }
      await loadExpenses();
    } catch (saveError) {
      setError(saveError.message || "No fue posible guardar el gasto.");
    } finally {
      setSaving(false);
    }
  };

  const deleteExpense = async expense => {
    if (closedExpenseIds.has(expense.id)) {
      setError("Este gasto ya forma parte de un cierre semanal y no se puede borrar desde aquí.");
      return;
    }
    if (!window.confirm(`¿Eliminar el gasto “${expense.desc}” por ${COP(expense.monto)}?`)) return;
    setError("");
    setMessage("");
    const deleted = await localDelete("gastos", { id: expense.id });
    if (!deleted) {
      setError("No fue posible eliminar el gasto. Inténtalo de nuevo.");
      return;
    }
    setGastos(current => current.filter(item => item.id !== expense.id));
    setMessage("Gasto eliminado.");
  };

  return (
    <div className="expenses-page">
      <header className="expenses-hero">
        <div>
          <span className="expenses-hero__eyebrow">CONTROL FINANCIERO</span>
          <h1>Gastos</h1>
          <p>Registra, consulta y organiza los egresos de {negocio.name}.</p>
        </div>
        <div className="expenses-hero__total">
          <span>Total del resultado</span>
          <strong>{COP(filteredTotal)}</strong>
          <small>{filteredExpenses.length} {filteredExpenses.length === 1 ? "registro" : "registros"}</small>
        </div>
      </header>

      {(error || message) && (
        <div className={`expenses-notice${error ? " is-error" : " is-success"}`} role={error ? "alert" : "status"}>
          <span aria-hidden="true">{error ? "!" : "✓"}</span>{error || message}
          {error && <button type="button" onClick={() => setError("")} aria-label="Cerrar aviso">×</button>}
        </div>
      )}

      <div className="expenses-layout">
        <aside className="expenses-entry">
          <section className="expenses-panel">
            <div className="expenses-panel__heading">
              <span className="expenses-panel__icon">▧</span>
              <div><h2>Comprobante</h2><p>Adjunta una foto y registra sus datos.</p></div>
            </div>
            <UploadGasto negocio={negocio} onRegistered={async () => {
              setMessage("Gasto con comprobante guardado correctamente.");
              setError("");
              await loadExpenses();
            }} />
          </section>

          <form className="expenses-panel expenses-manual" onSubmit={saveManualExpense}>
            <div className="expenses-panel__heading">
              <span className="expenses-panel__icon expenses-panel__icon--amber">＋</span>
              <div><h2>Registro manual</h2><p>Guarda un egreso sin comprobante.</p></div>
            </div>
            <label className="expenses-field">
              <span>Descripción</span>
              <input style={s.inp} value={form.desc} maxLength={160} required={form.cat !== "Insumos"} placeholder={form.cat === "Insumos" ? "Opcional; se completa con el producto y la cantidad" : "Ej. Compra de hielo"} onChange={event => setForm(current => ({ ...current, desc: event.target.value }))} />
            </label>
            {form.cat === "Insumos" && (
              <div className="expenses-supply-fields">
                {supplyItems.map((item, index) => (
                  <div className="expenses-supply-item" key={item.id}>
                    <div className="expenses-supply-item__heading">
                      <strong>Producto {index + 1}</strong>
                      {supplyItems.length > 1 && (
                        <button type="button" className="expenses-supply-item__remove" disabled={saving} onClick={() => setSupplyItems(current => current.filter(supplyItem => supplyItem.id !== item.id))}>
                          Quitar
                        </button>
                      )}
                    </div>
                    <div className="expenses-field">
                      <span>Tipo de producto</span>
                      <div className="expenses-supply-mode" role="group" aria-label={`Tipo del producto ${index + 1}`}>
                        <button type="button" disabled={saving} className={item.mode === "existing" ? "is-active" : ""} onClick={() => setSupplyItems(current => current.map(supplyItem => supplyItem.id === item.id ? { ...supplyItem, mode: "existing" } : supplyItem))}>Del inventario</button>
                        <button type="button" disabled={saving} className={item.mode === "new" ? "is-active" : ""} onClick={() => setSupplyItems(current => current.map(supplyItem => supplyItem.id === item.id ? { ...supplyItem, mode: "new" } : supplyItem))}>Producto nuevo</button>
                      </div>
                    </div>
                    {item.mode === "existing" ? (
                      <label className="expenses-field">
                        <span>Selecciona del inventario</span>
                        <select style={s.sel} value={item.productId} disabled={saving || supplyLoading || Boolean(supplyError) || turnoAbierto} onChange={event => setSupplyItems(current => current.map(supplyItem => supplyItem.id === item.id ? { ...supplyItem, productId: event.target.value } : supplyItem))}>
                          <option value="">{supplyLoading ? "Cargando inventario…" : "Selecciona un producto"}</option>
                          {productos.map(product => (
                            <option key={product.id} value={product.id}>{product.name} · existencias {Number(product.stock) || 0}</option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <>
                        <label className="expenses-field">
                          <span>Nombre del producto nuevo</span>
                          <input style={s.inp} value={item.newProduct.name} maxLength={120} placeholder="Ej. Hielo en bolsa" disabled={saving || supplyLoading || Boolean(supplyError) || turnoAbierto} onChange={event => setSupplyItems(current => current.map(supplyItem => supplyItem.id === item.id ? { ...supplyItem, newProduct: { ...supplyItem.newProduct, name: event.target.value } } : supplyItem))} />
                        </label>
                        <div className="expenses-field-row">
                          <label className="expenses-field">
                            <span>Categoría del producto</span>
                            <select style={s.sel} value={item.newProduct.cat} disabled={saving || supplyLoading || Boolean(supplyError) || turnoAbierto} onChange={event => setSupplyItems(current => current.map(supplyItem => supplyItem.id === item.id ? { ...supplyItem, newProduct: { ...supplyItem.newProduct, cat: event.target.value } } : supplyItem))}>
                              {Object.keys(PRODUCT_CATEGORIES).map(category => <option key={category} value={category}>{category}</option>)}
                            </select>
                          </label>
                          <label className="expenses-field">
                            <span>Precio de venta (COP)</span>
                            <input style={s.inp} type="number" min="0" step="1" value={item.newProduct.price} placeholder="0" disabled={saving || supplyLoading || Boolean(supplyError) || turnoAbierto} onChange={event => setSupplyItems(current => current.map(supplyItem => supplyItem.id === item.id ? { ...supplyItem, newProduct: { ...supplyItem.newProduct, price: event.target.value } } : supplyItem))} />
                          </label>
                          <label className="expenses-field">
                            <span>Stock mínimo</span>
                            <input style={s.inp} type="number" min="0" step="1" value={item.newProduct.min} disabled={saving || supplyLoading || Boolean(supplyError) || turnoAbierto} onChange={event => setSupplyItems(current => current.map(supplyItem => supplyItem.id === item.id ? { ...supplyItem, newProduct: { ...supplyItem.newProduct, min: event.target.value } } : supplyItem))} />
                          </label>
                        </div>
                      </>
                    )}
                    <div className="expenses-field-row">
                      <label className="expenses-field">
                        <span>Cantidad que ingresa al inventario</span>
                        <input style={s.inp} type="number" min="1" step="1" value={item.quantity} disabled={saving || supplyLoading || Boolean(supplyError) || turnoAbierto} onChange={event => setSupplyItems(current => current.map(supplyItem => supplyItem.id === item.id ? { ...supplyItem, quantity: event.target.value } : supplyItem))} />
                      </label>
                      <label className="expenses-field">
                        <span>Costo unitario de compra (COP)</span>
                        <input style={s.inp} type="number" min="0" step="1" value={item.costoUnitario} placeholder="0" disabled={saving || supplyLoading || Boolean(supplyError) || turnoAbierto} onChange={event => setSupplyItems(current => current.map(supplyItem => supplyItem.id === item.id ? { ...supplyItem, costoUnitario: event.target.value } : supplyItem))} />
                      </label>
                    </div>
                    <div className="expenses-supply-item__subtotal">
                      Subtotal: {COP((Number(item.quantity) || 0) * (Number(item.costoUnitario) || 0))}
                    </div>
                  </div>
                ))}
                <button type="button" className="expenses-supply-add" disabled={saving || supplyLoading || Boolean(supplyError) || turnoAbierto || supplyItems.length >= 100} onClick={() => setSupplyItems(current => [...current, {
                  id: uid(),
                  mode: "existing",
                  productId: "",
                  quantity: "1",
                  costoUnitario: "",
                  newProduct: { name: "", cat: "Bebida", price: "", min: "0" },
                }])}>
                  + Agregar otro producto
                </button>
                {turnoAbierto && <div className="expenses-supply-notice" role="status">Hay un turno abierto. Registra ajustes de existencias desde la planilla activa.</div>}
                {supplyError && <div className="expenses-supply-notice is-error" role="alert">No se puede registrar el insumo: {supplyError}</div>}
              </div>
            )}
            <div className="expenses-field-row">
              <label className="expenses-field">
                <span>Monto (COP)</span>
                <input
                  style={s.inp}
                  type="number"
                  min="1"
                  step="1"
                  value={isSupplyExpense ? calculatedSupplyTotal : form.monto}
                  placeholder="0"
                  readOnly={isSupplyExpense}
                  onChange={isSupplyExpense ? undefined : event => setForm(current => ({ ...current, monto: event.target.value }))}
                />
              </label>
              <label className="expenses-field">
                <span>Fecha</span>
                <input style={s.inp} type="date" value={form.fecha} onChange={event => setForm(current => ({ ...current, fecha: event.target.value }))} />
              </label>
            </div>
            <label className="expenses-field">
              <span>Categoría</span>
              <select style={s.sel} value={form.cat} onChange={event => setForm(current => ({ ...current, cat: event.target.value }))}>
                {CATS.map(category => <option key={category}>{category}</option>)}
              </select>
            </label>
            <button className="expenses-save-button" type="submit" disabled={saving || (form.cat === "Insumos" && (supplyLoading || Boolean(supplyError) || turnoAbierto))}>
              {saving ? "Guardando..." : "Guardar gasto"}
            </button>
          </form>

          <section className="expenses-panel expenses-categories">
            <div className="expenses-panel__heading">
              <span className="expenses-panel__icon expenses-panel__icon--violet">◷</span>
              <div><h2>Por categoría</h2><p>Según los filtros actuales.</p></div>
            </div>
            {categoryTotals.length ? categoryTotals.map(({ cat, total }) => (
              <div className="expenses-category-row" key={cat}>
                <Badge color={CAT_COLORS[cat] || C.muted} small>{cat}</Badge>
                <strong>{COP(total)}</strong>
              </div>
            )) : <p className="expenses-muted">No hay gastos para resumir.</p>}
            <div className="expenses-category-total"><span>TOTAL FILTRADO</span><strong>{COP(filteredTotal)}</strong></div>
          </section>
        </aside>

        <section className="expenses-panel expenses-history">
          <div className="expenses-history__heading">
            <div><h2>Registro de gastos</h2><p>Busca y filtra comprobantes y gastos guardados.</p></div>
            <span>{filteredExpenses.length} resultados</span>
          </div>
          <div className="expenses-filters">
            <label className="expenses-field expenses-filters__search">
              <span>Buscar</span>
              <input style={s.inp} value={filters.search} placeholder="Descripción o categoría" onChange={event => setFilters(current => ({ ...current, search: event.target.value }))} />
            </label>
            <label className="expenses-field">
              <span>Categoría</span>
              <select style={s.sel} value={filters.cat} onChange={event => setFilters(current => ({ ...current, cat: event.target.value }))}>
                <option>Todas</option>{CATS.map(category => <option key={category}>{category}</option>)}
              </select>
            </label>
            <label className="expenses-field">
              <span>Desde</span>
              <input style={s.inp} type="date" value={filters.desde} max={filters.hasta || undefined} onChange={event => setFilters(current => ({ ...current, desde: event.target.value }))} />
            </label>
            <label className="expenses-field">
              <span>Hasta</span>
              <input style={s.inp} type="date" value={filters.hasta} min={filters.desde || undefined} onChange={event => setFilters(current => ({ ...current, hasta: event.target.value }))} />
            </label>
            <label className="expenses-field">
              <span>Estado de cierre</span>
              <select style={s.sel} value={filters.cierre} onChange={event => setFilters(current => ({ ...current, cierre: event.target.value }))}>
                <option value="todos">Todos</option>
                <option value="pendientes">Sin cerrar</option>
                <option value="incluidos">Incluidos en cierre</option>
              </select>
            </label>
            <button className="expenses-clear-filters" type="button" onClick={() => setFilters({ search: "", cat: "Todas", desde: "", hasta: "", cierre: "todos" })}>
              Limpiar filtros
            </button>
          </div>

          {loading ? <div className="expenses-empty">Cargando registro...</div> : (
            <div className="expenses-table-wrap">
              <table className="expenses-table">
                <thead><tr><th>Fecha</th><th>Descripción</th><th>Categoría</th><th>Estado</th><th>Comprobante</th><th className="is-number">Monto</th><th aria-label="Acciones"/></tr></thead>
                <tbody>
                  {!filteredExpenses.length ? (
                    <tr><td className="expenses-empty" colSpan={7}>No hay gastos que coincidan con estos filtros.</td></tr>
                  ) : filteredExpenses.map(expense => {
                    const closed = closedExpenseIds.has(expense.id);
                    return (
                      <tr key={expense.id}>
                        <td>{expense.fecha}</td>
                        <td className="expenses-table__description">
                          {expense.desc}
                          {expense.insumos_detalle?.length > 0 && (
                            <ul className="expenses-table__supply-details">
                              {expense.insumos_detalle.map((item, index) => (
                                <li key={`${item.producto_id || item.nombre}-${index}`}>
                                  {item.nombre} · {item.cantidad} × {COP(item.costo_unitario)} = {COP(item.subtotal)}
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                        <td><Badge color={CAT_COLORS[expense.cat] || C.muted} small>{expense.cat}</Badge></td>
                        <td><span className={`expenses-status${closed ? " is-closed" : ""}`}><i/>{closed ? "En cierre" : "Pendiente"}</span></td>
                        <td>{expense.foto_url ? (
                          <button className="expenses-receipt" type="button" onClick={() => setReceipt({ src: expense.foto_url, desc: expense.desc })}>
                            ▧ Ver imagen
                          </button>
                        ) : <span className="expenses-muted">—</span>}</td>
                        <td className="is-number is-amount">{COP(expense.monto)}</td>
                        <td>
                          <button
                            className="expenses-delete"
                            type="button"
                            disabled={closed}
                            title={closed ? "Este gasto ya está incluido en un cierre" : "Eliminar gasto"}
                            aria-label={`Eliminar gasto: ${expense.desc}`}
                            onClick={() => deleteExpense(expense)}
                          >×</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {receipt && (
        <div className="expenses-receipt-modal" role="presentation" onClick={event => { if (event.target === event.currentTarget) setReceipt(null); }}>
          <section role="dialog" aria-modal="true" aria-label={`Comprobante: ${receipt.desc}`}>
            <header><strong>{receipt.desc}</strong><button type="button" onClick={() => setReceipt(null)} aria-label="Cerrar comprobante">×</button></header>
            <img src={receipt.src} alt={`Comprobante del gasto ${receipt.desc}`} />
          </section>
        </div>
      )}
    </div>
  );
}
