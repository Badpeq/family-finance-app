import { createClient } from 'jsr:@supabase/supabase-js@2';

const ER_API_URL = 'https://open.er-api.com/v6/latest/USD';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function extractRates(text: string): { compra: number; venta: number } | null {
  const csvMatch = text.match(/(3\.\d{2,4}|4\.[0-4]\d{1,3})[,\t ]+?(3\.\d{2,4}|4\.[0-4]\d{1,3})/);
  if (csvMatch) {
    const a = parseFloat(csvMatch[1]);
    const b = parseFloat(csvMatch[2]);
    if (a > 0 && b > 0 && Math.abs(a - b) < 0.5) return { compra: Math.min(a, b), venta: Math.max(a, b) };
  }
  const all = (text.match(/\b(3\.\d{2,4}|4\.[0-4]\d{1,3})\b/g) ?? []).map(Number).filter(n => n >= 3.0 && n <= 4.5);
  if (all.length >= 2) return { compra: Math.min(...all), venta: Math.max(...all) };
  return null;
}

async function fetchFromGoogleSheet(): Promise<{ compra: number; venta: number; fuente: string } | null> {
  const url = Deno.env.get('GOOGLE_SHEET_URL');
  if (!url) return null;
  try {
    const res = await fetch(url, { redirect: 'follow' });
    const pair = extractRates(await res.text());
    return pair ? { ...pair, fuente: 'google_sheet' } : null;
  } catch { return null; }
}

async function fetchFromErAPI(): Promise<{ compra: number; venta: number; fuente: string } | null> {
  try {
    const res  = await fetch(ER_API_URL);
    const json = await res.json() as { result?: string; rates?: { PEN?: number } };
    if (json?.result === 'success' && typeof json?.rates?.PEN === 'number') {
      const mid = json.rates.PEN;
      return {
        compra: parseFloat((mid - 0.02).toFixed(4)),
        venta:  parseFloat((mid + 0.02).toFixed(4)),
        fuente: 'er-api',
      };
    }
    return null;
  } catch { return null; }
}

Deno.serve(async () => {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const today = todayISO();
  const { data: existing } = await admin
    .from('tipos_cambio')
    .select('fecha')
    .eq('fecha', today)
    .single();

  if (existing) return Response.json({ ok: true, msg: 'ya actualizado hoy' });

  const rate = (await fetchFromGoogleSheet()) ?? (await fetchFromErAPI()) ?? {
    compra: 3.68, venta: 3.72, fuente: 'fallback',
  };

  const { error } = await admin.from('tipos_cambio').upsert(
    { fecha: today, compra: rate.compra, venta: rate.venta, fuente: rate.fuente },
    { onConflict: 'fecha' },
  );

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true, fecha: today, ...rate });
});
