/**
 * api/_lib/ratelimit.js — Sliding Window Rate Limiter for Serverless Functions
 *
 * Implements sliding-window rate limiting with in-memory caching and optional
 * MongoDB atomic persistence. Sets standard RateLimit headers (Retry-After,
 * X-RateLimit-Limit, X-RateLimit-Remaining).
 */

const memoryStore = new Map();

// Periodic in-memory garbage collector to prevent memory growth
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of memoryStore.entries()) {
    if (now > record.resetAt) {
      memoryStore.delete(key);
    }
  }
}, 60000);

/**
 * Extracts client IP address from serverless request headers.
 */
export function getClientIp(req) {
  const forwarded = req.headers?.['x-forwarded-for'] || req.headers?.['X-Forwarded-For'];
  if (forwarded && typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  const realIp = req.headers?.['x-real-ip'] || req.headers?.['X-Real-IP'];
  if (realIp && typeof realIp === 'string') {
    return realIp.trim();
  }
  return req.socket?.remoteAddress || '127.0.0.1';
}

/**
 * Checks if a request exceeds rate limits.
 *
 * @param {Object} options
 * @param {string} options.key - Unique key (e.g. `login:192.168.1.1` or `chat:user123`)
 * @param {number} options.limit - Max requests allowed in the window
 * @param {number} options.windowSeconds - Time window in seconds
 * @param {Object} [options.db] - Optional MongoDB database instance for cross-instance persistence
 * @returns {Promise<{ allowed: boolean, remaining: number, resetInSeconds: number }>}
 */
export async function checkRateLimit({ key, limit, windowSeconds, db = null }) {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;

  // 1. Fast In-Memory Check
  let memRecord = memoryStore.get(key);
  if (!memRecord || now > memRecord.resetAt) {
    memRecord = { count: 1, resetAt: now + windowMs };
    memoryStore.set(key, memRecord);
  } else {
    memRecord.count += 1;
  }

  let currentCount = memRecord.count;
  let resetAtMs = memRecord.resetAt;

  // 2. Cross-instance MongoDB Persistence (if db is connected)
  if (db) {
    try {
      const col = db.collection('rate_limits');
      const doc = await col.findOneAndUpdate(
        { _id: key, resetAt: { $gt: new Date(now) } },
        { $inc: { count: 1 } },
        { returnDocument: 'after' }
      );

      if (doc && doc.count) {
        currentCount = Math.max(currentCount, doc.count);
        resetAtMs = doc.resetAt ? doc.resetAt.getTime() : resetAtMs;
      } else {
        const newReset = new Date(now + windowMs);
        await col.updateOne(
          { _id: key },
          { $set: { count: currentCount, resetAt: newReset } },
          { upsert: true }
        );
        resetAtMs = newReset.getTime();
      }
    } catch (e) {
      // Graceful fallback to memoryStore if MongoDB is unavailable
    }
  }

  const resetInSeconds = Math.max(1, Math.ceil((resetAtMs - now) / 1000));
  const remaining = Math.max(0, limit - currentCount);
  const allowed = currentCount <= limit;

  return {
    allowed,
    remaining,
    resetInSeconds,
  };
}

/**
 * Helper to apply rate-limit response headers and return a 429 if exceeded.
 */
export function applyRateLimitHeaders(res, { limit, remaining, resetInSeconds }) {
  res.setHeader('X-RateLimit-Limit', String(limit));
  res.setHeader('X-RateLimit-Remaining', String(remaining));
  res.setHeader('X-RateLimit-Reset', String(resetInSeconds));
  if (remaining === 0) {
    res.setHeader('Retry-After', String(resetInSeconds));
  }
}
