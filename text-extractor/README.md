# Article Text Extractor

Upload a newspaper / magazine / article image → get the full text (Hindi + English), with typos corrected.

Two engines:
- **AI reading (Gemini)** – best quality: correct column order, Hindi matras, typo correction, list of corrections. Uses Google's **free** Gemini API key.
- **Offline OCR (Tesseract)** – runs in the browser, no key needed, basic cleanup only.

## Files
```
index.html        the page
api/extract.js    sends images to Gemini (keeps your key secret on the server)
api/config.js     tells the page which features are on
vercel.json       allows up to 60 s per extraction
package.json
```

## Deploy on Vercel
1. Put these files in a new GitHub repo (keep the `api` folder as it is).
2. Vercel → **Add New → Project** → import the repo → Deploy (no build settings needed).
3. Get a free key at https://aistudio.google.com/apikey
4. Vercel → Project → **Settings → Environment Variables**, add:
   - `GEMINI_API_KEY` = your key  *(required for AI reading)*
   - `APP_PASSWORD` = any password  *(optional – anyone using the link must enter it)*
   - `GEMINI_MODEL` = e.g. `gemini-2.5-flash`  *(optional – this is the default)*
5. **Deployments → ⋯ → Redeploy** so the variables take effect.

To change the password later, edit `APP_PASSWORD` in Vercel and redeploy – only someone with access to your Vercel account can change it.

## Notes
- Free Gemini tier has per-minute and per-day limits. If they are hit, the tool says so; wait or use Offline OCR. If one model is busy it automatically tries `gemini-2.5-flash-lite`.
- On Google's free tier, Google may use the images to improve its products. Don't upload confidential material.
- Images are shrunk in the browser to stay under Vercel's 4.5 MB request limit. Up to 8 images per run.
