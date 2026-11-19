// Tells the page which features are switched on (never exposes the key or password).
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ai: Boolean(process.env.GEMINI_API_KEY),
    password: Boolean(process.env.APP_PASSWORD),
  });
}
