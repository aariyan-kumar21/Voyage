/**
 * /api/auth/signup.js — Vercel Serverless Function
 * POST /api/auth/signup
 * Body: { name, email, password }
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
  if (!cachedClient) {
    cachedClient = new MongoClient(process.env.MONGODB_URI, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
    });
    await cachedClient.connect();
  }
  return cachedClient.db('voyage');
}

export default async function handler(req, res) {
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  const { name, email, password } = req.body || {};

  // --- Validate inputs ---
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Name is required.' });
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'A valid email is required.' });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  try {
    const db = await getDb();
    const users = db.collection('users');

    // Check for duplicate email (case-insensitive)
    const existing = await users.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await users.insertOne({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      passwordHash,
      createdAt: new Date(),
      data: {
        todos: [],
        notes: [],
        events: [],
        goals: [],
        roadmaps: [],
        streak: 0,
        todoHistory: {},
        habitGrid: null,
      },
    });

    return res.status(201).json({
      userId: result.insertedId.toString(),
      name: name.trim(),
    });
  } catch (err) {
    console.error('[/api/auth/signup] Error:', err);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
}
