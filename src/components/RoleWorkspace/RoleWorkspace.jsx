import MeseroWorkspace from "../Turnos/MeseroWorkspace.jsx";
import BarraWorkspace from "../Turnos/BarraWorkspace.jsx";

export default function RoleWorkspace({ role, negocio, userName, userId }) {
  if (role === "mesero") return <MeseroWorkspace negocio={negocio} userName={userName} userId={userId} />;
  if (role === "barra") return <BarraWorkspace negocio={negocio} userName={userName} />;
  return null;
}
