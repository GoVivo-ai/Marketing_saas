/**
 * In-memory fixed-window rate limiter. State is per server instance: it
 * resets on cold starts and is not shared across concurrent instances, so
 * treat it as a brake on abuse (brute force, cost-running loops), not an
 * exact quota. Swap for a Redis/Upstash-backed limiter if exact global
 * limits ever matter.
 */
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

/** Returns true when the call is allowed, false when the key is over budget. */
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();

  if (buckets.size > MAX_BUCKETS) {
    for (const [k, v] of buckets) if (now >= v.resetAt) buckets.delete(k);
  }

  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count++;
  return bucket.count <= max;
}
