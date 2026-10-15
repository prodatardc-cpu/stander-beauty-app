import type { NextFunction, Request, Response } from 'express';

type Counter = { failures: number; resetAt: number };

type LoginRateLimitOptions = {
  windowMs?: number;
  maxPerAccountAndAddress?: number;
  maxPerAccount?: number;
  maxPerAddress?: number;
  maxEntries?: number;
};

/**
 * Brute-force protection for POST /auth/login.
 *
 * Failed sign-ins are counted per address + account, per account (distributed guessing) and per
 * address (password spraying). Once a limit is reached, every attempt gets the same 429 until the
 * window ends, whether the password is right or not and whether the account exists or not, so the
 * answer reveals nothing about the account.
 *
 * Counters are kept in memory: each API instance counts on its own and a restart resets them.
 */
export const createLoginRateLimiter = ({
  windowMs = 15 * 60 * 1000,
  maxPerAccountAndAddress = 5,
  maxPerAccount = 10,
  maxPerAddress = 30,
  maxEntries = 10_000,
}: LoginRateLimitOptions = {}) => {
  const counters = new Map<string, Counter>();

  const active = (key: string, now: number) => {
    const counter = counters.get(key);
    return counter && counter.resetAt > now ? counter : undefined;
  };

  const prune = (now: number) => {
    for (const [key, counter] of counters) {
      if (counter.resetAt <= now) counters.delete(key);
    }
    // Still too many keys (a flood of random e-mails): forget the oldest ones first.
    for (const key of counters.keys()) {
      if (counters.size <= maxEntries) break;
      counters.delete(key);
    }
  };

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const address = req.ip || req.socket.remoteAddress || 'unknown';
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 254) : '';
    const limits: [string, number][] = [[`address:${address}`, maxPerAddress]];
    if (email) limits.push([`account:${email}`, maxPerAccount], [`pair:${address}|${email}`, maxPerAccountAndAddress]);

    const exhausted = limits
      .map(([key, max]) => ({ counter: active(key, now), max }))
      .filter((entry): entry is { counter: Counter; max: number } => Boolean(entry.counter && entry.counter.failures >= entry.max));
    if (exhausted.length) {
      const retryAfterMs = Math.max(...exhausted.map(({ counter }) => counter.resetAt)) - now;
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
      return res.status(429).json({ error: 'Too many login attempts' });
    }

    // Count the attempt before it runs, so that a burst of parallel requests cannot exceed the
    // limits, and give it back once it turns out not to be a failed sign-in.
    const counted = limits.map(([key]) => {
      const counter = active(key, now) ?? { failures: 0, resetAt: now + windowMs };
      counter.failures += 1;
      counters.set(key, counter);
      return counter;
    });
    if (counters.size > maxEntries) prune(now);

    res.on('finish', () => {
      if (res.statusCode === 401) return;
      for (const counter of counted) counter.failures = Math.max(0, counter.failures - 1);
      // A successful sign-in clears this address's failures for the account (not the global counters).
      if (res.statusCode < 400 && email) counters.delete(`pair:${address}|${email}`);
    });
    next();
  };
};
