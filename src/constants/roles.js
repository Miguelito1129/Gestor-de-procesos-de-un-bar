import { C } from './theme.js';

export const ROL_COLORS  = { barra:C.amber, dj:C.purple, mesero:C.indigo, patin:C.cyan, seguridad:C.red, aseo:C.green, barra_fija:C.amber, mesero_fijo:C.indigo };
export const CAT_COLORS  = { Whisky:"#a78bfa", Tequila:"#fbbf24", Aguardiente:"#fb923c", Ron:"#f472b6", Cerveza:"#34d399", Vodka:"#818cf8", Energética:"#f87171", Cortesía:"#67e8f9", Gaseosa:"#a3e635", Bebida:"#94a3b8", Insumo:"#64748b" };
export const ROLES_LIST  = ["barra","dj","mesero","patin","seguridad","aseo","barra_fija","mesero_fijo","otro"];

export const ROLE_LABELS = {
  admin: 'Administrador',
  administrador: 'Administrador',
  auxiliar: 'Administrador de turno',
  jefe: 'Dueño',
  dueño: 'Dueño',
  barra: 'Barra',
  mesero: 'Mesero',
};

export const normalizeRole = role => ({
  admin: 'administrador',
  auxiliar: 'administrador',
  jefe: 'dueño',
}[role] || role);

export const PERMS = {
  admin:          new Set(['all']),
  administrador:  new Set(['all']),
  auxiliar:       new Set(['planilla_manage']),
  jefe:            new Set(['dashboard_view','reports_view','inventory_view','planilla_view','planilla_download']),
  dueño:           new Set(['dashboard_view','reports_view','inventory_view','planilla_view','planilla_download']),
  barra:           new Set(['turno_view','comanda_dispatch','expense_create','novelty_create']),
  mesero:          new Set(['turno_view','comanda_create']),
};

export const can       = (user, perm) => { if(!user) return false; const p=PERMS[user.role]; return p?.has('all') || p?.has(perm) || false; };
export const canSeeNeg = (user, negId) => { if(!user) return false; if(user.negocios==='all') return true; return Array.isArray(user.negocios) && user.negocios.includes(negId); };
