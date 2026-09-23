import { useState, useRef, useCallback } from "react";
import { C, s, COP } from "../../constants/theme.js";
import { CAT_COLORS } from "../../constants/roles.js";
import { uid } from "../../utils/helpers.js";
import { localDeleteProductos, localInsert } from "../../lib/localApi.js";
import { Badge, Metric, SectionTitle } from "../common/index.jsx";

export default function Inventario({ negocio, onUpdateNegocio, readOnly }) {
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('Todos');
  const [showAdd, setShowAdd] = useState(false);
  const [f, setF] = useState({name:'',cat:'Cerveza',price:'',stock:'',min:''});
  const [importMsg, setImportMsg] = useState('');
  const [showConfirmBorrar, setShowConfirmBorrar] = useState(false);
  const fileRef = useRef(null);

  const productos = negocio.productos;
  const setProductos = useCallback(fn => onUpdateNegocio({...negocio, productos: typeof fn==='function'?fn(negocio.productos):fn}), [negocio, onUpdateNegocio]);
  const cats = ['Todos', ...new Set(productos.map(p=>p.cat))];
  const filtered = productos.filter(p=>(catFilter==='Todos'||p.cat===catFilter)&&p.name.toLowerCase().includes(search.toLowerCase()));
  const low = productos.filter(p=>p.stock<=p.min&&p.min>0);

  const loadXLSX = () => new Promise((res,rej)=>{
    if(window.XLSX){res(window.XLSX);return;}
    const sc=document.createElement('script');
    sc.src='https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js';
    sc.onload=()=>setTimeout(()=>res(window.XLSX),300);
    sc.onerror=rej;
    document.head.appendChild(sc);
  });

  const downloadTemplate = async () => {
    const XLSX = await loadXLSX();
    const data = [
      {nombre:'Buchannas Master 750',categoria:'Whisky',     precio:380000,stock:5,  minimo:2,  cortesia:'gatorade'},
      {nombre:'Amarillo Botella',    categoria:'Aguardiente',precio:140000,stock:20, minimo:6,  cortesia:'agua'},
      {nombre:'Ron Caldas Botella',  categoria:'Ron',        precio:140000,stock:10, minimo:4,  cortesia:'gaseosa'},
      {nombre:'Don Julio 70',        categoria:'Tequila',    precio:700000,stock:4,  minimo:2,  cortesia:'agua'},
      {nombre:'Corona',              categoria:'Cerveza',    precio:10000, stock:100,minimo:24, cortesia:''},
      {nombre:'Gatorade',            categoria:'Cortesía',   precio:10000, stock:50, minimo:24, cortesia:''},
      {nombre:'Agua Cristal',        categoria:'Cortesía',   precio:5000,  stock:200,minimo:48, cortesia:''},
    ];
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [{wch:28},{wch:15},{wch:12},{wch:8},{wch:8},{wch:12}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
    XLSX.writeFile(wb, `Plantilla_Inventario_${negocio.name.replace(/\s/g,'_')}.xlsx`);
    setImportMsg('✓ Plantilla descargada. Llénala y usa "Importar Excel" para subirla.');
  };

  const downloadInventario = async () => {
    if (!productos.length){setImportMsg('⚠ No hay productos para exportar.');return;}
    const XLSX = await loadXLSX();
    const data = productos.map(p=>({nombre:p.name,categoria:p.cat,precio:p.price,stock:p.stock,minimo:p.min}));
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [{wch:28},{wch:15},{wch:12},{wch:8},{wch:8},{wch:12}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
    XLSX.writeFile(wb, `Inventario_${negocio.name.replace(/\s/g,'_')}_${new Date().toLocaleDateString('es-CO').replace(/\//g,'-')}.xlsx`);
    setImportMsg(`✓ Inventario exportado (${productos.length} productos).`);
  };

  const handleImport = async e => {
    const file = e.target.files[0]; if(!file) return;
    setImportMsg('Cargando archivo...');
    try {
      const XLSX = await loadXLSX();
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf,{type:'array'});
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws,{defval:''});
      if(!rows.length){setImportMsg('⚠ El archivo está vacío. Usa la Plantilla para ver el formato.');return;}
      const g = (row,...keys) => {
        for(const k of keys){
          for(const rk of Object.keys(row)){
            if(rk.trim().toLowerCase()===k.toLowerCase()){
              const v=row[rk]; if(v!==null&&v!==undefined&&v!=='')return v;
            }
          }
        }
        return '';
      };
      const newP = rows.map((row,i)=>({
        id:uid(),
        sort_order:i,
        name:String(g(row,'nombre','Nombre','producto','Producto','name','Name','NOMBRE','PRODUCTO')||'').trim(),
        cat:String(g(row,'categoria','Categoria','CATEGORIA','cat','Cat','categoría','Categoría')||'Otro').trim(),
        price:parseInt(g(row,'precio','Precio','PRECIO','price','Price','valor','Valor'))||0,
        stock:parseInt(g(row,'stock','Stock','STOCK','existencia','Existencia','cantidad','Cantidad'))||0,
        min:parseInt(g(row,'minimo','Minimo','MINIMO','mínimo','Mínimo','min','Min','stock_minimo','StockMinimo','minimum'))||0,
      })).filter(p=>p.name.length>0);
      if(!newP.length){
        const cols=Object.keys(rows[0]||{}).join(', ');
        setImportMsg(`⚠ Sin productos válidos. Columnas detectadas: ${cols}. Descarga la Plantilla para ver el formato correcto.`);
        return;
      }
      if(window.confirm(`Se encontraron ${newP.length} productos.\n\nAceptar = Reemplazar inventario completo\nCancelar = Agregar a los existentes`)){
        await localDeleteProductos(negocio.id);
        setProductos(newP);
      } else {
        setProductos(prev=>[...prev,...newP.map((p,i)=>({...p,sort_order:prev.length+i}))]);
      }
      setImportMsg(`✓ ${newP.length} productos importados correctamente.`);
    } catch(err) {
      console.error(err);
      setImportMsg('⚠ Error al leer el archivo. Asegúrate de que sea .xlsx o .xls y usa la Plantilla de ejemplo.');
    }
    e.target.value='';
  };

  return (
    <div>
      <SectionTitle action={
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <select style={{...s.sel,width:120}} value={catFilter} onChange={e=>setCatFilter(e.target.value)}>{cats.map(c=><option key={c}>{c}</option>)}</select>
          <input style={{...s.inp,width:160}} placeholder="Buscar..." value={search} onChange={e=>setSearch(e.target.value)}/>
          {!readOnly&&<>
            <button style={s.btn('primary')} onClick={()=>setShowAdd(!showAdd)}>+ Producto</button>
            <button style={{...s.btn(),color:C.cyan,border:`1px solid ${C.cyan}30`}} onClick={()=>fileRef.current.click()}>📥 Importar Excel</button>
            <button style={{...s.btn(),color:C.green,border:`1px solid ${C.green}30`}} onClick={downloadInventario} title="Descargar inventario actual en Excel">📤 Exportar</button>
            <button style={{...s.btn(),color:C.amber,border:`1px solid ${C.amber}30`}} onClick={downloadTemplate} title="Descargar plantilla Excel vacía para llenar">📋 Plantilla</button>
            <button style={{...s.btn(),color:C.red,border:`1px solid ${C.red}30`}} onClick={()=>setShowConfirmBorrar(true)}>🗑 Borrar todo</button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{display:'none'}} onChange={handleImport}/>
          </>}
        </div>
      }>Inventario — {negocio.name}{readOnly&&<Badge color={C.sub} small>Solo lectura</Badge>}</SectionTitle>

      {importMsg&&(
        <div style={{padding:'7px 12px',background:importMsg.startsWith('✓')?C.green+'18':C.amber+'18',border:`1px solid ${importMsg.startsWith('✓')?C.green:C.amber}40`,borderRadius:8,fontSize:12,marginBottom:'1rem',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <span style={{color:importMsg.startsWith('✓')?C.green:C.amber}}>{importMsg}</span>
          <button style={{background:'none',border:'none',cursor:'pointer',color:C.sub,fontSize:16}} onClick={()=>setImportMsg('')}>✕</button>
        </div>
      )}

      {productos.filter(p=>p.stock<0).length>0&&(
        <div style={{padding:'10px 14px',background:C.red+'18',border:`2px solid ${C.red}60`,borderRadius:8,fontSize:12,marginBottom:'1rem'}}>
          <div style={{fontWeight:800,color:C.red,marginBottom:4}}>⚠ Productos con stock negativo — esto no debería ocurrir:</div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            {productos.filter(p=>p.stock<0).map(p=><span key={p.id} style={{background:C.red+'22',color:C.red,padding:'2px 8px',borderRadius:6,fontWeight:700}}>{p.name}: {p.stock}</span>)}
          </div>
          <div style={{fontSize:11,color:C.red,marginTop:6}}>Corrige el stock manualmente en la tabla.</div>
        </div>
      )}

      {showConfirmBorrar&&(
        <div style={{...s.card,borderColor:C.red+'60',marginBottom:'1rem',padding:'1rem'}}>
          <div style={{fontWeight:700,color:C.red,marginBottom:8}}>⚠ ¿Borrar todo el inventario ({productos.length} productos)?</div>
          <div style={{fontSize:12,color:C.sub,marginBottom:12}}>Borrará local y en Supabase. No se puede deshacer.</div>
          <div style={{display:'flex',gap:8}}>
            <button style={s.btn('danger')} onClick={async()=>{
              await localDeleteProductos(negocio.id);
              setProductos([]);
              setShowConfirmBorrar(false);
              setImportMsg('✓ Inventario borrado completamente.');
            }}>Sí, borrar todo</button>
            <button style={s.btn()} onClick={()=>setShowConfirmBorrar(false)}>Cancelar</button>
          </div>
        </div>
      )}

      {!readOnly&&<div style={{marginBottom:'0.75rem',padding:'7px 12px',background:C.surface,borderRadius:8,fontSize:11,color:C.sub,border:`1px solid ${C.border}`}}>📋 <strong style={{color:C.text}}>Formato Excel:</strong> columnas <code style={{background:C.border,padding:'1px 5px',borderRadius:4}}>nombre</code>, <code style={{background:C.border,padding:'1px 5px',borderRadius:4}}>categoria</code>, <code style={{background:C.border,padding:'1px 5px',borderRadius:4}}>precio</code>, <code style={{background:C.border,padding:'1px 5px',borderRadius:4}}>stock</code>, <code style={{background:C.border,padding:'1px 5px',borderRadius:4}}>minimo</code></div>}

      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8,marginBottom:'1.25rem'}}>
        <Metric label="Total"    value={productos.length}/>
        <Metric label="Bajo Stock" value={low.filter(p=>p.stock>0).length} color={C.amber}/>
        <Metric label="Agotados"   value={productos.filter(p=>p.stock===0&&p.min>0).length} color={C.red}/>
        <Metric label="En Orden"   value={productos.filter(p=>p.stock>p.min).length} color={C.green}/>
      </div>

      {showAdd&&!readOnly&&(
        <div style={{...s.card,marginBottom:'1.25rem',borderColor:negocio.color+'40'}}>
          <div style={{fontWeight:700,marginBottom:'0.75rem',fontSize:13}}>Nuevo Producto</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10}}>
            <div><div style={s.label}>Nombre</div><input style={s.inp} value={f.name} onChange={e=>setF(p=>({...p,name:e.target.value}))}/></div>
            <div><div style={s.label}>Categoría</div>
              <select style={s.sel} value={f.cat} onChange={e=>setF(p=>({...p,cat:e.target.value}))}>
                {Object.keys(CAT_COLORS).map(c=><option key={c}>{c}</option>)}
              </select>
            </div>
            <div><div style={s.label}>Precio</div><input style={s.inp} type="number" value={f.price} onChange={e=>setF(p=>({...p,price:e.target.value}))}/></div>
            <div><div style={s.label}>Stock</div><input style={s.inp} type="number" value={f.stock} onChange={e=>setF(p=>({...p,stock:e.target.value}))}/></div>
            <div><div style={s.label}>Mínimo</div><input style={s.inp} type="number" value={f.min} onChange={e=>setF(p=>({...p,min:e.target.value}))}/></div>
          </div>
          <div style={{marginTop:10,display:'flex',gap:8}}>
            <button style={s.btn('primary')} onClick={()=>{
              if(!f.name) return;
              setProductos(p=>[...p,{...f,id:uid(),sort_order:p.length,price:parseInt(f.price)||0,stock:parseInt(f.stock)||0,min:parseInt(f.min)||0}]);
              setShowAdd(false);
            }}>Guardar</button>
            <button style={s.btn()} onClick={()=>setShowAdd(false)}>Cancelar</button>
          </div>
        </div>
      )}

      <div style={s.card}>
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <thead><tr style={{background:C.surface}}>{['Producto','Cat.','Precio','Stock','Mín.','Estado',''].map(h=><th key={h} style={s.th}>{h}</th>)}</tr></thead>
          <tbody>
            {filtered.length===0?(<tr><td colSpan={7} style={{padding:'2rem',textAlign:'center',color:C.sub,fontSize:13}}>Sin productos</td></tr>):
            filtered.map((p,i)=>{
              const out=p.stock===0&&p.min>0; const lowS=p.stock<=p.min&&!out&&p.min>0;
              const bg=out?C.red+'0a':lowS?C.amber+'08':i%2===0?C.rowA:C.rowB;
              return(
                <tr key={p.id} style={{background:bg}}>
                  <td style={{...s.td(i),fontWeight:500,fontSize:11,background:bg}}>{p.name}</td>
                  <td style={{...s.td(i),background:bg}}><Badge color={CAT_COLORS[p.cat]||C.muted} small>{p.cat}</Badge></td>
                  <td style={{...s.td(i),background:bg}}>
                    {readOnly
                      ? (p.price>0?COP(p.price):<span style={{color:C.sub}}>—</span>)
                      : <input type="number" min="0" style={{...s.inp,width:110,padding:'4px 8px',textAlign:'right',fontSize:12}} value={p.price} onChange={e=>setProductos(prev=>prev.map(x=>x.id===p.id?{...x,price:Math.max(0,parseInt(e.target.value)||0)}:x))}/>
                    }
                  </td>
                  <td style={{...s.td(i),background:bg}}>
                    {readOnly?<span style={{fontWeight:800,fontSize:14,color:out?C.red:lowS?C.amber:C.green}}>{p.stock}</span>:(
                      <input type="number" min="0" style={{...s.inp,width:72,padding:'4px 8px',textAlign:'center',fontWeight:800,fontSize:13,color:out?C.red:lowS?C.amber:C.green,border:`1px solid ${out?C.red:lowS?C.amber:C.border}60`}} value={p.stock} onChange={e=>setProductos(prev=>prev.map(x=>x.id===p.id?{...x,stock:Math.max(0,parseInt(e.target.value)||0)}:x))}/>
                    )}
                  </td>
                  <td style={{...s.td(i),color:C.sub,background:bg}}>{p.min}</td>
                  <td style={{...s.td(i),background:bg}}><Badge color={out?C.red:lowS?C.amber:C.green} small>{out?'Agotado':lowS?'Bajo':'OK'}</Badge></td>
                  <td style={{...s.td(i),background:bg}}>
                    {!readOnly&&<button style={{background:'none',border:'none',color:C.muted,cursor:'pointer',fontSize:13,padding:'2px 6px'}} onClick={()=>setProductos(prev=>prev.filter(x=>x.id!==p.id))} title="Eliminar">✕</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
