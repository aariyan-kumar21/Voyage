/**
 * api/_lib/auth.js — Server-side Token Creation, Verification, and Cookie Handling
 *
 * Provides cryptographically secure HMAC-SHA256 signed tokens (JWT format)
 * using Node's built-in crypto module, with httpOnly cookie encapsulation.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

function getSecret() {
  let secret = process.env.JWT_SECRET || process.env.AUTH_SECRET;
  if (!secret) {
    try {
      const envPath = path.resolve(process.cwd(), '.env.local');
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        const match = content.match(/^(?:JWT_SECRET|AUTH_SECRET)=(.*)$/m);
        if (match && match[1]) {
          secret = match[1].trim().replace(/^["']|["']$/g, '');
        }
      }
    } catch (e) {}
  }
  // Fallback to MONGODB_URI or internal key if JWT_SECRET is not explicitly defined
  return secret || process.env.MONGODB_URI || 'voyage-internal-jwt-signature-secret-2026';
}

function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str) {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  return Buffer.from(base64, 'base64').toString('utf8');
}

/**
 * Signs a payload with HMAC-SHA256 and returns a standard JWT string.
 * Default expiration: 30 days.
 */
export function signToken(payload, expiresInSeconds = 30 * 24 * 60 * 60) {
  const secret = getSecret();
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64url');

  return `${signingInput}.${signature}`;
}

/**
 * Verifies a JWT token's format, signature, and expiration time.
 * Returns the decoded payload object if valid, or null if invalid/expired.
 */
export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, signature] = parts;
  const secret = getSecret();
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64url');

  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (sigBuffer.length !== expectedBuffer.length) return null;
  if (!crypto.timingSafeEqual(sigBuffer, expectedBuffer)) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return null; // Expired
    }
    return payload;
  } catch (e) {
    return null;
  }
}

/**
 * Builds an httpOnly, Secure, SameSite=Lax Set-Cookie header for session persistence.
 */
export function buildAuthCookie(token, maxAgeSeconds = 30 * 24 * 60 * 60) {
  return `voyage_token=${token}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax; Secure`;
}

/**
 * Builds an expired Set-Cookie header to clear the auth session cookie.
 */
export function buildClearAuthCookie() {
  return `voyage_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`;
}

/**
 * Extracts session token from incoming request:
 * 1. Checks httpOnly cookie header (`voyage_token`)
 * 2. Checks Authorization Bearer header as fallback
 * 3. Checks x-auth-token header as fallback
 */
export function extractToken(req) {
  // 1. Prioritize httpOnly cookie
  const cookieHeader = req.headers?.cookie || req.headers?.Cookie;
  if (cookieHeader && typeof cookieHeader === 'string') {
    const match = cookieHeader.match(/(?:^|;\s*)voyage_token=([^;]+)/);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  // 2. Authorization Bearer fallback
  const authHeader = req.headers?.authorization || req.headers?.Authorization;
  if (authHeader && typeof authHeader === 'string') {
    if (authHeader.toLowerCase().startsWith('bearer ')) {
      return authHeader.slice(7).trim();
    }
    return authHeader.trim();
  }

  // 3. Custom header fallback
  if (req.headers && req.headers['x-auth-token']) {
    return String(req.headers['x-auth-token']).trim();
  }

  return null;
}
