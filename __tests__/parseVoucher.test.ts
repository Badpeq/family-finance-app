/**
 * M8-Lib · Parser de vouchers y tickets
 * Cubre: parseVoucherText, parseTicketItems, mergeVisionLines (indirectamente)
 */

import { parseVoucherText, parseTicketItems } from '@/lib/parseVoucher';

// ─── parseVoucherText ─────────────────────────────────────────────────────────

describe('parseVoucherText', () => {
  describe('formato BCP / Interbank genérico', () => {
    it('parsea líneas con monto al final', () => {
      const text = `
        FECHA      DESCRIPCION          MONTO
        15/05/2025 UBER PERU             12.50
        15/05/2025 RAPPI DELIVERY        35.00
        16/05/2025 STARBUCKS MIRAFLORES  22.90
      `;
      const result = parseVoucherText(text);
      expect(result).toHaveLength(3);
      expect(result[0].monto).toBe(12.5);
      expect(result[1].monto).toBe(35.0);
      expect(result[2].monto).toBe(22.9);
    });

    it('ignora líneas de encabezado (FECHA, DESCRIPCION, MONTO)', () => {
      const text = 'FECHA DESCRIPCION MONTO\n20/06/2025 FARMACIA 45.00';
      const result = parseVoucherText(text);
      expect(result).toHaveLength(1);
    });

    it('ignora líneas sin monto decimal', () => {
      const text = 'texto sin precio\n20/06/2025 TIENDA 100.50';
      const result = parseVoucherText(text);
      expect(result).toHaveLength(1);
    });

    it('ignora montos cero o negativos', () => {
      const text = '20/06/2025 NADA 0.00\n20/06/2025 TIENDA 50.00';
      const result = parseVoucherText(text);
      expect(result).toHaveLength(1);
    });
  });

  describe('detección de moneda', () => {
    it('detecta PEN por defecto', () => {
      const result = parseVoucherText('20/06/2025 TIENDA 50.00');
      expect(result[0].moneda).toBe('PEN');
    });

    it('detecta USD con símbolo $', () => {
      const result = parseVoucherText('20/06/2025 AMAZON $29.99');
      expect(result[0].moneda).toBe('USD');
    });

    it('detecta USD con texto USD', () => {
      const result = parseVoucherText('20/06/2025 NETFLIX USD 5.99');
      expect(result[0].moneda).toBe('USD');
    });
  });

  describe('parseo de fechas', () => {
    it('parsea DD/MM/YYYY', () => {
      const result = parseVoucherText('15/06/2025 TIENDA 10.00');
      expect(result[0].fecha).toBe('2025-06-15');
    });

    it('parsea DD/MM sin año', () => {
      const result = parseVoucherText('15/06 TIENDA 10.00');
      const year = new Date().getFullYear();
      expect(result[0].fecha).toBe(`${year}-06-15`);
    });

    it('usa fecha de hoy si no hay fecha detectada', () => {
      const today = new Date().toISOString().slice(0, 10);
      const result = parseVoucherText('SUPERMERCADO 50.00');
      expect(result[0].fecha).toBe(today);
    });
  });

  describe('inferencia de categoría', () => {
    it('categoriza supermercados como Alimentación', () => {
      const result = parseVoucherText('20/06/2025 METRO S.A.C. 150.00');
      expect(result[0].categoria).toBe('Alimentación');
    });

    it('categoriza rides como Transporte', () => {
      const result = parseVoucherText('20/06/2025 UBER TRIP 25.00');
      expect(result[0].categoria).toBe('Transporte');
    });

    it('categoriza farmacias como Salud', () => {
      const result = parseVoucherText('20/06/2025 INKAFARMA 45.00');
      expect(result[0].categoria).toBe('Salud');
    });

    it('devuelve Otros si no coincide ninguna categoría', () => {
      const result = parseVoucherText('20/06/2025 TIENDA XYZ 99.00');
      expect(result[0].categoria).toBe('Otros');
    });
  });

  describe('casos límite', () => {
    it('retorna array vacío con texto vacío', () => {
      expect(parseVoucherText('')).toHaveLength(0);
    });

    it('retorna array vacío con solo encabezados', () => {
      expect(parseVoucherText('FECHA DESCRIPCION MONTO\n---')).toHaveLength(0);
    });

    it('ignora montos superiores a 100.000', () => {
      const result = parseVoucherText('20/06/2025 TIENDA 150000.00');
      expect(result).toHaveLength(0);
    });
  });
});

// ─── parseTicketItems ─────────────────────────────────────────────────────────

describe('parseTicketItems', () => {
  describe('formato inline (texto manual)', () => {
    it('parsea producto con precio al final', () => {
      const result = parseTicketItems('Leche Gloria 1L 7.50\nPan integral 3.20');
      expect(result).toHaveLength(2);
      // toTitleCase baja todo a minúsculas y capitaliza inicio de palabra;
      // "1L" queda "1l" porque la "l" va pegada a un dígito, no a un espacio.
      expect(result[0].producto).toBe('Leche Gloria 1l');
      expect(result[0].precio_total).toBe(7.5);
      expect(result[1].producto).toBe('Pan Integral');
      expect(result[1].precio_total).toBe(3.2);
    });

    it('parsea cantidad con formato Nx', () => {
      const result = parseTicketItems('Agua San Luis 500ml x3 6.00');
      expect(result[0].cantidad).toBe(3);
      expect(result[0].precio_unitario).toBe(2.0);
      expect(result[0].precio_total).toBe(6.0);
    });

    it('parsea cantidad con formato N x PRECIO', () => {
      const result = parseTicketItems('Yogur Yomost 2 x 4.50 9.00');
      expect(result[0].cantidad).toBe(2);
      expect(result[0].precio_unitario).toBe(4.5);
      expect(result[0].precio_total).toBe(9.0);
    });

    it('ignora líneas sin precio decimal', () => {
      const result = parseTicketItems('SOLO TEXTO\nProducto 5.00');
      expect(result).toHaveLength(1);
    });
  });

  describe('líneas de skip / encabezados', () => {
    const skipLines = [
      'SUBTOTAL 50.00',
      'TOTAL 55.00',
      'IGV 8.10',
      'EFECTIVO 60.00',
      'TARJETA 55.00',
      'YAPE 55.00',
      'VUELTO 5.00',
      'CAJA 3 12:30',
      'CAJERO JUAN',
      'RUC 20608300393',
    ];
    skipLines.forEach(line => {
      it(`ignora: "${line}"`, () => {
        const result = parseTicketItems(`${line}\nLeche Gloria 7.50`);
        expect(result.filter(i => /subtotal|total|igv|efectivo|tarjeta|yape|vuelto|caja|cajero|ruc/i.test(i.producto))).toHaveLength(0);
      });
    });
  });

  describe('formato Google Vision OCR — ticket1.jpeg real', () => {
    const ocrText = `obne m
COMPANIA FOOD RETAIL S.A.C.
RUC 20608300393
CAL CESAR MORELLI 181 P-3
SAN BORJA, LIMA
BOLETA DE VENTA ELECTRONICA
BA20-07354099
:808
CAJERO
7750571002165 SALE CHR ESP
17.90
2200203943762 BZETOAHUM80
5.50
2200204056355 BEK MANTA IN
24.90
0638060271797 SCOTCH DES 4
12.90
2200204056317 BEK MANTA IN
24.90
2800205403297 SGL JOGGER D
29.90
2800204895093 SGL JOGGER D
24.90
2200203934456 BZECREMCP230
8.50
6930518984346 STICKER BO-L
2 X or 4.50
9.00
7751271036399 L UHT SL 3PK
15.50
2200204272588 TOALLA ROSA
9.90
7750670021852 HYFTTNTW600
2.60
2200000241238 TINKA AZAR
5.00
Tinka (ID: 228723950)
SUBTOTAL
S/
191.40
14 UNIDAD(ES)
OP EXONERADA
0.00
OP. INAFECTA
5.00
OP: GRAVADA
157.96
I.G.V.
S/
28.44
IMPORTE TOTAL
S/
191.40
TOTAL A PAGAR
S/
191.40
CIENTO NOVENTA Y UNO Y 40/100 SOLES
TARJ BANC
191.40
4772********5303
VUELTO
0.00`;

    let result: ReturnType<typeof parseTicketItems>;
    beforeAll(() => { result = parseTicketItems(ocrText); });

    it('extrae 13 productos (1 por línea de barcode)', () => {
      expect(result).toHaveLength(13);
    });

    it('total suma exactamente S/ 191.40', () => {
      const total = result.reduce((s, i) => s + i.precio_total, 0);
      expect(total).toBeCloseTo(191.4, 1);
    });

    it('no incluye barcodes EAN en el nombre del producto', () => {
      for (const item of result) {
        expect(item.producto).not.toMatch(/^\d{8,14}/);
      }
    });

    it('detecta Sticker BO-L como 2 unidades a 4.50', () => {
      const sticker = result.find(i => i.producto.toLowerCase().includes('sticker'));
      expect(sticker).toBeDefined();
      expect(sticker!.cantidad).toBe(2);
      expect(sticker!.precio_unitario).toBe(4.5);
      expect(sticker!.precio_total).toBe(9.0);
    });

    it('no incluye OP: GRAVADA, SUBTOTAL ni TOTAL como productos', () => {
      const banned = ['gravada', 'subtotal', 'total', 'vuelto', 'importe', 'tarj'];
      for (const item of result) {
        for (const b of banned) {
          expect(item.producto.toLowerCase()).not.toContain(b);
        }
      }
    });

    it('no incluye líneas de solo precio (191.40, 28.44)', () => {
      const priceOnly = result.filter(i => /^\d+\.\d{2}$/.test(i.producto));
      expect(priceOnly).toHaveLength(0);
    });
  });

  describe('formato OCR con S/. y cantidades', () => {
    // Para disparar mergeVisionLines se necesitan >= 3 líneas de solo-precio.
    // Usamos texto inline (precio en la misma línea) para tests de unidad simples.

    it('parsea precios con S/. en línea inline', () => {
      const result = parseTicketItems('Arroz Costeño S/. 8.90\nAceite 12.50\nLeche 7.00');
      const arroz = result.find(i => i.producto.toLowerCase().includes('arroz'));
      expect(arroz).toBeDefined();
      expect(arroz!.precio_total).toBe(8.9);
    });

    it('parsea precios con S/ en línea inline', () => {
      const result = parseTicketItems('Aceite Primor S/ 12.50\nLeche 7.00\nPan 3.50');
      const aceite = result.find(i => i.producto.toLowerCase().includes('aceite'));
      expect(aceite).toBeDefined();
      expect(aceite!.precio_total).toBe(12.5);
    });

    it('maneja "2 X @ 4.50" como qty=2, pu=4.50 (formato OCR multi-línea)', () => {
      // ≥3 precios en líneas propias activa mergeVisionLines
      const text = [
        'Choclo Desgranado',
        '2 X @ 4.50',
        '9.00',
        'Leche Gloria',
        '7.50',
        'Arroz Costeño',
        '8.90',
      ].join('\n');
      const result = parseTicketItems(text);
      const choclo = result.find(i => i.producto.toLowerCase().includes('choclo'));
      expect(choclo).toBeDefined();
      expect(choclo!.cantidad).toBe(2);
      expect(choclo!.precio_unitario).toBe(4.5);
      expect(choclo!.precio_total).toBe(9.0);
    });
  });

  describe('casos límite', () => {
    it('retorna array vacío con texto vacío', () => {
      expect(parseTicketItems('')).toHaveLength(0);
    });

    it('retorna array vacío con solo encabezados de ticket', () => {
      const text = 'SUBTOTAL 100.00\nTOTAL 100.00\nIGV 15.25\nVUELTO 0.00';
      expect(parseTicketItems(text)).toHaveLength(0);
    });

    it('ignora items con precio cero', () => {
      const result = parseTicketItems('Descuento 0.00\nLeche 7.50');
      expect(result).toHaveLength(1);
    });

    it('cantidad mínima es 1', () => {
      const result = parseTicketItems('Leche Gloria 7.50');
      expect(result[0].cantidad).toBe(1);
    });
  });
});
