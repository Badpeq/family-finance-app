import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).end();

  const { image } = (req.body ?? {}) as { image?: string };
  if (!image) return res.status(400).json({ error: 'Missing image (base64)' });

  const key = process.env.GOOGLE_VISION_API_KEY;
  if (!key)   return res.status(500).json({ error: 'OCR not configured — set GOOGLE_VISION_API_KEY in Vercel env vars' });

  try {
    const r = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            image:    { content: image },
            features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }],
          }],
        }),
      }
    );

    if (!r.ok) {
      const err = await r.text();
      return res.status(502).json({ error: `Vision API: ${err.slice(0, 200)}` });
    }

    const data = await r.json() as any;
    const text: string = data.responses?.[0]?.fullTextAnnotation?.text ?? '';
    return res.status(200).json({ text });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? 'Unknown error' });
  }
}
