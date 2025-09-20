// pages/api/health.js
export default function handler(req, res) {
  if (req.method === 'POST') {
    return res.status(200).json({ ok: true, via: 'POST' });
  }
  return res.status(200).json({ ok: true, via: req.method });
}
