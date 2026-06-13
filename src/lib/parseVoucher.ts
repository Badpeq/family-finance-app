// Parser de vouchers bancarios y tickets de supermercado.
// Corre íntegramente en el cliente — sin backend ni OCR.

export interface ParsedLine {
  id:       string;          // uuid local para key en React
  comercio: string;          // nombre del comercio/producto
  fecha:    string;          // ISO date 'YYYY-MM-DD'
  monto:    number;          // monto positivo
  moneda:   string;          // 'PEN' | 'USD' | ...
  raw:      string;          // línea original
  excluir:  boolean;         // el usuario puede descheckear
  categoria:string;          // asignada por heurística, editable
}

export interface ParsedItem {
  producto:        string;
  cantidad:        number;
  precio_unitario: number;
  precio_total:    number;
}

// ─── Heurística de categorías por palabra clave ───────────────────────────

const CAT_KEYWORDS: [string, string[]][] = [
  ['Alimentación',    ['metro','plaza vea','wong','tottus','vivanda','mass','super','market','mercado','tambo','listo']],
  ['Restaurantes',    ['kfc','mcdonalds','burger','pizza','bembos','popeyes','starbucks','delivery','rappi','uber eat','pedidos','restaurant','cafe','ceviche','chifa']],
  ['Transporte',      ['uber','cabify','beat','indriver','grifo','repsol','petroperu','primax','shell','peaje','autopista','tren','metropolitano','bus']],
  ['Salud',           ['farmacias','inkafarma','botica','clinica','hospital','laboratorio','dentista','farmacia','salcobrand']],
  ['Entretenimiento', ['netflix','spotify','disney','hbo','amazon','prime','youtube','cine','cinemark','cineplanet','juego','steam','xbox','playstation']],
  ['Ropa',            ['ripley','saga','falabella','zara','h&m','tennis','bata','payless','zapateria','ropa','moda']],
  ['Educación',       ['udemy','coursera','platzi','universidad','colegio','instituto','libro','amazon','libreria']],
  ['Servicios',       ['enel','luz del sur','sedapal','agua','claro','movistar','entel','bitel','telefonica','internet','cable']],
  ['Vivienda',        ['alquiler','condominio','mantenimiento','ferreteria','sodimac','promart','maestro','constructor']],
];

function inferCategoria(texto: string): string {
  const lower = texto.toLowerCase();
  for (const [cat, keywords] of CAT_KEYWORDS) {
    if (keywords.some(k => lower.includes(k))) return cat;
  }
  return 'Otros';
}

// ─── Normalización de fecha ───────────────────────────────────────────────

const MONTH_MAP: Record<string, string> = {
  ene:'01',feb:'02',mar:'03',abr:'04',may:'05',jun:'06',
  jul:'07',ago:'08',sep:'09',oct:'10',nov:'11',dic:'12',
  jan:'01',apr:'04',aug:'08',sep2:'09',oct2:'10',nov2:'11',dec:'12',
};

function parseDate(raw: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const year  = new Date().getFullYear();

  // DD/MM/YYYY o DD-MM-YYYY
  let m = raw.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;

  // DD/MM sin año
  m = raw.match(/(\d{2})[\/\-](\d{2})/);
  if (m) return `${year}-${m[2]}-${m[1]}`;

  // 15JUN o JUN15
  m = raw.match(/(\d{1,2})([A-Za-z]{3})/);
  if (m) {
    const mon = MONTH_MAP[m[2].toLowerCase()] ?? '01';
    return `${year}-${mon}-${m[1].padStart(2,'0')}`;
  }
  m = raw.match(/([A-Za-z]{3})(\d{1,2})/);
  if (m) {
    const mon = MONTH_MAP[m[1].toLowerCase()] ?? '01';
    return `${year}-${mon}-${m[2].padStart(2,'0')}`;
  }

  return today;
}

// ─── Detectar moneda en la línea ──────────────────────────────────────────

function detectMoneda(line: string): string {
  if (/\$\s*\d|USD/i.test(line)) return 'USD';
  if (/EUR/i.test(line))         return 'EUR';
  return 'PEN';
}

// ─── Parser principal — estado de cuenta bancario ─────────────────────────
// Soporta formatos de BCP, BBVA, Interbank, Visa/MC genérico y texto libre.

let _uid = 0;
function uid() { return String(++_uid); }

export function parseVoucherText(text: string): ParsedLine[] {
  const lines  = text.split('\n').map(l => l.trim()).filter(Boolean);
  const result: ParsedLine[] = [];

  // Regex de monto: número con punto/coma decimal, opcionalmente precedido de S/, $, S/.
  const MONTO_RE = /(?:S\/\.?\s*|USD\s*|\$\s*)?([\d]{1,6}[.,]\d{2})\s*$/;

  for (const raw of lines) {
    // Ignorar encabezados comunes
    if (/^(fecha|date|descripci|comercio|monto|importe|saldo|total|movimiento|concepto)/i.test(raw)) continue;
    if (/^\-{3,}|^={3,}/.test(raw)) continue;

    const montoMatch = raw.match(MONTO_RE);
    if (!montoMatch) continue;

    const monto = parseFloat(montoMatch[1].replace(',', '.'));
    if (isNaN(monto) || monto <= 0 || monto > 100_000) continue;

    // Extraer fecha del texto antes del monto
    const sinMonto = raw.slice(0, raw.lastIndexOf(montoMatch[0])).trim();
    const fecha    = parseDate(sinMonto);

    // Extraer nombre del comercio: quitar fecha y código de autorización
    let comercio = sinMonto
      .replace(/\d{2}[\/\-]\d{2}([\/\-]\d{4})?/g, '')
      .replace(/\d{1,2}[A-Za-z]{3}/g, '')
      .replace(/[A-Za-z]{3}\d{1,2}/g, '')
      .replace(/\b\d{4,}\b/g, '')   // códigos numéricos largos
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (!comercio || comercio.length < 2) comercio = sinMonto.slice(0, 40).trim();

    result.push({
      id:        uid(),
      comercio:  toTitleCase(comercio),
      fecha,
      monto,
      moneda:    detectMoneda(raw),
      raw,
      excluir:   false,
      categoria: inferCategoria(raw),
    });
  }

  return result;
}

// ─── Parser de ticket de supermercado ─────────────────────────────────────
// Soporta dos formatos:
//   A) Todo en una línea:  "Leche Gloria 1L  x2  8.50"
//   B) Google Vision OCR:  cada elemento en línea propia
//                          "Leche Gloria 1L\nx2\nS/ 8.50"

const SKIP_TICKET  = /^(subtotal|total|igv|itbm|itv|descuento|ruc|ticket|gracias|fecha|caja|cajero|entregado|cambio|método|efectivo|tarjeta|yape|plin|boleta|factura|nota|www\.|tel:|av\.|jr\.|ruc:|unidad|op[.:]|importe|vuelto|tarj|ciento)/i;
const IS_PRICE     = /^[Ss]\/\.?\s*([\d]+[.,]\d{2})$|^([\d]+[.,]\d{2})$/;
const IS_QTY_ONLY  = /^[xX]\s*\d+$|^\d+\s*[xX]$/;
// "2 X @ 4.50"  "2 X or 4.50"  "2x4.50"
const IS_QTY_PRICE = /^(\d+)\s*[xX\*]\s*(?:[@]|or\s+|a\s+)?([\d]+[.,]\d{2})$/i;
// Leading EAN-8 to EAN-14 barcode: "7750571002165 SALE CHR ESP"
const BARCODE_PREFIX = /^\d{8,14}\s+/;

function extractPrice(s: string): number | null {
  const m = s.match(/^[Ss]\/\.?\s*([\d]+[.,]\d{2})$/) ??
            s.match(/^([\d]+[.,]\d{2})$/);
  if (!m) return null;
  const v = parseFloat((m[1] ?? m[2]).replace(',', '.'));
  return v > 0 && v < 100_000 ? v : null;
}

function isProductName(s: string): boolean {
  if (SKIP_TICKET.test(s))  return false;
  if (IS_PRICE.test(s))     return false;
  if (IS_QTY_ONLY.test(s))  return false;
  if (IS_QTY_PRICE.test(s)) return false;
  if (/^\d+$/.test(s))      return false;
  // Pure barcode line (no letters after the digits)
  if (/^\d{8,14}$/.test(s)) return false;
  return s.length >= 3;
}

// Pre-procesa la salida de Google Vision: agrupa nombre + qty + precio en una línea.
// Maneja:
//   "BARCODE NOMBRE\n17.90"          → "BARCODE NOMBRE 17.90"
//   "BARCODE NOMBRE\n2 X or 4.50\n9.00" → "BARCODE NOMBRE 2 X or 4.50 9.00"
function mergeVisionLines(lines: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!isProductName(line)) { i++; continue; }

    let merged = line;
    let j = i + 1;
    let priceFound = false;
    // Absorbe hasta 3 líneas siguientes: qty-only, qty+price, o solo precio
    while (j < lines.length && j <= i + 3 && !priceFound) {
      const next = lines[j];
      if (IS_QTY_ONLY.test(next)) {
        merged += ' ' + next; j++;
      } else if (IS_QTY_PRICE.test(next)) {
        // "2 X or 4.50" — la siguiente línea debería ser el total
        merged += ' ' + next; j++;
      } else if (IS_PRICE.test(next)) {
        const p = extractPrice(next);
        if (p !== null) merged += ' ' + p.toFixed(2);
        j++; priceFound = true;
      } else {
        break;
      }
    }
    out.push(merged);
    i = j;
  }
  return out;
}

export function parseTicketItems(text: string): ParsedItem[] {
  const rawLines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const items: ParsedItem[] = [];

  // Detectar si el texto viene de Vision OCR (precios en líneas propias)
  const priceOnlyLines = rawLines.filter(l => IS_PRICE.test(l)).length;
  const lines = priceOnlyLines >= 3 ? mergeVisionLines(rawLines) : rawLines;

  for (const raw of lines) {
    if (SKIP_TICKET.test(raw)) continue;

    const totalMatch = raw.match(/([\d]+[.,]\d{2})\s*$/);
    if (!totalMatch) continue;

    const precio_total = parseFloat(totalMatch[1].replace(',', '.'));
    if (isNaN(precio_total) || precio_total <= 0 || precio_total > 100_000) continue;

    let cantidad = 1;
    let precio_unitario = precio_total;

    // "2 X @ 4.50"  "2 X or 4.50"  "2x4.50"
    const qtyPuMatch = raw.match(/(\d+)\s*[xX\*]\s*(?:[@]|or\s+|a\s+)?([\d]+[.,]\d{2})/i);
    if (qtyPuMatch) {
      cantidad        = parseInt(qtyPuMatch[1], 10);
      precio_unitario = parseFloat(qtyPuMatch[2].replace(',', '.'));
    } else {
      const xMatch = raw.match(/[xX]\s*(\d+)/);
      if (xMatch) {
        cantidad        = parseInt(xMatch[1], 10);
        precio_unitario = Math.round((precio_total / cantidad) * 100) / 100;
      }
    }

    let producto = raw
      .replace(BARCODE_PREFIX, '')                                      // strip EAN barcode
      .replace(/(\d+)\s*[xX\*]\s*(?:[@]|or\s+|a\s+)?[\d]+[.,]\d{2}/gi, '') // strip qty+price
      .replace(/[xX]\s*\d+/gi, '')                                     // strip standalone qty
      .replace(/[Ss]\/\.?\s*/g, '')                                    // strip S/.
      .replace(/([\d]+[.,]\d{2})\s*$/, '')                             // strip trailing price
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (!producto || producto.length < 2) continue;

    items.push({
      producto:        toTitleCase(producto),
      cantidad:        Math.max(1, cantidad),
      precio_unitario: Math.round(precio_unitario * 100) / 100,
      precio_total:    Math.round(precio_total * 100) / 100,
    });
  }

  return items;
}

function toTitleCase(s: string): string {
  return s.toLowerCase().replace(/(?:^|\s)\S/g, c => c.toUpperCase());
}
