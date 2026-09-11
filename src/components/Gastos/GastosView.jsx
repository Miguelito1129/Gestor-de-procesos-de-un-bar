import { useState, useEffect } from "react";
import { C, s, COP } from "../../constants/theme.js";
import { uid } from "../../utils/helpers.js";
import { localFetch, localInsert, localDelete } from "../../lib/localApi.js";
import { Badge, SectionTitle } from "../common/index.jsx";
import UploadGasto from "../common/UploadGasto.jsx";

const CATS = ['Insumos','Nómina','Mantenimiento','Servicios','Proveedores','Arriendo','Comisión','CxC','Otros'];
const CAT_COLORS = { Insumos:C.indigo, Nómina:C.green, Mantenimiento:C.amber, Servicios:C.purple, Proveedores:C.cyan, Arriendo:C.red, Comisión:'#ec4899', CxC:C.red, Otros:C.sub };

export default function GastosView({ negocio }) {
  const [gastos, setGastos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState({desc:'',monto:'',cat:'Insumos',fecha:new Date().toISOString().slice(0,10)});

  useEffect(()=>{
    (async()=>{
      setLoading(true);
      const data = await localFetch('gastos', `negocio_id=eq.${negocio.id}&order=fecha.desc&select=*`);
      if (data) {
        const cierresData = JSON.parse(localStorage.getItem('gesbar_cierres_v2')||'{}');
        const usedIds = new Set((cierresData[negocio.id]||[]).flatMap(c=>c.gastoIds||[]));
        setGastos(data.filter(g=>!usedIds.has(g.id)).map(g=>({id:g.id,fecha:g.fecha,desc:g.descripcion||g.desc||'',monto:g.monto,cat:g.cat||'Otros'})));
      }
      setLoading(false);
    })();
  },[negocio.id]);

  const guardar = async () => {
    if (!f.desc || !f.monto) return;
    const nuevo = {id:uid(), ...f, monto:parseInt(f.monto)};
    setGastos(p=>[nuevo,...p]);
    setF(p=>({...p,desc:'',monto:''}));
    await localInsert('gastos', [{
      id: nuevo.id,
      negocio_id: negocio.id,
      fecha: nuevo.fecha,
      descripcion: nuevo.desc,
      monto: nuevo.monto,
      cat: nuevo.cat,
    }]);
  };

  const eliminar = async (id) => {
    setGastos(p=>p.filter(x=>x.id!==id));
    await localDelete('gastos', {id});
  };

  return (
    <div>
      <SectionTitle>Gastos — {negocio.name}</SectionTitle>
      <div style={{display:'grid',gridTemplateColumns:'1fr 2fr',gap:'1.25rem'}}>
        <div>
          <div style={{...s.card,marginBottom:'1rem'}}>
            <div style={{fontWeight:700,marginBottom:'0.75rem',fontSize:13}}>📸 Subir Factura / Recibo</div>
            <div style={{fontSize:11,color:C.sub,marginBottom:'0.75rem',padding:'7px 10px',background:C.amber+'15',borderRadius:8,border:`1px solid ${C.amber}30`}}>
              🧾 Sube una foto de la factura. La IA extraerá la descripción y el monto automáticamente.
            </div>
            <UploadGasto negocio={negocio} onRegistered={()=>{
              // Recargar gastos después de registrar uno nuevo
              (async()=>{
                const data = await localFetch('gastos', `negocio_id=eq.${negocio.id}&order=fecha.desc&select=*`);
                if (data) {
                  const cierresData = JSON.parse(localStorage.getItem('gesbar_cierres_v2')||'{}');
                  const usedIds = new Set((cierresData[negocio.id]||[]).flatMap(c=>c.gastoIds||[]));
                  setGastos(data.filter(g=>!usedIds.has(g.id)).map(g=>({id:g.id,fecha:g.fecha,desc:g.descripcion||g.desc||'',monto:g.monto,cat:g.cat||'Otros'})));
                }
              })();
            }}/>
          </div>
          <div style={{...s.card,marginBottom:'1rem'}}>
            <div style={{fontWeight:700,marginBottom:'0.75rem',fontSize:13}}>Registrar Gasto Manual</div>
            {[['desc','Descripción','text','ej: 1 galón cloro $29.000'],['monto','Monto (COP)','number','0'],['fecha','Fecha','date','']].map(([k,l,t,ph])=>(
              <div key={k} style={{marginBottom:8}}>
                <div style={s.label}>{l}</div>
                <input style={s.inp} type={t} placeholder={ph} value={f[k]} onChange={e=>setF(p=>({...p,[k]:e.target.value}))}/>
              </div>
            ))}
            <div style={{marginBottom:10}}>
              <div style={s.label}>Categoría</div>
              <select style={s.sel} value={f.cat} onChange={e=>setF(p=>({...p,cat:e.target.value}))}>
                {CATS.map(c=><option key={c}>{c}</option>)}
              </select>
            </div>
            <button style={{...s.btn('primary'),width:'100%'}} onClick={guardar}>Guardar</button>
          </div>
          <div style={s.card}>
            <div style={{fontWeight:700,marginBottom:'0.75rem',fontSize:13}}>Por Categoría</div>
            {CATS.map(c=>{
              const t=gastos.filter(g=>g.cat===c).reduce((s,g)=>s+g.monto,0);
              if(!t) return null;
              return(
                <div key={c} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'5px 0',borderBottom:`1px solid ${C.border}40`}}>
                  <Badge color={CAT_COLORS[c]||C.muted}>{c}</Badge>
                  <span style={{fontWeight:700,fontSize:13}}>{COP(t)}</span>
                </div>
              );
            })}
            <div style={{display:'flex',justifyContent:'space-between',paddingTop:8,fontWeight:800}}>
              <span>TOTAL</span>
              <span style={{color:C.red}}>{COP(gastos.reduce((s,g)=>s+g.monto,0))}</span>
            </div>
          </div>
        </div>
        <div style={s.card}>
          {loading?<div style={{color:C.sub,fontSize:13,padding:'2rem',textAlign:'center'}}>Cargando gastos...</div>:(
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead><tr>{['Fecha','Descripción','Categoría','Monto',''].map(h=><th key={h} style={s.th}>{h}</th>)}</tr></thead>
              <tbody>
                {gastos.length===0&&<tr><td colSpan={5} style={{padding:'2rem',textAlign:'center',color:C.sub,fontSize:13}}>Sin gastos registrados.</td></tr>}
                {gastos.map((g,i)=>(
                  <tr key={g.id}>
                    <td style={s.td(i)}>{g.fecha}</td>
                    <td style={s.td(i)}>{g.desc}</td>
                    <td style={s.td(i)}><Badge color={CAT_COLORS[g.cat]||C.muted} small>{g.cat}</Badge></td>
                    <td style={{...s.td(i),color:C.red,fontWeight:700}}>{COP(g.monto)}</td>
                    <td style={s.td(i)}>
                      <button style={{background:'none',border:'none',color:C.muted,cursor:'pointer'}} onClick={()=>eliminar(g.id)}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
