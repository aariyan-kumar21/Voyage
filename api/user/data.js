/**
 * /api/user/data.js — Vercel Serverless Function
 *
 * GET  /api/user/data?userId=xxx  → returns { data } for that user
 * POST /api/user/data             → body: { userId, data } — upserts data field
 */

import dns from 'dns';
try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch(e) {}

import fs from 'fs';
import path from 'path';
import { MongoClient, ObjectId, ServerApiVersion } from 'mongodb';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

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

  // --- GET: load user data ---
  if (req.method === 'GET') {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId is required.' });

    try {
      const db = await getDb();
      const user = await db.collection('users').findOne(
        { _id: new ObjectId(userId) },
        { projection: { data: 1 } }
      );
      if (!user) return res.status(404).json({ error: 'User not found.' });
      return res.status(200).json({ data: user.data || {} });
    } catch (err) {
      console.error('[/api/user/data GET] Error:', err);
      return res.status(500).json({ error: 'Server error.' });
    }
  }

  // --- POST: save user data ---
  if (req.method === 'POST') {
    const { userId, data } = req.body || {};
    if (!userId || !data) {
      return res.status(400).json({ error: 'userId and data are required.' });
    }

    try {
      const db = await getDb();
      await db.collection('users').updateOne(
        { _id: new ObjectId(userId) },
        { $set: { data, updatedAt: new Date() } }
      );
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('[/api/user/data POST] Error:', err);
      return res.status(500).json({ error: 'Server error.' });
    }
  }

  return res.status(405).json({ error: `Method ${req.method} not allowed.` });
}
