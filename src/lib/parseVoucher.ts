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
// Formato esperado: "Nombre Producto  Qty x PU  TOTAL"
// o líneas sueltas: "Leche Gloria 1L   x2  S/ 8.50"

export function parseTicketItems(text: string): ParsedItem[] {
  const lines  = text.split('\n').map(l => l.trim()).filter(Boolean);
  const items: ParsedItem[] = [];

  for (const raw of lines) {
    if (/^(subtotal|total|igv|itbm|descuento|ruc|ticket|gracias|fecha|caja)/i.test(raw)) continue;

    // Extraer precio total al final de la línea
    const totalMatch = raw.match(/([\d]+[.,]\d{2})\s*$/);
    if (!totalMatch) continue;

    const precio_total = parseFloat(totalMatch[1].replace(',', '.'));
    if (isNaN(precio_total) || precio_total <= 0) continue;

    // Detectar cantidad y precio unitario: "2 x 4.50" o "x2"
    let cantidad = 1;
    let precio_unitario = precio_total;

    const qtyMatch = raw.match(/(\d+)\s*[xX\*]\s*([\d]+[.,]\d{2})/);
    if (qtyMatch) {
      cantidad        = parseInt(qtyMatch[1], 10);
      precio_unitario = parseFloat(qtyMatch[2].replace(',', '.'));
    } else {
      const xMatch = raw.match(/[xX]\s*(\d+)/);
      if (xMatch) {
        cantidad        = parseInt(xMatch[1], 10);
        precio_unitario = precio_total / cantidad;
      }
    }

    // Nombre del producto: texto antes de cantidad/precio
    let producto = raw
      .replace(/(\d+)\s*[xX\*]\s*[\d]+[.,]\d{2}/g, '')
      .replace(/[xX]\s*\d+/g, '')
      .replace(/([\d]+[.,]\d{2})\s*$/, '')
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
