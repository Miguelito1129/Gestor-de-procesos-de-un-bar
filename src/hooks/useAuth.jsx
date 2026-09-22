import { useState, useEffect, createContext, useContext } from "react";
import { genSalt, hashPwd, localHash, verifyPwd } from "../utils/auth.js";
import { uid } from "../utils/helpers.js";
import { can, canSeeNeg } from "../constants/roles.js";
import { localFetch, localUpsert, localDelete } from "../lib/localApi.js";

// ── Constantes de almacenamiento ───────────────────────────────────────────────
export const SESSION_KEY = 'gesbar_sess_v2';
export const USERS_KEY   = 'gesbar_users_v2';

// ── Usuarios por defecto — cambiar contraseñas en el primer acceso ─────────────
const DEFAULT_USERS_PLAIN = [];

// ── Protección brute-force (en memoria, reset al recargar página) ──────────────
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS   = 15 * 60 * 1000; // 15 minutos
const loginAttempts = new Map(); // email → { count, lockedUntil }

function checkBruteForce(email) {
  const key    = email.toLowerCase().trim();
  const record = loginAttempts.get(key) || { count:0, lockedUntil:0 };
  if (record.lockedUntil > Date.now()) {
    const mins = Math.ceil((record.lockedUntil - Date.now()) / 60000);
    return { blocked: true, message: `Demasiados intentos. Espera ${mins} min.` };
  }
  return { blocked: false, record, key };
}

function recordFailedAttempt(key, record) {
  const count = record.count + 1;
  loginAttempts.set(key, {
    count,
    lockedUntil: count >= MAX_ATTEMPTS ? Date.now() + LOCKOUT_MS : 0,
  });
  const remaining = MAX_ATTEMPTS - count;
  return remaining > 0
    ? `Contraseña incorrecta. ${remaining} intento${remaining>1?'s':''} restante${remaining>1?'s':''}.`
    : `Cuenta bloqueada 15 minutos por exceso de intentos.`;
}

function clearAttempts(key) {
  loginAttempts.delete(key);
}

// ── Contexto ───────────────────────────────────────────────────────────────────
const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [user,        setUser]        = useState(null);
  const [users,       setUsers]       = useState([]);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError,   setAuthError]   = useState('');

  useEffect(() => {
    (async () => {
      try {
      let storedUsers = await localFetch('usuarios', 'select=*');
      if (!storedUsers) {
        setAuthError('No se pudo conectar con el servidor local. Verifica que el celular use la dirección web del equipo servidor.');
        return;
      }
      if (!storedUsers.length) {
        let legacyUsers = [];
        const legacyRaw = localStorage.getItem(USERS_KEY);
        if (legacyRaw) {
          try { legacyUsers = JSON.parse(legacyRaw); } catch {}
        }
        storedUsers = legacyUsers.length ? legacyUsers : await Promise.all(DEFAULT_USERS_PLAIN.map(async u => {
          const salt = genSalt();
          const hash = await hashPwd(u.password, salt);
          return { id:u.id, name:u.name, email:u.email, role:u.role, negocios:u.negocios, passwordHash:hash, passwordHashLocal:localHash(`${salt}${import.meta.env.VITE_APP_PEPPER || 'GESBAR_PROD_2024_X9mK'}${u.password}`), salt };
        }));
        const saved = await localUpsert('usuarios', storedUsers.map(u => ({
          id:u.id, name:u.name, email:u.email, role:u.role, negocios:u.negocios,
          password_hash:u.passwordHash, salt:u.salt,
          password_hash_local:u.passwordHashLocal,
        })));
        if (!saved) throw new Error('No fue posible crear los usuarios iniciales.');
      } else {
        storedUsers = storedUsers.map(u => ({
          id:u.id, name:u.name, email:u.email, role:u.role, negocios:u.negocios,
          passwordHash:u.password_hash, salt:u.salt,
          passwordHashLocal:u.password_hash_local,
        }));
      }

      setUsers(storedUsers);

      try {
        const sess = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
        if (sess?.expiresAt > Date.now()) {
          const u = storedUsers.find(x => x.id === sess.userId);
          if (u) setUser({ id:u.id, name:u.name, email:u.email, role:u.role, negocios:u.negocios });
        } else {
          localStorage.removeItem(SESSION_KEY);
        }
      } catch {}

      } finally {
        setAuthLoading(false);
      }
    })();
  }, []);

  const saveUsers = async u => {
    setUsers(u);
    const saved = await localUpsert('usuarios', u.map(user => ({
      id:user.id, name:user.name, email:user.email, role:user.role, negocios:user.negocios,
      password_hash:user.passwordHash, salt:user.salt,
      password_hash_local:user.passwordHashLocal,
    })));
    if (!saved) throw new Error('No fue posible guardar los usuarios en SQLite.');
  };

  const login = async (email, password) => {
    if (authError) return { error: authError };
    const bf = checkBruteForce(email);
    if (bf.blocked) return { error: bf.message };

    const normalizedEmail = email.trim().toLowerCase();
    const u = users.find(x => x.email.trim().toLowerCase() === normalizedEmail);
    if (!u) {
      // No revelar si el email existe (timing-safe)
      return { error: 'Credenciales incorrectas.' };
    }

    const ok = await verifyPwd(password, u.salt, u.passwordHash, u.passwordHashLocal);
    if (!ok) {
      const msg = recordFailedAttempt(bf.key, bf.record);
      return { error: msg };
    }

    clearAttempts(bf.key);
    localStorage.setItem(SESSION_KEY, JSON.stringify({ userId:u.id, expiresAt:Date.now() + 8*3600000 }));
    setUser({ id:u.id, name:u.name, email:u.email, role:u.role, negocios:u.negocios });
    return { success: true };
  };

  const logout = () => { localStorage.removeItem(SESSION_KEY); setUser(null); };

  const createUser = async ({ name, email, role, negocios, password }) => {
    const normalizedEmail = email.trim().toLowerCase();
    if (users.find(u => u.email.trim().toLowerCase() === normalizedEmail)) return { error:'Email ya existe' };
    if (!password || password.length < 8) return { error:'Contraseña mínimo 8 caracteres' };
    const salt = genSalt();
    const hash = await hashPwd(password, salt);
    const localPasswordHash = localHash(`${salt}${import.meta.env.VITE_APP_PEPPER || 'GESBAR_PROD_2024_X9mK'}${password}`);
    await saveUsers([...users, { id:uid(), name:name.trim(), email:normalizedEmail, role, negocios, passwordHash:hash, passwordHashLocal:localPasswordHash, salt }]);
    return { success: true };
  };

  const updateUser = async (userId, changes) => {
    const updated = await Promise.all(users.map(async u => {
      if (u.id !== userId) return u;
      let r = { ...u, ...changes };
      if (changes.password) {
        const salt = genSalt();
        r.passwordHash = await hashPwd(changes.password, salt);
        r.passwordHashLocal = localHash(`${salt}${import.meta.env.VITE_APP_PEPPER || 'GESBAR_PROD_2024_X9mK'}${changes.password}`);
        r.salt = salt;
      }
      delete r.password;
      return r;
    }));
    await saveUsers(updated);
    if (user?.id === userId) {
      const u = updated.find(x => x.id === userId);
      if (u) setUser({ id:u.id, name:u.name, email:u.email, role:u.role, negocios:u.negocios });
    }
  };

  const deleteUser = async id => {
    if (id === user?.id) return;
    const saved = await localDelete('usuarios', { id });
    if (!saved) throw new Error('No fue posible eliminar el usuario de SQLite.');
    setUsers(users.filter(u => u.id !== id));
  };

  return (
    <AuthCtx.Provider value={{ user, users, authLoading, authError, login, logout, createUser, updateUser, deleteUser, can, canSeeNeg }}>
      {children}
    </AuthCtx.Provider>
  );
}
