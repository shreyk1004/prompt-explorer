type RateRecord = { count: number; resetAtMs: number };

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 4; // <5 req/min/IP as per user rule

const ipToRecord = new Map<string, RateRecord>();

export function checkRateLimit(ip: string): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const now = Date.now();
  const record = ipToRecord.get(ip);

  if (!record || now > record.resetAtMs) {
    ipToRecord.set(ip, { count: 1, resetAtMs: now + RATE_LIMIT_WINDOW_MS });
    return { ok: true };
  }

  if (record.count >= RATE_LIMIT_MAX) {
    const retryAfterSeconds = Math.max(1, Math.ceil((record.resetAtMs - now) / 1000));
    return { ok: false, retryAfterSeconds };
  }

  record.count += 1;
  return { ok: true };
}

