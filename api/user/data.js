/**
 * /api/user/data.js — Vercel Serverless Function
 *
 * GET  /api/user/data             → returns { data } for authenticated user
 * POST /api/user/data             → body: { data } — validated & whitelisted update
 */

import dns from 'dns';
import fs from 'fs';
import path from 'path';
import { MongoClient, ObjectId, ServerApiVersion } from 'mongodb';
import { extractToken, verifyToken } from '../_lib/auth.js';

try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch(e) {}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-auth-token',
};

const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024; // 5MB limit

/**
 * Whitelists and validates user data fields before persisting to MongoDB.
 * Strips any unknown or unauthorized keys.
 */
function validateAndSanitizeUserData(rawData) {
  if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) {
    return { valid: false, error: 'Invalid data format: Expected a JSON object.' };
  }

  const clean = {};

  // 1. Array collections
  const arrayKeys = ['todos', 'notes', 'projects', 'events', 'goals', 'roadmaps'];
  for (const key of arrayKeys) {
    if (key in rawData) {
      if (!Array.isArray(rawData[key])) {
        return { valid: false, error: `Invalid data type for '${key}': Expected an array.` };
      }
      clean[key] = rawData[key];
    }
  }

  // 2. Numeric metrics
  if ('streak' in rawData) {
    const val = rawData.streak;
    if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) {
      return { valid: false, error: "Invalid data type for 'streak': Expected a non-negative number." };
    }
    clean.streak = Math.floor(val);
  }

  // 3. Object-based maps & configs
  if ('habitGrid' in rawData) {
    const val = rawData.habitGrid;
    if (val !== null && (typeof val !== 'object' || Array.isArray(val))) {
      return { valid: false, error: "Invalid data type for 'habitGrid': Expected an object or null." };
    }
    clean.habitGrid = val;
  }

  if ('todoHistory' in rawData) {
    const val = rawData.todoHistory;
    if (val !== null && (typeof val !== 'object' || Array.isArray(val))) {
      return { valid: false, error: "Invalid data type for 'todoHistory': Expected an object." };
    }
    clean.todoHistory = val;
  }

  // 4. String keys
  if ('calendarMonthKey' in rawData) {
    const val = rawData.calendarMonthKey;
    if (typeof val !== 'string' || val.length > 30) {
      return { valid: false, error: "Invalid data type for 'calendarMonthKey': Expected a string." };
    }
    clean.calendarMonthKey = val;
  }

  // 5. Dynamic roadmap check states: roadmap_checks_*
  for (const [key, val] of Object.entries(rawData)) {
    if (key.startsWith('roadmap_checks_')) {
      if (!/^roadmap_checks_[a-zA-Z0-9_-]{1,64}$/.test(key)) {
        continue; // Discard invalid key format
      }
      if (val !== null && (typeof val !== 'object' || Array.isArray(val))) {
        return { valid: false, error: `Invalid data type for '${key}': Expected an object.` };
      }
      clean[key] = val;
    }
  }

  return { valid: true, data: clean };
}

let cachedClient = null;

function getMongoUri() {
  let uri = process.env.MONGODB_URI;
  if (!uri || uri.includes('<username>') || uri.includes('<cluster>')) {
    try {
      const envPath = path.resolve(process.cwd(), '.env.local');
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        const match = content.match(/^MONGODB_URI=(.*)$/m);
        if (match && match[1]) {
          uri = match[1].trim().replace(/^["']|["']$/g, '');
        }
      }
    } catch (e) {}
  }
  return uri;
}

async function getDb() {
  const uri = getMongoUri();
  if (!uri || uri.includes('<username>') || uri.includes('<cluster>')) {
    throw new Error('MONGODB_URI is not configured.');
  }
  if (!cachedClient) {
    try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch(e) {}
    cachedClient = new MongoClient(uri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
      connectTimeoutMS: 6000,
      socketTimeoutMS: 6000,
      serverSelectionTimeoutMS: 6000,
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

  // --- Check payload size limit (5MB) ---
  const contentLength = req.headers['content-length'];
  if (contentLength && parseInt(contentLength, 10) > MAX_PAYLOAD_BYTES) {
    return res.status(413).json({ error: 'Payload too large. Maximum allowed size is 5MB.' });
  }

  if (req.body && typeof req.body === 'object') {
    const estimatedSize = JSON.stringify(req.body).length;
    if (estimatedSize > MAX_PAYLOAD_BYTES) {
      return res.status(413).json({ error: 'Payload too large. Maximum allowed size is 5MB.' });
    }
  }

  // --- Authenticate user via verified session token ---
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Authentication token is required.' });
  }

  const payload = verifyToken(token);
  if (!payload || !payload.userId) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired token.' });
  }

  const authUserId = payload.userId;

  // --- GET: load user data (scoped strictly to verified authUserId) ---
  if (req.method === 'GET') {
    try {
      const db = await getDb();
      const user = await db.collection('users').findOne(
        { _id: new ObjectId(authUserId) },
        { projection: { data: 1 } }
      );
      if (!user) return res.status(404).json({ error: 'User not found.' });
      return res.status(200).json({ data: user.data || {} });
    } catch (err) {
      console.error('[/api/user/data GET] Error:', err);
      return res.status(500).json({ error: 'Server error.' });
    }
  }

  // --- POST: save user data (scoped strictly to verified authUserId with whitelist validation) ---
  if (req.method === 'POST') {
    const { data } = req.body || {};
    if (!data) {
      return res.status(400).json({ error: 'data is required.' });
    }

    const validation = validateAndSanitizeUserData(data);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    try {
      const db = await getDb();
      await db.collection('users').updateOne(
        { _id: new ObjectId(authUserId) },
        { $set: { data: validation.data, updatedAt: new Date() } }
      );
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('[/api/user/data POST] Error:', err);
      return res.status(500).json({ error: 'Server error.' });
    }
  }

  return res.status(405).json({ error: `Method ${req.method} not allowed.` });
}
