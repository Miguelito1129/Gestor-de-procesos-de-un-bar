import { useState, useCallback, useEffect } from "react";
import { C, s } from "../constants/theme.js";
import { can, canSeeNeg, normalizeRole, ROLE_LABELS } from "../constants/roles.js";
import { useAuth } from "../hooks/useAuth.jsx";
import {
  LOCAL_API_URL, localDeleteNegocio, localDeleteProductos, localInsert, localUpsert,
  loadNegociosFromLocal,
} from "../lib/localApi.js";
import { Badge } from "./common/index.jsx";
import Dashboard        from "./Dashboard/Dashboard.jsx";
import Planilla         from "./Planilla/Planilla.jsx";
import Inventario       from "./Inventario/Inventario.jsx";
import GastosView       from "./Gastos/GastosView.jsx";
import CierreSemanal    from "./CierreSemanal/CierreSemanal.jsx";
import Reports          from "./Reports/Reports.jsx";
import ChatbotIA        from "./ChatbotIA/ChatbotIA.jsx";
import UserMgmt         from "./Users/UserMgmt.jsx";
import Promociones      from "./Promociones/Promociones.jsx";
import NuevoNegocioModal from "./NuevoNegocioModal.jsx";
import EliminarNegocioModal from "./EliminarNegocioModal.jsx";
import AdminAccessLinks from "./AdminAccessLinks.jsx";
import RoleWorkspace    from "./RoleWorkspace/RoleWorkspace.jsx";

// ── Storage key ───────────────────────────────────────────────────────────────

// ── Default data ──────────────────────────────────────────────────────────────
const INIT_NEGOCIOS = []; /*
  { id:"simona", name:"La Simona", emoji:"🎵", color:"#f59e0b",
    staff:[{id:"j_s",name:"Jhonatan",rol:"barra",pay:"3%"},{id:"k_s",name:"Kilberth",rol:"dj",pay:133000},{id:"i_s",name:"Ivan",rol:"mesero",pay:"5%"},{id:"e_s",name:"Erick",rol:"mesero",pay:"5%"},{id:"y_s",name:"Yiseth",rol:"mesero",pay:"5%"},{id:"lo_s",name:"Lorena",rol:"mesero",pay:"5%"},{id:"ma_s",name:"Mauricio",rol:"mesero",pay:"5%"},{id:"ju_s",name:"Juan",rol:"mesero",pay:"5%"},{id:"p_s",name:"Patin",rol:"patin",pay:70000},{id:"sal_s",name:"Saladillo",rol:"seguridad",pay:70000},{id:"al_s",name:"Alirio",rol:"seguridad",pay:70000},{id:"pat_s",name:"Patricia",rol:"aseo",pay:40000}],
    gastosFijos:[{id:"pub_s",desc:"Publicista",monto:1000000,dia:20},{id:"arr_d",desc:"Arriendo Disco",monto:3300000,dia:30},{id:"arr_c",desc:"Arriendo Cantina",monto:1700000,dia:30},{id:"arr_l",desc:"Arriendo Licorera",monto:1100000,dia:30},{id:"arr_b",desc:"Arriendo Bodega",monto:500000,dia:30},{id:"int_s",desc:"Internet",monto:120000,dia:30},{id:"luz_s",desc:"Recibo de Luz",monto:3957000,dia:0}],
    cxc:[{id:"cxc1",deudor:"El Alcalde",monto:8133000,fecha:"2026-03-21",concepto:"Consumo sin pagar"}],
    productos:[{id:"p1",name:"Buchannas Master 750",cat:"Whisky",price:380000,stock:5,min:2,courtesy:"gatorade"},{id:"p2",name:"Buchannas Deluxe 750",cat:"Whisky",price:310000,stock:8,min:2,courtesy:"gatorade"},{id:"p3",name:"Old Parr Botella",cat:"Whisky",price:310000,stock:5,min:2,courtesy:"gatorade"},{id:"p4",name:"Jack Daniel's Honey",cat:"Whisky",price:200000,stock:3,min:2,courtesy:"gatorade"},{id:"p5",name:"Tequila Don Julio 70",cat:"Tequila",price:700000,stock:4,min:2,courtesy:"agua"},{id:"p6",name:"Tequila Don Julio Rep.",cat:"Tequila",price:450000,stock:2,min:2,courtesy:"agua"},{id:"p7",name:"Aguardiente Amarillo Bot.",cat:"Aguardiente",price:140000,stock:20,min:12,courtesy:"agua"},{id:"p8",name:"Aguardiente Amarillo 1/2",cat:"Aguardiente",price:70000,stock:37,min:24,courtesy:"agua"},{id:"p9",name:"Antioqueño Botella",cat:"Aguardiente",price:140000,stock:10,min:6,courtesy:"agua"},{id:"p10",name:"Antioqueño 1/2",cat:"Aguardiente",price:70000,stock:11,min:12,courtesy:"agua"},{id:"p11",name:"Llanero Botella",cat:"Aguardiente",price:120000,stock:0,min:6,courtesy:"agua"},{id:"p12",name:"Ron Caldas Botella",cat:"Ron",price:140000,stock:5,min:4,courtesy:"gaseosa"},{id:"p13",name:"Ron Caldas 1/2",cat:"Ron",price:70000,stock:26,min:12,courtesy:"gaseosa"},{id:"p14",name:"Corona",cat:"Cerveza",price:10000,stock:291,min:48,courtesy:null},{id:"p15",name:"Coronita",cat:"Cerveza",price:6000,stock:204,min:48,courtesy:null},{id:"p16",name:"Cerveza Águila",cat:"Cerveza",price:5000,stock:216,min:48,courtesy:null},{id:"p17",name:"Red Bull",cat:"Energética",price:15000,stock:23,min:12,courtesy:null},{id:"p18",name:"Gatorade",cat:"Cortesía",price:10000,stock:75,min:24,courtesy:null},{id:"p19",name:"Agua Cristal",cat:"Cortesía",price:5000,stock:953,min:48,courtesy:null},{id:"p20",name:"Coca-Cola",cat:"Gaseosa",price:5000,stock:8,min:24,courtesy:null},{id:"p21",name:"Soda",cat:"Gaseosa",price:5000,stock:19,min:12,courtesy:null}],
    planillas:[{id:"h1",fecha:"2026-03-21",apertura:"21:00",cierre:"04:30",ventas:24564000,gastos:915000,bancos:7871000,extras:0,pendientes:0,personal:2850000,neto:20324000,novedades:"Sin novedades."},{id:"h2",fecha:"2026-03-20",apertura:"20:30",cierre:"05:00",ventas:5840000,gastos:384000,bancos:495000,extras:0,pendientes:0,personal:1031000,neto:4925000,novedades:""},{id:"h3",fecha:"2026-03-19",apertura:"21:00",cierre:"04:00",ventas:4450000,gastos:320000,bancos:580000,extras:80000,pendientes:0,personal:850000,neto:3625000,novedades:""},{id:"h4",fecha:"2026-03-15",apertura:"21:30",cierre:"05:30",ventas:18500000,gastos:780000,bancos:5200000,extras:0,pendientes:0,personal:2450000,neto:15270000,novedades:""}] },
  { id:"tenampa", name:"El Tenampa", emoji:"🎸", color:"#818cf8",
    staff:[{id:"m_t",name:"Maira",rol:"barra",pay:"3%"},{id:"jl_t",name:"Julian",rol:"dj",pay:133000},{id:"sa_t",name:"Saira",rol:"mesero",pay:"5%"},{id:"mae_t",name:"Mael",rol:"mesero",pay:"5%"},{id:"ma_t",name:"Martin",rol:"mesero",pay:"5%"},{id:"i_t",name:"Ivan",rol:"mesero",pay:"5%"},{id:"e_t",name:"Erick",rol:"mesero",pay:"5%"},{id:"p_t",name:"Patin",rol:"patin",pay:70000},{id:"an_t",name:"Andres",rol:"seguridad",pay:80000},{id:"as_t",name:"Aseo",rol:"aseo",pay:70000}],
    gastosFijos:[{id:"pub_t",desc:"Publicista",monto:1000000,dia:20},{id:"arr_dt",desc:"Arriendo Disco",monto:3300000,dia:30},{id:"arr_ct",desc:"Arriendo Cantina",monto:1700000,dia:30},{id:"int_t",desc:"Internet",monto:120000,dia:30},{id:"luz_t",desc:"Recibo de Luz",monto:3957000,dia:0}],
    cxc:[{id:"cxc_e",deudor:"Edward",monto:105000,fecha:"2026-03-18",concepto:"Adelanto turno"}],
    productos:[{id:"t1",name:"Buchannas Master 750",cat:"Whisky",price:380000,stock:3,min:2,courtesy:"gatorade"},{id:"t2",name:"Don Julio 70",cat:"Tequila",price:700000,stock:2,min:2,courtesy:"agua"},{id:"t3",name:"Don Julio Reposado",cat:"Tequila",price:450000,stock:1,min:2,courtesy:"agua"},{id:"t4",name:"Amarillo Botella",cat:"Aguardiente",price:140000,stock:17,min:12,courtesy:"agua"},{id:"t5",name:"Amarillo Media",cat:"Aguardiente",price:75000,stock:0,min:12,courtesy:"agua"},{id:"t6",name:"Antioqueño Botella",cat:"Aguardiente",price:140000,stock:0,min:6,courtesy:"agua"},{id:"t7",name:"Ron Caldas Botella",cat:"Ron",price:140000,stock:9,min:4,courtesy:"gaseosa"},{id:"t8",name:"Ron Caldas Media",cat:"Ron",price:75000,stock:6,min:6,courtesy:"gaseosa"},{id:"t9",name:"Corona",cat:"Cerveza",price:10000,stock:77,min:48,courtesy:null},{id:"t10",name:"Agua",cat:"Cortesía",price:5000,stock:919,min:48,courtesy:null},{id:"t11",name:"Gatorade",cat:"Cortesía",price:10000,stock:34,min:24,courtesy:null},{id:"t12",name:"Coca-Cola",cat:"Gaseosa",price:5000,stock:23,min:12,courtesy:null}],
    planillas:[{id:"h5",fecha:"2026-03-21",apertura:"21:30",cierre:"05:00",ventas:10355000,gastos:825000,bancos:3494000,extras:0,pendientes:0,personal:1692000,neto:8663000,novedades:""},{id:"h6",fecha:"2026-03-20",apertura:"20:00",cierre:"04:30",ventas:4450000,gastos:400000,bancos:1200000,extras:0,pendientes:0,personal:950000,neto:3625000,novedades:""},{id:"h7",fecha:"2026-03-19",apertura:"21:00",cierre:"04:00",ventas:5470000,gastos:512000,bancos:1800000,extras:0,pendientes:0,personal:1000000,neto:3454000,novedades:""}] },
*/ 

const VIEWS_ADMIN    = [{id:'dashboard',label:'Dashboard'},{id:'planilla',label:'Planillas'},{id:'inventario',label:'Inventario'},{id:'promociones',label:'🏷️ Promociones'},{id:'gastos',label:'Gastos'},{id:'cierres',label:'📅 Cierres'},{id:'reportes',label:'📊 Reportes'},{id:'chat',label:'✦ IA'},{id:'usuarios',label:'👤 Usuarios'}];
const VIEWS_GERENTE  = VIEWS_ADMIN.filter(view=>view.id!=='usuarios');
const VIEWS_ADMIN_TURNO = [{id:'planilla',label:'Turno'}];
const VIEWS_DUENO    = [{id:'dashboard',label:'Dashboard'},{id:'cierres',label:'📅 Cierres'},{id:'reportes',label:'📊 Reportes'},{id:'inventario',label:'Inventario'},{id:'planilla',label:'Historial'}];
const VIEWS_BARRA    = [{id:'operacion',label:'Cola de barra'}];
const VIEWS_MESERO   = [{id:'operacion',label:'Mis comandas'}];

const ROLE_BADGE = {admin:C.amber, administrador:C.amber, gerente:C.amber, auxiliar:C.indigo, jefe:C.green, dueño:C.green, barra:C.amber, mesero:C.indigo};

// Tabs inferiores para móvil (máx 5 visibles + "Más")
const BOTTOM_ADMIN   = [{id:'dashboard',label:'Inicio',icon:'🏠'},{id:'planilla',label:'Turno',icon:'📋'},{id:'cierres',label:'Cierres',icon:'📅'},{id:'mas',label:'Más',icon:'⋯'}];
const BOTTOM_AUXILIAR= [{id:'planilla',label:'Turno',icon:'📋'}];
const BOTTOM_JEFE    = [{id:'dashboard',label:'Inicio',icon:'🏠'},{id:'planilla',label:'Turno',icon:'📋'},{id:'cierres',label:'Cierres',icon:'📅'},{id:'reportes',label:'Reportes',icon:'📊'},{id:'inventario',label:'Stock',icon:'📦'}];
const BOTTOM_BARRA   = [{id:'operacion',label:'Cola',icon:'🍸'}];
const BOTTOM_MESERO  = [{id:'operacion',label:'Comandas',icon:'🧾'}];
const VIEW_ICONS = {
  dashboard: '⌂',
  planilla: '▤',
  inventario: '▦',
  promociones: '◇',
  gastos: '$',
  cierres: '◷',
  reportes: '▥',
  chat: '✦',
  usuarios: '♙',
  operacion: '🍸',
};
const SIDEBAR_STORAGE_KEY = 'gestionbar-sidebar-collapsed';

// Menú "Más" para admin en móvil
const MAS_ADMIN = [{id:'inventario',label:'Inventario',icon:'📦'},{id:'promociones',label:'Promociones',icon:'🏷️'},{id:'gastos',label:'Gastos',icon:'💸'},{id:'reportes',label:'Reportes',icon:'📊'},{id:'chat',label:'Asistente IA',icon:'✦'},{id:'usuarios',label:'Usuarios',icon:'👤'}];
const MAS_GERENTE = MAS_ADMIN.filter(item=>item.id!=='usuarios');

export default function MainApp() {
  const { user, logout } = useAuth();
  const [isMobile, setIsMobile] = useState(()=>window.innerWidth<=768||!!window.Capacitor);
  const [showMas, setShowMas] = useState(false);
  const role = normalizeRole(user?.role);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    return saved === null ? window.innerWidth <= 1100 : saved === 'true';
  });
  useEffect(()=>{
    const h=()=>setIsMobile(window.innerWidth<=768||!!window.Capacitor);
    window.addEventListener('resize',h); return()=>window.removeEventListener('resize',h);
  },[]);
  useEffect(()=>{
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarCollapsed));
  },[sidebarCollapsed]);
  const [negocios, setNegocios] = useState(INIT_NEGOCIOS);
  const [dbLoading, setDbLoading] = useState(true);
  const [dbSource,  setDbSource]  = useState('local');
  const [businessToDelete, setBusinessToDelete] = useState(null);

  useEffect(()=>{
    (async()=>{
      setDbLoading(true);
      const data = await loadNegociosFromLocal();
      if (data?.length) {
        setNegocios(data);
        setDbSource('local');
      }
      setDbLoading(false);
    })();
  },[]);

  const saveNegocios = n => { setNegocios(n); };

  const [negocioId, setNegocioId] = useState(()=>{
    const visible=INIT_NEGOCIOS.filter(n=>canSeeNeg(user,n.id));
    return visible[0]?.id||INIT_NEGOCIOS[0]?.id;
  });
  const [view, setView]           = useState(role==='barra'||role==='mesero'?'operacion':role==='administrador'?'dashboard':'dashboard');
  const [showNuevoNeg, setShowNuevoNeg] = useState(false);
  const [showUsers,    setShowUsers]    = useState(false);
  const [showAccessLinks, setShowAccessLinks] = useState(false);

  useEffect(()=>{
    if(negocios.length&&!negocios.find(n=>n.id===negocioId)){
      const visible=negocios.filter(n=>canSeeNeg(user,n.id));
      if(visible.length) setNegocioId(visible[0].id);
    }
  },[negocios]);

  const saveAndSync = useCallback(async (updated, syncProducts=false) => {
    const newNegocios = negocios.map(n=>n.id===updated.id?updated:n);
    saveNegocios(newNegocios);
    if (LOCAL_API_URL) {
      if (syncProducts) {
        const deleted = await localDeleteProductos(updated.id);
        if (deleted && updated.productos.length>0) {
          await localInsert('productos', updated.productos.map(p=>({...p,negocio_id:updated.id})));
        }
      }
      if (updated.planillas?.length) {
        const anterior = negocios.find(n=>n.id===updated.id);
        const prevMap  = new Map((anterior?.planillas||[]).map(p=>[p.id,p]));
        // Sincronizar planillas nuevas O cuyo cierre/ventas/neto cambió
        const toSync = updated.planillas.filter(p=>{
          const prev = prevMap.get(p.id);
          if (!prev) return true; // nueva
          return p.cierre!==prev.cierre || p.ventas!==prev.ventas || p.neto!==prev.neto;
        });
        if (toSync.length) {
          await localUpsert('planillas', toSync.map(p=>({
            id:p.id, negocio_id:updated.id, fecha:p.fecha,
            apertura:p.apertura, cierre:p.cierre||null,
            ventas:p.ventas||0, bancos:p.bancos||0, gastos:p.gastos||0,
            personal:p.personal||0, extras:p.extras||0,
            pendientes:p.pendientes||0, neto:p.neto||0,
            novedades:p.novedades||'', estado:p.cierre?'cerrada':'abierta',
            personal_detalle:p.personalDetalle||[], movimientos:p.movimientos||[],
            banco_detalle:p.bancoDetalle||{}, gastos_detalle:p.gastosDetalle||[],
          })));
          // Sincronizar stock de productos solo cuando hay planillas nuevas (turno cerrado)
          const hayNuevas = toSync.some(p=>!prevMap.has(p.id));
          if (!syncProducts && hayNuevas && updated.productos.length>0) {
            await localDeleteProductos(updated.id);
            await localInsert('productos', updated.productos.map(p=>({...p,negocio_id:updated.id})));
          }
        }
      }
    }
  },[negocios]);

  // ── Crear negocio nuevo → localStorage + Supabase ────────────────────────
  const crearNegocio = useCallback(async n => {
    saveNegocios([...negocios, n]);
    setNegocioId(n.id);
    setView('dashboard');
    setShowNuevoNeg(false);
    if (LOCAL_API_URL) await localInsert('negocios', { id:n.id, name:n.name, emoji:n.emoji, color:n.color, tipo:n.tipo });
  }, [negocios]);

  const confirmarEliminacionNegocio = async () => {
    if (!businessToDelete) return;
    await localDeleteNegocio(businessToDelete.id);
    const remainingBusinesses = negocios.filter(item => item.id !== businessToDelete.id);
    saveNegocios(remainingBusinesses);
    if (negocioId === businessToDelete.id) {
      setNegocioId(remainingBusinesses[0]?.id || null);
      setView('dashboard');
    }
    setBusinessToDelete(null);
  };

  const visibleNegs   = negocios.filter(n=>canSeeNeg(user,n.id));
  const negocio       = negocios.find(n=>n.id===negocioId)||visibleNegs[0]||negocios[0];
  const updateNegocio = useCallback(updated=>saveAndSync(updated),[saveAndSync]);
  const isAdmin       = role==='administrador';
  const isManager     = role==='gerente';
  const VIEWS         = isAdmin ? VIEWS_ADMIN : isManager ? VIEWS_GERENTE : role==='dueño' ? VIEWS_DUENO : role==='barra' ? VIEWS_BARRA : role==='mesero' ? VIEWS_MESERO : VIEWS_ADMIN_TURNO;
  const BOTTOM_TABS   = isAdmin || isManager ? BOTTOM_ADMIN : role==='dueño' ? BOTTOM_JEFE : role==='barra' ? BOTTOM_BARRA : role==='mesero' ? BOTTOM_MESERO : BOTTOM_AUXILIAR;
  const MORE_MENU     = isAdmin ? MAS_ADMIN : MAS_GERENTE;
  const isJefe        = role==='dueño';

  const syncDB = async()=>{
    setDbLoading(true);
    const d=await loadNegociosFromLocal();
    if(d?.length){setNegocios(d);setDbSource('local');}
    setDbLoading(false);
  };

  if (dbLoading) return (
    <div style={{minHeight:'100vh',background:C.bg,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:16}}>
      <div style={{fontSize:32}}>▸</div>
      <div style={{color:C.amber,fontWeight:800,fontSize:18}}>GestiónBar</div>
      <div style={{color:C.sub,fontSize:13}}>Cargando datos desde SQLite local...</div>
      <div style={{display:'flex',gap:6,marginTop:8}}>
        {[0,1,2].map(i=><div key={i} style={{width:8,height:8,borderRadius:'50%',background:C.amber,opacity:0.4,animation:`blink 1.2s ${i*0.2}s infinite`}}/>)}
      </div>
      <style>{`@keyframes blink{0%,100%{opacity:.3}50%{opacity:1}}`}</style>
    </div>
  );

  if (!negocio) return (
    <div style={{minHeight:'100vh',background:C.bg,color:C.text,display:'flex',alignItems:'center',justifyContent:'center',padding:'1.5rem',textAlign:'center'}}>
      <div style={{maxWidth:460}}>
        <div style={{fontSize:32,marginBottom:12}}>▸</div>
        <h2 style={{margin:'0 0 8px'}}>No hay negocios registrados</h2>
        <p style={{color:C.sub,lineHeight:1.5}}>Crea tu negocio real desde el botón <strong>+</strong> para comenzar a registrar productos, personal y turnos.</p>
        {isAdmin && <button style={s.btn('primary')} onClick={()=>setShowNuevoNeg(true)}>Crear negocio</button>}
        <button style={{...s.btn('ghost'),marginLeft:8}} onClick={logout}>Salir</button>
        {showNuevoNeg&&<NuevoNegocioModal onClose={()=>setShowNuevoNeg(false)} onCrear={crearNegocio}/>}
        {businessToDelete&&<EliminarNegocioModal negocio={businessToDelete} onClose={()=>setBusinessToDelete(null)} onDelete={confirmarEliminacionNegocio}/>}
      </div>
    </div>
  );

  // ── Contenido principal (compartido) ─────────────────────────────────────────
  const mainContent = (
    <>
      {view==='dashboard'  && <Dashboard negocio={negocio}/>}
      {view==='operacion'  && (role==='barra'||role==='mesero') && <RoleWorkspace role={role} negocio={negocio} userName={user?.name} userId={user?.id}/>}
      {view==='planilla'   && <Planilla key={negocio?.id} negocio={negocio} onUpdateNegocio={updateNegocio}/>}
      {view==='inventario' && <Inventario negocio={negocio} onUpdateNegocio={updated=>saveAndSync(updated,true)} readOnly={isJefe}/>}
      {view==='promociones' && (isAdmin||isManager) && <Promociones negocio={negocio}/>}
      {view==='gastos'     && (isAdmin||isManager) && <GastosView negocio={negocio}/>}
      {view==='cierres'    && <CierreSemanal negocios={visibleNegs} negocioId={negocioId}/>}
      {view==='reportes'   && <Reports negocios={visibleNegs}/>}
      {view==='chat'       && (isAdmin||isManager) && <ChatbotIA negocio={negocio}/>}
      {view==='usuarios'   && isAdmin && <div style={{color:C.sub,padding:'2rem',textAlign:'center',fontSize:14}}>Usa el botón 👤 en la barra de navegación para gestionar usuarios.</div>}
    </>
  );

  // ── LAYOUT MÓVIL ─────────────────────────────────────────────────────────────
  if (isMobile) {
    const accentColor = negocio?.color || C.amber;
    return (
      <div className="app-mobile" style={{minHeight:'100vh',background:C.bg,color:C.text,fontFamily:"'Segoe UI',system-ui,-apple-system,sans-serif",display:'flex',flexDirection:'column'}}>

        {/* Header móvil */}
        <div style={{position:'sticky',top:0,zIndex:50,background:C.surface,borderBottom:`1px solid ${C.border}`,padding:'10px 14px',display:'flex',alignItems:'center',gap:10,minHeight:52}}>
          <div style={{fontWeight:900,fontSize:16,color:C.amber,letterSpacing:'-0.5px',flexShrink:0}}>▸ GestiónBar</div>
          <div style={{flex:1,display:'flex',gap:6,overflowX:'auto',scrollbarWidth:'none'}}>
            {visibleNegs.map(n=>(
              <button key={n.id} onClick={()=>setNegocioId(n.id)}
                style={{flexShrink:0,padding:'6px 14px',borderRadius:20,border:'none',cursor:'pointer',
                  background:negocioId===n.id?n.color:C.bg,
                  color:negocioId===n.id?'#0b0b14':C.sub,
                  fontWeight:700,fontSize:13,whiteSpace:'nowrap'}}>
                {n.emoji} {n.name}
              </button>
            ))}
          </div>
          <button onClick={syncDB}
            style={{flexShrink:0,background:'none',border:`1px solid ${C.green}60`,
              borderRadius:8,color:C.green,padding:'5px 8px',fontSize:13,cursor:'pointer'}}>
            {'↻'}
          </button>
        </div>

        {/* Contenido con padding inferior para la tab bar */}
        <main className="app-mobile__content" style={{flex:1,padding:'clamp(0.65rem, 3vw, 1rem)',paddingBottom:'calc(74px + env(safe-area-inset-bottom))',overflowY:'auto'}}>
          <div key={view} className="app-page-enter">{mainContent}</div>
        </main>

        {/* Bottom Tab Bar */}
        <div style={{position:'fixed',bottom:0,left:0,right:0,zIndex:50,background:C.surface,
          borderTop:`1px solid ${C.border}`,display:'flex',height:62,
          paddingBottom:'env(safe-area-inset-bottom)'}}>
          {BOTTOM_TABS.map(tab=>{
            const active = tab.id==='mas' ? showMas : (view===tab.id && !showMas);
            return(
              <button key={tab.id}
                onClick={()=>{
                  if(tab.id==='mas'){setShowMas(v=>!v);}
                  else{setView(tab.id);setShowMas(false);}
                }}
                style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
                  gap:2,border:'none',background:'none',cursor:'pointer',
                  color:active?accentColor:C.sub,padding:'6px 2px'}}>
                <span style={{fontSize:20,lineHeight:1}}>{tab.icon}</span>
                <span style={{fontSize:10,fontWeight:active?700:400,letterSpacing:'0.02em'}}>{tab.label}</span>
                {active&&<div style={{position:'absolute',bottom:0,width:32,height:2,borderRadius:1,background:accentColor}}/>}
              </button>
            );
          })}
        </div>

        {/* Panel "Más" (slide-up) */}
        {showMas&&(
          <div style={{position:'fixed',inset:0,zIndex:40}} onClick={()=>setShowMas(false)}>
            <div style={{position:'absolute',bottom:62,left:0,right:0,background:C.surface,
              borderTop:`1px solid ${C.border}`,borderRadius:'16px 16px 0 0',padding:'8px 0 16px'}}
              onClick={e=>e.stopPropagation()}>
                <div style={{width:36,height:4,borderRadius:2,background:C.border,margin:'4px auto 12px'}}/>
              {MORE_MENU.map(item=>(
                <button key={item.id} onClick={()=>{setView(item.id);setShowMas(false);}}
                  style={{width:'100%',display:'flex',alignItems:'center',gap:14,padding:'14px 20px',
                    border:'none',background:view===item.id?accentColor+'15':'none',cursor:'pointer',
                    color:view===item.id?accentColor:C.text,fontSize:15,fontWeight:view===item.id?700:400}}>
                  <span style={{fontSize:22}}>{item.icon}</span>{item.label}
                </button>
              ))}
              {isAdmin&&(
                <div className="app-mobile-business-admin">
                  <div className="app-mobile-business-admin__heading">Administrar negocios</div>
                  {visibleNegs.map(business=>(
                    <div className="app-mobile-business-admin__row" key={business.id}>
                      <span>{business.emoji} {business.name}</span>
                      <button type="button" onClick={()=>setBusinessToDelete(business)} aria-label={`Eliminar ${business.name}`}>
                        Eliminar
                      </button>
                    </div>
                  ))}
                  <button className="app-mobile-business-admin__create" type="button" onClick={()=>{setShowNuevoNeg(true);setShowMas(false);}}>
                    + Crear negocio
                  </button>
                </div>
              )}
              <div style={{height:1,background:C.border,margin:'8px 0'}}/>
              <div style={{padding:'8px 20px',display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                <Badge color={ROLE_BADGE[role]||C.muted} small>{ROLE_LABELS[role]||role}</Badge>
                <span style={{fontSize:13,color:C.sub,flex:1}}>{user?.name}</span>
                {isAdmin&&<button style={{...s.btn(),padding:'6px 12px',fontSize:12}} onClick={()=>{setShowAccessLinks(true);setShowMas(false);}}>🔗 Compartir acceso</button>}
                {isAdmin&&<button style={{...s.btn(),padding:'6px 12px',fontSize:12}} onClick={()=>{setShowUsers(true);setShowMas(false);}}>👤 Usuarios</button>}
                <button style={{...s.btn('danger'),padding:'6px 12px',fontSize:12}} onClick={logout}>Salir</button>
              </div>
            </div>
          </div>
        )}

        {showNuevoNeg&&<NuevoNegocioModal onClose={()=>setShowNuevoNeg(false)} onCrear={crearNegocio}/>}
        {businessToDelete&&<EliminarNegocioModal negocio={businessToDelete} onClose={()=>setBusinessToDelete(null)} onDelete={confirmarEliminacionNegocio}/>}
        {showAccessLinks&&<AdminAccessLinks onClose={()=>setShowAccessLinks(false)}/>}
        {showUsers&&<UserMgmt negocios={negocios} onClose={()=>setShowUsers(false)}/>}
      </div>
    );
  }

  // ── LAYOUT ESCRITORIO ────────────────────────────────────────────────────────
  return(
    <div className={`app-desktop${sidebarCollapsed?' app-desktop--collapsed':''}`} style={{minHeight:'100vh',background:C.bg,color:C.text,fontFamily:"'Segoe UI',system-ui,-apple-system,sans-serif"}}>
      <aside className="app-sidebar">
        <div className="app-sidebar__brand">
          <span className="app-sidebar__brand-mark">▸</span>
          {!sidebarCollapsed&&<span className="app-sidebar__brand-name">GestiónBar</span>}
          <button
            className="app-sidebar__collapse"
            type="button"
            onClick={()=>setSidebarCollapsed(collapsed=>!collapsed)}
            aria-label={sidebarCollapsed?'Expandir barra lateral':'Contraer barra lateral'}
            aria-expanded={!sidebarCollapsed}
            title={sidebarCollapsed?'Expandir barra lateral':'Contraer barra lateral'}
          >
            {sidebarCollapsed?'»':'«'}
          </button>
        </div>
        <div className="app-sidebar__section-label">{!sidebarCollapsed&&'Negocios'}</div>
        <div className="app-sidebar__businesses">
          {visibleNegs.map(n=>(
            <div className="app-sidebar__business-row" key={n.id}>
              <button
                className={`app-sidebar__business${negocioId===n.id?' is-active':''}`}
                onClick={()=>setNegocioId(n.id)}
                style={negocioId===n.id?{'--business-color':n.color}:undefined}
                title={n.name}
                aria-current={negocioId===n.id?'true':undefined}
              >
                <span>{n.emoji}</span>
                {!sidebarCollapsed&&<span className="app-sidebar__business-name">{n.name}</span>}
              </button>
              {isAdmin&&(
                <button
                  className="app-sidebar__business-delete"
                  type="button"
                  onClick={()=>setBusinessToDelete(n)}
                  title={`Eliminar ${n.name}`}
                  aria-label={`Eliminar ${n.name}`}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          {isAdmin&&(
            <button
              className="app-sidebar__business app-sidebar__add"
              onClick={()=>setShowNuevoNeg(true)}
              title="Nuevo negocio"
              aria-label="Crear negocio"
            >
              <span>+</span>{!sidebarCollapsed&&<span className="app-sidebar__business-name">Nuevo negocio</span>}
            </button>
          )}
        </div>
        <div className="app-sidebar__section-label">{!sidebarCollapsed&&'Navegación'}</div>
        <nav className="app-sidebar__navigation" aria-label="Navegación principal">
          {VIEWS.map(v=>{
            const active=view===v.id;
            const icon=v.id==='operacion'&&role==='mesero'?'🧾':VIEW_ICONS[v.id]||'•';
            return(
              <button
                key={v.id}
                className={`app-sidebar__link${active?' is-active':''}`}
                style={active?{'--business-color':negocio?.color||C.amber}:undefined}
                onClick={()=>setView(v.id)}
                title={v.label}
                aria-current={active?'page':undefined}
              >
                <span className="app-sidebar__icon" aria-hidden="true">{icon}</span>
                {!sidebarCollapsed&&<span className="app-sidebar__link-label">{v.label}</span>}
              </button>
            );
          })}
        </nav>
        <div className="app-sidebar__footer">
          {!sidebarCollapsed&&(
            <div className="app-sidebar__user">
              <Badge color={ROLE_BADGE[role]||C.muted} small>{ROLE_LABELS[role]||role}</Badge>
              <span title={user?.name}>{user?.name}</span>
            </div>
          )}
          {sidebarCollapsed&&<div className="app-sidebar__role" title={ROLE_LABELS[role]||role}><Badge color={ROLE_BADGE[role]||C.muted} small>{(ROLE_LABELS[role]||role).slice(0,1)}</Badge></div>}
          {isAdmin&&(
            <button className="app-sidebar__utility" onClick={()=>setShowUsers(true)} title="Usuarios">
              <span aria-hidden="true">👤</span>{!sidebarCollapsed&&<span>Usuarios</span>}
            </button>
          )}
          {isAdmin&&(
            <button className="app-sidebar__utility" onClick={()=>setShowAccessLinks(true)} title="Compartir acceso con meseros y barra">
              <span aria-hidden="true">🔗</span>{!sidebarCollapsed&&<span>Compartir acceso</span>}
            </button>
          )}
          <button className="app-sidebar__utility" onClick={syncDB} title="Datos en servidor local">
            <span aria-hidden="true">↻</span>{!sidebarCollapsed&&<span>Servidor local</span>}
          </button>
          <button className="app-sidebar__utility app-sidebar__logout" onClick={logout} title="Salir">
            <span aria-hidden="true">↪</span>{!sidebarCollapsed&&<span>Salir</span>}
          </button>
        </div>
      </aside>
      <div className="app-desktop__content">
        <header className="app-topbar">
          <div className="app-topbar__workspace">
            <span className="app-topbar__business-mark" aria-hidden="true">{negocio.emoji||'🍸'}</span>
            <div className="app-topbar__titles">
              <span className="app-topbar__eyebrow">ESPACIO DE TRABAJO</span>
              <div>
                <strong>{negocio.name}</strong>
                <span className="app-topbar__separator">/</span>
                <span>{VIEWS.find(item=>item.id===view)?.label||'Inicio'}</span>
              </div>
            </div>
          </div>
          <div className="app-topbar__meta">
            <span className="app-topbar__local"><i aria-hidden="true"/> Sistema local</span>
            <Badge color={ROLE_BADGE[role]||C.muted} small>{ROLE_LABELS[role]||role}</Badge>
          </div>
        </header>
        <main className="app-desktop__main">
          <div key={view} className="app-page-enter">
            {mainContent}
          </div>
        </main>
      </div>
      {showNuevoNeg&&<NuevoNegocioModal onClose={()=>setShowNuevoNeg(false)} onCrear={crearNegocio}/>}
      {businessToDelete&&<EliminarNegocioModal negocio={businessToDelete} onClose={()=>setBusinessToDelete(null)} onDelete={confirmarEliminacionNegocio}/>}
      {showAccessLinks&&<AdminAccessLinks onClose={()=>setShowAccessLinks(false)}/>}
      {showUsers&&<UserMgmt negocios={negocios} onClose={()=>setShowUsers(false)}/>}
    </div>
  );
}
