/**
 * /api/auth/login.js — Vercel Serverless Function
 * POST /api/auth/login
 * Body: { email, password }
 * Returns: { userId, name }
 */

import bcrypt from 'bcryptjs';
import { MongoClient, ServerApiVersion } from 'mongodb';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

let cachedClient = null;

async function getDb() {
  const uri = process.env.MONGODB_URI;
  if (!uri || uri.includes('<username>') || uri.includes('<cluster>')) {
    throw new Error('MONGODB_URI is not configured. Please set it in your .env.local file or Vercel environment variables.');
  }
  if (!cachedClient) {
    cachedClient = new MongoClient(uri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
    });
    try {
      await cachedClient.connect();
    } catch (e) {
      cachedClient = null;
      throw e;
    }
  }
  return cachedClient.db('voyage');
}

export default async function handler(req, res) {
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const db = await getDb();
    const users = db.collection('users');

    const user = await users.findOne({ email: email.toLowerCase().trim() });

    if (!user) {
      return res.status(401).json({ error: 'No account found with that email.' });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(401).json({ error: 'Incorrect password.' });
    }

    return res.status(200).json({
      userId: user._id.toString(),
      name: user.name,
    });
  } catch (err) {
    console.error('[/api/auth/login] Error:', err);
    const msg = err.message && err.message.includes('MONGODB_URI')
      ? err.message
      : 'Could not connect to the database. Please check your MONGODB_URI configuration.';
    return res.status(500).json({ error: msg });
  }
}
