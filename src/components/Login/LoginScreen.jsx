import { useState } from "react";
import { useAuth } from "../../hooks/useAuth.jsx";
import { C, s } from "../../constants/theme.js";
import { Badge } from "../common/index.jsx";

export default function LoginScreen() {
  const { login, authError } = useAuth();
  const [email,   setEmail]   = useState('');
  const [pwd,     setPwd]     = useState('');
  const [err,     setErr]     = useState('');
  const [loading, setLoading] = useState(false);
  const [showPwd, setShowPwd] = useState(false);

  const submit = async e => {
    e.preventDefault();
    setErr('');
    setLoading(true);
    const res = await login(email, pwd);
    if (res.error) { setErr(res.error); setLoading(false); }
  };

  return (
    <div style={{minHeight:'100vh',background:C.bg,display:'flex',alignItems:'center',justifyContent:'center',padding:'1rem'}}>
      <div style={{width:'min(400px,100%)',background:C.card,border:`1px solid ${C.border}`,borderRadius:16,padding:'2rem'}}>
        <div style={{textAlign:'center',marginBottom:'1.5rem'}}>
          <div style={{fontSize:36,marginBottom:8}}>▸</div>
          <div style={{fontSize:24,fontWeight:900,color:C.amber,letterSpacing:'-0.5px'}}>GestiónBar</div>
          <div style={{fontSize:12,color:C.sub,marginTop:4}}>Plataforma de gestión de negocios</div>
        </div>

        <form onSubmit={submit}>
          <div style={{marginBottom:12}}>
            <div style={s.label}>Correo electrónico</div>
            <input style={s.inp} type="email" placeholder="usuario@gesbar.co" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" required/>
          </div>
          <div style={{marginBottom:16}}>
            <div style={s.label}>Contraseña</div>
            <div style={{position:'relative'}}>
              <input
                style={{...s.inp,paddingRight:40}}
                type={showPwd?"text":"password"}
                placeholder="••••••••"
                value={pwd}
                onChange={e=>setPwd(e.target.value)}
                autoComplete="current-password"
                required
              />
              <button type="button" onClick={()=>setShowPwd(p=>!p)} style={{position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',cursor:'pointer',color:C.sub,fontSize:14}}>
                {showPwd?'🙈':'👁'}
              </button>
            </div>
          </div>

          {(err || authError) && (
            <div style={{background:C.red+'20',border:`1px solid ${C.red}40`,borderRadius:8,padding:'8px 12px',fontSize:12,color:C.red,marginBottom:12}}>
              {err || authError}
            </div>
          )}

          <button type="submit" disabled={loading} style={{...s.btn('primary'),width:'100%',padding:'10px',fontSize:14,opacity:loading?0.7:1}}>
            {loading?'Verificando...':'Ingresar'}
          </button>
        </form>

        <div style={{marginTop:'1.5rem',textAlign:'center',fontSize:10,color:C.muted}}>
          Sesión de 8 horas · PBKDF2-SHA256 · Datos locales cifrados
        </div>
      </div>
    </div>
  );
}
