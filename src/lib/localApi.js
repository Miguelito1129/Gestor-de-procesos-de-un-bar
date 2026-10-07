// Cliente HTTP de la API local. La base de datos nunca se expone al navegador.
export const LOCAL_API_URL = import.meta.env.VITE_LOCAL_API_URL || '/api';
const headers = () => {
  let token = '';
  try {
    token = JSON.parse(localStorage.getItem('gesbar_sess_v2') || 'null')?.token || '';
  } catch {}
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

export async function localLogin(email, password) {
  const response = await fetch(`${LOCAL_API_URL}/auth/login`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ email, password }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error || `No fue posible iniciar sesión (${response.status}).`);
  return result;
}

export async function localLogout() {
  const response = await fetch(`${LOCAL_API_URL}/auth/logout`, {
    method: 'POST',
    headers: headers(),
  });
  if (!response.ok) throw new Error(`No fue posible cerrar la sesión (${response.status}).`);
}

async function userRequest(path, method, data) {
  const response = await fetch(`${LOCAL_API_URL}${path}`, {
    method,
    headers: headers(),
    body: JSON.stringify(data),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error || `No fue posible guardar el usuario (${response.status}).`);
  return result;
}

export const localCreateUser = user => userRequest('/users', 'POST', user);
export const localUpdateUser = (id, changes) =>
  userRequest(`/users/${encodeURIComponent(id)}`, 'PATCH', changes);

export async function localFetch(table, filter = '') {
  try {
    const r = await fetch(`${LOCAL_API_URL}/${table}?${filter}`, { headers: headers() });
    if (!r.ok) throw new Error(`GET ${table} failed: ${r.status}`);
    return await r.json();
  } catch (error) { console.error(error); return null; }
}

export async function createMasterAccount(name, password) {
  const response = await fetch(`${LOCAL_API_URL}/setup/master`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ name, password }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error || `No fue posible configurar el administrador maestro (${response.status}).`);
  return result;
}

export async function localInsertDetailed(table, data) {
  try {
    const r = await fetch(`${LOCAL_API_URL}/${table}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(data),
    });
    if (!r.ok) {
      const details = await r.json().catch(() => null);
      throw new Error(details?.error || `POST ${table} failed: ${r.status}`);
    }
    return { ok: true, error: '' };
  } catch (error) {
    console.error(error);
    return { ok: false, error: error.message || `No fue posible guardar en ${table}.` };
  }
}

export async function localInsert(table, data) {
  const result = await localInsertDetailed(table, data);
  return result.ok;
}

export async function localUpsert(table, data) {
  try {
    const r = await fetch(`${LOCAL_API_URL}/${table}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(data),
    });
    if (!r.ok) {
      const details = await r.json().catch(() => null);
      throw new Error(details?.error || `UPSERT ${table} failed: ${r.status}`);
    }
    return true;
  } catch (error) { console.error(error); return false; }
}

export async function localUpdate(table, match, data) {
  try {
    const params = Object.entries(match).map(([k,v]) => `${k}=eq.${v}`).join('&');
    const r = await fetch(`${LOCAL_API_URL}/${table}?${params}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify(data),
    });
    if (!r.ok) throw new Error(`PATCH ${table} failed: ${r.status}`);
    return true;
  } catch (error) { console.error(error); return false; }
}

export async function localDelete(table, match) {
  try {
    const params = Object.entries(match).map(([k,v]) => `${k}=eq.${v}`).join('&');
    const r = await fetch(`${LOCAL_API_URL}/${table}?${params}`, {
      method: 'DELETE',
      headers: headers(),
    });
    if (!r.ok) throw new Error(`DELETE ${table} failed: ${r.status}`);
    return true;
  } catch (error) { console.error(error); return false; }
}

export async function localDeleteNegocio(negocioId) {
  const response = await fetch(`${LOCAL_API_URL}/negocios/${encodeURIComponent(negocioId)}`, {
    method: 'DELETE',
    headers: headers(),
  });
  if (!response.ok) {
    const details = await response.json().catch(() => null);
    throw new Error(details?.error || `DELETE negocio failed: ${response.status}`);
  }
  return true;
}

export async function localPrintInvoice(comandaId, userId) {
  const response = await fetch(`${LOCAL_API_URL}/print/invoice`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ comanda_id: comandaId, user_id: userId }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    if (result?.error) throw new Error(result.error);
    if (response.status === 404) {
      throw new Error("El servidor activo no tiene habilitada la impresión. Reinicia el backend desde la carpeta de esta versión.");
    }
    if (response.status === 503) {
      throw new Error("Impresora sin conexión o puerto Bluetooth no disponible. Revisa Printer001 y vuelve a intentarlo.");
    }
    throw new Error(`No fue posible imprimir el comprobante (HTTP ${response.status}).`);
  }
  return result;
}

export async function localPrintOrder(comandaId, userId) {
  const response = await fetch(`${LOCAL_API_URL}/print/order`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ comanda_id: comandaId, user_id: userId }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    if (result?.error) throw new Error(result.error);
    if (response.status === 404) {
      throw new Error("El servidor activo no tiene habilitada la impresión de pedidos. Reinicia el backend desde la carpeta de esta versión.");
    }
    if (response.status === 503) {
      throw new Error("Impresora sin conexión o puerto Bluetooth no disponible. Revisa Printer001 y vuelve a intentarlo.");
    }
    throw new Error(`No fue posible imprimir el pedido (HTTP ${response.status}).`);
  }
  return result;
}

// ── Helpers de dominio ─────────────────────────────────────────────────────────
export const localDeleteProductos = negocioId => localDelete('productos', { negocio_id: negocioId });
export const localDeleteStaff     = negocioId => localDelete('staff',     { negocio_id: negocioId });

// Detecta fechas con día/mes invertidos (yyyy-DD-MM en vez de yyyy-MM-DD).
// Ocurre cuando una versión anterior del código usaba toLocaleDateString y se
// convirtió incorrectamente. Si la fecha es futura e intercambiar mm↔dd da una
// fecha pasada válida, la corrige en Supabase automáticamente (fire-and-forget).
const corregirFechaSwap = (fecha, planillaId) => {
  if (!fecha || !fecha.includes('-')) return fecha;
  const hoy = new Date(); hoy.setHours(23, 59, 59, 999);
  if (new Date(fecha) <= hoy) return fecha; // fecha válida, no tocar
  const [yyyy, mm, dd] = fecha.split('-');
  if (parseInt(dd, 10) <= 12) {
    const fix = `${yyyy}-${dd}-${mm}`;
    if (new Date(fix) <= hoy) {
      // Corregir en Supabase (async, sin bloquear la carga)
      localUpdate('planillas', { id: planillaId }, { fecha: fix });
      return fix;
    }
  }
  return fecha;
};

export async function loadNegociosFromLocal() {
  const negocios = await localFetch('negocios', 'select=*');
  if (!negocios) return null;
  if (!negocios.length) return [];

  const result = await Promise.all(negocios.map(async neg => {
    const [productos, planillas, gastosFijos, cxc, staff] = await Promise.all([
      localFetch('productos',    `negocio_id=eq.${neg.id}&select=*&order=sort_order.asc`),
      localFetch('planillas',    `negocio_id=eq.${neg.id}&select=*&order=fecha.desc`),
      localFetch('gastos_fijos', `negocio_id=eq.${neg.id}&select=*`),
      localFetch('cxc',          `negocio_id=eq.${neg.id}&pagado=eq.false&select=*`),
      localFetch('staff',        `negocio_id=eq.${neg.id}&select=*`),
    ]);
    return {
      ...neg,
      productos:   (productos  ||[]).map((p,i) => ({ id:p.id, sort_order:p.sort_order??i, name:p.name, cat:p.cat, price:p.price||0, stock:p.stock||0, min:p.min||0, courtesy:p.courtesy||null })),
      planillas:   (planillas  ||[]).map(p => ({ id:p.id, fecha:corregirFechaSwap(p.fecha, p.id), apertura:p.apertura, cierre:p.cierre, ventas:p.ventas||0, bancos:p.bancos||0, gastos:p.gastos||0, personal:p.personal||0, extras:p.extras||0, pendientes:p.pendientes||0, neto:p.neto||0, novedades:p.novedades||'', personalDetalle:p.personal_detalle||[], gastosDetalle:p.gastos_detalle||[], movimientos:p.movimientos||[], bancoDetalle:p.banco_detalle||{} })),
      gastosFijos: (gastosFijos||[]).map(g => ({ id:g.id, desc:g.descripcion, monto:g.monto, dia:g.dia||0 })),
      cxc:         (cxc        ||[]).map(c => ({ id:c.id, deudor:c.deudor, monto:c.monto, fecha:c.fecha, concepto:c.concepto||'' })),
      staff:       (staff      ||[]).map(s => ({ id:s.id, name:s.name, rol:s.rol, pay:isNaN(Number(s.pay))?s.pay:Number(s.pay) })),
    };
  }));
  return result;
}

export const fetchLocal = localFetch;
export const insertLocal = localInsert;
export const upsertLocal = localUpsert;
export const updateLocal = localUpdate;
export const deleteLocal = localDelete;
