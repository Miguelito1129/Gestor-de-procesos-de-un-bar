import { useState, useRef, useEffect } from "react";
import { C, s } from "../../constants/theme.js";
import { SectionTitle } from "../common/index.jsx";

const GROQ_KEY = import.meta.env.VITE_GROQ_KEY || '';

export default function ChatbotIA({ negocio }) {
  const low = negocio.productos.filter(p=>p.stock<=p.min&&p.min>0);
  const [messages, setMessages] = useState([{role:'assistant',content:`Hola! Soy el asistente de ${negocio.name}. ¿En qué te ayudo?`}]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(()=>{ bottomRef.current?.scrollIntoView({behavior:'smooth'}); },[messages]);

  const QUICK = ['estado inventario','productos agotados','cuánto pago barra si ventas 10 millones','gastos fijos este mes','cuentas por cobrar','cortesías aguardiente'];

  const send = async text => {
    const msg = text || input.trim();
    if (!msg || loading) return;
    setInput('');
    const newMsgs = [...messages, {role:'user',content:msg}];
    setMessages(newMsgs);
    setLoading(true);
    const fmt = n => `$${(n||0).toLocaleString('es-CO')}`;
    const pl  = (negocio.planillas||[]).slice(0,90);
    const planillasStr = pl.map(p =>
      `${p.fecha}|${p.apertura||'?'}-${p.cierre||'?'}|ventas=${fmt(p.ventas)}|bancos=${fmt(p.bancos)}|efectivo=${fmt((p.ventas||0)-(p.bancos||0))}|gastos=${fmt(p.gastos)}|personal=${fmt(p.personal)}|neto=${fmt(p.neto)}`
    ).join('\n');
    const totalVentas   = pl.reduce((s,p)=>s+(p.ventas||0),0);
    const totalBancos   = pl.reduce((s,p)=>s+(p.bancos||0),0);
    const totalEfectivo = totalVentas - totalBancos;
    const totalGastos   = pl.reduce((s,p)=>s+(p.gastos||0),0);
    const totalNeto     = pl.reduce((s,p)=>s+(p.neto||0),0);

    const sys = `Eres el asistente IA de GestiónBar para ${negocio.name} (Colombia). Hoy: ${new Date().toLocaleDateString('es-CO',{timeZone:'America/Bogota'})}.

GLOSARIO DE CAMPOS:
- ventas = total ingresado en el turno (efectivo + transferencias)
- bancos = transferencias electrónicas (Nequi, Bancolombia, Daviplata, etc.)
- efectivo = ventas − bancos (dinero físico en caja)
- gastos = egresos del turno
- personal = pagos al staff
- neto = ganancia neta estimada del turno

RESUMEN GLOBAL (${pl.length} turnos cargados):
Total ventas=${fmt(totalVentas)} | Transferencias=${fmt(totalBancos)} | Efectivo=${fmt(totalEfectivo)} | Gastos=${fmt(totalGastos)} | Neto acumulado=${fmt(totalNeto)}

TURNOS (fecha|apertura-cierre|ventas|bancos|efectivo|gastos|personal|neto):
${planillasStr||'Sin turnos registrados.'}

INVENTARIO: Agotados: ${negocio.productos.filter(p=>p.stock===0&&p.min>0).map(p=>p.name).join(', ')||'ninguno'}. Bajo stock: ${low.map(p=>`${p.name}(${p.stock})`).join(', ')||'ninguno'}.
STAFF: ${negocio.staff.map(s=>`${s.name}(${s.rol}:${typeof s.pay==='number'?fmt(s.pay):s.pay})`).join(', ')}
GASTOS FIJOS: ${negocio.gastosFijos.map(g=>`${g.desc}=${fmt(g.monto)}${g.dia>0?' día'+g.dia:''}`).join(', ')||'ninguno'}
CxC PENDIENTES: ${negocio.cxc.map(c=>`${c.deudor}=${fmt(c.monto)}`).join(', ')||'sin deudas'}
REGLAS PAGO: Barra=3% ventas. DJ=$133k fijo. Meseros=5% individual tope 5% total. Aguardiente→cortesía agua. Whisky/Tequila→Gatorade. Ron→Gaseosa.

RESTRICCIÓN IMPORTANTE: Eres un asistente de SOLO CONSULTA. Únicamente puedes responder preguntas, hacer cálculos y analizar los datos proporcionados. No puedes crear, modificar ni eliminar ningún dato. Si el usuario pide que registres, guardes, edites, borres o realices cualquier acción sobre el sistema, responde: "Solo puedo responder consultas. Para esa acción usa la aplicación directamente."

Responde en español colombiano. Sé conciso. Calcula con exactitud usando los datos anteriores. Si te preguntan por un período (semana, mes, día específico) filtra las filas de TURNOS por fecha y suma.`;
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_KEY}`,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 1000,
          messages: [
            {role:'system', content:sys},
            ...newMsgs.slice(-10).map(m=>({role:m.role,content:m.content})),
          ],
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error?.message || `HTTP ${r.status}`);
      setMessages(p=>[...p,{role:'assistant',content:d.choices?.[0]?.message?.content||'Sin respuesta.'}]);
    } catch(e) {
      setMessages(p=>[...p,{role:'assistant',content:`Error: ${e.message||'Verifica VITE_GROQ_KEY en Railway'}`}]);
    }
    setLoading(false);
    setTimeout(()=>bottomRef.current?.scrollIntoView({behavior:'smooth'}),100);
  };

  return (
    <div>
      <SectionTitle>Asistente IA — {negocio.name}</SectionTitle>
      <div style={{...s.card,display:'flex',flexDirection:'column',minHeight:520}}>
        <div style={{flex:1,overflowY:'auto',marginBottom:'1rem',maxHeight:420}}>
          {messages.map((m,i)=>(
            <div key={i} style={{display:'flex',justifyContent:m.role==='user'?'flex-end':'flex-start',marginBottom:12}}>
              {m.role==='assistant'&&<div style={{width:28,height:28,borderRadius:'50%',background:negocio.color+'30',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,marginRight:8,flexShrink:0,marginTop:2}}>✦</div>}
              <div style={{maxWidth:'78%',padding:'10px 14px',borderRadius:m.role==='user'?'16px 16px 4px 16px':'16px 16px 16px 4px',background:m.role==='user'?negocio.color:C.surface,color:m.role==='user'?'#0b0b14':C.text,fontSize:13,lineHeight:1.6,whiteSpace:'pre-wrap'}}>{m.content}</div>
            </div>
          ))}
          {loading&&<div style={{display:'flex',gap:5,paddingLeft:36,alignItems:'center',height:36}}>{[0,1,2].map(i=><div key={i} style={{width:7,height:7,borderRadius:'50%',background:negocio.color,animation:`blink 1.2s ${i*0.2}s infinite`}}/>)}</div>}
          <div ref={bottomRef}/>
        </div>
        <div style={{borderTop:`1px solid ${C.border}`,paddingTop:'1rem'}}>
          <div style={{display:'flex',flexWrap:'wrap',gap:5,marginBottom:10}}>
            {QUICK.map(cmd=><button key={cmd} style={{...s.btn(),fontSize:10,padding:'3px 9px',color:C.sub}} onClick={()=>send(cmd)}>{cmd}</button>)}
          </div>
          <div style={{display:'flex',gap:8}}>
            <input style={{...s.inp,flex:1}} placeholder="Escribe aquí..." value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&send()}/>
            <button style={{...s.btn('primary'),padding:'8px 18px'}} onClick={()=>send()} disabled={loading}>Enviar</button>
          </div>
        </div>
      </div>
      <style>{`@keyframes blink{0%,100%{opacity:.4;transform:scale(1)}50%{opacity:1;transform:scale(1.3)}}`}</style>
    </div>
  );
}
