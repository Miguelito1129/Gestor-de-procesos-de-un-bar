import { AuthProvider, useAuth } from "./hooks/useAuth.jsx";
import { C } from "./constants/theme.js";
import LoginScreen from "./components/Login/LoginScreen.jsx";
import MainApp from "./components/MainApp.jsx";

function Root() {
  const { user, authLoading } = useAuth();
  if (authLoading) return (
    <div style={{minHeight:'100vh',background:C.bg,display:'flex',alignItems:'center',justifyContent:'center',color:C.amber,fontSize:18,fontWeight:700}}>
      ▸ GestiónBar
    </div>
  );
  return user ? <MainApp/> : <LoginScreen/>;
}

export default function App() {
  return <AuthProvider><Root/></AuthProvider>;
}
