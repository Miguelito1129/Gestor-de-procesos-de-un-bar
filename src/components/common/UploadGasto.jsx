import { useState, useRef } from "react";
import { C, s, COP } from "../../constants/theme.js";
import { uid } from "../../utils/helpers.js";
import { localInsert } from "../../lib/localApi.js";
import { analizarGasto, hasAI } from "../../lib/aiVision.js";

const CATS = ['Insumos','Nómina','Mantenimiento','Servicios','Proveedores','Arriendo','Comisión','CxC','Otros'];
const CAT_COLORS = { Insumos:C.indigo, Nómina:C.green, Mantenimiento:C.amber, Servicios:C.purple, Proveedores:C.cyan, Arriendo:C.red, Comisión:'#ec4899', CxC:C.red, Otros:C.sub };

// La foto queda disponible localmente para previsualización; el registro se guarda en SQLite.
async function uploadFoto(file, carpeta) {
  return file ? URL.createObjectURL(file) : null;
}

// Detectar categoría del gasto
function parseCategoria(texto) {
  const t = (texto || '').toLowerCase();
  if (/hielo|limon|limón|vaso|bolsa|sal|insumo|servilleta/.test(t)) return 'Insumos';
  if (/arreglo|reparac|manten|plomero|electr/.test(t)) return 'Mantenimiento';
  if (/licor|aguardiente|cerveza|proveedor|pedido|ron|whisky/.test(t)) return 'Proveedores';
  if (/arriendo/.test(t)) return 'Arriendo';
  if (/nomina|nómina|personal|pago personal/.test(t)) return 'Nómina';
  if (/publicidad|redes|diseño/.test(t)) return 'Comisión';
  return 'Otros';
}

export default function UploadGasto({ negocio, onRegistered }) {
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState(null);
  const [desc, setDesc] = useState('');
  const [monto, setMonto] = useState('');
  const [cat, setCat] = useState('Insumos');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const handleFile = async (f) => {
    if (!f) return;
    setFile(f);
    setResult(null);
    setSuccess(false);
    setError('');
    setPreview(URL.createObjectURL(f));

    if (hasAI()) {
      setAnalyzing(true);
      try {
        const ai = await analizarGasto(f);
        if (ai) {
          if (ai.descripcion) setDesc(ai.descripcion);
          if (ai.monto_total) setMonto(String(ai.monto_total));
          if (ai.categoria && CATS.includes(ai.categoria)) setCat(ai.categoria);
          setResult(ai);
        }
      } catch (e) {
        console.error('[UploadGasto] AI error:', e);
      }
      setAnalyzing(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f && f.type.startsWith('image/')) handleFile(f);
  };

  const registrar = async () => {
    if (!desc || !monto || parseInt(monto) <= 0) return;
    setUploading(true);
    setError('');
    try {
      let fotoUrl = null;
      if (file) {
        try { fotoUrl = await uploadFoto(file, `gastos/${negocio.id}`); } catch (_) {}
      }

      await localInsert('gastos', [{
        id: uid(),
        negocio_id: negocio.id,
        fecha: new Date().toISOString().slice(0, 10),
        descripcion: desc,
        monto: parseInt(monto),
        cat,
        foto_url: fotoUrl,
        procesado: false,
      }]);

      setSuccess(true);
      setFile(null);
      setPreview(null);
      setResult(null);
      setDesc('');
      setMonto('');
      setCat('Insumos');
      if (onRegistered) onRegistered();
    } catch (e) {
      setError('Error al registrar: ' + e.message);
    }
    setUploading(false);
  };

  const reset = () => {
    setFile(null);
    setPreview(null);
    setResult(null);
    setDesc('');
    setMonto('');
    setCat('Insumos');
    setError('');
    setSuccess(false);
  };

  return (
    <div>
      {!file ? (
        <div
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
          onClick={() => fileRef.current?.click()}
          style={{
            border: `2px dashed ${C.border}`,
            borderRadius: 12,
            padding: '1.5rem 1rem',
            textAlign: 'center',
            cursor: 'pointer',
            background: C.surface,
            transition: 'border-color 0.2s',
          }}
          onMouseEnter={e => e.currentTarget.style.borderColor = C.amber}
          onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
        >
          <div style={{ fontSize: 32, marginBottom: 8 }}>🧾</div>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
            Subir factura / recibo
          </div>
          <div style={{ fontSize: 11, color: C.sub }}>
            Arrastra una foto o haz clic para seleccionar
          </div>
          <div style={{ fontSize: 10, color: C.muted, marginTop: 6 }}>
            {hasAI() ? '🧠 La IA extraerá descripción y monto automáticamente' : '📝 Ingresa los datos manualmente'}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={e => handleFile(e.target.files?.[0])}
          />
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{
            width: 80, height: 80, borderRadius: 10, overflow: 'hidden',
            border: `1px solid ${C.border}`, flexShrink: 0, position: 'relative'
          }}>
            <img src={preview} alt="factura" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <button
              onClick={reset}
              style={{
                position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,0.6)',
                border: 'none', color: '#fff', borderRadius: '50%', width: 20, height: 20,
                cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}
            >✕</button>
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            {analyzing && (
              <div style={{ padding: '6px 10px', background: C.purple + '15', borderRadius: 8, fontSize: 11, color: C.purple, marginBottom: 8, border: `1px solid ${C.purple}30` }}>
                🧠 Analizando factura con IA...
              </div>
            )}
            {result && !analyzing && (
              <div style={{ padding: '6px 10px', background: C.green + '15', borderRadius: 8, fontSize: 11, color: C.green, marginBottom: 8, border: `1px solid ${C.green}30` }}>
                ✓ Detectado: {result.descripcion} — {result.monto_total ? COP(result.monto_total) : 'sin monto'}
              </div>
            )}
            {error && (
              <div style={{ padding: '6px 10px', background: C.red + '15', borderRadius: 8, fontSize: 11, color: C.red, marginBottom: 8 }}>{error}</div>
            )}
            {success && (
              <div style={{ padding: '6px 10px', background: C.green + '15', borderRadius: 8, fontSize: 11, color: C.green, marginBottom: 8 }}>
                ✓ Gasto registrado
              </div>
            )}

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
              <input
                style={{ ...s.inp, flex: 2, minWidth: 120, fontSize: 12, padding: '4px 8px', height: 30 }}
                placeholder="Descripción (ej: hielo 5 bolsas)"
                value={desc}
                onChange={e => {
                  setDesc(e.target.value);
                  if (!result) setCat(parseCategoria(e.target.value));
                }}
              />
              <input
                style={{ ...s.inp, flex: 1, maxWidth: 120, fontSize: 12, padding: '4px 8px', height: 30 }}
                type="number"
                placeholder="Monto"
                value={monto}
                onChange={e => setMonto(e.target.value)}
              />
              <select
                style={{ ...s.sel, flex: '0 0 110px', fontSize: 11, padding: '4px 6px', height: 30 }}
                value={cat}
                onChange={e => setCat(e.target.value)}
              >
                {CATS.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              <button
                style={{ ...s.btn('primary'), padding: '5px 14px', fontSize: 11 }}
                disabled={uploading || !desc || !monto}
                onClick={registrar}
              >
                {uploading ? 'Subiendo...' : '✓ Registrar'}
              </button>
              <button style={{ ...s.btn(), padding: '5px 10px', fontSize: 11 }} onClick={reset}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
