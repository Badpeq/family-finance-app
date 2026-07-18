import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Unauthorized', { status: 401, headers: CORS });

  const { image_base64 } = await req.json().catch(() => ({})) as { image_base64?: string };
  if (!image_base64 || image_base64.length > 8_000_000) {
    return new Response('Bad request', { status: 400, headers: CORS });
  }

  const visionRes = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${Deno.env.get('GOOGLE_VISION_KEY')}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{ image: { content: image_base64 }, features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }] }],
      }),
    },
  );

  if (!visionRes.ok) {
    const err = await visionRes.text();
    return Response.json({ error: `Vision API: ${err.slice(0, 200)}` }, { status: 502, headers: CORS });
  }

  const json = await visionRes.json() as { responses?: Array<{ fullTextAnnotation?: { text?: string } }> };
  const text = json.responses?.[0]?.fullTextAnnotation?.text ?? '';
  return Response.json({ text }, { headers: CORS });
});
