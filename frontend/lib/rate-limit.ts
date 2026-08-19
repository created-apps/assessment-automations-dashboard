/**
 * Minimal in-memory fixed-window rate limiter for failed sign-in attempts.
 * Keyed by IP and by email so neither an attacker on one IP nor a distributed
 * attempt against a single account can exceed the threshold.
 *
 * In-memory is adequate for a single-instance internal tool. For multi-instance
 * deployments, swap the Map for Upstash/Redis behind the same interface.
 */

const WINDOW_MS = 15 * 60 * 1000 // 15 minutes
const MAX_ATTEMPTS = 5

type Bucket = { count: number; resetAt: number }
const buckets = new Map<string, Bucket>()

function hit(key: string): boolean {
  const now = Date.now()
  const existing = buckets.get(key)
  if (!existing || existing.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return true
  }
  existing.count += 1
  return existing.count <= MAX_ATTEMPTS
}

/**
 * Returns `true` when the request is allowed to proceed, `false` when the
 * caller has exceeded the limit for either their IP or the target email.
 * Only failed attempts should call {@link registerFailure}; a success should
 * clear the counters via {@link clearAttempts}.
 */
export function isAllowed(ip: string, email: string): boolean {
  const now = Date.now()
  const ipBucket = buckets.get(`ip:${ip}`)
  const emailBucket = buckets.get(`email:${email}`)
  const overIp = ipBucket && ipBucket.resetAt >= now && ipBucket.count > MAX_ATTEMPTS
  const overEmail =
    emailBucket && emailBucket.resetAt >= now && emailBucket.count > MAX_ATTEMPTS
  return !overIp && !overEmail
}

export function registerFailure(ip: string, email: string): void {
  hit(`ip:${ip}`)
  hit(`email:${email}`)
}

export function clearAttempts(ip: string, email: string): void {
  buckets.delete(`ip:${ip}`)
  buckets.delete(`email:${email}`)
}
