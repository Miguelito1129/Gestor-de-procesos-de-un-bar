import { useEffect, useMemo, useState } from "react";
import { C, s, COP, NOW_TIME } from "../../constants/theme.js";
import { localFetch, localInsert } from "../../lib/localApi.js";
import { uid } from "../../utils/helpers.js";
import { useAuth } from "../../hooks/useAuth.jsx";
import { Badge, SectionTitle } from "../common/index.jsx";

export default function AbrirTurno({ negocio, onOpened }) {
  const { user, users } = useAuth();
  const [modo, setModo] = useState(negocio.tipo === "cantina" ? "cantina" : "discoteca");
  const [baseCaja, setBaseCaja] = useState("");
  const [staff, setStaff] = useState([]);
  const [products, setProducts] = useState([]);
  const [counts, setCounts] = useState({});
  const [responsables, setResponsables] = useState({ barra: "", meseros: [] });
  const [novedades, setNovedades] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const [staffRows, productRows] = await Promise.all([
        localFetch("staff", `negocio_id=eq.${negocio.id}&activo=eq.true&select=*&order=name.asc`),
        localFetch("productos", `negocio_id=eq.${negocio.id}&select=*&order=name.asc`),
      ]);
      if (!active) return;
      const storedStaff = staffRows || [];
      const assignedUsers = (users || [])
        .filter(account => Array.isArray(account.negocios)
          ? account.negocios.includes(negocio.id)
          : account.negocios === "all")
        .filter(account => account.role === "barra" || account.role === "mesero")
        .map(account => ({
          id: account.id,
          negocio_id: negocio.id,
          name: account.name,
          rol: account.role,
          pay: account.role === "mesero" ? "5%" : "3%",
          activo: true,
        }));
      const combined = [...storedStaff];
      assignedUsers.forEach(account => {
        if (!combined.some(person => person.id === account.id)) combined.push(account);
      });
      setStaff(combined);
      setProducts(productRows || []);
      setCounts(Object.fromEntries((productRows || []).map(product => [product.id, product.stock || 0])));
      const currentBar = combined.find(person => person.id === user?.id && person.rol === "barra");
      if (currentBar) setResponsables(current => ({ ...current, barra: currentBar.id }));
    })();
    return () => { active = false; };
  }, [negocio.id, users, user?.id]);

  const barras = staff.filter(person => person.rol === "barra");
  const meseros = staff.filter(person => person.rol === "mesero");
  const countedProducts = useMemo(() => products.map(product => ({
    producto_id: product.id,
    nombre: product.name,
    cantidad: Number(counts[product.id] || 0),
  })), [products, counts]);

  const toggleMesero = id => setResponsables(current => ({
    ...current,
    meseros: current.meseros.includes(id)
      ? current.meseros.filter(item => item !== id)
      : [...current.meseros, id],
  }));

  const openShift = async () => {
    if (busy) return;
    const cash = Number(baseCaja);
    if (!Number.isFinite(cash) || cash < 0) {
      setMessage("Ingresa una base de caja válida.");
      return;
    }
    if (!responsables.barra || !responsables.meseros.length) {
      setMessage("Selecciona un responsable de barra y al menos un mesero.");
      return;
    }
    setBusy(true);
    setMessage("");
    const existing = await localFetch("turnos", `negocio_id=eq.${negocio.id}&estado=eq.abierto&select=id&limit=1`);
    if (existing?.length) {
      setMessage("Ya existe un turno abierto para este negocio.");
      setBusy(false);
      return;
    }
    const id = uid();
    const selectedStaff = staff.filter(person =>
      person.id === responsables.barra || responsables.meseros.includes(person.id));
    const staffSaved = await localInsert("staff", selectedStaff.map(person => ({
      id: person.id,
      negocio_id: negocio.id,
      name: person.name,
      rol: person.rol,
      pay: person.pay || (person.rol === "mesero" ? "5%" : "3%"),
      activo: true,
    })));
    if (!staffSaved) {
      setMessage("No fue posible guardar los responsables del turno.");
      setBusy(false);
      return;
    }
    const created = await localInsert("turnos", {
      id,
      negocio_id: negocio.id,
      modo_operacion: modo,
      base_caja: cash,
      estado: "abierto",
      inventario_apertura: countedProducts,
      novedades_apertura: novedades.trim() || null,
      abierto_por: user?.id || null,
      barra_id: responsables.barra,
      meseros_ids: responsables.meseros,
    });
    if (!created) {
      setMessage("No fue posible abrir el turno. Verifica la conexión y permisos.");
      setBusy(false);
      return;
    }
    const movements = countedProducts.filter(item => item.cantidad > 0).map(item => ({
      id: uid(),
      negocio_id: negocio.id,
      turno_id: id,
      producto_id: item.producto_id,
      tipo: "apertura",
      cantidad: item.cantidad,
      motivo: "Conteo físico de apertura",
      creado_por: user?.id || null,
    }));
    if (movements.length) await localInsert("movimientos_inventario", movements);
    setMessage(`✓ Turno abierto a las ${NOW_TIME()}. Barra y meseros ya pueden operar.`);
    if (onOpened) onOpened();
    setBusy(false);
  };

  return (
    <div>
      <SectionTitle>🟢 Abrir turno — {negocio.name}</SectionTitle>
      <div style={{ ...s.card, maxWidth: 900 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <div style={s.label}>Modo de operación</div>
            <select style={s.sel} value={modo} onChange={event => setModo(event.target.value)}>
              <option value="discoteca">Discoteca — pago por comanda</option>
              <option value="cantina">Cantina — cuenta acumulada por mesa</option>
            </select>
          </div>
          <div>
            <div style={s.label}>Base de caja</div>
            <input style={s.inp} type="number" min="0" value={baseCaja} onChange={event => setBaseCaja(event.target.value)} placeholder="Ej. 200000" />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 18 }}>
          <div>
            <div style={s.label}>Responsable de barra</div>
            {barras.map(person => (
              <label key={person.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "7px 0", fontSize: 13 }}>
                <input type="radio" name="barra" checked={responsables.barra === person.id} onChange={() => setResponsables(current => ({ ...current, barra: person.id }))} />
                {person.name}<Badge color={C.amber} small>barra</Badge>
              </label>
            ))}
            {!barras.length && <div style={{ color: C.red, fontSize: 12 }}>No hay personal de barra activo.</div>}
          </div>
          <div>
            <div style={s.label}>Meseros del turno</div>
            {meseros.map(person => (
              <label key={person.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "7px 0", fontSize: 13 }}>
                <input type="checkbox" checked={responsables.meseros.includes(person.id)} onChange={() => toggleMesero(person.id)} />
                {person.name}
              </label>
            ))}
            {!meseros.length && <div style={{ color: C.red, fontSize: 12 }}>No hay meseros activos.</div>}
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <div style={s.label}>Conteo físico de inventario inicial</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 8 }}>
            {products.map(product => (
              <label key={product.id} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 8, fontSize: 12 }}>
                <div style={{ marginBottom: 5 }}>{product.name}</div>
                <input style={s.inp} type="number" min="0" value={counts[product.id] ?? ""} onChange={event => setCounts(current => ({ ...current, [product.id]: event.target.value }))} placeholder={`Stock actual: ${product.stock || 0}`} />
              </label>
            ))}
          </div>
          {!products.length && <div style={{ color: C.sub, fontSize: 12 }}>No hay productos cargados para contar.</div>}
        </div>

        <div style={{ marginTop: 18 }}>
          <div style={s.label}>Novedades de apertura</div>
          <textarea style={{ ...s.inp, minHeight: 70, resize: "vertical" }} value={novedades} onChange={event => setNovedades(event.target.value)} placeholder="Presentación del personal, equipos o novedades..." />
        </div>

        {message && <div style={{ color: message.startsWith("✓") ? C.green : C.red, fontSize: 12, marginTop: 12 }}>{message}</div>}
        <button style={{ ...s.btn("primary"), marginTop: 16 }} type="button" disabled={busy} onClick={openShift}>
          {busy ? "Abriendo turno..." : `Abrir turno (${COP(Number(baseCaja) || 0)})`}
        </button>
      </div>
    </div>
  );
}
