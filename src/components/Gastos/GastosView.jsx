import { useCallback, useEffect, useMemo, useState } from "react";
import { C, s, COP } from "../../constants/theme.js";
import { uid } from "../../utils/helpers.js";
import { localFetch, localInsert, localDelete } from "../../lib/localApi.js";
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

export default function GastosView({ negocio }) {
  const [gastos, setGastos] = useState([]);
  const [closedExpenseIds, setClosedExpenseIds] = useState(() => getClosedExpenseIds(negocio.id));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [receipt, setReceipt] = useState(null);
  const [form, setForm] = useState({ desc: "", monto: "", cat: "Insumos", fecha: today() });
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
    })));
    setClosedExpenseIds(getClosedExpenseIds(negocio.id));
    setLoading(false);
  }, [negocio.id]);

  useEffect(() => { loadExpenses(); }, [loadExpenses]);

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

  const saveManualExpense = async event => {
    event.preventDefault();
    const amount = Number(form.monto);
    if (!form.desc.trim() || !Number.isSafeInteger(amount) || amount <= 0 || !form.fecha || saving) {
      setError("Completa la descripción, una fecha y un monto entero mayor que cero.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    const newExpense = {
      id: uid(),
      negocio_id: negocio.id,
      fecha: form.fecha,
      desc: form.desc.trim(),
      monto: amount,
      cat: form.cat,
      foto_url: null,
      procesado: false,
    };
    try {
      const saved = await localInsert("gastos", newExpense);
      if (!saved) throw new Error("El servidor no guardó el gasto. Revisa la conexión e inténtalo de nuevo.");
      setForm(current => ({ ...current, desc: "", monto: "" }));
      setMessage("Gasto guardado correctamente.");
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
              <input style={s.inp} value={form.desc} maxLength={160} placeholder="Ej. Compra de hielo" onChange={event => setForm(current => ({ ...current, desc: event.target.value }))} />
            </label>
            <div className="expenses-field-row">
              <label className="expenses-field">
                <span>Monto (COP)</span>
                <input style={s.inp} type="number" min="1" step="1" value={form.monto} placeholder="0" onChange={event => setForm(current => ({ ...current, monto: event.target.value }))} />
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
            <button className="expenses-save-button" type="submit" disabled={saving}>
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
                        <td className="expenses-table__description">{expense.desc}</td>
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
