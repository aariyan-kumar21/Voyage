/**
 * /api/auth/me.js — Vercel Serverless Function
 * GET /api/auth/me
 * Checks the httpOnly cookie and returns the authenticated user info
 */

import dns from 'dns';
import fs from 'fs';
import path from 'path';
import { MongoClient, ObjectId, ServerApiVersion } from 'mongodb';
import { extractToken, verifyToken } from '../_lib/auth.js';

try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch(e) {}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-auth-token',
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
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });

  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ authenticated: false, error: 'No session token.' });
  }

  const payload = verifyToken(token);
  if (!payload || !payload.userId) {
    return res.status(401).json({ authenticated: false, error: 'Invalid or expired session.' });
  }

  try {
    const db = await getDb();
    const user = await db.collection('users').findOne(
      { _id: new ObjectId(payload.userId) },
      { projection: { name: 1, email: 1 } }
    );

    if (!user) {
      return res.status(401).json({ authenticated: false, error: 'User no longer exists.' });
    }

    return res.status(200).json({
      authenticated: true,
      user: {
        userId: user._id.toString(),
        name: user.name,
        email: user.email,
      }
    });
  } catch (err) {
    // If DB has temporary connection issue, return identity from verified token payload
    return res.status(200).json({
      authenticated: true,
      user: {
        userId: payload.userId,
        email: payload.email || '',
      }
    });
  }
}
