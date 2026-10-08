import { AuthProvider, useAuth } from "./hooks/useAuth.jsx";
import { C } from "./constants/theme.js";
import LoginScreen from "./components/Login/LoginScreen.jsx";
import MainApp from "./components/MainApp.jsx";

function Root() {
  const { user, authLoading } = useAuth();
  if (authLoading) return (
    <div style={{minHeight:'100vh',background:C.bg,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:10,color:C.amber,fontSize:18,fontWeight:700}}>
      <img src="/gestionbar-logo.png" alt="GestiónBar" style={{width:88,height:82,objectFit:'contain'}}/>
      <span>GestiónBar</span>
    </div>
  );
  return user ? <MainApp/> : <LoginScreen/>;
}

export default function App() {
  return <AuthProvider><Root/></AuthProvider>;
}
