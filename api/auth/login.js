/**
 * /api/auth/login.js — Vercel Serverless Function
 * POST /api/auth/login
 * Body: { email, password }
 * Returns: { userId, name }
 */

import dns from 'dns';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { MongoClient, ServerApiVersion } from 'mongodb';
import { signToken, buildAuthCookie } from '../_lib/auth.js';
import { getClientIp, checkRateLimit, applyRateLimitHeaders } from '../_lib/ratelimit.js';

try { dns.setServers(['8.8.8.8', '1.1.1.1']); } catch(e) {}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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
    throw new Error('MONGODB_URI is not configured. Please set it in your .env.local file or Vercel environment variables.');
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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  // Rate Limiting: 10 attempts per 15 minutes per IP
  const clientIp = getClientIp(req);
  const rateLimit = await checkRateLimit({
    key: `login:${clientIp}`,
    limit: 10,
    windowSeconds: 15 * 60,
  });

  applyRateLimitHeaders(res, {
    limit: 10,
    remaining: rateLimit.remaining,
    resetInSeconds: rateLimit.resetInSeconds,
  });

  if (!rateLimit.allowed) {
    return res.status(429).json({
      error: `Too many login attempts. Please wait ${Math.ceil(rateLimit.resetInSeconds / 60)} minute(s) and try again.`,
    });
  }

  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const db = await getDb();
    const users = db.collection('users');

    const user = await users.findOne({ email: email.toLowerCase().trim() });

    let match = false;
    if (user && user.passwordHash) {
      match = await bcrypt.compare(password, user.passwordHash);
    } else {
      // Constant-time comparison to prevent timing-based user enumeration
      await bcrypt.compare(password, '$2b$10$123456789012345678901234567890123456789012345678901234');
    }

    if (!user || !match) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = signToken({
      userId: user._id.toString(),
      email: user.email,
    });

    res.setHeader('Set-Cookie', buildAuthCookie(token));

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
