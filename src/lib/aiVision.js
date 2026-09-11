// src/lib/aiVision.js
// Análisis de imágenes de comprobantes usando IA (Groq Vision o Anthropic)

const GROQ_KEY = import.meta.env.VITE_GROQ_KEY || '';
const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_KEY || '';

const PLAT_KEYWORDS = {
  nequi:       ['nequi'],
  bancolombia: ['bancolombia', 'banco col', 'bancol'],
  datafono:    ['datafono', 'datáfono', 'dataphone'],
  daviplata:   ['daviplata', 'davi plata', 'davip'],
  llave:       ['llave'],
  qr:          ['qr', 'codigo qr', 'código qr'],
};

export const PLAT_LABELS = {
  nequi: 'Nequi', bancolombia: 'Bancolombia',
  datafono: 'Datáfono', daviplata: 'Daviplata',
  llave: 'Llave', qr: 'QR', otro: 'Otro',
};

export const PLAT_COLORS = {
  nequi:'#FF0066', bancolombia:'#FFCD00', datafono:'#34d399',
  daviplata:'#FF4500', llave:'#67e8f9', qr:'#a78bfa',
};

// Detectar plataforma del texto
export function parsePlataforma(texto) {
  if (!texto) return 'otro';
  const n = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const [plat, kws] of Object.entries(PLAT_KEYWORDS)) {
    if (kws.some(k => n.includes(k))) return plat;
  }
  return 'otro';
}

// Parsear monto (formatos colombianos: 150.000, 1.500.000, 150k, 150000)
export function parseMonto(texto) {
  if (!texto) return null;
  const t = texto.toLowerCase();

  // "150k" o "150mil"
  const km = t.match(/(\d+(?:[,.]\d+)?)\s*(?:k\b|mil(?:es?)?\b)/i);
  if (km) return Math.round(parseFloat(km[1].replace(',', '.')) * 1000);

  const num = t.replace(/[^0-9.,]/g, '');
  if (!num) return null;

  // Múltiples puntos: 1.500.000
  if ((num.match(/\./g) || []).length >= 2) {
    return parseInt(num.replace(/\./g, ''), 10);
  }
  // Un punto: 150.000 (sep. de miles si hay 3 dígitos tras el punto)
  if (num.includes('.') && !num.includes(',')) {
    const [int, dec] = num.split('.');
    if (dec.length === 3) return parseInt(int + dec, 10);
    return Math.round(parseFloat(num));
  }
  // Una coma: 150,000 (sep. de miles) o 150,50 (decimal)
  if (num.includes(',')) {
    const [int, dec] = num.split(',');
    if (dec.length === 3) return parseInt(int + dec, 10);
    return Math.round(parseFloat(int + '.' + dec));
  }
  const n = parseInt(num, 10);
  return n > 0 ? n : null;
}

// Convertir archivo a base64 data URL
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Prompt para análisis de comprobante bancario
const TRANSFER_PROMPT = `Analiza este comprobante de transferencia bancaria colombiana.
IMPORTANTE: extrae los datos del DESTINATARIO (quien RECIBE el dinero), NO del remitente.
Responde SOLO con JSON válido (sin markdown, sin texto extra):
{"plataforma":"nequi"|"bancolombia"|"daviplata"|"datafono"|"llave"|"otro"|"null","monto_total":123456,"descripcion":"breve descripción"}
Reglas:
- plataforma: app/banco DESTINO (Nequi=rosa/morado, Bancolombia=amarillo, Daviplata=rojo)
- monto_total: número entero en pesos colombianos (150000 no "$150.000"), null si no se ve
- descripcion: qué se transfiere (ej: "Transferencia Nequi", "Pago proveedor")`;

// Prompt para análisis de factura/gasto
const GASTO_PROMPT = `Analiza esta imagen de factura o recibo de gasto.
Responde SOLO con JSON válido (sin markdown, sin texto extra):
{"descripcion":"descripción breve del gasto","monto_total":123456,"categoria":"Insumos"|"Mantenimiento"|"Proveedores"|"Arriendo"|"Nómina"|"Servicios"|"Otros"}
Reglas:
- descripcion: qué se compró (máx 60 caracteres)
- monto_total: número entero en pesos colombianos, null si no se ve
- categoria: la más adecuada según el contenido`;

// Análisis con Groq Vision (gratuito)
async function analizarConGroq(imageDataUrl, prompt) {
  if (!GROQ_KEY) return null;
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        max_tokens: 200,
        temperature: 0,
        messages: [{ role: 'user', content: [
          { type: 'image_url', image_url: { url: imageDataUrl } },
          { type: 'text', text: prompt },
        ]}],
      }),
    });
    if (res.ok) {
      const data = await res.json();
      const texto = data.choices?.[0]?.message?.content || '';
      const match = texto.match(/\{[\s\S]*?\}/);
      if (match) return JSON.parse(match[0]);
    }
  } catch (e) { console.error('[Groq Vision]', e.message); }
  return null;
}

// Análisis con Anthropic Claude (fallback)
async function analizarConAnthropic(imageDataUrl, prompt) {
  if (!ANTHROPIC_KEY) return null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'url', url: imageDataUrl } },
          { type: 'text', text: prompt },
        ]}],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const texto = data.content?.[0]?.text || '';
    const match = texto.match(/\{[\s\S]*?\}/);
    if (match) return JSON.parse(match[0]);
  } catch (e) { console.error('[Anthropic Vision]', e.message); }
  return null;
}

// Analizar comprobante de transferencia
export async function analizarTransferencia(file) {
  const dataUrl = await fileToDataUrl(file);
  return await analizarConGroq(dataUrl, TRANSFER_PROMPT)
      || await analizarConAnthropic(dataUrl, TRANSFER_PROMPT);
}

// Analizar factura/gasto
export async function analizarGasto(file) {
  const dataUrl = await fileToDataUrl(file);
  return await analizarConGroq(dataUrl, GASTO_PROMPT)
      || await analizarConAnthropic(dataUrl, GASTO_PROMPT);
}

// Verificar si hay IA configurada
export function hasAI() {
  return Boolean(GROQ_KEY || ANTHROPIC_KEY);
}
