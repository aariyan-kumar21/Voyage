/**
 * /api/auth/logout.js — Vercel Serverless Function
 * POST /api/auth/logout
 * Clears the session cookie
 */

import { buildClearAuthCookie } from '../_lib/auth.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req, res) {
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  res.setHeader('Set-Cookie', buildClearAuthCookie());
  return res.status(200).json({ ok: true });
}
