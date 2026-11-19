// Reads article images with Google Gemini (free API tier) and returns clean, typo-corrected text.
// Environment variables (set in Vercel → Project → Settings → Environment Variables):
//   GEMINI_API_KEY  required  – free key from https://aistudio.google.com/apikey
//   APP_PASSWORD    optional  – if set, users must enter it to use the tool
//   GEMINI_MODEL    optional  – defaults to gemini-2.5-flash

const FALLBACK_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];

function buildPrompt({ count, mode, topic, fix, captions }) {
  const scope =
    mode === 'main' ? 'Extract ONLY the main article (the one with the largest headline).'
    : mode === 'topic' ? `Extract ONLY the article(s) about: "${String(topic || 'the main subject').slice(0, 200)}". Ignore all other articles.`
    : 'Extract EVERY news article / editorial text block on the image(s), each as a separate article.';

  return `You are an expert OCR transcriber and newspaper copy editor for Hindi (Devanagari) and English print media.
${count > 1 ? `There are ${count} images: consecutive pages/parts of the same material, in order. Join an article that continues across images.` : 'There is one image.'}

TASK: ${scope}
Rules:
- Transcribe the COMPLETE text word for word. Never summarise, shorten, paraphrase, translate or add anything.
- Follow the correct reading order across columns; join lines broken by column width and words hyphenated at line ends.
- Keep the original language(s) exactly as printed (Hindi stays Hindi, English stays English).
- Keep paragraph breaks as in print. Put sub-headings inside the body as their own paragraph.
- ${captions ? 'Include photo captions, pull-quotes and boxed items, each as its own paragraph prefixed with "[Caption] " or "[Box] ".' : 'Skip photo captions, advertisements, page headers/footers and page numbers.'}
- ${fix
    ? 'Correct spelling mistakes, printing typos and OCR-style errors: wrong/missing matras, nukta, chandrabindu/anusvara, halant, broken conjuncts, wrong punctuation (use । for Hindi sentences), stray characters, doubled words, English misspellings. Keep proper nouns, names, numbers, dates and quotations faithful; do not change style, grammar choices or wording. List every change in "corrections".'
    : 'Do NOT correct anything: reproduce spelling exactly as printed. "corrections" must be an empty array.'}
- If some text is unreadable, write [अस्पष्ट] (or [illegible] in English text) in its place.

Return ONLY JSON in this shape:
{"language":"Hindi|English|Mixed","source":"newspaper/magazine name and date if printed, else empty","articles":[{"headline":"","subheadline":"","byline":"","dateline":"","body":"paragraphs separated by \\n\\n"}],"corrections":[{"from":"as printed","to":"corrected","why":"short reason"}],"notes":"illegible or cut-off parts, else empty"}`;
}

function parseJSON(t) {
  t = String(t || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('bad_json');
  return JSON.parse(t.slice(a, b + 1));
}

async function callGemini(model, key, prompt, images) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [{ text: prompt }, ...images.map(i => ({ inline_data: { mime_type: i.mime || 'image/jpeg', data: i.data } }))],
      }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 65536 },
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(body?.error?.message || `Gemini error ${r.status}`);
    err.status = r.status;
    throw err;
  }
  const cand = body?.candidates?.[0];
  const text = (cand?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
  if (!text) {
    const err = new Error(cand?.finishReason === 'SAFETY' || body?.promptFeedback?.blockReason
      ? 'Google blocked this image. Try a cropped image of just the article.'
      : 'Gemini returned no text.');
    err.status = 422;
    throw err;
  }
  return { text, truncated: cand?.finishReason === 'MAX_TOKENS' };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  const pass = process.env.APP_PASSWORD;
  if (pass && req.headers['x-app-password'] !== pass) return res.status(401).json({ error: 'wrong_password' });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(503).json({ error: 'GEMINI_API_KEY is not set on the server.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const images = Array.isArray(body?.images) ? body.images.slice(0, 8).filter(i => i && typeof i.data === 'string') : [];
  if (!images.length) return res.status(400).json({ error: 'No image received.' });

  const o = body.options || {};
  const prompt = buildPrompt({ count: images.length, mode: o.mode, topic: o.topic, fix: o.fix !== false, captions: !!o.captions });
  const models = [...new Set([process.env.GEMINI_MODEL, ...FALLBACK_MODELS].filter(Boolean))];

  let lastErr;
  for (const model of models) {
    try {
      const { text, truncated } = await callGemini(model, key, prompt, images);
      const out = parseJSON(text);
      out.articles = (out.articles || []).filter(a => a && (a.body || a.headline));
      out.corrections = Array.isArray(out.corrections) ? out.corrections : [];
      out.truncated = truncated;
      out.model = model;
      return res.status(200).json(out);
    } catch (e) {
      lastErr = e;
      // Try the next model only when this one is busy, over quota or unavailable.
      if (![404, 429, 500, 503].includes(e.status) && e.message !== 'bad_json') break;
    }
  }
  const status = lastErr?.status === 429 ? 429 : 502;
  res.status(status).json({
    error: status === 429
      ? 'Free Gemini limit reached for now. Wait a minute (or until tomorrow), or use Offline OCR.'
      : lastErr?.message === 'bad_json' ? 'The text came back in an unexpected form. Please try again.' : (lastErr?.message || 'Extraction failed.'),
  });
}
