// ── Paleta de colores ──────────────────────────────────────────────────────────
export const C = {
  bg:"#08080f", surface:"#0f0f1c", card:"#14142a",
  border:"#1e1e3a", border2:"#2a2a4a",
  amber:"#f59e0b", indigo:"#818cf8", green:"#34d399",
  red:"#f87171", purple:"#c084fc", cyan:"#67e8f9",
  muted:"#475569", sub:"#64748b", text:"#e2e8f0", text2:"#94a3b8",
  rowA:"#14142a", rowB:"#111120",
};

export const CHART_COLORS = ['#f59e0b','#818cf8','#34d399','#f87171','#c084fc','#67e8f9','#fb923c','#a3e635'];
export const BILLETS     = [100000, 50000, 20000, 10000, 5000, 2000];
export const PALETTE     = ["#f59e0b","#818cf8","#34d399","#f472b6","#67e8f9","#fb923c","#a78bfa","#4ade80"];

// ── Formatters ─────────────────────────────────────────────────────────────────
export const COP      = n => new Intl.NumberFormat("es-CO",{style:"currency",currency:"COP",maximumFractionDigits:0}).format(n||0);
export const NOW_TIME = () => new Date().toLocaleTimeString("es-CO",{hour:"2-digit",minute:"2-digit"});
export const TODAY_STR= new Date().toLocaleDateString("es-CO",{weekday:"long",year:"numeric",month:"long",day:"numeric"});

// ── Estilos compartidos ────────────────────────────────────────────────────────
export const s = {
  nav:    { background:C.surface, borderBottom:`1px solid ${C.border}`, padding:"0 1.5rem", display:"flex", alignItems:"center", gap:"4px", height:56, position:"sticky", top:0, zIndex:100, flexWrap:"wrap" },
  main:   { maxWidth:1280, margin:"0 auto", padding:"1.5rem" },
  card:   { background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:"1.25rem" },
  metric: { background:C.surface, borderRadius:10, padding:"0.9rem 1.1rem", border:`1px solid ${C.border}` },
  label:  { fontSize:10, color:C.sub, textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:4, fontWeight:600 },
  big:    { fontSize:24, fontWeight:800, letterSpacing:"-0.5px" },
  btn:    (v="def") => ({ padding:"7px 16px", borderRadius:8, border:"none", cursor:"pointer", fontWeight:600, fontSize:12, background:v==="primary"?"#f59e0b":v==="danger"?"#b91c1c":v==="success"?"#059669":v==="ghost"?"transparent":C.surface, color:v==="primary"?"#0b0b14":C.text }),
  inp:    { background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:"7px 11px", color:C.text, fontSize:13, width:"100%", outline:"none", boxSizing:"border-box" },
  sel:    { background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:"7px 11px", color:C.text, fontSize:13, width:"100%", boxSizing:"border-box" },
  th:     { textAlign:"left", padding:"7px 10px", color:C.sub, borderBottom:`1px solid ${C.border}`, fontWeight:600, fontSize:10, textTransform:"uppercase", letterSpacing:"0.07em" },
  td:     i => ({ padding:"8px 10px", borderBottom:`1px solid ${C.border}30`, fontSize:12, background:i%2===0?C.rowA:C.rowB }),
  overlay:{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:200, display:"flex", alignItems:"center", justifyContent:"center" },
  modal:  { background:C.card, border:`1px solid ${C.border2}`, borderRadius:16, padding:"1.5rem", width:"min(560px,96vw)", maxHeight:"88vh", overflowY:"auto" },
};
