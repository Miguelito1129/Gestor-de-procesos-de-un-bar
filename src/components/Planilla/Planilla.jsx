import { useState, useEffect, useCallback } from "react";
import { C, s, COP, NOW_TIME, BILLETS } from "../../constants/theme.js";
import { ROL_COLORS, ROLES_LIST } from "../../constants/roles.js";
import { CAT_COLORS } from "../../constants/roles.js";
import { useAuth } from "../../hooks/useAuth.jsx";
import { localFetch, localUpdate, localDeleteStaff, localInsert } from "../../lib/localApi.js";
import { uid } from "../../utils/helpers.js";
import { printPlanilla } from "../../utils/printPlanilla.js";
import { Badge, Metric, SectionTitle, TabBar, Modal } from "../common/index.jsx";
const r1000 = v => Math.round(v / 1000) * 1000; // redondear al millar más cercano

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
import UploadTransfer from "../common/UploadReceipt.jsx";

export default function Planilla({ negocio, onUpdateNegocio }) {
  const { user } = useAuth();
  const isJefe = user?.role === 'jefe';
  const isAux  = user?.role === 'auxiliar';
  const TURNO_KEY = `gesbar_turno_${negocio.id}`;

  const saved = () => { try{return JSON.parse(localStorage.getItem(TURNO_KEY)||'{}');}catch{return {};} };

  const [step,setStep]         = useState(()=>saved().step||'inicio');
  const [apertura,setApertura] = useState(()=>saved().apertura||'');
  const [baseCaja,setBaseCaja] = useState(()=>saved().baseCaja||'1000000');
  const [staffFilter,setStaffFilter] = useState('');
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
  const [gastosT,setGastosT]      = useState(()=>saved().gastosT||[]);
  const [bancosTransfs,setBancosTransfs] = useState(()=>{
    const sv=saved();
    if(sv.bancosTransfs?.length) return sv.bancosTransfs;
    // migración desde formato anterior {nequi:'',bancolombia:'',…}
    if(sv.bancos) return Object.entries(sv.bancos).filter(([,v])=>parseInt(v)>0).map(([k,v])=>({id:`_${k}`,plataforma:k,monto:parseInt(v)||0,ref:'',hora:''}));
    return [];
  });
  const [bForm,setBForm] = useState({plataforma:'nequi',monto:'',ref:''});
  const [extras,setExtras]        = useState(()=>saved().extras||'');
  const [pendientes,setPendientes]= useState(()=>saved().pendientes||'');
  const [novedades,setNovedades]  = useState(()=>saved().novedades||'');
  const [tab,setTab]              = useState('productos');
  const [ventasMesero,setVentasMesero] = useState(()=>saved().ventasMesero||{});
  const [billetes,setBilletes]    = useState(()=>saved().billetes||{});
  const [resumen,setResumen]      = useState(null);
  const [gForm,setGForm]          = useState({desc:'',monto:''});
  const [viewPlanilla,setViewPlanilla] = useState(null);
  const [editingPlatId,setEditingPlatId]     = useState(null); // id de la fila con selector de plataforma abierto
  const [pctBarra,setPctBarra]               = useState(()=>saved().pctBarra??3);
  const [pctMeseros,setPctMeseros]           = useState(()=>saved().pctMeseros??5);

  useEffect(()=>{
    if(step==='inicio'||step==='cerrado') return;
    const data={step,apertura,baseCaja,staffActivo,checklist,movs,gastosT,bancosTransfs,extras,pendientes,novedades,ventasMesero,billetes,pctBarra,pctMeseros};
    localStorage.setItem(TURNO_KEY, JSON.stringify(data));
  },[step,apertura,movs,gastosT,bancosTransfs,extras,pendientes,novedades,ventasMesero,billetes,checklist,pctBarra,pctMeseros,staffActivo]);



  const staffFiltrado  = staffActivo.filter(s=>s.name.toLowerCase().includes(staffFilter.toLowerCase())||s.rol.toLowerCase().includes(staffFilter.toLowerCase()));
  const barman         = staffActivo.find(s=>s.rol==='barra'&&s.activo);
  const dj             = staffActivo.find(s=>s.rol==='dj'&&s.activo);
  const meseros        = staffActivo.filter(s=>s.rol==='mesero'&&s.activo);
  const pagoFijosStaff = staffActivo.filter(s=>['patin','seguridad','aseo','barra_fija','mesero_fijo'].includes(s.rol)&&s.activo);
  const totalBancos        = bancosTransfs.reduce((s,t)=>s+(t.monto||0),0);
  const totalGastosT       = gastosT.reduce((s,g)=>s+g.monto,0);
  const totalBilletes      = BILLETS.reduce((s,b)=>s+(parseInt(billetes[b])||0)*b,0);
  const totalVentaProductos= negocio.productos.reduce((s,p)=>{const m=movs[p.id]||{};return s+(m.ventaManual!==undefined?m.ventaManual:Math.max(0,(m.salidas||0)-(m.cortesia||0))*p.price);},0);
  const totalVentasMeseros = meseros.reduce((s,m)=>s+(parseInt(ventasMesero[m.id])||0),0);
  const totalVentas        = totalVentaProductos;
  const pagoBarra          = barman?r1000(totalVentas*(pctBarra/100)):0;
  const pagoDJ             = dj?(typeof dj.pay==='number'?dj.pay:0):0;
  const pagoMeseros        = meseros.map(m=>{const v=parseInt(ventasMesero[m.id])||0;return{...m,venta:v,pago:r1000(v*(pctMeseros/100))};});
  const capMeseros         = r1000(totalVentas*(pctMeseros/100));
  const totalMeserosFinal  = Math.min(pagoMeseros.reduce((s,m)=>s+m.pago,0),capMeseros);
  const pagoFijosTotal     = pagoFijosStaff.reduce((s,p)=>s+(typeof p.pay==='number'?p.pay:0),0);
  const totalPersonal      = pagoBarra+pagoDJ+totalMeserosFinal+pagoFijosTotal;
  const neto               = totalVentas-totalBancos+(parseInt(extras)||0)-totalGastosT-totalPersonal-(parseInt(pendientes)||0);

  const resetTurno = () => {
    setStep('inicio');setMovs({});setGastosT([]);setBancosTransfs([]);
    setExtras('');setPendientes('');setNovedades('');setVentasMesero({});setBilletes({});setResumen(null);setChecklist({});
    setStaffActivo(negocio.staff.map(s=>({...s,activo:true})));
    localStorage.removeItem(TURNO_KEY);
  };

  const confirmarApertura = (checkItems, novedadesApert='') => {
    setChecklist(checkItems);
    if(novedadesApert) setNovedades(novedadesApert);
    setApertura(NOW_TIME());
    setGastosT(GASTOS_PRESETS);   // hielo, limón y vasos siempre visibles
    setBancosTransfs([]);          // limpia tranfs de sesión anterior
    setTab('productos');           // siempre empieza en la pestaña de productos
    setStep('abierto');
    setShowChecklist(false);
  };

  const cerrarTurno = () => {
    const personalDetalle=[...pagoMeseros.filter(m=>m.pago>0).map(m=>({name:m.name,rol:'mesero',pago:m.pago})),...(barman?[{name:barman.name,rol:'barra',pago:pagoBarra}]:[]),...(dj?[{name:dj.name,rol:'dj',pago:pagoDJ}]:[]),...pagoFijosStaff.map(s=>({name:s.name,rol:s.rol,pago:typeof s.pay==='number'?s.pay:0}))];
    const movsList=negocio.productos.filter(p=>movs[p.id]&&(movs[p.id].salidas||movs[p.id].entradas||movs[p.id].cortesia||movs[p.id].existencias!==undefined)).map(p=>{const m=movs[p.id]||{};const vendidas=Math.max(0,(m.salidas||0)-(m.cortesia||0));const finalStock=m.existencias!==undefined?m.existencias:p.stock+(m.entradas||0)-(m.salidas||0)-(m.cortesia||0);const total=m.ventaManual!==undefined?m.ventaManual:vendidas*p.price;return{name:p.name,inicio:p.stock,entradas:m.entradas||0,salidas:m.salidas||0,cortesia:m.cortesia||0,final:finalStock,total,precio:p.price,...(m.ventaManual!==undefined?{ventaManual:m.ventaManual}:{})};});
    const gastosDetalle=gastosT.filter(g=>g.monto>0).map(g=>({desc:g.desc,monto:g.monto}));
    const bancoDetalle={};bancosTransfs.forEach(t=>{bancoDetalle[t.plataforma]=(bancoDetalle[t.plataforma]||0)+t.monto;});
    const r={id:uid(),fecha:new Date().toISOString().slice(0,10),apertura,cierre:NOW_TIME(),ventas:totalVentas,bancos:totalBancos,bancoDetalle,gastos:totalGastosT,extras:parseInt(extras)||0,pendientes:parseInt(pendientes)||0,personal:totalPersonal,personalDetalle,gastosDetalle,neto,arqueo:{total:totalBilletes},novedades,movimientos:movsList};
    r.diferencia=totalBilletes-neto;
    const newProds=negocio.productos.map(p=>{const m=movs[p.id];if(!m)return p;if(m.existencias!==undefined)return{...p,stock:Math.max(0,m.existencias)};return{...p,stock:Math.max(0,p.stock+(m.entradas||0)-(m.salidas||0)-(m.cortesia||0))};});
    onUpdateNegocio({...negocio,productos:newProds,planillas:[r,...negocio.planillas]});
    localStorage.removeItem(TURNO_KEY);
    setResumen(r);setStep('cerrado');
  };

  const tabs=[{id:'productos',label:'Planilla Productos'},{id:'ventas',label:'Ventas Meseros'},{id:'gastos',label:'Gastos'},{id:'bancos',label:'Bancos'},{id:'novedades',label:'Novedades'},{id:'perspectiva',label:'📊 Perspectiva'},{id:'cierre',label:'Cerrar Turno'}];

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
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:'1.25rem'}}>
            <Metric label="Ventas"   value={COP(viewPlanilla.ventas)}       color={C.green}/>
            <Metric label="Bancos"   value={COP(viewPlanilla.bancos||0)}    color={C.indigo}/>
            <Metric label="Neto"     value={COP(viewPlanilla.neto)}         color={C.amber}/>
            <Metric label="Personal" value={COP(viewPlanilla.personal||0)}  color={C.red}/>
          </div>
        </div>
      ) : (
        <div style={s.card}>
          {negocio.planillas.map(p=>(
            <div key={p.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 0',borderBottom:`1px solid ${C.border}50`}}>
              <div><span style={{fontWeight:600,fontSize:13}}>{p.fecha}</span><span style={{color:C.sub,marginLeft:8,fontSize:11}}>{p.apertura}–{p.cierre}</span></div>
              <div style={{display:'flex',gap:12,alignItems:'center'}}>
                <span style={{color:C.green,fontWeight:600,fontSize:13}}>{COP(p.ventas)}</span>
                <span style={{color:C.amber,fontWeight:700,fontSize:13}}>{COP(p.neto)}</span>
                <button style={{...s.btn(),padding:'2px 10px',fontSize:11}} onClick={()=>setViewPlanilla(p)}>Ver</button>
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
    const getWeekKey = fechaStr => {
      let d;
      if(fechaStr.includes('-')) d=new Date(fechaStr);
      else { const [dd,mm,yyyy]=fechaStr.split('/'); d=new Date(`${yyyy}-${mm}-${dd}`); }
      if(isNaN(d)) return fechaStr;
      const day=d.getDay();const diffLun=(day===0)?-6:1-day;
      const lun=new Date(d); lun.setDate(d.getDate()+diffLun);
      const dom=new Date(lun); dom.setDate(lun.getDate()+6);
      const fmt=x=>`${String(x.getDate()).padStart(2,'0')}/${String(x.getMonth()+1).padStart(2,'0')}`;
      return `${fmt(lun)} – ${fmt(dom)} ${dom.getFullYear()}`;
    };
    return(
      <div>
        <SectionTitle>Planillas de Turno</SectionTitle>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'1.25rem'}}>
          <div style={s.card}>
            <div style={{fontWeight:700,marginBottom:'1rem',fontSize:14}}>Abrir Turno</div>
            <div style={{marginBottom:12}}><div style={s.label}>Base de Caja (COP)</div><input style={s.inp} type="number" value={baseCaja} onChange={e=>setBaseCaja(e.target.value)}/></div>
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
              <div style={{fontSize:11,color:C.sub,marginTop:5}}>{staffActivo.filter(s=>s.activo).length}/{staffActivo.length} en turno</div>
            </div>
            <button style={{...s.btn('primary'),width:'100%',padding:10}} onClick={()=>setShowChecklist(true)}>Abrir Turno</button>
          </div>
          <div style={s.card}>
            <div style={{fontWeight:700,marginBottom:'1rem',fontSize:14,display:'flex',justifyContent:'space-between'}}>
              <span>Planillas Cerradas</span><Badge color={C.green} small>{negocio.planillas.length}</Badge>
            </div>
            {negocio.planillas.length===0?<div style={{color:C.sub,fontSize:13}}>Sin planillas registradas.</div>:(()=>{
              const grupos={};
              [...negocio.planillas].sort((a,b)=>a.fecha.localeCompare(b.fecha)).forEach(p=>{
                const k=getWeekKey(p.fecha);
                if(!grupos[k]) grupos[k]=[];
                grupos[k].push(p);
              });
              return Object.entries(grupos).map(([semana,planillas])=>(
                <details key={semana} open style={{marginBottom:'0.75rem'}}>
                  <summary style={{cursor:'pointer',padding:'6px 8px',borderRadius:8,background:negocio.color+'18',border:`1px solid ${negocio.color}30`,fontWeight:700,fontSize:12,color:negocio.color,listStyle:'none',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <span>📅 Semana {semana}</span>
                    <div style={{display:'flex',gap:8,alignItems:'center'}}>
                      <span style={{color:C.green,fontWeight:700,fontSize:11}}>{COP(planillas.reduce((s,p)=>s+p.ventas,0))}</span>
                      <Badge color={negocio.color} small>{planillas.length} turnos</Badge>
                    </div>
                  </summary>
                  <div style={{paddingTop:6}}>
                    {planillas.map(p=>(
                      <div key={p.id} style={{padding:'8px 4px',borderBottom:`1px solid ${C.border}40`}}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                          <span style={{fontWeight:600,fontSize:13}}>{p.fecha} <span style={{color:C.sub,fontWeight:400,fontSize:11}}>{p.apertura}–{p.cierre}</span></span>
                          <div style={{display:'flex',gap:5}}>
                            <button style={{...s.btn(),padding:'2px 10px',fontSize:11}} onClick={()=>setViewPlanilla(p)}>Ver</button>
                            <button style={{...s.btn(),padding:'2px 10px',fontSize:11}} onClick={()=>printPlanilla(p,negocio.name)}>🖨</button>
                          </div>
                        </div>
                        <div style={{display:'flex',gap:14,marginTop:4,fontSize:12,color:C.sub}}>
                          <span>Ventas: <strong style={{color:C.green}}>{COP(p.ventas)}</strong></span>
                          <span>Neto: <strong style={{color:p.neto>=0?C.amber:C.red}}>{COP(p.neto)}</strong></span>
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              ));
            })()}
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
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10}}>
              <Metric label="Ventas"   value={COP(viewPlanilla.ventas)}       color={C.green}/>
              <Metric label="Bancos"   value={COP(viewPlanilla.bancos||0)}    color={C.indigo}/>
              <Metric label="Neto"     value={COP(viewPlanilla.neto)}         color={C.amber}/>
              <Metric label="Personal" value={COP(viewPlanilla.personal||0)}  color={C.red}/>
            </div>
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
            📦 <strong style={{color:C.green}}>Existencias</strong> = conteo físico al cierre del turno. &nbsp;
            📤 <strong style={{color:C.amber}}>Salidas</strong> = calculadas automáticamente (Inicio + Entradas − Existencias). &nbsp;
            🎁 <strong style={{color:C.purple}}>Cortesías</strong> automáticas por categoría.
          </div>
          {(()=>{
            const negatives=negocio.productos.filter(p=>{const m=movs[p.id]||{};if(m.existencias!==undefined)return m.existencias<0;return p.stock+(m.entradas||0)-(m.salidas||0)-(m.cortesia||0)<0;});
            if(!negatives.length) return null;
            return <div style={{padding:'10px 14px',background:C.red+'18',border:`2px solid ${C.red}60`,borderRadius:8,marginBottom:'0.75rem',fontSize:12}}>
              <div style={{fontWeight:700,color:C.red,marginBottom:4}}>⚠ Existencias insuficientes — no se puede cerrar el turno con stock negativo</div>
              <div style={{color:C.text}}>Productos: {negatives.map(p=>{const m=movs[p.id]||{};return m.existencias!==undefined?`${p.name} (exist:${m.existencias})`:`${p.name} (stock:${p.stock}, sale:${(m.salidas||0)+(m.cortesia||0)})`;}).join(' · ')}</div>
            </div>;
          })()}
          <div style={{overflowX:'auto',overflowY:'auto',maxHeight:'calc(100vh - 290px)'}}>
            <table style={{width:'100%',borderCollapse:'collapse',minWidth:720}}>
              <thead><tr>{['Producto','Cat.','Auto','Inicio','📥 Entradas','📦 Existencias','📤 Salidas','🎁 Cortesía','Final','Venta'].map(h=><th key={h} style={{...s.th,position:'sticky',top:0,zIndex:2,background:'#1a1a2e'}}>{h}</th>)}</tr></thead>
              <tbody>{negocio.productos.map((p,i)=>{
                const m=movs[p.id]||{};const e=m.entradas||0;const sa=m.salidas||0;const co=m.cortesia||0;const final=m.existencias!==undefined?m.existencias:p.stock+e-sa-co;
                return(
                  <tr key={p.id} style={{background:final<0?C.red+'10':i%2===0?C.rowA:C.rowB}}>
                    <td style={{...s.td(i),fontWeight:500,fontSize:11}}>{p.name}</td>
                    <td style={s.td(i)}><Badge color={CAT_COLORS[p.cat]||C.muted} small>{p.cat}</Badge></td>
                    <td style={s.td(i)}>{p.courtesy?<Badge color={C.purple} small>→{p.courtesy}</Badge>:<span style={{color:C.muted}}>—</span>}</td>
                    <td style={{...s.td(i),fontWeight:700,color:C.sub}}>{p.stock}</td>
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
                        value={m.existencias??''} placeholder="—"
                        onChange={ev=>{
                          const raw=ev.target.value;
                          const val=raw===''?undefined:parseInt(raw)||0;
                          setMovs(prev=>{
                            const prevM=prev[p.id]||{};
                            const ent=prevM.entradas||0;
                            const newSalidas=val!==undefined?Math.max(0,p.stock+ent-val):0;
                            const updated={...prev,[p.id]:{...prevM,existencias:val,salidas:newSalidas}};
                            if(p.courtesy&&val!==undefined){
                              const ck=p.courtesy.toLowerCase();
                              // Búsqueda en dos pasos: primero preferencia específica (coca),
                              // luego fallback. Evita que "Soda" sea deducida antes que "Coca-Cola".
                              const cpFind=(test)=>negocio.productos.find(x=>{if(x.id===p.id)return false;const n=x.name.toLowerCase();return test(n,ck);});
                              const cp=
                                cpFind((n,ck)=>{
                                  if(ck==='agua')return n.includes('agua')&&!n.includes('gator')&&!n.includes('ardiente')&&!n.includes('iero');
                                  if(ck==='gatorade')return n.includes('gatorade')||n.includes('gator');
                                  if(ck==='gaseosa')return n.includes('coca'); // primera preferencia: coca-cola
                                  return false;
                                })||
                                cpFind((n,ck)=>{
                                  if(ck==='gaseosa')return n.includes('gaseosa')||n.includes('soda'); // fallback
                                  return false;
                                });
                              if(cp){
                                // Sumar salidas de TODOS los productos que comparten la misma cortesía
                                const totalCortesia=negocio.productos
                                  .filter(x=>x.courtesy?.toLowerCase()===ck)
                                  .reduce((sum,x)=>sum+(updated[x.id]?.salidas||0),0);
                                const cpM=prev[cp.id]||{};
                                updated[cp.id]={...cpM,cortesia:totalCortesia};
                                if(cpM.existencias!==undefined){
                                  // salidas = total físico que salió (stock + entradas - existencias)
                                  // La cortesía es una partida DENTRO de esas salidas, no se resta de nuevo
                                  updated[cp.id]={...updated[cp.id],salidas:Math.max(0,cp.stock+(cpM.entradas||0)-cpM.existencias)};
                                }
                              }
                            }
                            return updated;
                          });
                        }}/>
                    </td>
                    <td style={s.td(i)}>
                      <span style={{fontSize:13,fontWeight:sa>0?700:400,color:sa>0?(p.courtesy?C.purple:C.amber):C.sub,display:'block',textAlign:'center'}}>{sa>0?sa:'—'}</span>
                    </td>
                    <td style={s.td(i)}>
                      <input type="number" min="0" style={{...s.inp,width:56,padding:'3px 5px',textAlign:'center',color:co>0?C.purple:C.text,fontWeight:co>0?700:400,border:`1px solid ${co>0?C.purple:C.border}`}}
                        value={m.cortesia||''} placeholder="0"
                        onChange={ev=>setMovs(prev=>({...prev,[p.id]:{...(prev[p.id]||{}),cortesia:parseInt(ev.target.value)||0}}))}/>
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
                          <span style={{color:(sa-co)>0?C.green:C.sub,fontWeight:600}}>{sa>0?COP((sa-co)*p.price):'—'}</span>
                          {sa>0&&<button title="Ajustar total manualmente" style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:11,padding:0,lineHeight:1}}
                            onClick={()=>setMovs(prev=>({...prev,[p.id]:{...(prev[p.id]||{}),ventaManual:(sa-co)*p.price}}))}>✏</button>}
                        </div>
                      )}
                      {sa>0&&co>0&&m.ventaManual===undefined&&<div style={{fontSize:10,color:C.purple,marginTop:2}}>{sa} - {co} cort. = {sa-co} pagadas</div>}
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
          {(()=>{const entradas=negocio.productos.filter(p=>(movs[p.id]?.entradas||0)>0);if(!entradas.length)return null;return<div style={{marginTop:8,padding:'8px 12px',background:C.green+'15',border:`1px solid ${C.green}30`,borderRadius:8,fontSize:12}}><strong style={{color:C.green}}>📥 Entradas registradas (sumarán al inventario al cerrar):</strong>{entradas.map((p,i)=><span key={i} style={{marginLeft:8,color:C.text2}}>+{movs[p.id].entradas} {p.name.split(' ').slice(0,2).join(' ')}</span>)}</div>;})()}
          {(()=>{const sum=negocio.productos.filter(p=>p.courtesy&&(movs[p.id]?.salidas||0)>0);if(!sum.length)return null;return<div style={{marginTop:6,padding:'8px 12px',background:C.purple+'15',border:`1px solid ${C.purple}30`,borderRadius:8,fontSize:12}}><strong style={{color:C.purple}}>🎁 Cortesías automáticas:</strong>{sum.map((p,i)=><span key={i} style={{marginLeft:8,color:C.text2}}>{movs[p.id].salidas}×{p.name.split(' ').slice(0,2).join(' ')}→{movs[p.id].salidas} {p.courtesy}</span>)}</div>;})()}
        </div>
      )}

      {tab==='ventas'&&(
        <div style={s.card}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.5rem'}}>
            <div style={{fontWeight:700,fontSize:13}}>Personal del Turno — Comisiones</div>
            <button style={{...s.btn(),padding:'4px 12px',fontSize:12,color:C.green,border:`1px solid ${C.green}40`}} onClick={()=>setShowNuevoStaff(true)}>+ Personal</button>
          </div>
          <div style={{display:'flex',gap:16,alignItems:'center',marginBottom:'0.75rem',padding:'8px 12px',background:C.surface,borderRadius:8,border:`1px solid ${C.border}`,flexWrap:'wrap'}}>
            <span style={{fontSize:11,color:C.sub,fontWeight:600}}>Comisiones:</span>
            <div style={{display:'flex',alignItems:'center',gap:6,fontSize:12}}>
              <span style={{color:C.sub}}>Barra</span>
              <input type="number" min="0" max="100" step="0.5" style={{...s.inp,width:58,padding:'3px 6px',textAlign:'center',fontSize:12}} value={pctBarra} onChange={e=>setPctBarra(parseFloat(e.target.value)||0)}/>
              <span style={{color:C.sub}}>%</span>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:6,fontSize:12}}>
              <span style={{color:C.sub}}>Meseros</span>
              <input type="number" min="0" max="100" step="0.5" style={{...s.inp,width:58,padding:'3px 6px',textAlign:'center',fontSize:12}} value={pctMeseros} onChange={e=>setPctMeseros(parseFloat(e.target.value)||0)}/>
              <span style={{color:C.sub}}>%</span>
            </div>
          </div>
          <div style={{fontSize:11,color:C.sub,marginBottom:'1rem'}}>
            Ingresa lo que vendió cada mesero esta noche. El <strong style={{color:C.red}}>{pctMeseros}% de comisión se descuenta del neto</strong>.
            La barra cobra <strong style={{color:C.amber}}>{pctBarra}% del total de ventas</strong>: {COP(totalVentas)}.
          </div>
          <table style={{width:'100%',borderCollapse:'collapse',marginBottom:'1rem'}}>
            <thead><tr style={{background:C.surface}}>{['Mesero','Ventas del turno',`Comisión ${pctMeseros}%`,'Entrega en caja',''].map(h=><th key={h} style={s.th}>{h}</th>)}</tr></thead>
            <tbody>
              {meseros.map((m,i)=>{
                const v=parseInt(ventasMesero[m.id])||0;const comision=r1000(v*(pctMeseros/100));const entrega=v-comision;
                return(
                  <tr key={m.id} style={{background:i%2===0?C.rowA:C.rowB}}>
                    <td style={{...s.td(i),fontWeight:600}}>{m.name}</td>
                    <td style={s.td(i)}><input style={{...s.inp,maxWidth:180,border:`1px solid ${v>0?C.green:C.border}`,color:v>0?C.green:C.text,fontWeight:v>0?700:400}} type="number" placeholder="0" value={ventasMesero[m.id]||''} onChange={e=>setVentasMesero(p=>({...p,[m.id]:e.target.value}))}/></td>
                    <td style={{...s.td(i),color:C.red,fontWeight:v>0?700:400}}>{v>0?`− ${COP(comision)}`:'—'}</td>
                    <td style={{...s.td(i),color:v>0?C.amber:C.sub,fontWeight:v>0?700:400}}>{v>0?COP(entrega):'—'}</td>
                    <td style={s.td(i)}><button onClick={()=>setStaffActivo(p=>p.map(x=>x.id===m.id?{...x,activo:false}:x))} style={{background:'none',border:'none',cursor:'pointer',color:C.muted,fontSize:15,padding:'0 4px',lineHeight:1}} title="Quitar del turno">✕</button></td>
                  </tr>
                );
              })}
              {totalVentasMeseros>0&&(
                <tr style={{background:C.amber+'12'}}>
                  <td style={{...s.td(0),fontWeight:800}}>TOTAL MESEROS</td>
                  <td style={{...s.td(0),color:C.green,fontWeight:800}}>{COP(totalVentasMeseros)}</td>
                  <td style={{...s.td(0),color:C.red,fontWeight:700}}>− {COP(totalMeserosFinal)}</td>
                  <td style={{...s.td(0),color:C.amber,fontWeight:800}}>{COP(totalVentasMeseros-totalMeserosFinal)}</td>
                  <td style={s.td(0)}/>
                </tr>
              )}
            </tbody>
          </table>
          {meseros.length===0&&<div style={{color:C.sub,fontSize:12,padding:'1rem',textAlign:'center'}}>No hay meseros activos en este turno.</div>}
          <div style={{borderTop:`1px solid ${C.border}`,paddingTop:'1rem',display:'flex',flexDirection:'column',gap:8}}>
            <div style={{fontSize:11,color:C.sub,textTransform:'uppercase',fontWeight:600,letterSpacing:'0.05em',marginBottom:4}}>Otros pagos de personal</div>
            {barman&&<div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 10px',background:C.surface,borderRadius:8}}><div><span style={{fontWeight:600}}>{barman.name}</span><span style={{color:C.sub,marginLeft:8,fontSize:11}}>Barra {pctBarra}%</span></div><div style={{display:'flex',alignItems:'center',gap:8}}><span style={{color:C.red,fontWeight:700}}>− {COP(pagoBarra)}</span><button onClick={()=>setStaffActivo(p=>p.map(x=>x.id===barman.id?{...x,activo:false}:x))} style={{background:'none',border:'none',cursor:'pointer',color:C.muted,fontSize:15,padding:'0 4px',lineHeight:1}} title="Quitar del turno">✕</button></div></div>}
            {dj&&<div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 10px',background:C.surface,borderRadius:8}}><div><span style={{fontWeight:600}}>{dj.name}</span><span style={{color:C.sub,marginLeft:8,fontSize:11}}>DJ fijo</span></div><div style={{display:'flex',alignItems:'center',gap:6}}><span style={{color:C.sub,fontSize:11}}>−</span><input type="number" min="0" style={{...s.inp,width:110,padding:'3px 6px',textAlign:'right',fontSize:12}} value={typeof dj.pay==='number'?dj.pay:''} onChange={e=>setStaffActivo(p=>p.map(x=>x.id===dj.id?{...x,pay:parseInt(e.target.value)||0}:x))}/><button onClick={()=>setStaffActivo(p=>p.map(x=>x.id===dj.id?{...x,activo:false}:x))} style={{background:'none',border:'none',cursor:'pointer',color:C.muted,fontSize:15,padding:'0 4px',lineHeight:1}} title="Quitar del turno">✕</button></div></div>}
            {pagoFijosStaff.map(st=>(
              <div key={st.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 10px',background:C.surface,borderRadius:8}}><div><span style={{fontWeight:600}}>{st.name}</span><span style={{color:C.sub,marginLeft:8,fontSize:11}}>{st.rol.replace(/_/g,' ')}</span></div><div style={{display:'flex',alignItems:'center',gap:6}}><span style={{color:C.sub,fontSize:11}}>−</span><input type="number" min="0" style={{...s.inp,width:110,padding:'3px 6px',textAlign:'right',fontSize:12}} value={typeof st.pay==='number'?st.pay:''} onChange={e=>setStaffActivo(p=>p.map(x=>x.id===st.id?{...x,pay:parseInt(e.target.value)||0}:x))}/><button onClick={()=>setStaffActivo(p=>p.map(x=>x.id===st.id?{...x,activo:false}:x))} style={{background:'none',border:'none',cursor:'pointer',color:C.muted,fontSize:15,padding:'0 4px',lineHeight:1}} title="Quitar del turno">✕</button></div></div>
            ))}
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

          {/* ── Registrar transferencia ─────────────────────────────────── */}
          <div style={s.card}>
            <div style={{fontWeight:700,fontSize:13,marginBottom:'0.75rem'}}>Registrar Transferencia</div>
            <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center',marginBottom:'0.75rem'}}>
              <select style={{...s.sel,flex:'0 0 135px'}} value={bForm.plataforma} onChange={e=>setBForm(p=>({...p,plataforma:e.target.value}))}>
                {Object.entries(PLAT_LABELS).map(([k,l])=><option key={k} value={k}>{l}</option>)}
              </select>
              <input style={{...s.inp,flex:'0 0 150px'}} type="number" placeholder="Monto"
                value={bForm.monto} onChange={e=>setBForm(p=>({...p,monto:e.target.value}))}/>
              <input style={{...s.inp,flex:1,minWidth:130}} placeholder="Referencia (ej: Juan García, #Ref1234)"
                value={bForm.ref} onChange={e=>setBForm(p=>({...p,ref:e.target.value}))}
                onKeyDown={e=>{if(e.key==='Enter'&&bForm.monto){setBancosTransfs(p=>[...p,{id:uid(),plataforma:bForm.plataforma,monto:parseInt(bForm.monto)||0,ref:bForm.ref,hora:NOW_TIME()}]);setBForm(p=>({...p,monto:'',ref:''}));}}}/>
              <button style={s.btn('primary')} onClick={()=>{
                if(!bForm.monto) return;
                setBancosTransfs(p=>[...p,{id:uid(),plataforma:bForm.plataforma,monto:parseInt(bForm.monto)||0,ref:bForm.ref,hora:NOW_TIME()}]);
                setBForm(p=>({...p,monto:'',ref:''}));
              }}>+ Agregar</button>
            </div>
            <div style={{padding:'7px 10px',background:C.indigo+'12',borderRadius:8,fontSize:11,color:C.sub,border:`1px solid ${C.indigo}30`}}>
              💡 Registra <strong style={{color:C.indigo}}>cada transferencia por separado</strong> para trazabilidad. Se restan del efectivo de caja.
            </div>
          </div>

          {/* ── Lista de transferencias ─────────────────────────────────── */}
          <div style={s.card}>
            <div style={{fontWeight:700,fontSize:13,marginBottom:'0.75rem',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span>Transferencias del Turno</span>
              <span style={{color:C.indigo,fontSize:17,fontWeight:800}}>{COP(totalBancos)}</span>
            </div>
            {bancosTransfs.length>0&&(
              <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:'0.75rem'}}>
                {Object.entries(bancosTransfs.reduce((acc,t)=>{acc[t.plataforma]=(acc[t.plataforma]||0)+t.monto;return acc;},{})).map(([plat,tot])=>(
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
                        setBancosTransfs(p=>p.map(x=>x.id===t.id?{...x,plataforma:nueva}:x));
                        // Si viene de Supabase (UUID real, no fake _xxx), persistir el cambio
                        if(!String(t.id).startsWith('_')){
                          await localUpdate('transferencias',{id:t.id},{plataforma:nueva}).catch(()=>{});
                        }
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
                <span style={{fontWeight:700,color:C.indigo,flexShrink:0}}>{COP(t.monto)}</span>
                {t.ref&&<span style={{color:C.sub,fontSize:11,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.ref}</span>}
                {t.hora&&<span style={{color:C.muted,fontSize:10,marginLeft:'auto',flexShrink:0}}>{t.hora}</span>}
                <button style={{background:'none',border:'none',cursor:'pointer',color:C.muted,padding:'0 4px',fontSize:14,lineHeight:1,flexShrink:0}} onClick={()=>setBancosTransfs(p=>p.filter(x=>x.id!==t.id))}>✕</button>
              </div>
            ))}
            {bancosTransfs.length>0&&(
              <div style={{display:'flex',justifyContent:'space-between',padding:'10px 0 2px',borderTop:`1px solid ${C.border}`,fontWeight:800,marginTop:4}}>
                <span>Total Bancos</span><span style={{color:C.indigo,fontSize:17}}>{COP(totalBancos)}</span>
              </div>
            )}
          </div>

          {/* ── Subir comprobante ────────────────────────────────────────────── */}
          <div style={s.card}>
            <div style={{fontWeight:700,fontSize:13,marginBottom:'0.75rem'}}>📸 Subir Comprobante</div>
            <div style={{fontSize:11,color:C.sub,marginBottom:'0.75rem',padding:'7px 10px',background:C.indigo+'15',borderRadius:8,border:`1px solid ${C.indigo}30`}}>
              📸 Sube una foto del comprobante bancario. La IA detectará la plataforma y el monto automáticamente.
            </div>
            <UploadTransfer negocio={negocio} onRegistered={()=>{}}/>
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
            const negatives=negocio.productos.filter(p=>{const m=movs[p.id]||{};if(m.existencias!==undefined)return m.existencias<0;return p.stock+(m.entradas||0)-(m.salidas||0)-(m.cortesia||0)<0;});
            if(negatives.length>0){alert(`⚠ No se puede cerrar el turno.\n\nExistencias en negativo:\n${negatives.map(p=>{const m=movs[p.id]||{};return m.existencias!==undefined?`• ${p.name}: existencias ${m.existencias}`:`• ${p.name}: stock ${p.stock}, salidas ${(m.salidas||0)+(m.cortesia||0)}`;}).join('\n')}\n\nCorrige las existencias o registra las entradas.`);return;}
            cerrarTurno();
          }}>🔒 Cerrar y Bloquear Planilla</button>
        </div>
      )}
      {showNuevoStaff&&<NuevoStaffModal onClose={()=>setShowNuevoStaff(false)} negocioColor={negocio.color} onAgregar={nuevo=>setStaffActivo(p=>[...p,nuevo])}/>}
    </div>
  );
}
