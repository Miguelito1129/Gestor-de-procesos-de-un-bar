import { useState, useEffect, useCallback, useRef } from "react";
import { C, s, COP, NOW_TIME, BILLETS } from "../../constants/theme.js";
import { ROL_COLORS, ROLES_LIST } from "../../constants/roles.js";
import { CAT_COLORS } from "../../constants/roles.js";
import { useAuth } from "../../hooks/useAuth.jsx";
import { localFetch, localFetchOrThrow, localUpdate, localDelete, localDeleteStaff, localInsert, localInsertDetailed, localUpdateTurnInventoryOpening } from "../../lib/localApi.js";
import { uid } from "../../utils/helpers.js";
import { formatLocalDateKey, formatLocalTime } from "../../utils/dateTime.js";
import { printPlanilla } from "../../utils/printPlanilla.js";
import { Badge, Metric, SectionTitle, TabBar, Modal } from "../common/index.jsx";
import { OrderPageTabs, visibleOrderPage } from "../Turnos/OrderPagination.jsx";
const r1000 = v => Math.round(v / 1000) * 1000; // redondear al millar más cercano
const COMANDA_STATUS = {
  enviada: ['Esperando autorización', C.amber],
  entregada_falta_pago: ['Entregado (pedido anterior)', C.amber],
  pagada: ['Pagado', C.green],
  cancelada: ['Cancelado', C.red],
};
const PLANILLA_ORDER_GROUPS = [
  { id: 'todos', title: 'Todos los pedidos', description: 'Todas las comandas registradas durante este turno.' },
  { id: 'enviada', title: 'Pendientes por autorizar', description: 'Pedidos que esperan revisión y autorización de Barra.' },
  { id: 'pagada', title: 'Pagados y entregados', description: 'Pedidos despachados; el medio de pago elegido quedó registrado.' },
  { id: 'cancelada', title: 'Cancelados', description: 'Pedidos cancelados; no cuentan como ventas.' },
  { id: 'otros', title: 'Otros estados', description: 'Pedidos con un estado diferente a los habituales.' },
];
const formatComandaTime = value => value
  ? formatLocalTime(value)
  : '—';
const planillaDateKey = value => {
  const date = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}/.test(date)) return date.slice(0, 10);
  const match = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return match
    ? `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
    : '';
};
const timestampDateKey = value => {
  return formatLocalDateKey(value);
};
const currentBogotaWeekRange = () => {
  const todayKey = formatLocalDateKey(new Date());
  if (!todayKey) return { start: '', end: '' };
  const [year, month, day] = todayKey.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, day));
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const dateKey = date => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  return { start: dateKey(start), end: dateKey(end) };
};

function ComandaMeseroFilter({ meseros, comandas, selected, onChange }) {
  const safeMeseros = Array.isArray(meseros) ? meseros.filter(mesero => mesero?.id && mesero?.nombre) : [];
  const safeComandas = Array.isArray(comandas) ? comandas.filter(comanda => comanda && typeof comanda === 'object') : [];
  const countFor = meseroId => safeComandas.filter(comanda =>
    String(comanda.mesero_id || comanda.mesero_nombre || 'sin_mesero') === String(meseroId)
  ).length;

  return (
    <div className="barra-waiter-filter planilla-comanda-filter">
      <div className="barra-waiter-filter__label">
        <span>Comandas por mesero</span>
        <span>{selected === 'todos' ? safeComandas.length : countFor(selected)} comandas</span>
      </div>
      <div className="barra-waiter-filter__chips" role="group" aria-label="Filtrar comandas por mesero">
        <button type="button" className={`barra-waiter-chip ${selected === 'todos' ? 'is-active' : ''}`} onClick={() => onChange('todos')}>
          <span>Todos</span><b>{safeComandas.length}</b>
        </button>
        {safeMeseros.map(mesero => (
          <button key={mesero.id} type="button" className={`barra-waiter-chip ${selected === mesero.id ? 'is-active' : ''}`} onClick={() => onChange(mesero.id)}>
            <span>{mesero.nombre}</span><b>{countFor(mesero.id)}</b>
          </button>
        ))}
      </div>
    </div>
  );
}

function PlanillaComandaTabs({ comandas, itemsByOrder, activeStatus, onStatusChange }) {
  const [orderPage, setOrderPage] = useState(0);
  useEffect(() => setOrderPage(0), [activeStatus]);
  const safeOrders = Array.isArray(comandas) ? comandas.filter(order => order && typeof order === 'object') : [];
  const ordersForStatus = statusId => safeOrders.filter(order => {
    if (statusId === 'todos') return true;
    if (statusId === 'otros') return !['enviada', 'pagada', 'cancelada'].includes(order.estado);
    return order.estado === statusId;
  });
  const activeGroup = PLANILLA_ORDER_GROUPS.find(group => group.id === activeStatus) || PLANILLA_ORDER_GROUPS[0];
  const visibleOrders = ordersForStatus(activeGroup.id);
  const visiblePageOrders = visibleOrderPage(visibleOrders, activeGroup.id, orderPage);

  return (
    <>
      <div className="barra-order-tabs planilla-order-tabs" role="tablist" aria-label="Filtrar pedidos de la planilla por estado">
        {PLANILLA_ORDER_GROUPS.map(group => (
          <button
            key={group.id}
            id={`planilla-order-tab-${group.id}`}
            type="button"
            role="tab"
            aria-selected={activeGroup.id === group.id}
            aria-controls="planilla-orders-panel"
            className={`barra-order-tab${group.id !== 'todos' && group.id !== 'otros' ? ` barra-order-tab--${group.id}` : ''}${activeGroup.id === group.id ? ' is-active' : ''}`}
            onClick={() => {
              onStatusChange(group.id);
              setOrderPage(0);
            }}
          >
            <span>{group.title}</span><b>{ordersForStatus(group.id).length}</b>
          </button>
        ))}
      </div>
      <section
        id="planilla-orders-panel"
        role="tabpanel"
        aria-labelledby={`planilla-order-tab-${activeGroup.id}`}
        className={`barra-order-group${activeGroup.id !== 'todos' && activeGroup.id !== 'otros' ? ` barra-order-group--${activeGroup.id}` : ''}`}
      >
        <header className="barra-order-group__header">
          <div><h3>{activeGroup.title}</h3><p>{activeGroup.description}</p></div>
          <span>{visibleOrders.length}</span>
        </header>
        <OrderPageTabs
          status={activeGroup.id}
          orderCount={visibleOrders.length}
          page={orderPage}
          onPageChange={setOrderPage}
          idPrefix="planilla-orders"
        />
        {!visibleOrders.length && <p className="barra-order-empty">No hay pedidos en esta categoría.</p>}
        <div className={['pagada', 'cancelada'].includes(activeGroup.id) ? 'order-page-grid' : undefined}>
        {visiblePageOrders.map(order => {
          const [statusLabel, statusColor] = COMANDA_STATUS[order.estado] || [order.estado || 'Estado desconocido', C.sub];
          return (
            <article key={order.id} className="barra-order planilla-order">
              <div className="planilla-order__summary">
                <div className="barra-order__identity">
                  <strong>Comanda #{order.consecutivo || '—'}</strong>
                  <span>Mesero: {order.mesero_nombre || order.mesero_id || 'Sin asignar'}</span>
                  <time>Creada: {formatComandaTime(order.creado_en)}</time>
                </div>
                <Badge color={statusColor} small>{statusLabel}</Badge>
                <strong className="barra-order__total">{COP(order.total)}</strong>
              </div>
              <div className="planilla-order__times">
                <span>Autorizada: {formatComandaTime(order.confirmado_en)}</span>
                <span>Entregada: {formatComandaTime(order.despachado_en)}</span>
                <span>Pago: {formatComandaTime(order.pagado_en || order.pago_registrado_en)}</span>
              </div>
              <div className="planilla-order__items">
                {(itemsByOrder[order.id] || []).length
                  ? itemsByOrder[order.id].map(item => (
                    <div key={item.id}>
                      <span>{item.cantidad} × {item.nombre}</span>
                      <strong>{COP(Number(item.cantidad) * Number(item.precio_unitario))}</strong>
                    </div>
                  ))
                  : <span className="planilla-order__no-items">Sin productos registrados.</span>}
              </div>
            </article>
          );
        })}
        </div>
      </section>
    </>
  );
}

function BankReceiptButton({ transfer, meseroName }) {
  const [open, setOpen] = useState(false);
  if (!transfer.foto_url) return null;
  return (
    <>
      <button type="button" className="planilla-bank-receipt-button" onClick={() => setOpen(true)}>
        Ver comprobante
      </button>
      {open&&<Modal title={`Comprobante · ${meseroName}`} onClose={()=>setOpen(false)} width="min(760px,96vw)">
        <img className="planilla-bank-receipt-image" src={transfer.foto_url} alt={`Comprobante ${PLAT_LABELS[transfer.plataforma] || transfer.plataforma} por ${COP(transfer.monto)}`}/>
        <div className="planilla-bank-receipt-caption">
          <strong>{PLAT_LABELS[transfer.plataforma] || transfer.plataforma}</strong>
          <span>{COP(transfer.monto)}</span>
        </div>
      </Modal>}
    </>
  );
}

function BankTransferHistory({ transfers, users }) {
  const namesById = new Map((users || []).map(account => [String(account.id), account.name]));
  if (!transfers.length) return <div className="planilla-bank-history-empty">No hay transferencias registradas en esta planilla.</div>;
  return (
    <div className="planilla-bank-history">
      {transfers.map(transfer => {
        const meseroName = namesById.get(String(transfer.mesero_id)) || transfer.mesero_nombre || 'Mesero no disponible';
        return (
          <article className="planilla-bank-history__row" key={transfer.id}>
            <div className="planilla-bank-history__identity">
              <strong>{meseroName}</strong>
              <span>{PLAT_LABELS[transfer.plataforma] || transfer.plataforma} · {formatComandaTime(transfer.created_at) || transfer.hora || '—'}</span>
              {transfer.descripcion&&<small>{transfer.descripcion}</small>}
            </div>
            <strong className="planilla-bank-history__amount">{COP(transfer.monto)}</strong>
            <BankReceiptButton transfer={transfer} meseroName={meseroName}/>
          </article>
        );
      })}
    </div>
  );
}

// Personal predefinido por defecto para nuevos turnos
const STAFF_DEFECTO = [
  { id:'def_barra', name:'Barra',     rol:'barra',     pay:'3%',   activo:true, temporal:true },
  { id:'def_mes1',  name:'Mesero 1',  rol:'mesero',    pay:'5%',   activo:true, temporal:true },
  { id:'def_mes2',  name:'Mesero 2',  rol:'mesero',    pay:'5%',   activo:true, temporal:true },
  { id:'def_dj',    name:'DJ',        rol:'dj',        pay:133000, activo:true, temporal:true },
  { id:'def_patin', name:'Patín',     rol:'patin',     pay:70000,  activo:true, temporal:true },
  { id:'def_seg',   name:'Seguridad', rol:'seguridad', pay:80000,  activo:true, temporal:true },
];

import ChecklistModal, { CHECKLIST_ITEMS } from "./ChecklistModal.jsx";

// Gastos que siempre aparecen precompletados al abrir turno
const GASTOS_PRESETS = [
  {id:'gp_hielo',desc:'Hielo',monto:0},
  {id:'gp_limon',desc:'Limón',monto:0},
  {id:'gp_vasos',desc:'Vasos',monto:0},
];

// Colores y etiquetas de plataformas bancarias
const PLAT_COLORS = {nequi:'#FF0066',bancolombia:'#FFCD00',datafono:'#34d399',daviplata:'#FF4500',llave:'#67e8f9',qr:'#a78bfa'};
const PLAT_LABELS = {nequi:'Nequi',bancolombia:'Bancolombia',datafono:'Datáfono',daviplata:'Daviplata',llave:'Llave',qr:'QR'};
import NuevoStaffModal from "./NuevoStaffModal.jsx";
import PerspectivaCierre from "./PerspectivaCierre.jsx";
import { preparePhoto } from "../common/UploadGasto.jsx";

export default function Planilla({ negocio, onUpdateNegocio }) {
  const { user, users, refreshUsers } = useAuth();
  const isJefe = user?.role === 'jefe';
  const isAux  = user?.role === 'auxiliar';
  const TURNO_KEY = `gesbar_turno_${negocio.id}`;
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersError, setUsersError] = useState('');
  useEffect(() => {
    let active = true;
    if (!['administrador', 'gerente'].includes(String(user?.role || '').toLowerCase())) {
      setUsersLoading(false);
      return () => { active = false; };
    }
    setUsersLoading(true);
    setUsersError('');
    refreshUsers()
      .catch(error => {
        console.error('No fue posible actualizar las cuentas para abrir el turno:', error);
        if (active) setUsersError(error.message || 'No fue posible actualizar las cuentas de usuario.');
      })
      .finally(() => {
        if (active) setUsersLoading(false);
      });
    return () => { active = false; };
  }, [negocio.id, refreshUsers, user?.role]);
  const barraUsers = users.filter(account => {
    if (String(account.role || '').trim().toLowerCase() !== 'barra') return false;
    if (String(account.negocios || '').trim().toLowerCase() === 'all') return true;
    if (Array.isArray(account.negocios)) {
      return account.negocios.some(id => String(id) === String(negocio.id));
    }
    if (typeof account.negocios === 'string') {
      try {
        const assignedBusinesses = JSON.parse(account.negocios);
        return Array.isArray(assignedBusinesses)
          ? assignedBusinesses.some(id => String(id) === String(negocio.id))
          : String(assignedBusinesses) === String(negocio.id);
      } catch {
        return account.negocios.trim() === String(negocio.id);
      }
    }
    return false;
  }).sort((first, second) => String(first.name || '').localeCompare(String(second.name || ''), 'es'));

  const saved = () => { try{return JSON.parse(localStorage.getItem(TURNO_KEY)||'{}');}catch{return {};} };

  const [step,setStep]         = useState(()=>saved().step||'inicio');
  const [turnoId,setTurnoId]   = useState(()=>saved().turnoId||'');
  const [turnoAbierto,setTurnoAbierto] = useState(null);
  const [verificandoTurno,setVerificandoTurno] = useState(true);
  const [apertura,setApertura] = useState(()=>saved().apertura||'');
  const [baseCaja,setBaseCaja] = useState(()=>saved().baseCaja||'1000000');
  const [staffFilter,setStaffFilter] = useState('');
  const [barraSeleccionada,setBarraSeleccionada] = useState('');
  const [authorizedMeseroIds,setAuthorizedMeseroIds] = useState(()=>saved().authorizedMeseroIds||[]);
  const [staffActivo,setStaffActivo] = useState(()=>{
    const sv=saved();
    if(sv.staffActivo) return sv.staffActivo;
    return negocio.staff.length ? negocio.staff.map(s=>({...s,activo:true})) : STAFF_DEFECTO;
  });

  useEffect(()=>{
    const sv=saved();
    if(!sv.step||sv.step==='inicio'||!sv.staffActivo||sv.staffActivo.length===0){
      setStaffActivo(negocio.staff.length ? negocio.staff.map(s=>({...s,activo:true})) : STAFF_DEFECTO);
    }
  },[negocio.staff]);

  const [showStaffModal,setShowStaffModal] = useState(false);
  const [showChecklist,setShowChecklist]   = useState(false);
  const [showNuevoStaff,setShowNuevoStaff] = useState(false);
  const [checklist,setChecklist]  = useState(()=>saved().checklist||{});
  const [movs,setMovs]            = useState(()=>saved().movs||{});
  const [productosInventario,setProductosInventario] = useState(negocio.productos);
  const lastProductStocks = useRef(Object.fromEntries(negocio.productos.map(product => [product.id, Number(product.stock) || 0])));
  const [gastosT,setGastosT]      = useState(()=>saved().gastosT||[]);
  const [bancosTransfs,setBancosTransfs] = useState(()=>{
    const sv=saved();
    if(sv.bancosTransfs?.length) return sv.bancosTransfs.map(({foto_url,comprobante,...transfer})=>({
      ...transfer,
      id:String(transfer.id).startsWith('_')?transfer.id:`_${transfer.id}`,
    }));
    // migración desde formato anterior {nequi:'',bancolombia:'',…}
    if(sv.bancos) return Object.entries(sv.bancos).filter(([,v])=>parseInt(v)>0).map(([k,v])=>({id:`_${k}`,plataforma:k,monto:parseInt(v)||0,ref:'',hora:''}));
    return [];
  });
  const [bForm,setBForm] = useState({plataforma:'nequi',monto:'',ref:'',meseroId:'',comprobante:''});
  const [savingTransfer,setSavingTransfer] = useState(false);
  const [bankTransferError,setBankTransferError] = useState('');
  const [bankTransferMessage,setBankTransferMessage] = useState('');
  const [bankTransfersLoading,setBankTransfersLoading] = useState(false);
  const [planillaBankTransfers,setPlanillaBankTransfers] = useState([]);
  const [bankHistoryError,setBankHistoryError] = useState('');
  const [transferLinkError,setTransferLinkError] = useState('');
  const [extras,setExtras]        = useState(()=>saved().extras||'');
  const [pendientes,setPendientes]= useState(()=>saved().pendientes||'');
  const [novedades,setNovedades]  = useState(()=>saved().novedades||'');
  const [turnoNovedades,setTurnoNovedades] = useState([]);
  const [turnoNovedadesError,setTurnoNovedadesError] = useState('');
  const [inventoryEntriesError,setInventoryEntriesError] = useState('');
  const [inventoryOpeningDrafts,setInventoryOpeningDrafts] = useState({});
  const [inventoryOpeningError,setInventoryOpeningError] = useState('');
  const [savingOpeningProduct,setSavingOpeningProduct] = useState('');
  const [tab,setTab]              = useState('productos');
  const [historySearch,setHistorySearch] = useState('');
  const [historyFrom,setHistoryFrom] = useState('');
  const [historyTo,setHistoryTo] = useState('');
  const [historyPage,setHistoryPage] = useState(0);
  const [showAllClosedPlanillas,setShowAllClosedPlanillas] = useState(false);
  const [activeTurnComandas,setActiveTurnComandas] = useState([]);
  const [activeTurnComandasError,setActiveTurnComandasError] = useState('');
  const [activeTurnComandasLoading,setActiveTurnComandasLoading] = useState(false);
  const [billetes,setBilletes]    = useState(()=>saved().billetes||{});
  const [resumen,setResumen]      = useState(null);
  const [gForm,setGForm]          = useState({desc:'',monto:''});
  const [viewPlanilla,setViewPlanilla] = useState(null);
  const [closedPlanillaTab,setClosedPlanillaTab] = useState('planilla');
  const [closedTurnNovelties,setClosedTurnNovelties] = useState([]);
  const [closedTurnNotes,setClosedTurnNotes] = useState([]);
  const [closedNoveltiesError,setClosedNoveltiesError] = useState('');
  const [closedNoveltiesLoading,setClosedNoveltiesLoading] = useState(false);
  const [viewComandas,setViewComandas] = useState([]);
  const [viewComandaItems,setViewComandaItems] = useState({});
  const [comandasLoading,setComandasLoading] = useState(false);
  const [comandasError,setComandasError] = useState('');
  const [viewMeseroFilter,setViewMeseroFilter] = useState('todos');
  const [viewActiveStatus,setViewActiveStatus] = useState('todos');
  const [editingPlatId,setEditingPlatId]     = useState(null); // id de la fila con selector de plataforma abierto
  const [pctBarra,setPctBarra]               = useState(()=>saved().pctBarra??3);
  const [pctMeseros,setPctMeseros]           = useState(()=>saved().pctMeseros??5);
  const viewMeseros = [...new Map(viewComandas
    .filter(comanda => comanda && typeof comanda === 'object')
    .map(comanda => {
      const id = String(comanda.mesero_id || comanda.mesero_nombre || 'sin_mesero');
      const nombre = String(comanda.mesero_nombre || comanda.mesero_id || 'Sin mesero');
      return [id, { id, nombre }];
    })).values()]
    .filter(mesero => mesero && typeof mesero.nombre === 'string')
    .sort((first, second) => String(first?.nombre || '').localeCompare(String(second?.nombre || ''), 'es'));
  const viewComandasVisibles = viewMeseroFilter === 'todos'
    ? viewComandas
    : viewComandas.filter(comanda => comanda && typeof comanda === 'object' &&
      String(comanda.mesero_id || comanda.mesero_nombre || 'sin_mesero') === String(viewMeseroFilter)
    );

  useEffect(() => {
    let active = true;
    setVerificandoTurno(true);
    localFetch(
      'turnos',
      `negocio_id=eq.${negocio.id}&estado=eq.abierto&select=*&order=fecha_apertura.desc&limit=1`,
    ).then(turnos => {
      if (!active) return;
      const abierto = turnos?.[0] || null;
      setTurnoAbierto(abierto);
      setVerificandoTurno(false);
      if (abierto) {
        setTurnoId(abierto.id);
        setStep('abierto');
        if (abierto.base_caja !== undefined && abierto.base_caja !== null) {
          setBaseCaja(String(abierto.base_caja));
        }
        if (abierto.fecha_apertura) {
          setApertura(formatLocalTime(abierto.fecha_apertura));
        }
        setAuthorizedMeseroIds(Array.isArray(abierto.meseros_ids) ? abierto.meseros_ids.map(String) : []);
      } else {
        setAuthorizedMeseroIds([]);
        setTurnoId(currentTurnoId => {
          if (currentTurnoId) setStep('inicio');
          return '';
        });
      }
    });
    return () => { active = false; };
  }, [negocio.id]);

  useEffect(() => {
    if (!turnoId || step !== 'abierto') return undefined;
    let active = true;
    let poll;
    const refreshProducts = async () => {
      const [products, courtesyMovements, inventoryAdjustments, activeTurns] = await Promise.all([
        localFetch('productos', `negocio_id=eq.${negocio.id}&select=*&order=sort_order.asc`),
        localFetch('movimientos_inventario', `turno_id=eq.${encodeURIComponent(turnoId)}&tipo=eq.cortesia&select=producto_id,cantidad`),
        localFetch('movimientos_inventario', `turno_id=eq.${encodeURIComponent(turnoId)}&tipo=eq.ajuste&select=producto_id,cantidad`),
        localFetch('turnos', `id=eq.${encodeURIComponent(turnoId)}&select=inventario_apertura`),
      ]);
      if (!Array.isArray(inventoryAdjustments)) {
        if (active) setInventoryEntriesError('La respuesta de los ajustes de inventario no tiene el formato esperado.');
        return;
      }
      if (!active) return;
      let entryMovements = null;
      try {
        entryMovements = await localFetchOrThrow(
          'movimientos_inventario',
          `turno_id=eq.${encodeURIComponent(turnoId)}&tipo=eq.entrada&select=producto_id,cantidad`,
        );
        if (!Array.isArray(entryMovements)) throw new Error('La respuesta de ingresos no tiene el formato esperado.');
        if (active) setInventoryEntriesError('');
      } catch (error) {
        if (active) setInventoryEntriesError(error.message || 'No fue posible cargar ingresos y ajustes de inventario del turno.');
      }
      if (!active) return;
      if (Array.isArray(activeTurns) && Array.isArray(activeTurns[0]?.inventario_apertura)) {
        setTurnoAbierto(current => {
          if (JSON.stringify(current?.inventario_apertura) === JSON.stringify(activeTurns[0].inventario_apertura)) return current;
          return { ...current, inventario_apertura: activeTurns[0].inventario_apertura };
        });
      }
      if (Array.isArray(products)) {
        const courtesyByProduct = Array.isArray(courtesyMovements)
          ? courtesyMovements.reduce((totals, movement) => {
            const productId = String(movement.producto_id);
            totals[productId] = (totals[productId] || 0) + Math.abs(Number(movement.cantidad) || 0);
            return totals;
          }, {})
          : null;
        const entriesByProduct = Array.isArray(entryMovements)
          ? entryMovements.reduce((totals, movement) => {
            const productId = String(movement.producto_id);
            totals[productId] = (totals[productId] || 0) + Math.max(0, Number(movement.cantidad) || 0);
            return totals;
          }, {})
          : null;
        const adjustmentsByProduct = inventoryAdjustments.reduce((totals, movement) => {
          const productId = String(movement.producto_id);
          totals[productId] = (totals[productId] || 0) + (Number(movement.cantidad) || 0);
          return totals;
        }, {});
        const previousStocks = lastProductStocks.current;
        const nextStocks = Object.fromEntries(products.map(product => [product.id, Number(product.stock) || 0]));
        setProductosInventario(current => {
          const unchanged = current.length === products.length && products.every((product, index) =>
            current[index]?.id === product.id
            && Number(current[index]?.stock) === Number(product.stock)
          );
          return unchanged ? current : products;
        });
        setMovs(current => {
          let changed = false;
          const updated = { ...current };
          for (const product of products) {
            const movement = current[product.id] || {};
            const manualEntries = Number(movement.entradas) || 0;
            const registeredEntries = entriesByProduct
              ? entriesByProduct[String(product.id)] || 0
              : Math.max(0, manualEntries - Number(movement.entradasNoRegistradas || 0));
            const entries = Math.max(manualEntries, registeredEntries);
            const unrecordedEntries = Math.max(0, manualEntries - registeredEntries);
            const courtesy = movement.cortesiaEditadaManualmente
              ? Math.max(0, Number(movement.cortesia) || 0)
              : courtesyByProduct
                ? courtesyByProduct[String(product.id)] || 0
                : Number(movement.cortesia) || 0;
            const previousStock = previousStocks[product.id] ?? (Number(product.stock) || 0);
            const adjustment = movement.existencias === undefined
              ? 0
              : Number(movement.ajusteExistencias ?? (Number(movement.existencias) - previousStock - entries)) || 0;
            const openingItem = turnoAbierto?.inventario_apertura?.find(item =>
              String(item.producto_id) === String(product.id)
            );
            const openingStock = Number(openingItem?.cantidad ?? product.stock) || 0;
            const existencias = (Number(product.stock) || 0) + unrecordedEntries + adjustment;
            const inventoryAdjustment = adjustmentsByProduct[String(product.id)] || 0;
            const salidas = Math.max(0, openingStock + entries - existencias + inventoryAdjustment);
            if ((movement.entradas !== entries && entries > 0)
              || movement.entradasNoRegistradas !== unrecordedEntries
              || (movement.cortesia !== courtesy && (courtesy > 0 || movement.cortesia !== undefined))
              || movement.ajusteInventario !== inventoryAdjustment
              || (movement.salidas !== salidas && (salidas !== 0 || movement.salidas !== undefined))
              || (movement.existencias !== undefined && movement.existencias !== existencias)
              || (movement.existencias !== undefined && movement.ajusteExistencias !== adjustment)) {
              updated[product.id] = {
                ...movement,
                ...(entries > 0 ? { entradas: entries } : {}),
                entradasNoRegistradas: unrecordedEntries,
                cortesia: courtesy,
                ajusteInventario: inventoryAdjustment,
                salidas,
                ...(movement.existencias !== undefined
                  ? { existencias, ajusteExistencias: adjustment }
                  : {}),
              };
              changed = true;
            }
          }
          return changed ? updated : current;
        });
        lastProductStocks.current = nextStocks;
      }
      poll = window.setTimeout(refreshProducts, 1500);
    };
    void refreshProducts();
    return () => {
      active = false;
      if (poll) window.clearTimeout(poll);
    };
  }, [turnoId, negocio.id, turnoAbierto, step]);

  useEffect(() => {
    if (!turnoId || step !== 'abierto') {
      setTurnoNovedades([]);
      setTurnoNovedadesError('');
      return undefined;
    }
    let active = true;
    let poll;
    const refreshTurnoNovedades = async () => {
      try {
        const rows = await localFetchOrThrow(
          'novedades',
          `turno_id=eq.${encodeURIComponent(turnoId)}&select=id,texto,created_at,creado_por&order=created_at.desc`,
        );
        if (!Array.isArray(rows)) throw new Error('La respuesta de novedades no tiene el formato esperado.');
        if (active) {
          setTurnoNovedades(rows);
          setTurnoNovedadesError('');
        }
      } catch (error) {
        if (active) setTurnoNovedadesError(error.message || 'No fue posible cargar las novedades del turno.');
      }
      if (active) poll = window.setTimeout(refreshTurnoNovedades, 3000);
    };
    void refreshTurnoNovedades();
    return () => {
      active = false;
      if (poll) window.clearTimeout(poll);
    };
  }, [turnoId, step]);

  useEffect(() => {
    if (!turnoId || step !== 'abierto') {
      setActiveTurnComandas([]);
      setActiveTurnComandasError('');
      setActiveTurnComandasLoading(false);
      return undefined;
    }
    let active = true;
    let refreshTimer;
    const refreshComandas = async () => {
      try {
        const orders = await localFetchOrThrow(
          'comandas',
          `turno_id=eq.${encodeURIComponent(turnoId)}&select=id,mesero_id,mesero_nombre,total,estado`,
        );
        if (!Array.isArray(orders)) throw new Error('La respuesta de comandas no es válida.');
        if (active) {
          setActiveTurnComandas(orders);
          setActiveTurnComandasError('');
        }
      } catch (error) {
        console.error('No fue posible actualizar las ventas de comandas del turno:', error);
        if (active) {
          setActiveTurnComandas([]);
          setActiveTurnComandasError('No fue posible cargar las ventas de las comandas. Se volverá a intentar automáticamente.');
        }
      } finally {
        if (active) setActiveTurnComandasLoading(false);
        if (active) refreshTimer = window.setTimeout(refreshComandas, 1500);
      }
    };
    setActiveTurnComandas([]);
    setActiveTurnComandasError('');
    setActiveTurnComandasLoading(true);
    void refreshComandas();
    return () => {
      active = false;
      if (refreshTimer) window.clearTimeout(refreshTimer);
    };
  }, [turnoId, step]);

  useEffect(() => {
    if (!turnoId) return undefined;
    let active = true;
    const refreshAuthorizedWaiters = async () => {
      const rows = await localFetch('turnos', `id=eq.${turnoId}&select=id,meseros_ids,estado&limit=1`);
      if (!active || !Array.isArray(rows) || !rows[0]) return;
      const ids = rows[0].estado === 'abierto' && Array.isArray(rows[0].meseros_ids)
        ? rows[0].meseros_ids.map(String)
        : [];
      setAuthorizedMeseroIds(current => current.join('|') === ids.join('|') ? current : ids);
    };
    void refreshAuthorizedWaiters();
    const interval = window.setInterval(refreshAuthorizedWaiters, 3000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [turnoId]);

  useEffect(() => {
    if (!turnoId) {
      setBankTransfersLoading(false);
      return undefined;
    }
    let active = true;
    setBankTransfersLoading(true);
    setBankTransferError('');
    (async () => {
      const rows = await localFetch(
        'transferencias',
        `turno_id=eq.${encodeURIComponent(turnoId)}&select=*&order=created_at.asc`,
      );
      if (!active) return;
      if (!Array.isArray(rows)) {
        setBankTransferError('No fue posible cargar los comprobantes guardados del turno.');
      } else {
        setBancosTransfs(current => rows.length
          ? rows.map(row => ({
            ...row,
            monto: Number(row.monto) || 0,
            ref: row.descripcion || '',
          }))
          : current.filter(transfer => String(transfer.id).startsWith('_')));
      }
      setBankTransfersLoading(false);
    })();
    return () => { active = false; };
  }, [turnoId]);

  useEffect(() => {
    if (!viewPlanilla) {
      setViewComandas([]);
      setViewComandaItems({});
      setPlanillaBankTransfers([]);
      setClosedTurnNovelties([]);
      setClosedTurnNotes([]);
      setBankHistoryError('');
      setClosedNoveltiesError('');
      setClosedNoveltiesLoading(false);
      setViewMeseroFilter('todos');
      setViewActiveStatus('todos');
      setClosedPlanillaTab('planilla');
      setComandasError('');
      return undefined;
    }
    let active = true;
    setComandasLoading(true);
    setComandasError('');
    setViewComandas([]);
    setViewComandaItems({});
    setPlanillaBankTransfers([]);
    setClosedTurnNovelties([]);
    setClosedTurnNotes([]);
    setBankHistoryError('');
    setClosedNoveltiesError('');
    setClosedNoveltiesLoading(true);
    setViewMeseroFilter('todos');
    setClosedPlanillaTab('planilla');
    let noveltiesLoaded = false;
    (async () => {
      try {
        const shifts = await localFetch(
          'turnos',
          `negocio_id=eq.${negocio.id}&select=*&order=fecha_apertura.desc`,
        );
        if (!Array.isArray(shifts)) throw new Error('No fue posible cargar los turnos.');
        const planillaDay = planillaDateKey(viewPlanilla.fecha);
        const linkedShifts = shifts.filter(shift =>
          String(shift.legacy_planilla_id || '') === String(viewPlanilla.id)
        );
        const selectedShifts = linkedShifts.length ? linkedShifts : shifts.filter(shift =>
          planillaDay && timestampDateKey(shift.fecha_apertura) === planillaDay
        );
        const noveltyGroups = await Promise.all(selectedShifts.map(shift =>
          localFetch('novedades', `turno_id=eq.${encodeURIComponent(shift.id)}&select=id,texto,created_at,creado_por&order=created_at.desc`)
        ));
        const noveltiesFailed = noveltyGroups.some(group => !Array.isArray(group));
        const noveltyRows = noveltiesFailed ? [] : noveltyGroups.flat()
          .filter(item => item && typeof item === 'object')
          .sort((first, second) => String(second.created_at || '').localeCompare(String(first.created_at || '')));
        if (active) {
          setClosedTurnNovelties(noveltyRows);
          setClosedTurnNotes(selectedShifts.flatMap(shift => [
            shift.novedades_apertura ? { id: `${shift.id}-apertura`, tipo: 'Apertura', texto: shift.novedades_apertura, created_at: shift.fecha_apertura } : null,
            shift.novedades_cierre ? { id: `${shift.id}-cierre`, tipo: 'Cierre', texto: shift.novedades_cierre, created_at: shift.fecha_cierre } : null,
          ].filter(Boolean)));
          setClosedNoveltiesError(noveltiesFailed ? 'No fue posible cargar las novedades registradas en este turno.' : '');
          setClosedNoveltiesLoading(false);
        }
        noveltiesLoaded = true;
        const transferGroups = await Promise.all([
          localFetch('transferencias', `planilla_id=eq.${encodeURIComponent(viewPlanilla.id)}&select=*&order=created_at.asc`),
          ...selectedShifts.map(shift =>
            localFetch('transferencias', `turno_id=eq.${encodeURIComponent(shift.id)}&select=*&order=created_at.asc`)
          ),
        ]);
        const bankHistoryFailed = transferGroups.some(group => !Array.isArray(group));
        const bankTransferRows = bankHistoryFailed
          ? []
          : [...new Map(transferGroups.flat().map(transfer => [transfer.id, transfer])).values()];
        if (active) {
          setPlanillaBankTransfers(bankTransferRows);
          setBankHistoryError(bankHistoryFailed ? 'No fue posible cargar los comprobantes de las transferencias.' : '');
        }
        const orderGroups = await Promise.all(selectedShifts.map(shift =>
          localFetch('comandas', `turno_id=eq.${shift.id}&select=*&order=creado_en.asc`)
        ));
        if (orderGroups.some(group => !Array.isArray(group))) throw new Error('No fue posible cargar las comandas del turno.');
        const orders = orderGroups.flat().filter(order => order && typeof order === 'object');
        const itemGroups = await Promise.all(orders.map(order =>
          localFetch('comanda_items', `comanda_id=eq.${order.id}&select=*`)
        ));
        if (itemGroups.some(group => !Array.isArray(group))) throw new Error('No fue posible cargar los productos de las comandas.');
        const itemRows = itemGroups.flat().filter(item => item && typeof item === 'object');
        const products = await localFetch('productos', `negocio_id=eq.${negocio.id}&select=id,name`);
        if (!Array.isArray(products)) throw new Error('No fue posible cargar los nombres de los productos.');
        const names = new Map(products.map(product => [product.id, product.name]));
        const groupedItems = itemRows.reduce((groups, item) => ({
          ...groups,
          [item.comanda_id]: [...(groups[item.comanda_id] || []), {
            ...item,
            nombre: names.get(item.producto_id) || 'Producto no disponible',
          }],
        }), {});
        if (active) {
          setViewComandas(orders);
          setViewComandaItems(groupedItems);
          setViewMeseroFilter('todos');
        }
      } catch (error) {
        console.error('No fue posible cargar el detalle de comandas de la planilla:', error);
        if (active) {
          setComandasError(error.message || 'No fue posible cargar las comandas de esta planilla.');
          if (!noveltiesLoaded) {
            setClosedNoveltiesError('No fue posible cargar las novedades asociadas a esta planilla.');
            setClosedNoveltiesLoading(false);
          }
        }
      } finally {
        if (active) setComandasLoading(false);
      }
    })();
    return () => { active = false; };
  }, [negocio.id, viewPlanilla]);

  useEffect(()=>{
    if(step==='inicio'||step==='cerrado') return;
    const data={step,turnoId,apertura,baseCaja,staffActivo,authorizedMeseroIds,checklist,movs,gastosT,bancosTransfs:bancosTransfs.filter(transfer=>String(transfer.id).startsWith('_')).map(({foto_url,comprobante,...transfer})=>transfer),extras,pendientes,novedades,billetes,pctBarra,pctMeseros};
    localStorage.setItem(TURNO_KEY, JSON.stringify(data));
  },[step,turnoId,apertura,movs,gastosT,bancosTransfs,extras,pendientes,novedades,billetes,checklist,pctBarra,pctMeseros,staffActivo,authorizedMeseroIds]);



  const normalizedStaffFilter = staffFilter.trim().toLocaleLowerCase('es');
  const staffFiltrado  = staffActivo.filter(person =>
    String(person.name || '').toLocaleLowerCase('es').includes(normalizedStaffFilter)
    || String(person.rol || '').toLocaleLowerCase('es').includes(normalizedStaffFilter)
  );
  const waiterNameKey = name => String(name || '').trim().toLocaleLowerCase('es');
  const waiterAccounts = (users || []).filter(account =>
    String(account.role || '').toLowerCase() === 'mesero'
  );
  const authorizedMeseros = [...new Set(authorizedMeseroIds.map(String))]
    .filter(Boolean)
    .map(id => {
      const account = waiterAccounts.find(user => String(user.id) === id);
      const staffMatch = staffActivo.find(person =>
        person.rol === 'mesero'
        && waiterNameKey(person.name) === waiterNameKey(account?.name)
      );
      return {
        id,
        name: String(account?.name || staffMatch?.name || 'Mesero'),
        rol: 'mesero',
        pay: staffMatch?.pay ?? `${pctMeseros}%`,
        activo: true,
      };
    });
  const meserosConVentas = new Map();
  activeTurnComandas.filter(order => order.estado === 'pagada').forEach(order => {
    const account = waiterAccounts.find(user =>
      (order.mesero_id && String(user.id) === String(order.mesero_id))
      || (!order.mesero_id && waiterNameKey(user.name) === waiterNameKey(order.mesero_nombre))
    );
    const id = String(order.mesero_id || account?.id || waiterNameKey(order.mesero_nombre));
    if (!id) return;
    const staffMatch = staffActivo.find(person =>
      person.rol === 'mesero'
      && waiterNameKey(person.name) === waiterNameKey(account?.name || order.mesero_nombre)
    );
    meserosConVentas.set(id, {
      id,
      name: String(account?.name || order.mesero_nombre || 'Mesero'),
      rol: 'mesero',
      pay: staffMatch?.pay ?? `${pctMeseros}%`,
      activo: true,
    });
  });
  const barman         = staffActivo.find(s=>s.rol==='barra'&&s.activo);
  const dj             = staffActivo.find(s=>s.rol==='dj'&&s.activo);
  const meseros        = [...new Map([...authorizedMeseros, ...meserosConVentas.values()]
    .map(mesero => [String(mesero.id), mesero])).values()];
  const pagoFijosStaff = staffActivo.filter(s=>(['patin','seguridad','aseo','barra_fija','mesero_fijo'].includes(s.rol)||s.customRole)&&s.activo);
  const seguridadStaff = pagoFijosStaff.filter(s=>s.rol==='seguridad');
  const personalFijoStaff = pagoFijosStaff.filter(s=>s.rol!=='seguridad');
  const totalBancos        = bancosTransfs.reduce((s,t)=>s+(Number(t.monto)||0),0);
  const totalGastosT       = gastosT.reduce((s,g)=>s+g.monto,0);
  const totalBilletes      = BILLETS.reduce((s,b)=>s+(parseInt(billetes[b])||0)*b,0);
  const negocioProductsById = new Map(negocio.productos.map(product => [product.id, product]));
  const productosPlanilla = productosInventario.map(product => ({
    ...(negocioProductsById.get(product.id) || {}),
    ...product,
    stock: Number(product.stock) || 0,
  }));
  const existenciasProducto = (product, movement = {}) => Number(
    movement.existencias
      ?? ((Number(product.stock) || 0) + Number(movement.entradasNoRegistradas ?? movement.entradas ?? 0))
  );
  const totalVentaProductos= productosPlanilla.reduce((s,p)=>{const m=movs[p.id]||{};return s+(m.ventaManual!==undefined?m.ventaManual:Math.max(0,(m.salidas||0)-(m.cortesia||0))*p.price);},0);
  const ventasMesero = activeTurnComandas.reduce((sales, order) => {
    if (order.estado !== 'pagada') return sales;
    const waiterId = String(order.mesero_id || waiterNameKey(order.mesero_nombre));
    if (!waiterId) return sales;
    sales[waiterId] = (sales[waiterId] || 0) + Math.max(0, Number(order.total) || 0);
    return sales;
  }, {});
  const ventasMeseroPorId = Object.fromEntries(meseros.map(mesero => {
    const ventasPorId = ventasMesero[String(mesero.id)];
    const ventasPorNombre = ventasMesero[waiterNameKey(mesero.name)];
    return [mesero.id, ventasPorId ?? ventasPorNombre ?? 0];
  }));
  const totalVentasMeseros = meseros.reduce((sum, mesero) => sum + ventasMeseroPorId[mesero.id], 0);
  const totalVentas        = totalVentaProductos;
  const barraPaymentMode   = barman?.paymentMode === 'fixed' ? 'fixed' : 'commission';
  const pagoBarra          = barman
    ? barraPaymentMode === 'fixed'
      ? Math.max(0, Number(barman.pay) || 0)
      : r1000(totalVentas*(pctBarra/100))
    : 0;
  const pagoDJ             = dj?(typeof dj.pay==='number'?dj.pay:0):0;
  const pagoMeseros        = meseros.map(m=>{const v=ventasMeseroPorId[m.id];return{...m,venta:v,pago:r1000(v*(pctMeseros/100))};});
  const capMeseros         = r1000(totalVentas*(pctMeseros/100));
  const totalMeserosFinal  = Math.min(pagoMeseros.reduce((s,m)=>s+m.pago,0),capMeseros);
  const pagoFijosTotal     = pagoFijosStaff.reduce((s,p)=>s+(typeof p.pay==='number'?p.pay:0),0);
  const totalSeguridad     = seguridadStaff.reduce((s,p)=>s+(typeof p.pay==='number'?p.pay:0),0);
  const totalPersonal      = pagoBarra+pagoDJ+totalMeserosFinal+pagoFijosTotal;
  const neto               = totalVentas-totalBancos+(parseInt(extras)||0)-totalGastosT-totalPersonal-(parseInt(pendientes)||0);

  const handleBankReceipt = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBankTransferError('');
    setBankTransferMessage('');
    try {
      const comprobante = await preparePhoto(file);
      setBForm(current => ({ ...current, comprobante }));
    } catch (error) {
      setBankTransferError(error.message || 'No fue posible preparar el comprobante.');
    }
  };

  const registerBankTransfer = async () => {
    const monto = Number(bForm.monto);
    const mesero = authorizedMeseros.find(person => String(person.id) === String(bForm.meseroId || authorizedMeseros[0]?.id));
    if (bankTransfersLoading) {
      setBankTransferError('Espera a que termine la carga de las transferencias del turno.');
      return;
    }
    if (!turnoId || !mesero || !Number.isSafeInteger(monto) || monto <= 0 || savingTransfer) {
      setBankTransferError('Selecciona un mesero activo y un monto válido mayor que cero.');
      return;
    }
    setSavingTransfer(true);
    setBankTransferError('');
    setBankTransferMessage('');
    const transfer = {
      id: uid(),
      negocio_id: negocio.id,
      turno_id: turnoId,
      mesero_id: mesero.id,
      plataforma: bForm.plataforma,
      monto,
      foto_url: bForm.comprobante || null,
      descripcion: bForm.ref.trim() || null,
      verificada: false,
    };
    const saveResult = await localInsertDetailed('transferencias', transfer);
    if (!saveResult.ok) {
      const cause = saveResult.error;
      const isOldSchema = /(?:no such column:\s*|has no column named\s+)(turno_id|mesero_id)/i.test(cause);
      const isTooLarge = /too large|payload|entity too large|request entity/i.test(cause);
      setBankTransferError(isOldSchema
        ? 'La base del servidor aún no tiene las columnas requeridas. Reinicia el backend para aplicar la migración y vuelve a intentarlo.'
        : isTooLarge
          ? 'El comprobante supera el tamaño permitido por el servidor. Selecciona una imagen más pequeña.'
          : `No fue posible guardar la transferencia: ${cause}`);
      setSavingTransfer(false);
      return;
    }
    setBancosTransfs(current => [...current, {
      ...transfer,
      ref: transfer.descripcion || '',
      hora: NOW_TIME(),
      created_at: new Date().toISOString(),
    }]);
    setBForm(current => ({ ...current, monto: '', ref: '', comprobante: '' }));
    setBankTransferMessage(bForm.comprobante
      ? 'Transferencia y comprobante guardados en este turno.'
      : 'Transferencia guardada. Puedes adjuntar una foto de forma opcional.');
    setSavingTransfer(false);
  };

  const removeBankTransfer = async transfer => {
    if (!window.confirm('¿Eliminar esta transferencia y su comprobante del turno?')) return;
    if (String(transfer.id).startsWith('_')) {
      setBancosTransfs(current => current.filter(item => item.id !== transfer.id));
      return;
    }
    const deleted = await localDelete('transferencias', { id: transfer.id });
    if (!deleted) {
      setBankTransferError('No fue posible eliminar la transferencia guardada.');
      return;
    }
    setBancosTransfs(current => current.filter(item => item.id !== transfer.id));
  };

  const updateBankTransferPlatform = async (transfer, plataforma) => {
    if (transfer.plataforma === plataforma) return;
    if (String(transfer.id).startsWith('_')) {
      setBancosTransfs(current => current.map(item => item.id === transfer.id ? { ...item, plataforma } : item));
      return;
    }
    const updated = await localUpdate('transferencias', { id: transfer.id }, { plataforma });
    if (!updated) {
      setBankTransferError('No fue posible actualizar el banco de la transferencia.');
      return;
    }
    setBancosTransfs(current => current.map(item => item.id === transfer.id ? { ...item, plataforma } : item));
  };

  const resetTurno = () => {
    setStep('inicio');setTurnoId('');setTurnoAbierto(null);setMovs({});setGastosT([]);setBancosTransfs([]);
    setBForm({plataforma:'nequi',monto:'',ref:'',meseroId:'',comprobante:''});
    setTransferLinkError('');setBankTransferError('');setBankTransferMessage('');
    setExtras('');setPendientes('');setNovedades('');setBilletes({});setResumen(null);setChecklist({});
    setStaffActivo((negocio.staff.length ? negocio.staff : STAFF_DEFECTO)
      .filter(staff=>!staff.customRole)
      .map(s=>({...s,activo:true})));
    setAuthorizedMeseroIds([]);
    localStorage.removeItem(TURNO_KEY);
  };

  const confirmarApertura = async (checkItems, novedadesApert='') => {
    const barra = barraUsers.find(account => String(account.id) === String(barraSeleccionada));
    if (!barra) {
      alert('Selecciona una cuenta de Barra asignada a este negocio antes de abrir el turno.');
      return;
    }
    const existing = await localFetch('turnos', `negocio_id=eq.${negocio.id}&estado=eq.abierto&select=id&limit=1`);
    if (existing?.length) {
      alert('Ya existe un turno abierto para este negocio.');
      return;
    }
    const currentProducts = await localFetch(
      'productos',
      `negocio_id=eq.${negocio.id}&select=*&order=sort_order.asc`,
    );
    if (!Array.isArray(currentProducts)) {
      alert('No fue posible consultar el inventario actual. No se abrió el turno.');
      return;
    }
    const openingProducts = currentProducts.map(product => ({
      ...(negocio.productos.find(item => item.id === product.id) || {}),
      ...product,
      stock: Number(product.stock) || 0,
    }));
    const id = uid();
    const activos = staffActivo.filter(person => person.activo && person.rol !== 'mesero');
    const inventarioApertura = openingProducts.map(product => ({
      producto_id: product.id,
      nombre: product.name,
      cantidad: Number(product.stock || 0),
    }));
    const created = await localInsert('turnos', {
      id,
      negocio_id: negocio.id,
      modo_operacion: negocio.tipo === 'cantina' ? 'cantina' : 'discoteca',
      base_caja: Number(baseCaja) || 0,
      estado: 'abierto',
      inventario_apertura: inventarioApertura,
      abierto_por: user?.id || null,
      barra_id: barra.id,
      meseros_ids: [],
      novedades_apertura: novedadesApert.trim() || null,
    });
    if (!created) {
      alert('No fue posible abrir el turno en SQLite.');
      return;
    }
    lastProductStocks.current = Object.fromEntries(openingProducts.map(product => [product.id, product.stock]));
    setProductosInventario(openingProducts);
    const movements = inventarioApertura.filter(item => item.cantidad > 0).map(item => ({
      id: uid(),
      negocio_id: negocio.id,
      turno_id: id,
      producto_id: item.producto_id,
      tipo: 'apertura',
      cantidad: item.cantidad,
      motivo: 'Conteo físico de apertura',
      creado_por: user?.id || null,
    }));
    if (movements.length) await localInsert('movimientos_inventario', movements);
    setBancosTransfs([]);
    setBForm({plataforma:'nequi',monto:'',ref:'',meseroId:'',comprobante:''});
    setBankTransferError('');setBankTransferMessage('');
    setTurnoId(id);
    setTurnoAbierto({ id, base_caja: Number(baseCaja) || 0, inventario_apertura: inventarioApertura });
    setAuthorizedMeseroIds([]);
    setChecklist(checkItems);
    if(novedadesApert) setNovedades(novedadesApert);
    setApertura(NOW_TIME());
    setGastosT(GASTOS_PRESETS);   // hielo, limón y vasos siempre visibles
    setBancosTransfs([]);          // limpia tranfs de sesión anterior
    setTab('productos');           // siempre empieza en la pestaña de productos
    setStep('abierto');
    setShowChecklist(false);
  };

  const saveOpeningStock = async product => {
    const rawValue = inventoryOpeningDrafts[product.id];
    const openingStock = Number(rawValue);
    if (rawValue === '' || !Number.isSafeInteger(openingStock) || openingStock < 0) {
      setInventoryOpeningError('El inventario inicial debe ser un número entero igual o mayor que cero.');
      return;
    }
    setSavingOpeningProduct(product.id);
    setInventoryOpeningError('');
    try {
      const result = await localUpdateTurnInventoryOpening(turnoId, {
        productos: [{ producto_id: String(product.id), inventario_inicial: openingStock }],
      });
      if (!Array.isArray(result?.productos) || !Array.isArray(result?.inventario_apertura)) {
        throw new Error('La respuesta de la corrección del inventario inicial no es válida.');
      }
      const updatedStock = result.productos.find(item => String(item.producto_id) === String(product.id))?.existencias;
      if (!Number.isSafeInteger(Number(updatedStock))) {
        throw new Error('No se recibió el inventario actual corregido.');
      }
      setTurnoAbierto(current => ({ ...current, inventario_apertura: result.inventario_apertura }));
      const updatedProducts = productosInventario.map(item =>
        String(item.id) === String(product.id) ? { ...item, stock: Number(updatedStock) } : item
      );
      setProductosInventario(updatedProducts);
      await onUpdateNegocio({ ...negocio, productos: updatedProducts });
      lastProductStocks.current = { ...lastProductStocks.current, [product.id]: Number(updatedStock) };
      setInventoryOpeningDrafts(current => {
        const next = { ...current };
        delete next[product.id];
        return next;
      });
    } catch (error) {
      console.error('No fue posible corregir el inventario inicial de la planilla:', error);
      setInventoryOpeningError(error.message || 'No fue posible corregir el inventario inicial.');
    } finally {
      setSavingOpeningProduct('');
    }
  };

  const cerrarTurno = async () => {
    if (savingTransfer) {
      setBankTransferError('Espera a que termine el guardado de la transferencia antes de cerrar la planilla.');
      setTab('bancos');
      return;
    }
    const personalDetalle=[...pagoMeseros.filter(m=>m.pago>0).map(m=>({name:m.name,rol:'mesero',pago:m.pago})),...(barman?[{name:barman.name,rol:'barra',pago:pagoBarra,nota:barraPaymentMode==='commission'?`${pctBarra}% ventas`:'Pago fijo'}]:[]),...(dj?[{name:dj.name,rol:'dj',pago:pagoDJ,nota:'Pago fijo'}]:[]),...pagoFijosStaff.map(s=>({name:s.name,rol:s.customRole?(s.roleName?.trim()||'Otro'):s.rol,pago:typeof s.pay==='number'?s.pay:0}))];
    const movsList=productosPlanilla.filter(p=>movs[p.id]&&(movs[p.id].salidas||movs[p.id].entradas||movs[p.id].cortesia||movs[p.id].ajusteInventario||movs[p.id].existencias!==undefined)).map(p=>{const m=movs[p.id]||{};const inicio=Number(turnoAbierto?.inventario_apertura?.find(item=>String(item.producto_id)===String(p.id))?.cantidad??p.stock)||0;const vendidas=Math.max(0,(m.salidas||0)-(m.cortesia||0));const finalStock=existenciasProducto(p,m);const total=m.ventaManual!==undefined?m.ventaManual:vendidas*p.price;return{producto_id:p.id,name:p.name,inicio,entradas:m.entradas||0,ajusteInventario:m.ajusteInventario||0,salidas:m.salidas||0,cortesia:m.cortesia||0,final:finalStock,total,precio:p.price,...(m.ventaManual!==undefined?{ventaManual:m.ventaManual}:{})};});
    const gastosDetalle=gastosT.filter(g=>g.monto>0).map(g=>({desc:g.desc,monto:g.monto}));
    const bancoDetalle={};bancosTransfs.forEach(t=>{bancoDetalle[t.plataforma]=(bancoDetalle[t.plataforma]||0)+(Number(t.monto)||0);});
    const r={id:uid(),fecha:formatLocalDateKey(new Date()),apertura,cierre:NOW_TIME(),ventas:totalVentas,bancos:totalBancos,bancoDetalle,gastos:totalGastosT,extras:parseInt(extras)||0,pendientes:parseInt(pendientes)||0,personal:totalPersonal,personalDetalle,gastosDetalle,neto,arqueo:{total:totalBilletes},novedades,movimientos:movsList};
    r.diferencia=totalBilletes-neto;
    const newProds=productosPlanilla.map(p=>{const m=movs[p.id];if(!m)return p;return{...p,stock:Math.max(0,existenciasProducto(p,m))};});
    await onUpdateNegocio({...negocio,productos:newProds,planillas:[r,...negocio.planillas]});
    setTransferLinkError('');
    const transfersToLink = bancosTransfs.filter(transfer => !String(transfer.id).startsWith('_'));
    const linkedTransfers = await Promise.all(transfersToLink.map(transfer =>
      localUpdate('transferencias', { id: transfer.id }, { planilla_id: r.id })
    ));
    if (linkedTransfers.some(linked => !linked)) {
      console.error('La planilla cerró, pero algunos comprobantes bancarios no pudieron asociarse a su cierre.');
      setTransferLinkError('La planilla se cerró, pero no fue posible asociar todos los comprobantes bancarios al cierre. Revisa la conexión y contacta al gerente.');
    }
    if (turnoId) {
      localUpdate('turnos', { id: turnoId }, {
        estado: 'cerrado',
        legacy_planilla_id: r.id,
        fecha_cierre: new Date().toISOString(),
        inventario_cierre: movsList.map(item => ({
          producto_id: item.producto_id,
          nombre: item.name,
          cantidad: item.final,
        })),
        cerrado_por: user?.id || null,
        novedades_cierre: novedades || null,
      });
    }
    localStorage.removeItem(TURNO_KEY);
    setResumen(r);setStep('cerrado');
  };

  const tabs=[{id:'productos',label:'Planilla Productos'},{id:'ventas',label:'Personal'},{id:'gastos',label:'Gastos'},{id:'bancos',label:'Bancos'},{id:'novedades',label:'Novedades'},{id:'perspectiva',label:'📊 Perspectiva'},{id:'cierre',label:'Cerrar Turno'}];
  const historyWeekRange = currentBogotaWeekRange();
  const sortedClosedPlanillas = [...(negocio.planillas || [])]
    .sort((first, second) => (planillaDateKey(second.fecha) || '').localeCompare(planillaDateKey(first.fecha) || ''));
  const closedPlanillasInScope = showAllClosedPlanillas
    ? sortedClosedPlanillas
    : sortedClosedPlanillas.filter(planilla => {
      const dateKey = planillaDateKey(planilla.fecha);
      return dateKey && dateKey >= historyWeekRange.start && dateKey <= historyWeekRange.end;
    });
  const planillaNote = typeof viewPlanilla?.novedades === 'string' ? viewPlanilla.novedades.trim() : '';
  const closedNotes = [
    ...closedTurnNotes,
    ...(planillaNote && !closedTurnNotes.some(note => note.texto === planillaNote)
      ? [{ id: `${viewPlanilla?.id}-planilla`, tipo: 'Planilla', texto: planillaNote, created_at: null }]
      : []),
  ];
  const closedMovements = Array.isArray(viewPlanilla?.movimientos) ? viewPlanilla.movimientos : [];
  const closedStaffPayments = Array.isArray(viewPlanilla?.personalDetalle) ? viewPlanilla.personalDetalle : [];
  const closedExpenses = Array.isArray(viewPlanilla?.gastosDetalle) ? viewPlanilla.gastosDetalle : [];
  const closedPlanillaReport = (
    <div style={{display:'grid',gap:12,marginTop:'1rem'}}>
      <section style={s.card}>
        <div style={{fontWeight:700,fontSize:13,marginBottom:10}}>Movimiento de inventario</div>
        {closedMovements.length===0
          ? <div style={{color:C.sub,fontSize:12}}>Esta planilla no tiene movimientos de inventario guardados.</div>
          : <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',minWidth:700,borderCollapse:'collapse',fontSize:11}}>
              <thead><tr>{['Producto','Inicio','Entradas','Ajustes','Existencias','Salidas','Cortesías','Precio','Total'].map(label=><th key={label} style={{padding:'7px 8px',borderBottom:`1px solid ${C.border}`,color:C.sub,textAlign:label==='Producto'?'left':'right',whiteSpace:'nowrap'}}>{label}</th>)}</tr></thead>
              <tbody>{closedMovements.map((movement,index)=>{
                const salesQuantity=Math.max(0,(Number(movement.salidas)||0)-(Number(movement.cortesia)||0));
                const stock=movement.final??((Number(movement.inicio)||0)+(Number(movement.entradas)||0)+(Number(movement.ajusteInventario)||0)-(Number(movement.salidas)||0));
                const total=movement.ventaManual!==undefined?movement.ventaManual:movement.total!==undefined?movement.total:salesQuantity*(Number(movement.precio)||0);
                return <tr key={movement.producto_id||`${movement.name}-${index}`}>
                  <td style={{padding:'7px 8px',borderBottom:`1px solid ${C.border}40`}}>{movement.name||'Producto'}</td>
                  <td style={{padding:'7px 8px',textAlign:'right'}}>{movement.inicio||0}</td>
                  <td style={{padding:'7px 8px',textAlign:'right'}}>{movement.entradas||0}</td>
                  <td style={{padding:'7px 8px',textAlign:'right',color:movement.ajusteInventario?C.amber:C.sub}}>{movement.ajusteInventario>0?'+':''}{movement.ajusteInventario||0}</td>
                  <td style={{padding:'7px 8px',textAlign:'right'}}>{stock}</td>
                  <td style={{padding:'7px 8px',textAlign:'right'}}>{movement.salidas||0}</td>
                  <td style={{padding:'7px 8px',textAlign:'right'}}>{movement.cortesia||0}</td>
                  <td style={{padding:'7px 8px',textAlign:'right',whiteSpace:'nowrap'}}>{COP(movement.precio||0)}</td>
                  <td style={{padding:'7px 8px',textAlign:'right',whiteSpace:'nowrap'}}>{COP(total||0)}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>}
      </section>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))',gap:12}}>
        <section style={s.card}>
          <div style={{fontWeight:700,fontSize:13,marginBottom:8}}>Pagos de personal</div>
          {closedStaffPayments.length===0
            ? <div style={{color:C.sub,fontSize:12}}>Sin pagos de personal detallados.</div>
            : closedStaffPayments.map((payment,index)=><div key={`${payment.name}-${index}`} style={{display:'flex',justifyContent:'space-between',gap:8,padding:'5px 0',borderBottom:`1px solid ${C.border}40`,fontSize:11}}>
              <span>{payment.name}{payment.rol?` · ${payment.rol}`:''}</span><strong>{COP(payment.pago||0)}</strong>
            </div>)}
        </section>
        <section style={s.card}>
          <div style={{fontWeight:700,fontSize:13,marginBottom:8}}>Gastos del turno</div>
          {closedExpenses.length===0
            ? <div style={{color:C.sub,fontSize:12}}>Sin gastos detallados.</div>
            : closedExpenses.map((expense,index)=><div key={`${expense.desc||expense.descripcion}-${index}`} style={{display:'flex',justifyContent:'space-between',gap:8,padding:'5px 0',borderBottom:`1px solid ${C.border}40`,fontSize:11}}>
              <span>{expense.desc||expense.descripcion||'Gasto'}</span><strong>{COP(expense.monto||0)}</strong>
            </div>)}
        </section>
        <section style={s.card}>
          <div style={{fontWeight:700,fontSize:13,marginBottom:8}}>Resumen financiero</div>
          {[['Ventas',viewPlanilla?.ventas],['Gastos',viewPlanilla?.gastos],['Bancos',viewPlanilla?.bancos],['Descorches/Extras',viewPlanilla?.extras],['Neto',viewPlanilla?.neto]].map(([label,value])=>(
            <div key={label} style={{display:'flex',justifyContent:'space-between',gap:8,padding:'5px 0',borderBottom:`1px solid ${C.border}40`,fontSize:11}}>
              <span>{label}</span><strong>{COP(value||0)}</strong>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
  const closedNoveltiesContent = (
    <div style={{marginTop:'1rem'}}>
      {closedNoveltiesLoading&&<div style={{color:C.sub,fontSize:12}}>Cargando novedades...</div>}
      {closedNoveltiesError&&<div role="alert" style={{color:C.red,fontSize:12,padding:'10px 12px',borderRadius:8,background:`${C.red}12`,marginBottom:10}}>{closedNoveltiesError}</div>}
      {!closedNoveltiesLoading&&!closedNoveltiesError&&closedTurnNovelties.length===0&&closedNotes.length===0
        ? <div style={{...s.card,color:C.sub,fontSize:12,textAlign:'center'}}>No hay novedades registradas para esta planilla.</div>
        : <div style={{display:'grid',gap:8}}>
          {closedNotes.map(note=>(
            <article key={note.id} style={{...s.card,padding:'12px 14px'}}>
              <div style={{display:'flex',justifyContent:'space-between',gap:12,marginBottom:6}}>
                <strong style={{fontSize:12}}>{note.tipo}</strong>
                {note.created_at&&<time style={{fontSize:10,color:C.sub}}>{formatLocalTime(note.created_at)}</time>}
              </div>
              <div style={{fontSize:12,color:C.text2,whiteSpace:'pre-wrap'}}>{note.texto}</div>
            </article>
          ))}
          {closedTurnNovelties.map((novelty,index)=>(
            <article key={novelty.id||`${novelty.created_at}-${index}`} style={{...s.card,padding:'12px 14px'}}>
              <div style={{display:'flex',justifyContent:'space-between',gap:12,marginBottom:6}}>
                <strong style={{fontSize:12}}>Novedad del turno</strong>
                {novelty.created_at&&<time style={{fontSize:10,color:C.sub}}>{formatLocalTime(novelty.created_at)}</time>}
              </div>
              <div style={{fontSize:12,color:C.text2,whiteSpace:'pre-wrap'}}>{novelty.texto}</div>
            </article>
          ))}
        </div>}
    </div>
  );

  // ── JEFE: solo lectura de historial ──────────────────────────────────────────
  if (isJefe) return (
    <div>
      <SectionTitle>Planillas — {negocio.name}</SectionTitle>
      {viewPlanilla ? (
        <div>
          <div style={{display:'flex',gap:8,marginBottom:'1rem'}}>
            <button style={s.btn()} onClick={()=>setViewPlanilla(null)}>← Volver</button>
            <button style={s.btn('primary')} onClick={()=>printPlanilla(viewPlanilla,negocio.name)}>🖨 Descargar PDF</button>
          </div>
          <div className="planilla-detail-tabs" role="tablist" aria-label="Detalle del turno cerrado">
            <button type="button" role="tab" aria-selected={closedPlanillaTab==='planilla'} className={closedPlanillaTab==='planilla'?'is-active':''} onClick={()=>setClosedPlanillaTab('planilla')}>Planilla cerrada</button>
            <button type="button" role="tab" aria-selected={closedPlanillaTab==='comandas'} className={closedPlanillaTab==='comandas'?'is-active':''} onClick={()=>setClosedPlanillaTab('comandas')}>Comandas de la noche</button>
            <button type="button" role="tab" aria-selected={closedPlanillaTab==='novedades'} className={closedPlanillaTab==='novedades'?'is-active':''} onClick={()=>setClosedPlanillaTab('novedades')}>Novedades</button>
          </div>
          {closedPlanillaTab==='planilla' ? <>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:'1.25rem'}}>
            <Metric label="Ventas"   value={COP(viewPlanilla.ventas)}       color={C.green}/>
            <Metric label="Bancos"   value={COP(viewPlanilla.bancos||0)}    color={C.indigo}/>
            <Metric label="Neto"     value={COP(viewPlanilla.neto)}         color={C.amber}/>
            <Metric label="Personal" value={COP(viewPlanilla.personal||0)}  color={C.red}/>
          </div>
          {closedPlanillaReport}
          <div style={{...s.card,marginTop:'1rem'}}>
            <div style={{fontWeight:700,fontSize:14,marginBottom:12}}>🏦 Transferencias y comprobantes</div>
            {bankHistoryError&&<div role="alert" style={{color:C.red,fontSize:12,marginBottom:10}}>{bankHistoryError}</div>}
            <BankTransferHistory transfers={planillaBankTransfers} users={users}/>
          </div>
          </> : closedPlanillaTab==='comandas' ? <div style={{...s.card,marginTop:'1rem'}}>
            <div style={{fontWeight:700,fontSize:14,marginBottom:4}}>🧾 Comandas de esta noche</div>
            <div style={{fontSize:12,color:C.sub,marginBottom:12}}>Solo se muestran las comandas del turno correspondiente a la planilla {viewPlanilla.fecha}.</div>
            <ComandaMeseroFilter meseros={viewMeseros} comandas={viewComandas} selected={viewMeseroFilter} onChange={setViewMeseroFilter}/>
            {comandasLoading&&<div style={{color:C.sub,fontSize:12}}>Cargando comandas...</div>}
            {comandasError&&<div role="alert" style={{color:C.red,fontSize:12,padding:'10px 12px',borderRadius:8,background:`${C.red}12`}}>{comandasError}</div>}
            {!comandasError&&<PlanillaComandaTabs
              comandas={viewComandasVisibles}
              itemsByOrder={viewComandaItems}
              activeStatus={viewActiveStatus}
              onStatusChange={setViewActiveStatus}
            />}
          </div> : closedNoveltiesContent}
        </div>
      ) : (
        <div style={s.card}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap',marginBottom:12}}>
            <div>
              <strong style={{fontSize:13}}>Turnos cerrados</strong>
              <div style={{fontSize:11,color:C.sub,marginTop:3}}>{showAllClosedPlanillas?'Mostrando todos los cierres.':'Mostrando únicamente cierres de esta semana.'}</div>
            </div>
            <button type="button" className="planilla-view-button" onClick={()=>setShowAllClosedPlanillas(current=>!current)}>
              {showAllClosedPlanillas?'Ver esta semana':'Consultar planillas anteriores'}
            </button>
          </div>
          {closedPlanillasInScope.length===0
            ? <div className="planilla-history-empty">{showAllClosedPlanillas?'Aún no hay planillas cerradas.':'No hay turnos cerrados esta semana.'}</div>
            : closedPlanillasInScope.map(p=>(
            <div key={p.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 0',borderBottom:`1px solid ${C.border}50`}}>
              <div><span style={{fontWeight:600,fontSize:13}}>{p.fecha}</span><span style={{color:C.sub,marginLeft:8,fontSize:11}}>{p.apertura}–{p.cierre}</span></div>
              <div style={{display:'flex',gap:12,alignItems:'center'}}>
                <span style={{color:C.green,fontWeight:600,fontSize:13}}>{COP(p.ventas)}</span>
                <span style={{color:C.amber,fontWeight:700,fontSize:13}}>{COP(p.neto)}</span>
                <button className="planilla-view-button" onClick={()=>setViewPlanilla(p)}>🧾 Ver detalle</button>
                <button style={{...s.btn(),padding:'2px 10px',fontSize:11}} onClick={()=>printPlanilla(p,negocio.name)}>🖨</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ── Turno cerrado ────────────────────────────────────────────────────────────
  if (step==='cerrado'&&resumen) {
    const dif=resumen.diferencia;
    return(
      <div>
        <SectionTitle>🔒 Planilla Cerrada — {resumen.fecha}</SectionTitle>
        <div style={{...s.card,borderColor:C.green+'50',marginBottom:'1rem',display:'flex',alignItems:'center',gap:12,padding:'12px 16px'}}>
          <span style={{color:C.green,fontSize:18}}>✓</span>
          <div style={{flex:1,fontSize:13}}>Turno {resumen.apertura}–{resumen.cierre} bloqueado.</div>
          <button style={s.btn()} onClick={()=>printPlanilla(resumen,negocio.name)}>🖨 PDF</button>
          <button style={s.btn('primary')} onClick={resetTurno}>Nuevo Turno</button>
        </div>
        {transferLinkError&&<div role="alert" style={{...s.card,color:C.red,borderColor:`${C.red}50`,marginBottom:'1rem'}}>{transferLinkError}</div>}
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:'1.25rem'}}>
          <Metric label="Ventas"     value={COP(resumen.ventas)}        color={C.green}/>
          <Metric label="Bancos"     value={COP(resumen.bancos)}        color={C.indigo}/>
          <Metric label="Neto"       value={COP(resumen.neto)}          color={C.amber}/>
          <Metric label="Diferencia" value={COP(Math.abs(dif))} sub={dif===0?'Exacto ✓':dif>0?'Sobrante':'Faltante'} color={dif===0?C.green:C.red}/>
        </div>
        {resumen.novedades&&<div style={{...s.card,borderColor:C.amber+'40'}}><div style={{fontWeight:700,fontSize:13,marginBottom:6}}>Novedades</div><div style={{fontSize:13,color:C.text2}}>{resumen.novedades}</div></div>}
      </div>
    );
  }

  // ── Turno inicio ────────────────────────────────────────────────────────────
  if (step==='inicio') {
    const historyPageSize = 10;
    const closedPlanillas = negocio.planillas || [];
    const normalizedSearch = historySearch.trim().toLocaleLowerCase('es');
    const filteredClosedPlanillas = [...closedPlanillas]
      .filter(planilla => {
        const dateKey = planillaDateKey(planilla.fecha);
        const searchable = `${planilla.fecha || ''} ${planilla.apertura || ''} ${planilla.cierre || ''}`.toLocaleLowerCase('es');
        const inSelectedPeriod = showAllClosedPlanillas
          || (dateKey && dateKey >= historyWeekRange.start && dateKey <= historyWeekRange.end);
        return inSelectedPeriod
          && (!normalizedSearch || searchable.includes(normalizedSearch))
          && (!historyFrom || (dateKey && dateKey >= historyFrom))
          && (!historyTo || (dateKey && dateKey <= historyTo));
      })
      .sort((first, second) => (planillaDateKey(second.fecha) || '').localeCompare(planillaDateKey(first.fecha) || ''));
    const historyPageCount = Math.max(1, Math.ceil(filteredClosedPlanillas.length / historyPageSize));
    const visibleClosedPlanillas = filteredClosedPlanillas.slice(
      historyPage * historyPageSize,
      (historyPage + 1) * historyPageSize
    );
    const clearHistoryFilters = () => {
      setHistorySearch('');
      setHistoryFrom('');
      setHistoryTo('');
      setHistoryPage(0);
    };
    return(
      <div className="planilla-home">
        <header className="planilla-home__hero">
          <div>
            <span>CONTROL DE TURNOS</span>
            <h1>Planillas</h1>
            <p>Prepara un nuevo turno o consulta cierres anteriores de {negocio.name}.</p>
          </div>
          <div className="planilla-home__hero-stat">
            <strong>{closedPlanillas.length}</strong>
            <span>turnos cerrados</span>
          </div>
        </header>
        <div className="planilla-home__grid">
          <div className="planilla-open-card">
            <div className="planilla-home__card-heading">
              <span className="planilla-home__icon">＋</span>
              <div><h2>Abrir turno</h2><p>Configura la caja y el equipo de trabajo.</p></div>
            </div>
            <div style={{marginBottom:12}}><div style={s.label}>Base de Caja (COP)</div><input style={s.inp} type="number" value={baseCaja} onChange={e=>setBaseCaja(e.target.value)}/></div>
            <div style={{marginBottom:12}}>
              <div style={s.label}>Usuario de Barra para este turno</div>
              <select
                style={s.sel}
                value={barraSeleccionada}
                onChange={event=>setBarraSeleccionada(event.target.value)}
              >
                <option value="">Selecciona la cuenta de Barra</option>
                {barraUsers.map(account=>(
                  <option key={account.id} value={account.id}>{account.name} · {account.email}</option>
                ))}
              </select>
              <div style={{fontSize:11,color:C.sub,marginTop:5}}>
                Solo esta cuenta podrá acceder al espacio de Barra durante el turno.
              </div>
              {!usersLoading&&usersError&&(
                <div role="alert" style={{fontSize:12,color:C.red,marginTop:6}}>
                  {usersError}
                </div>
              )}
              {usersLoading&&(
                <div role="status" style={{fontSize:12,color:C.sub,marginTop:6}}>
                  Actualizando cuentas de Barra...
                </div>
              )}
              {!usersLoading&&!usersError&&!barraUsers.length&&(
                <div role="alert" style={{fontSize:12,color:C.red,marginTop:6}}>
                  No hay usuarios de Barra asignados a este negocio. Asigna uno en Gestión de Usuarios para poder abrir el turno.
                </div>
              )}
            </div>
            <div style={{marginBottom:12}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                <div style={s.label}>Personal del Turno</div>
                <div style={{display:'flex',gap:5}}>
                  <input style={{...s.inp,width:120,padding:'3px 8px',fontSize:11}} placeholder="Filtrar..." value={staffFilter} onChange={e=>setStaffFilter(e.target.value)}/>
                  <button style={{...s.btn(),padding:'3px 10px',fontSize:11,color:C.green,border:`1px solid ${C.green}30`}} onClick={()=>setShowNuevoStaff(true)}>+ Nuevo</button>
                  {!isAux&&<button style={{...s.btn(),padding:'3px 10px',fontSize:11}} onClick={()=>setShowStaffModal(true)}>⚙</button>}
                </div>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:5,maxHeight:260,overflowY:'auto'}}>
                {staffFiltrado.map(st=>(
                  <div key={st.id} style={{display:'flex',alignItems:'center',gap:6,padding:'3px 6px',borderRadius:6,background:st.activo?negocio.color+'12':'transparent'}}>
                    <input type="checkbox" checked={st.activo} onChange={e=>setStaffActivo(p=>p.map(x=>x.id===st.id?{...x,activo:e.target.checked}:x))} style={{accentColor:negocio.color,flexShrink:0}}/>
                    <input
                      style={{...s.inp,flex:1,padding:'2px 6px',fontSize:12,minWidth:0,height:24}}
                      value={st.name}
                      onChange={e=>setStaffActivo(p=>p.map(x=>x.id===st.id?{...x,name:e.target.value}:x))}
                    />
                    <Badge color={ROL_COLORS[st.rol]||C.muted} small>{st.rol}</Badge>
                    <span style={{color:C.sub,fontSize:11,flexShrink:0}}>{typeof st.pay==='number'?COP(st.pay):st.pay}</span>
                    <button
                      style={{background:'none',border:'none',cursor:'pointer',color:C.muted,padding:'0 2px',fontSize:13,lineHeight:1,flexShrink:0}}
                      title="Quitar del turno"
                      onClick={()=>setStaffActivo(p=>p.filter(x=>x.id!==st.id))}
                    >✕</button>
                  </div>
                ))}
              </div>
              <div style={{fontSize:11,color:C.sub,marginTop:5}}>{staffActivo.filter(person=>person.activo).length}/{staffActivo.length} personas seleccionadas</div>
            </div>
            <button className="planilla-open-button" type="button" disabled={usersLoading||Boolean(usersError)||!barraUsers.length||!barraSeleccionada} onClick={()=>setShowChecklist(true)}>Abrir turno <span>→</span></button>
          </div>
          <div className="planilla-history-card">
            <div className="planilla-history-card__heading">
              <div className="planilla-home__card-heading">
                <span className="planilla-home__icon planilla-home__icon--history">▤</span>
                <div><h2>Turnos cerrados</h2><p>{showAllClosedPlanillas?'Consulta cualquier cierre anterior.':'Se muestran los cierres de esta semana.'}</p></div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                <Badge color={C.green} small>{filteredClosedPlanillas.length} registros</Badge>
                <button type="button" className="planilla-view-button" onClick={()=>{setShowAllClosedPlanillas(current=>!current);setHistoryPage(0);}}>
                  {showAllClosedPlanillas?'Ver esta semana':'Consultar anteriores'}
                </button>
              </div>
            </div>
            <div className="planilla-history-filters">
              <label className="planilla-history-search"><span aria-hidden="true">⌕</span><input aria-label="Buscar planillas por fecha u horario" placeholder="Buscar fecha u horario..." value={historySearch} onChange={event=>{setHistorySearch(event.target.value);setHistoryPage(0);}}/></label>
              <label><span>Desde</span><input type="date" aria-label="Filtrar planillas desde la fecha" value={historyFrom} onChange={event=>{setHistoryFrom(event.target.value);setHistoryPage(0);}}/></label>
              <label><span>Hasta</span><input type="date" aria-label="Filtrar planillas hasta la fecha" value={historyTo} onChange={event=>{setHistoryTo(event.target.value);setHistoryPage(0);}}/></label>
              {(historySearch||historyFrom||historyTo)&&<button type="button" onClick={clearHistoryFilters}>Limpiar</button>}
            </div>
            <div className="planilla-history-limit">Mostrando hasta 10 cierres por página · {filteredClosedPlanillas.length} resultados</div>
            {visibleClosedPlanillas.length===0
              ? <div className="planilla-history-empty">{closedPlanillas.length?'No hay cierres que coincidan con los filtros.':'Aún no hay planillas cerradas.'}</div>
              : <div className="planilla-history-list">{visibleClosedPlanillas.map(planilla=>(
                <article key={planilla.id} className="planilla-history-row">
                  <div className="planilla-history-row__date">
                    <span>FECHA DEL TURNO</span>
                    <strong>{planilla.fecha}</strong>
                    <small>{planilla.apertura||'—'}–{planilla.cierre||'—'}</small>
                  </div>
                  <div className="planilla-history-row__metric"><span>Ventas</span><strong>{COP(planilla.ventas)}</strong></div>
                  <div className="planilla-history-row__metric"><span>Neto</span><strong className={planilla.neto>=0?'is-positive':'is-negative'}>{COP(planilla.neto)}</strong></div>
                  <div className="planilla-history-row__actions">
                    <button className="planilla-view-button" type="button" onClick={()=>setViewPlanilla(planilla)}>Ver detalle</button>
                    <button className="planilla-history-print" type="button" aria-label={`Descargar PDF de la planilla ${planilla.fecha}`} title="Descargar PDF" onClick={()=>printPlanilla(planilla,negocio.name)}>PDF</button>
                  </div>
                </article>
              ))}</div>}
            {historyPageCount>1&&<div className="planilla-history-pagination">
              <button type="button" onClick={()=>setHistoryPage(page=>Math.max(0,page-1))} disabled={historyPage===0}>← Anterior</button>
              <span>Página {historyPage+1} de {historyPageCount}</span>
              <button type="button" onClick={()=>setHistoryPage(page=>Math.min(historyPageCount-1,page+1))} disabled={historyPage>=historyPageCount-1}>Siguiente →</button>
            </div>}
          </div>
        </div>

        {viewPlanilla&&(
          <div style={{...s.card,marginTop:'1.25rem'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1rem'}}>
              <div style={{fontWeight:700,fontSize:14}}>Planilla {viewPlanilla.fecha}</div>
              <div style={{display:'flex',gap:8}}>
                <button style={s.btn('primary')} onClick={()=>printPlanilla(viewPlanilla,negocio.name)}>🖨 PDF</button>
                <button style={s.btn()} onClick={()=>setViewPlanilla(null)}>✕</button>
              </div>
            </div>
            <div className="planilla-detail-tabs" role="tablist" aria-label="Detalle del turno cerrado">
              <button type="button" role="tab" aria-selected={closedPlanillaTab==='planilla'} className={closedPlanillaTab==='planilla'?'is-active':''} onClick={()=>setClosedPlanillaTab('planilla')}>Planilla cerrada</button>
              <button type="button" role="tab" aria-selected={closedPlanillaTab==='comandas'} className={closedPlanillaTab==='comandas'?'is-active':''} onClick={()=>setClosedPlanillaTab('comandas')}>Comandas de la noche</button>
              <button type="button" role="tab" aria-selected={closedPlanillaTab==='novedades'} className={closedPlanillaTab==='novedades'?'is-active':''} onClick={()=>setClosedPlanillaTab('novedades')}>Novedades</button>
            </div>
            {closedPlanillaTab==='planilla' ? <>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10}}>
              <Metric label="Ventas"   value={COP(viewPlanilla.ventas)}       color={C.green}/>
              <Metric label="Bancos"   value={COP(viewPlanilla.bancos||0)}    color={C.indigo}/>
              <Metric label="Neto"     value={COP(viewPlanilla.neto)}         color={C.amber}/>
              <Metric label="Personal" value={COP(viewPlanilla.personal||0)}  color={C.red}/>
            </div>
            {closedPlanillaReport}
            <div style={{marginTop:'1rem',paddingTop:'1rem',borderTop:`1px solid ${C.border}50`}}>
              <div style={{fontWeight:700,fontSize:14,marginBottom:12}}>🏦 Transferencias y comprobantes</div>
              {bankHistoryError&&<div role="alert" style={{color:C.red,fontSize:12,marginBottom:10}}>{bankHistoryError}</div>}
              <BankTransferHistory transfers={planillaBankTransfers} users={users}/>
            </div>
            </> : closedPlanillaTab==='comandas' ? <div style={{...s.card,marginTop:'1rem'}}>
              <div style={{fontWeight:700,fontSize:14,marginBottom:4}}>🧾 Comandas de esta noche</div>
              <div style={{fontSize:12,color:C.sub,marginBottom:12}}>Solo se muestran las comandas del turno correspondiente a la planilla {viewPlanilla.fecha}.</div>
              <ComandaMeseroFilter meseros={viewMeseros} comandas={viewComandas} selected={viewMeseroFilter} onChange={setViewMeseroFilter}/>
              {comandasLoading&&<div style={{color:C.sub,fontSize:12}}>Cargando comandas...</div>}
              {comandasError&&<div role="alert" style={{color:C.red,fontSize:12,padding:'10px 12px',borderRadius:8,background:`${C.red}12`}}>{comandasError}</div>}
              {!comandasError&&<PlanillaComandaTabs
                comandas={viewComandasVisibles}
                itemsByOrder={viewComandaItems}
                activeStatus={viewActiveStatus}
                onStatusChange={setViewActiveStatus}
              />}
            </div> : closedNoveltiesContent}
          </div>
        )}

        {showStaffModal&&(
          <Modal title="Gestionar Personal" onClose={()=>setShowStaffModal(false)} width="min(620px,96vw)">
            <div style={{marginBottom:12,fontSize:12,color:C.sub}}>Edita el personal del negocio. Los cambios aplican a futuros turnos.</div>
            {staffActivo.filter(st=>!st.temporal).map((st,i)=>(
              <div key={st.id} style={{display:'flex',alignItems:'center',gap:8,padding:'7px 0',borderBottom:`1px solid ${C.border}40`}}>
                <div style={{width:30,height:30,borderRadius:'50%',background:(ROL_COLORS[st.rol]||C.muted)+'25',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,color:ROL_COLORS[st.rol]||C.muted,fontWeight:700,flexShrink:0}}>{st.name.slice(0,2).toUpperCase()}</div>
                <input style={{...s.inp,flex:1,padding:'4px 8px',fontSize:12}} value={st.name} onChange={e=>setStaffActivo(p=>p.map((x,j)=>j===i?{...x,name:e.target.value}:x))}/>
                <select style={{...s.sel,width:90,padding:'4px 8px',fontSize:11}} value={st.rol} onChange={e=>setStaffActivo(p=>p.map((x,j)=>j===i?{...x,rol:e.target.value}:x))}>
                  {ROLES_LIST.map(r=><option key={r} value={r}>{r}</option>)}
                </select>
                <input style={{...s.inp,width:75,padding:'4px 8px',fontSize:11}} value={st.pay} onChange={e=>setStaffActivo(p=>p.map((x,j)=>j===i?{...x,pay:isNaN(Number(e.target.value))?e.target.value:Number(e.target.value)}:x))}/>
                <button style={{background:'none',border:'none',cursor:'pointer',color:C.muted,padding:'0 4px'}} onClick={()=>setStaffActivo(p=>p.filter((_,j)=>j!==i))}>✕</button>
              </div>
            ))}
            <button style={{...s.btn('primary'),marginTop:12}} onClick={async()=>{
              const newStaff=staffActivo.filter(s=>!s.temporal).map(({activo,...s})=>s);
              await onUpdateNegocio({...negocio,staff:newStaff});
              await localDeleteStaff(negocio.id);
              if(newStaff.length>0) await localInsert('staff', newStaff.map(s=>({...s,negocio_id:negocio.id})));
              setShowStaffModal(false);
            }}>Guardar Personal</button>
          </Modal>
        )}
        {showChecklist&&<ChecklistModal onClose={()=>setShowChecklist(false)} onConfirm={confirmarApertura}/>}
        {showNuevoStaff&&<NuevoStaffModal onClose={()=>setShowNuevoStaff(false)} negocioColor={negocio.color} onAgregar={nuevo=>setStaffActivo(p=>[...p,nuevo])}/>}
      </div>
    );
  }

  // ── Turno abierto ────────────────────────────────────────────────────────────
  return(
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1rem'}}>
        <div><div style={{fontSize:18,fontWeight:800}}>Turno Activo — {negocio.name}</div><div style={{fontSize:12,color:C.sub,marginTop:2}}>Apertura: {apertura} · Base: {COP(parseInt(baseCaja))}</div></div>
        <Badge color={C.green}>En Curso</Badge>
      </div>
      {turnoAbierto&&<div style={{...s.card,borderColor:C.green+'70',background:C.green+'10',display:'flex',alignItems:'center',gap:10,marginBottom:'1rem',padding:'10px 14px'}}>
        <span style={{fontSize:18}}>🔔</span>
        <div style={{flex:1,fontSize:12}}><strong>Hay un turno abierto.</strong><div style={{color:C.sub}}>Puedes continuar trabajando y cerrarlo desde la pestaña “Cerrar Turno”.</div></div>
        <button style={{...s.btn('primary'),padding:'6px 10px',fontSize:11}} onClick={()=>setTab('cierre')}>Ir al cierre</button>
      </div>}
      <div style={{position:'sticky',top:56,zIndex:10,background:C.bg,paddingBottom:'0.5rem',marginBottom:'0.25rem',borderBottom:`1px solid ${C.border}30`}}>
        <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:6,marginBottom:'0.4rem'}}>
          <Metric label="Ventas"   value={COP(totalVentas)}    color={C.green}   compact/>
          <Metric label="Bancos"   value={COP(totalBancos)}    color={C.indigo}  compact/>
          <Metric label="Gastos"   value={COP(totalGastosT)}   color={C.red}     compact/>
          <Metric label="Personal" value={COP(totalPersonal)}  color={C.amber}   compact/>
          <Metric label="Neto"     value={COP(neto)}           color={neto>=0?C.green:C.red} compact/>
        </div>
        <TabBar tabs={tabs} active={tab} onChange={setTab} color={negocio.color}/>
      </div>

      {tab==='productos'&&(
        <div style={s.card}>
          <div style={{fontWeight:700,fontSize:13,marginBottom:'0.25rem'}}>Movimiento de Inventario</div>
          <div style={{fontSize:11,color:C.sub,marginBottom:'0.75rem'}}>
            📥 <strong style={{color:C.green}}>Entradas</strong> = mercancía que llegó este turno. &nbsp;
            ✎ <strong style={{color:C.amber}}>Ajustes</strong> = correcciones de inventario registradas por gerencia. &nbsp;
            📦 <strong style={{color:C.green}}>Existencias</strong> = inventario disponible, actualizado con los despachos y editable. &nbsp;
            📤 <strong style={{color:C.amber}}>Salidas</strong> = calculadas desde el inventario inicial. &nbsp;
            🎁 <strong style={{color:C.purple}}>Cortesías</strong> = unidades sin cobro incluidas en las salidas.
          </div>
          {inventoryEntriesError && <div role="alert" style={{color:C.red,fontSize:11,marginBottom:10}}>{inventoryEntriesError}</div>}
          {inventoryOpeningError && <div role="alert" style={{color:C.red,fontSize:11,marginBottom:10}}>{inventoryOpeningError}</div>}
          {(()=>{
            const negatives=productosPlanilla.filter(p=>existenciasProducto(p,movs[p.id])<0);
            if(!negatives.length) return null;
            return <div style={{padding:'10px 14px',background:C.red+'18',border:`2px solid ${C.red}60`,borderRadius:8,marginBottom:'0.75rem',fontSize:12}}>
              <div style={{fontWeight:700,color:C.red,marginBottom:4}}>⚠ Existencias insuficientes — no se puede cerrar el turno con stock negativo</div>
              <div style={{color:C.text}}>Productos: {negatives.map(p=>`${p.name} (exist:${existenciasProducto(p,movs[p.id])})`).join(' · ')}</div>
            </div>;
          })()}
          <div style={{overflowX:'auto',overflowY:'auto',maxHeight:'calc(100vh - 290px)'}}>
            <table style={{width:'100%',borderCollapse:'collapse',minWidth:760}}>
              <thead><tr>{['Producto','Cat.','Inicio','📥 Entradas','📦 Existencias','📤 Salidas','🎁 Cortesía','Final','Venta'].map(h=><th key={h} style={{...s.th,position:'sticky',top:0,zIndex:2,background:'#1a1a2e'}}>{h}</th>)}</tr></thead>
              <tbody>{productosPlanilla.map((p,i)=>{
                const m=movs[p.id]||{};const e=m.entradas||0;const sa=m.salidas||0;const co=m.cortesia||0;const inicio=Number(turnoAbierto?.inventario_apertura?.find(item=>String(item.producto_id)===String(p.id))?.cantidad??p.stock)||0;const existencias=existenciasProducto(p,m);const final=existencias;
                return(
                  <tr key={p.id} style={{background:final<0?C.red+'10':i%2===0?C.rowA:C.rowB}}>
                    <td style={{...s.td(i),fontWeight:500,fontSize:11}}>{p.name}</td>
                    <td style={s.td(i)}><Badge color={CAT_COLORS[p.cat]||C.muted} small>{p.cat}</Badge></td>
                    <td style={{...s.td(i),fontWeight:700,color:C.sub}}>
                      {['gerente','administrador'].includes(String(user?.role||'').toLowerCase())&&step==='abierto' ? <div style={{display:'flex',alignItems:'center',gap:3}}>
                        <input aria-label={`Inventario inicial de ${p.name}`} type="number" min="0" step="1" style={{...s.inp,width:58,padding:'3px 4px',textAlign:'center'}} value={inventoryOpeningDrafts[p.id]??inicio} onChange={event=>setInventoryOpeningDrafts(current=>({...current,[p.id]:event.target.value}))}/>
                        {inventoryOpeningDrafts[p.id]!==undefined&&Number(inventoryOpeningDrafts[p.id])!==inicio&&<button type="button" title="Guardar inventario inicial" style={{...s.btn('primary'),padding:'3px 6px',fontSize:10}} onClick={()=>saveOpeningStock(p)} disabled={savingOpeningProduct===p.id}>{savingOpeningProduct===p.id?'…':'✓'}</button>}
                      </div> : inicio}
                    </td>
                    <td style={s.td(i)}>
                      <input type="number" min="0" style={{...s.inp,width:56,padding:'3px 5px',textAlign:'center',border:`1px solid ${e>0?C.green:C.border}`,color:e>0?C.green:C.text,fontWeight:e>0?700:400,background:e>0?C.green+'12':C.surface}}
                        value={m.entradas||''} placeholder="0"
                        onChange={ev=>setMovs(prev=>({...prev,[p.id]:{...(prev[p.id]||{}),entradas:parseInt(ev.target.value)||0}}))}/>
                    </td>
                    <td style={s.td(i)}>
                      <input type="number" min="0"
                        style={{...s.inp,width:56,padding:'3px 5px',textAlign:'center',
                          border:`1px solid ${m.existencias!==undefined?C.green:C.border}`,
                          color:m.existencias!==undefined?C.green:C.text,
                          fontWeight:m.existencias!==undefined?700:400}}
                        value={existencias} placeholder="0"
                        onChange={ev=>{
                          const raw=ev.target.value;
                          const val=raw===''?undefined:parseInt(raw)||0;
                          setMovs(prev=>{
                            const prevM=prev[p.id]||{};
                            const ent=prevM.entradas||0;
                            const newSalidas=val!==undefined?Math.max(0,inicio+ent-val):Math.max(0,inicio-p.stock);
                            const updatedProduct={...prevM,salidas:newSalidas};
                            if(val===undefined){
                              delete updatedProduct.existencias;
                              delete updatedProduct.ajusteExistencias;
                            }else{
                              updatedProduct.existencias=val;
                              updatedProduct.ajusteExistencias=val-(p.stock+ent);
                            }
                            const updated={...prev,[p.id]:updatedProduct};
                            return updated;
                          });
                        }}/>
                    </td>
                    <td style={s.td(i)}>
                      <span style={{fontSize:13,fontWeight:sa>0?700:400,color:sa>0?C.amber:C.sub,display:'block',textAlign:'center'}}>{sa>0?sa:'—'}</span>
                    </td>
                    <td style={s.td(i)}>
                      <input type="number" min="0" style={{...s.inp,width:56,padding:'3px 5px',textAlign:'center',color:co>0?C.purple:C.text,fontWeight:co>0?700:400,border:`1px solid ${co>0?C.purple:C.border}`}}
                        value={m.cortesia||''} placeholder="0"
                        onChange={ev=>setMovs(prev=>({...prev,[p.id]:{...(prev[p.id]||{}),cortesia:parseInt(ev.target.value)||0,cortesiaEditadaManualmente:true}}))}/>
                    </td>
                    <td style={{...s.td(i),fontWeight:800,fontSize:13,color:final<0?C.red:final<=p.min?C.amber:C.green}}>
                      {final}
                      {final<0&&<div style={{fontSize:9,color:C.red,fontWeight:700}}>⚠ NEGATIVO</div>}
                    </td>
                    <td style={{...s.td(i),minWidth:130}}>
                      {m.ventaManual!==undefined?(
                        <div style={{display:'flex',alignItems:'center',gap:3}}>
                          <input type="number" min="0"
                            style={{...s.inp,width:95,padding:'2px 5px',textAlign:'right',fontSize:12,border:`1px solid ${C.amber}`,color:C.amber,fontWeight:700,background:C.amber+'12'}}
                            value={m.ventaManual}
                            onChange={ev=>setMovs(prev=>({...prev,[p.id]:{...(prev[p.id]||{}),ventaManual:parseInt(ev.target.value)||0}}))}/>
                          <button title="Restaurar automático" style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:14,lineHeight:1,padding:0}}
                            onClick={()=>setMovs(prev=>{const n={...(prev[p.id]||{})};delete n.ventaManual;return{...prev,[p.id]:n};})}>↩</button>
                        </div>
                      ):(
                        <div style={{display:'flex',alignItems:'center',gap:4,justifyContent:'flex-end'}}>
                          <span style={{color:(sa-co)>0?C.green:C.sub,fontWeight:600}}>{sa>0?COP(Math.max(0,sa-co)*p.price):'—'}</span>
                          {sa>0&&<button title="Ajustar total manualmente" style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:11,padding:0,lineHeight:1}}
                            onClick={()=>setMovs(prev=>({...prev,[p.id]:{...(prev[p.id]||{}),ventaManual:Math.max(0,sa-co)*p.price}}))}>✏</button>}
                        </div>
                      )}
                      {sa>0&&co>0&&m.ventaManual===undefined&&<div style={{fontSize:10,color:C.purple,marginTop:2}}>{sa} - {co} cort. = {sa-co} pagadas</div>}
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
          {(()=>{const entradas=productosPlanilla.filter(p=>(movs[p.id]?.entradas||0)>0);if(!entradas.length)return null;return<div style={{marginTop:8,padding:'8px 12px',background:C.green+'15',border:`1px solid ${C.green}30`,borderRadius:8,fontSize:12}}><strong style={{color:C.green}}>📥 Entradas registradas:</strong>{entradas.map((p,i)=><span key={i} style={{marginLeft:8,color:C.text2}}>+{movs[p.id].entradas} {p.name.split(' ').slice(0,2).join(' ')}</span>)}</div>;})()}
        </div>
      )}

      {tab==='ventas'&&(
        <div style={s.card}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.5rem'}}>
            <div style={{fontWeight:700,fontSize:13}}>Personal — Ventas y pagos del turno</div>
          </div>
          <div style={{display:'flex',gap:16,alignItems:'center',marginBottom:'0.75rem',padding:'8px 12px',background:C.surface,borderRadius:8,border:`1px solid ${C.border}`,flexWrap:'wrap'}}>
            <span style={{fontSize:11,color:C.sub,fontWeight:600}}>Comisiones:</span>
            {barraPaymentMode==='commission'&&<div style={{display:'flex',alignItems:'center',gap:6,fontSize:12}}>
              <span style={{color:C.sub}}>Barra</span>
              <input aria-label="Porcentaje de comisión de Barra" type="number" min="0" max="100" step="0.5" style={{...s.inp,width:58,padding:'3px 6px',textAlign:'center',fontSize:12}} value={pctBarra} onChange={e=>setPctBarra(parseFloat(e.target.value)||0)}/>
              <span style={{color:C.sub}}>%</span>
            </div>}
            <div style={{display:'flex',alignItems:'center',gap:6,fontSize:12}}>
              <span style={{color:C.sub}}>Meseros</span>
              <input type="number" min="0" max="100" step="0.5" style={{...s.inp,width:58,padding:'3px 6px',textAlign:'center',fontSize:12}} value={pctMeseros} onChange={e=>setPctMeseros(parseFloat(e.target.value)||0)}/>
              <span style={{color:C.sub}}>%</span>
            </div>
          </div>
          {activeTurnComandasError&&<div role="alert" style={{color:C.red,fontSize:12,marginBottom:10}}>{activeTurnComandasError}</div>}
          <div style={{fontSize:11,color:C.sub,marginBottom:'1rem'}}>
            Las ventas se actualizan automáticamente con las comandas pagadas y entregadas{activeTurnComandasLoading?' (cargando)…':''}. El <strong style={{color:C.red}}>{pctMeseros}% de comisión se descuenta del neto</strong>.
            {barraPaymentMode==='commission'
              ? <>Barra cobra <strong style={{color:C.amber}}>{pctBarra}% de las ventas</strong> ({COP(totalVentas)}): {COP(pagoBarra)}.</>
              : <>Barra recibe un pago fijo de <strong style={{color:C.amber}}>{COP(pagoBarra)}</strong>.</>}
          </div>
          <table style={{width:'100%',borderCollapse:'collapse',marginBottom:'1rem'}}>
            <thead><tr style={{background:C.surface}}>{['Mesero autorizado','Ventas del turno',`Comisión ${pctMeseros}%`,'Entrega en caja'].map(h=><th key={h} style={s.th}>{h}</th>)}</tr></thead>
            <tbody>
              {meseros.map((m,i)=>{
                const v=ventasMeseroPorId[m.id];const comision=r1000(v*(pctMeseros/100));const entrega=v-comision;
                return(
                  <tr key={m.id} style={{background:i%2===0?C.rowA:C.rowB}}>
                    <td style={{...s.td(i),fontWeight:600}}>{m.name}</td>
                    <td style={{...s.td(i),color:v>0?C.green:C.sub,fontWeight:v>0?700:400}}>{activeTurnComandasLoading&&v===0?'Cargando…':COP(v)}</td>
                    <td style={{...s.td(i),color:C.red,fontWeight:v>0?700:400}}>{v>0?`− ${COP(comision)}`:'—'}</td>
                    <td style={{...s.td(i),color:v>0?C.amber:C.sub,fontWeight:v>0?700:400}}>{v>0?COP(entrega):'—'}</td>
                  </tr>
                );
              })}
              {totalVentasMeseros>0&&(
                <tr style={{background:C.amber+'12'}}>
                  <td style={{...s.td(0),fontWeight:800}}>TOTAL MESEROS</td>
                  <td style={{...s.td(0),color:C.green,fontWeight:800}}>{COP(totalVentasMeseros)}</td>
                  <td style={{...s.td(0),color:C.red,fontWeight:700}}>− {COP(totalMeserosFinal)}</td>
                  <td style={{...s.td(0),color:C.amber,fontWeight:800}}>{COP(totalVentasMeseros-totalMeserosFinal)}</td>
                </tr>
              )}
            </tbody>
          </table>
          {meseros.length===0&&<div style={{color:C.sub,fontSize:12,padding:'1rem',textAlign:'center'}}>No hay meseros autorizados en este turno. Selecciónalos antes de abrir la planilla.</div>}
          <div style={{borderTop:`1px solid ${C.border}`,paddingTop:'1rem',display:'flex',flexDirection:'column',gap:8}}>
            <div style={{fontSize:11,color:C.sub,textTransform:'uppercase',fontWeight:600,letterSpacing:'0.05em',marginBottom:4}}>Otros pagos de personal</div>
            {barman&&<div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,padding:'8px 10px',background:C.surface,borderRadius:8,flexWrap:'wrap'}}><div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}><span style={{fontWeight:600}}>{barman.name}</span><span style={{color:C.sub,fontSize:11}}>Barra</span><select aria-label="Modalidad de pago de Barra" style={{...s.inp,width:150,padding:'4px 6px',fontSize:12}} value={barraPaymentMode} onChange={e=>setStaffActivo(p=>p.map(x=>x.id===barman.id?{...x,paymentMode:e.target.value,...(e.target.value==='fixed'?{pay:typeof x.pay==='number'?x.pay:0}:{})}:x))}><option value="commission">Comisión (%)</option><option value="fixed">Valor fijo</option></select>{barraPaymentMode==='fixed'&&<input aria-label="Pago fijo de Barra" type="number" min="0" step="1000" style={{...s.inp,width:120,padding:'3px 6px',textAlign:'right',fontSize:12}} value={Number(barman.pay)||0} onChange={e=>setStaffActivo(p=>p.map(x=>x.id===barman.id?{...x,pay:parseInt(e.target.value)||0}:x))}/>}</div><div style={{display:'flex',alignItems:'center',gap:8}}><span style={{color:C.sub,fontSize:11}}>{barraPaymentMode==='commission'?`${pctBarra}%`: 'Fijo'}</span><span style={{color:C.red,fontWeight:700}}>− {COP(pagoBarra)}</span><button onClick={()=>setStaffActivo(p=>p.map(x=>x.id===barman.id?{...x,activo:false}:x))} style={{background:'none',border:'none',cursor:'pointer',color:C.muted,fontSize:15,padding:'0 4px',lineHeight:1}} title="Quitar del turno">✕</button></div></div>}
            {dj&&<div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:10,padding:'6px 10px',background:C.surface,borderRadius:8}}><div><span style={{fontWeight:600}}>{dj.name}</span><span style={{color:C.sub,marginLeft:8,fontSize:11}}>DJ · pago fijo</span></div><div style={{display:'flex',alignItems:'center',gap:6}}><span style={{color:C.sub,fontSize:11}}>−</span><input aria-label="Pago fijo del DJ" type="number" min="0" step="1000" style={{...s.inp,width:110,padding:'3px 6px',textAlign:'right',fontSize:12}} value={typeof dj.pay==='number'?dj.pay:''} onChange={e=>setStaffActivo(p=>p.map(x=>x.id===dj.id?{...x,pay:parseInt(e.target.value)||0}:x))}/><button onClick={()=>setStaffActivo(p=>p.map(x=>x.id===dj.id?{...x,activo:false}:x))} style={{background:'none',border:'none',cursor:'pointer',color:C.muted,fontSize:15,padding:'0 4px',lineHeight:1}} title="Quitar del turno">✕</button></div></div>}
            {personalFijoStaff.map(st=>(
              <div key={st.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,padding:'6px 10px',background:C.surface,borderRadius:8,flexWrap:'wrap'}}>{st.customRole?<><input aria-label="Nombre del rol adicional" style={{...s.inp,width:130,padding:'4px 6px',fontSize:12}} value={st.roleName||''} placeholder="Rol" onChange={e=>setStaffActivo(p=>p.map(x=>x.id===st.id?{...x,roleName:e.target.value}:x))}/><input aria-label="Nombre de la persona del rol adicional" style={{...s.inp,flex:'1 1 130px',minWidth:110,padding:'4px 6px',fontSize:12}} value={st.name||''} placeholder="Nombre de la persona" onChange={e=>setStaffActivo(p=>p.map(x=>x.id===st.id?{...x,name:e.target.value}:x))}/></>:<div><span style={{fontWeight:600}}>{st.name}</span><span style={{color:C.sub,marginLeft:8,fontSize:11}}>{st.rol.replace(/_/g,' ')}</span></div>}<div style={{display:'flex',alignItems:'center',gap:6}}><span style={{color:C.sub,fontSize:11}}>−</span><input type="number" min="0" aria-label={`Pago de ${st.customRole?(st.roleName||'rol adicional'):st.name}`} style={{...s.inp,width:110,padding:'3px 6px',textAlign:'right',fontSize:12}} value={typeof st.pay==='number'?st.pay:''} onChange={e=>setStaffActivo(p=>p.map(x=>x.id===st.id?{...x,pay:parseInt(e.target.value)||0}:x))}/><button onClick={()=>setStaffActivo(p=>p.map(x=>x.id===st.id?{...x,activo:false}:x))} style={{background:'none',border:'none',cursor:'pointer',color:C.muted,fontSize:15,padding:'0 4px',lineHeight:1}} title="Quitar del turno">✕</button></div></div>
            ))}
            <button type="button" style={{...s.btn(),alignSelf:'flex-start',fontSize:11,padding:'5px 9px'}} onClick={()=>setStaffActivo(p=>[...p,{id:uid(),name:'',roleName:'',rol:'otro',customRole:true,pay:0,activo:true,temporal:true}])}>+ Agregar otro rol</button>
            {seguridadStaff.length>0&&<details style={{background:C.surface,borderRadius:8,padding:'8px 10px'}}><summary style={{cursor:'pointer',fontWeight:700,fontSize:12}}>Seguridad · {seguridadStaff.length} {seguridadStaff.length===1?'persona':'personas'} · Total {COP(totalSeguridad)}</summary><div style={{display:'flex',flexDirection:'column',gap:6,marginTop:8}}>{seguridadStaff.map((st,index)=><div key={st.id} style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}><input aria-label={`Nombre de seguridad ${index+1}`} style={{...s.inp,flex:'1 1 130px',minWidth:110,padding:'4px 6px',fontSize:12}} value={st.name||''} placeholder="Nombre" onChange={e=>setStaffActivo(p=>p.map(x=>x.id===st.id?{...x,name:e.target.value}:x))}/><input aria-label={`Pago de seguridad ${index+1}`} type="number" min="0" style={{...s.inp,width:110,padding:'3px 6px',textAlign:'right',fontSize:12}} value={typeof st.pay==='number'?st.pay:''} onChange={e=>setStaffActivo(p=>p.map(x=>x.id===st.id?{...x,pay:parseInt(e.target.value)||0}:x))}/><button onClick={()=>setStaffActivo(p=>p.map(x=>x.id===st.id?{...x,activo:false}:x))} style={{background:'none',border:'none',cursor:'pointer',color:C.muted,fontSize:15,padding:'0 4px',lineHeight:1}} title="Quitar del turno">✕</button></div>)}<button type="button" style={{...s.btn(),alignSelf:'flex-start',fontSize:11,padding:'5px 9px'}} onClick={()=>setStaffActivo(p=>[...p,{id:uid(),name:'',rol:'seguridad',pay:0,activo:true,temporal:true}])}>+ Agregar persona de seguridad</button></div></details>}
            {seguridadStaff.length===0&&<button type="button" style={{...s.btn(),alignSelf:'flex-start',fontSize:11,padding:'5px 9px'}} onClick={()=>setStaffActivo(p=>[...p,{id:uid(),name:'',rol:'seguridad',pay:0,activo:true,temporal:true}])}>+ Agregar persona de seguridad</button>}
            {seguridadStaff.length>0&&<div style={{display:'flex',justifyContent:'space-between',fontSize:12,padding:'2px 10px'}}><span style={{color:C.sub}}>Total Seguridad</span><strong style={{color:C.red}}>− {COP(totalSeguridad)}</strong></div>}
          </div>
          <div style={{marginTop:'1rem',padding:'10px 14px',background:C.red+'12',borderRadius:8,border:`1px solid ${C.red}30`,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span style={{fontWeight:700,fontSize:13}}>Total a pagar Personal</span>
            <span style={{fontWeight:800,fontSize:16,color:C.red}}>− {COP(totalPersonal)}</span>
          </div>
          <div style={{marginTop:8,padding:'10px 14px',background:C.surface,borderRadius:8,border:`1px solid ${C.border}`}}>
            <div style={{fontSize:11,color:C.sub,marginBottom:6}}>Cálculo del neto:</div>
            {[['Ventas (productos)',COP(totalVentas),C.green],['− Bancos (digital)',COP(totalBancos),C.indigo],['− Personal',COP(totalPersonal),C.red],['− Gastos',COP(totalGastosT),C.red]].map(([l,v,col])=>(
              <div key={l} style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:3}}><span style={{color:C.sub}}>{l}</span><span style={{color:col,fontWeight:600}}>{v}</span></div>
            ))}
            <div style={{display:'flex',justifyContent:'space-between',fontWeight:800,fontSize:14,borderTop:`1px solid ${C.border}`,paddingTop:6,marginTop:4}}><span>= Neto en caja</span><span style={{color:neto>=0?C.amber:C.red}}>{COP(neto)}</span></div>
          </div>
        </div>
      )}

      {tab==='gastos'&&(
        <div style={s.card}>
          <div style={{fontWeight:700,marginBottom:'1rem',fontSize:13}}>Gastos del Turno</div>
          <div style={{display:'flex',gap:8,marginBottom:'1rem'}}>
            <input style={{...s.inp,flex:2}} placeholder="ej: hielo 5 bolsas, limones..." value={gForm.desc} onChange={e=>setGForm(p=>({...p,desc:e.target.value}))}/>
            <input style={{...s.inp,flex:1,maxWidth:130}} type="number" placeholder="Monto" value={gForm.monto} onChange={e=>setGForm(p=>({...p,monto:e.target.value}))}/>
            <button style={s.btn('primary')} onClick={()=>{if(!gForm.desc||!gForm.monto)return;setGastosT(p=>[...p,{id:uid(),...gForm,monto:parseInt(gForm.monto)}]);setGForm({desc:'',monto:''});}}>+</button>
          </div>
          {gastosT.map(g=>(
            <div key={g.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 0',borderBottom:`1px solid ${C.border}40`,fontSize:13}}>
              <span style={{color:g.monto===0?C.sub:C.text,fontWeight:g.monto>0?600:400}}>{g.desc}</span>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <input type="number" min="0"
                  style={{...s.inp,width:125,padding:'3px 8px',textAlign:'right',fontSize:12,
                    color:g.monto>0?C.red:C.sub,fontWeight:g.monto>0?700:400,
                    border:`1px solid ${g.monto>0?C.red:C.border}`}}
                  placeholder="0"
                  value={g.monto||''}
                  onChange={e=>setGastosT(p=>p.map(x=>x.id===g.id?{...x,monto:parseInt(e.target.value)||0}:x))}/>
                <button style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:14,lineHeight:1}} onClick={()=>setGastosT(p=>p.filter(x=>x.id!==g.id))}>✕</button>
              </div>
            </div>
          ))}
          {gastosT.length>0&&<div style={{textAlign:'right',fontWeight:700,paddingTop:8,color:C.red}}>Total: {COP(totalGastosT)}</div>}
        </div>
      )}

      {tab==='bancos'&&(
        <div style={{display:'flex',flexDirection:'column',gap:'1rem'}}>
          <div style={s.card}>
            <div style={{fontWeight:700,fontSize:13,marginBottom:'0.75rem'}}>Registrar transferencia</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:10,alignItems:'center'}}>
              <select style={s.sel} value={bForm.meseroId || authorizedMeseros[0]?.id || ''} onChange={e=>setBForm(p=>({...p,meseroId:e.target.value}))}>
                <option value="">Selecciona un mesero activo</option>
                {authorizedMeseros.map(person=><option key={person.id} value={person.id}>{person.name}</option>)}
              </select>
              <select style={s.sel} value={bForm.plataforma} onChange={e=>setBForm(p=>({...p,plataforma:e.target.value}))}>
                {Object.entries(PLAT_LABELS).map(([k,l])=><option key={k} value={k}>{l}</option>)}
                <option value="otro">Otro</option>
              </select>
              <input style={s.inp} type="number" min="1" step="1" placeholder="Monto transferido ($)"
                value={bForm.monto} onChange={e=>setBForm(p=>({...p,monto:e.target.value}))}/>
              <input style={s.inp} placeholder="Referencia (opcional)" value={bForm.ref} onChange={e=>setBForm(p=>({...p,ref:e.target.value}))}/>
              <label style={{...s.inp,display:'flex',alignItems:'center',cursor:'pointer',gap:8}}>
                <span>{bForm.comprobante ? 'Comprobante listo' : 'Foto del comprobante (opcional)'}</span>
                <input type="file" accept="image/*" capture="environment" onChange={handleBankReceipt} style={{display:'none'}}/>
              </label>
            </div>
            {bForm.comprobante&&<img src={bForm.comprobante} alt="Vista previa del comprobante" style={{display:'block',maxWidth:220,maxHeight:180,objectFit:'contain',marginTop:10,borderRadius:8}}/>}
            {!authorizedMeseros.length&&<div role="status" style={{color:C.amber,fontSize:12,marginTop:8}}>Activa al menos un mesero desde el módulo de Barra para registrar transferencias.</div>}
            <button style={{...s.btn('primary'),marginTop:10}} onClick={registerBankTransfer} disabled={savingTransfer||bankTransfersLoading||!turnoId||!authorizedMeseros.length}>
              {savingTransfer ? 'Guardando…' : 'Guardar transferencia'}
            </button>
            {bankTransferError&&<div role="alert" style={{color:C.red,fontSize:12,marginTop:8}}>{bankTransferError}</div>}
            {bankTransferMessage&&<div role="status" style={{color:C.green,fontSize:12,marginTop:8}}>{bankTransferMessage}</div>}
            {bankTransfersLoading&&<div style={{color:C.sub,fontSize:12,marginTop:8}}>Cargando transferencias del turno…</div>}
            <div style={{padding:'7px 10px',background:C.indigo+'12',borderRadius:8,fontSize:11,color:C.sub,border:`1px solid ${C.indigo}30`}}>
              Registra cada transferencia por separado y relaciónala con el mesero activo. La foto del comprobante es opcional.
            </div>
          </div>
          <div style={s.card}>
            <div style={{fontWeight:700,fontSize:13,marginBottom:'0.75rem',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span>Transferencias del Turno</span>
              <span style={{color:C.indigo,fontSize:17,fontWeight:800}}>{COP(totalBancos)}</span>
            </div>
            {bancosTransfs.length>0&&(
              <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:'0.75rem'}}>
                {Object.entries(bancosTransfs.reduce((acc,t)=>{acc[t.plataforma]=(acc[t.plataforma]||0)+(Number(t.monto)||0);return acc;},{})).map(([plat,tot])=>(
                  <div key={plat} style={{padding:'3px 10px',borderRadius:20,background:(PLAT_COLORS[plat]||'#888')+'22',border:`1px solid ${(PLAT_COLORS[plat]||'#888')}40`,fontSize:11,fontWeight:700,color:PLAT_COLORS[plat]||'#888'}}>
                    {PLAT_LABELS[plat]||plat}: {COP(tot)}
                  </div>
                ))}
              </div>
            )}
            {bancosTransfs.length===0&&<div style={{color:C.sub,fontSize:12,padding:'0.75rem 0',textAlign:'center'}}>Sin transferencias. Usa el formulario de arriba.</div>}
            {bancosTransfs.map(t=>(
              <div key={t.id} style={{display:'flex',alignItems:'center',gap:8,padding:'7px 0',borderBottom:`1px solid ${C.border}30`,fontSize:12}}>
                <div style={{width:10,height:10,borderRadius:'50%',background:PLAT_COLORS[t.plataforma]||'#888',flexShrink:0}}/>
                {/* Plataforma: clic para corregir */}
                {editingPlatId===t.id
                  ? <select
                      autoFocus
                      style={{...s.sel,flex:'0 0 118px',fontSize:11,padding:'2px 4px',height:24}}
                      value={t.plataforma}
                      onBlur={()=>setEditingPlatId(null)}
                      onChange={async e=>{
                        const nueva=e.target.value;
                        await updateBankTransferPlatform(t,nueva);
                        setEditingPlatId(null);
                      }}
                    >
                      {Object.entries(PLAT_LABELS).map(([k,l])=><option key={k} value={k}>{l}</option>)}
                      <option value="otro">Otro</option>
                    </select>
                  : <button
                      title="Clic para cambiar plataforma"
                      style={{display:'inline-flex',alignItems:'center',gap:3,background:'none',border:'none',
                              cursor:'pointer',fontWeight:600,color:PLAT_COLORS[t.plataforma]||C.indigo,
                              width:105,fontSize:11,flexShrink:0,padding:0,textAlign:'left'}}
                      onClick={()=>setEditingPlatId(t.id)}
                    >
                      {PLAT_LABELS[t.plataforma]||t.plataforma}
                      <span style={{fontSize:9,color:C.muted,opacity:0.65}}>✎</span>
                    </button>
                }
                <span style={{fontWeight:700,color:C.indigo,flexShrink:0}}>{COP(Number(t.monto)||0)}</span>
                {t.ref&&<span style={{color:C.sub,fontSize:11,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.ref}</span>}
                {t.hora&&<span style={{color:C.muted,fontSize:10,marginLeft:'auto',flexShrink:0}}>{t.hora}</span>}
                {t.foto_url&&<BankReceiptButton transfer={t} meseroName={users.find(account=>String(account.id)===String(t.mesero_id))?.name || 'Mesero'}/>}
                <button style={{background:'none',border:'none',cursor:'pointer',color:C.muted,padding:'0 4px',fontSize:14,lineHeight:1,flexShrink:0}} onClick={()=>removeBankTransfer(t)}>✕</button>
              </div>
            ))}
            {bancosTransfs.length>0&&(
              <div style={{display:'flex',justifyContent:'space-between',padding:'10px 0 2px',borderTop:`1px solid ${C.border}`,fontWeight:800,marginTop:4}}>
                <span>Total Bancos</span><span style={{color:C.indigo,fontSize:17}}>{COP(totalBancos)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {tab==='novedades'&&(
        <div style={{display:'flex',flexDirection:'column',gap:'1rem'}}>
          {Object.keys(checklist).length>0&&(
            <div style={s.card}>
              <div style={{fontWeight:700,fontSize:13,marginBottom:'0.75rem'}}>✓ Checklist de Apertura</div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:6}}>
                {CHECKLIST_ITEMS.map(item=>(
                  <div key={item.id} style={{display:'flex',alignItems:'center',gap:8,fontSize:12,padding:'5px 8px',borderRadius:6,background:checklist[item.id]?C.green+'12':C.red+'10',border:`1px solid ${checklist[item.id]?C.green:C.red}30`}}>
                    <span style={{fontSize:15,flexShrink:0}}>{checklist[item.id]?'✓':'✗'}</span>
                    <span style={{color:checklist[item.id]?C.green:C.red}}>{item.icon} {item.label}</span>
                  </div>
                ))}
              </div>
              <div style={{marginTop:10,fontSize:11,color:C.sub}}>{Object.values(checklist).filter(Boolean).length}/{CHECKLIST_ITEMS.length} ítems OK</div>
            </div>
          )}
          <div style={s.card}>
            <div style={{fontWeight:700,marginBottom:'0.35rem',fontSize:13}}>Ingresos registrados por Barra</div>
            <div style={{fontSize:11,color:C.sub,marginBottom:10}}>Proveedor, hora y productos recibidos durante este turno.</div>
            {turnoNovedadesError
              ? <div role="alert" style={{color:C.red,fontSize:12}}>{turnoNovedadesError}</div>
              : turnoNovedades.filter(item => String(item.texto || '').startsWith('Ingreso de inventario ·')).length
                ? <div style={{display:'grid',gap:8}}>
                  {turnoNovedades.filter(item => String(item.texto || '').startsWith('Ingreso de inventario ·')).map(item=>(
                    <article key={item.id} style={{padding:'10px 12px',border:`1px solid ${C.green}35`,borderRadius:9,background:C.green+'08'}}>
                      <time style={{display:'block',fontSize:10,color:C.green,fontWeight:700,marginBottom:5}}>{formatLocalTime(item.created_at)}</time>
                      <div style={{fontSize:12,color:C.text2,lineHeight:1.5}}>{item.texto}</div>
                    </article>
                  ))}
                </div>
                : <div style={{fontSize:12,color:C.sub}}>Aún no se han registrado ingresos durante este turno.</div>}
          </div>
          <div style={s.card}>
            <div style={{fontWeight:700,marginBottom:'0.75rem',fontSize:13}}>Novedades del Turno</div>
            <div style={{fontSize:11,color:C.sub,marginBottom:8}}>Daños estructurales, fallas técnicas, situaciones especiales para los dueños.</div>
            <textarea style={{...s.inp,minHeight:150,resize:'vertical',lineHeight:1.6}} placeholder="Ej: Nevera 2 haciendo ruido anormal..." value={novedades} onChange={e=>setNovedades(e.target.value)}/>
          </div>
        </div>
      )}

      {tab==='perspectiva'&&(
        <PerspectivaCierre
          negocio={negocio}
          movs={movs}
          gastosT={gastosT}
          bancosTransfs={bancosTransfs}
          ventasMesero={ventasMesero}
          pctBarra={pctBarra}
          pctMeseros={pctMeseros}
          extras={extras}
          pendientes={pendientes}
          apertura={apertura}
          totalVentas={totalVentas}
          totalBancos={totalBancos}
          totalGastosT={totalGastosT}
          totalPersonal={totalPersonal}
          neto={neto}
          pagoBarra={pagoBarra}
          pagoDJ={pagoDJ}
          pagoMeseros={pagoMeseros}
          pagoFijosStaff={pagoFijosStaff}
          barman={barman}
          dj={dj}
          barraPaymentMode={barraPaymentMode}
          meseros={meseros}
        />
      )}

      {tab==='cierre'&&(
        <div style={s.card}>
          <div style={{fontWeight:700,marginBottom:'1rem',fontSize:14}}>Cerrar Turno</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:'1rem'}}>
            <div><div style={s.label}>Ingresos Extra (descorches, multas)</div><input style={s.inp} type="number" value={extras} onChange={e=>setExtras(e.target.value)} placeholder="0"/></div>
            <div><div style={s.label}>Cuentas Pendientes a Descontar</div><input style={s.inp} type="number" value={pendientes} onChange={e=>setPendientes(e.target.value)} placeholder="0"/></div>
          </div>
          <div style={{marginBottom:'1.5rem'}}>
            <div style={{fontWeight:700,fontSize:13,marginBottom:'0.75rem'}}>Arqueo de Caja</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8}}>
              {BILLETS.map(b=>(
                <div key={b} style={{background:C.surface,borderRadius:8,padding:'8px 10px',display:'flex',justifyContent:'space-between',alignItems:'center',border:`1px solid ${C.border}`}}>
                  <div><div style={{fontSize:10,color:C.sub}}>$ {b.toLocaleString('es-CO')}</div><div style={{fontSize:11,color:C.amber,fontWeight:600}}>{COP((parseInt(billetes[b])||0)*b)}</div></div>
                  <input type="number" min="0" style={{...s.inp,width:55,padding:'4px 6px',textAlign:'center'}} value={billetes[b]||''} onChange={e=>setBilletes(p=>({...p,[b]:e.target.value}))}/>
                </div>
              ))}
            </div>
            <div style={{marginTop:10,padding:'10px 14px',background:C.amber+'15',borderRadius:8,display:'flex',justifyContent:'space-between',fontWeight:700,fontSize:15}}><span>Total Conteo</span><span style={{color:C.amber}}>{COP(totalBilletes)}</span></div>
          </div>
          <div style={{background:C.surface,borderRadius:10,padding:'1rem',marginBottom:'1.25rem',border:`1px solid ${C.border}`}}>
            {[['Ventas',COP(totalVentas),C.green],['− Bancos (digital)',COP(totalBancos),C.indigo],['+ Extras',COP(parseInt(extras)||0),C.amber],['− Gastos',COP(totalGastosT),C.red],['− Personal',COP(totalPersonal),C.red],['− Pendientes',COP(parseInt(pendientes)||0),C.red]].map(([l,v,col])=>(
              <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'3px 0',fontSize:12,borderBottom:`1px solid ${C.border}30`}}><span style={{color:C.sub}}>{l}</span><span style={{color:col,fontWeight:600}}>{v}</span></div>
            ))}
            <div style={{display:'flex',justifyContent:'space-between',padding:'10px 0 4px',fontWeight:800,fontSize:17}}><span>NETO ESPERADO</span><span style={{color:C.amber}}>{COP(neto)}</span></div>
            {totalBilletes>0&&<div style={{display:'flex',justifyContent:'space-between',fontSize:13}}><span style={{color:C.sub}}>Diferencia</span><span style={{fontWeight:700,color:totalBilletes===neto?C.green:C.red}}>{totalBilletes===neto?'Exacto ✓':`${COP(Math.abs(totalBilletes-neto))} ${totalBilletes>neto?'sobrante':'faltante'}`}</span></div>}
          </div>
          <button style={{...s.btn('primary'),width:'100%',padding:12,fontSize:14,background:negocio.color,color:'#0b0b14'}} onClick={()=>{
            const negatives=productosPlanilla.filter(p=>existenciasProducto(p,movs[p.id])<0);
            if(negatives.length>0){alert(`⚠ No se puede cerrar el turno.\n\nExistencias en negativo:\n${negatives.map(p=>`• ${p.name}: existencias ${existenciasProducto(p,movs[p.id])}`).join('\n')}\n\nCorrige las existencias o registra las entradas.`);return;}
            cerrarTurno();
          }}>🔒 Cerrar y Bloquear Planilla</button>
        </div>
      )}
      {showNuevoStaff&&<NuevoStaffModal onClose={()=>setShowNuevoStaff(false)} negocioColor={negocio.color} onAgregar={nuevo=>setStaffActivo(p=>[...p,nuevo])}/>}
    </div>
  );
}
