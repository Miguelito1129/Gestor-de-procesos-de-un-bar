import { useState, useEffect, createContext, useContext } from "react";
import { genSalt, hashPwd, verifyPwd } from "../utils/auth.js";
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

  useEffect(() => {
    (async () => {
      try {
      let storedUsers = await localFetch('usuarios', 'select=*');
      if (!storedUsers) throw new Error('No fue posible cargar los usuarios desde la base local.');
      if (!storedUsers.length) {
        let legacyUsers = [];
        const legacyRaw = localStorage.getItem(USERS_KEY);
        if (legacyRaw) {
          try { legacyUsers = JSON.parse(legacyRaw); } catch {}
        }
        storedUsers = legacyUsers.length ? legacyUsers : await Promise.all(DEFAULT_USERS_PLAIN.map(async u => {
          const salt = genSalt();
          const hash = await hashPwd(u.password, salt);
          return { id:u.id, name:u.name, email:u.email, role:u.role, negocios:u.negocios, passwordHash:hash, salt };
        }));
        const saved = await localUpsert('usuarios', storedUsers.map(u => ({
          id:u.id, name:u.name, email:u.email, role:u.role, negocios:u.negocios,
          password_hash:u.passwordHash, salt:u.salt,
        })));
        if (!saved) throw new Error('No fue posible crear los usuarios iniciales.');
      } else {
        storedUsers = storedUsers.map(u => ({
          id:u.id, name:u.name, email:u.email, role:u.role, negocios:u.negocios,
          passwordHash:u.password_hash, salt:u.salt,
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
    })));
    if (!saved) throw new Error('No fue posible guardar los usuarios en SQLite.');
  };

  const login = async (email, password) => {
    const bf = checkBruteForce(email);
    if (bf.blocked) return { error: bf.message };

    const u = users.find(x => x.email.toLowerCase() === email.toLowerCase().trim());
    if (!u) {
      // No revelar si el email existe (timing-safe)
      return { error: 'Credenciales incorrectas.' };
    }

    const ok = await verifyPwd(password, u.salt, u.passwordHash);
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
    if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) return { error:'Email ya existe' };
    if (!password || password.length < 8) return { error:'Contraseña mínimo 8 caracteres' };
    const salt = genSalt();
    const hash = await hashPwd(password, salt);
    await saveUsers([...users, { id:uid(), name, email, role, negocios, passwordHash:hash, salt }]);
    return { success: true };
  };

  const updateUser = async (userId, changes) => {
    const updated = await Promise.all(users.map(async u => {
      if (u.id !== userId) return u;
      let r = { ...u, ...changes };
      if (changes.password) {
        const salt = genSalt();
        r.passwordHash = await hashPwd(changes.password, salt);
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
    <AuthCtx.Provider value={{ user, users, authLoading, login, logout, createUser, updateUser, deleteUser, can, canSeeNeg }}>
      {children}
    </AuthCtx.Provider>
  );
}
