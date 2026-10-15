import jwt, { type SignOptions } from 'jsonwebtoken';

type Environment = Record<string, string | undefined>;

const developmentOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];
const placeholderSecrets = new Set(['replace-with-a-long-random-secret', 'change-me']);

export const isProduction = (env: Environment = process.env) => env.NODE_ENV === 'production';

const isLoopback = (hostname: string) => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);

/**
 * CORS_ORIGIN: comma-separated list of the web app origins, e.g.
 * "https://salon.example.com, https://salon-preview.vercel.app". Spaces and a trailing slash are
 * tolerated; paths, "*" and (in production) plain http are refused, so a typo fails at startup
 * instead of silently blocking the browser.
 */
export const parseCorsOrigins = (value: string | undefined, production: boolean): string[] => {
  const entries = (value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean);
  if (!entries.length) {
    if (production) throw new Error('CORS_ORIGIN must list the web app origin(s) in production, e.g. https://salon.example.com');
    return developmentOrigins;
  }
  const origins = entries.map((entry) => {
    if (entry === '*') throw new Error('CORS_ORIGIN cannot be "*": list the allowed origins explicitly.');
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      throw new Error(`CORS_ORIGIN contains an invalid origin: "${entry}"`);
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
      throw new Error(`CORS_ORIGIN entries must be bare origins such as https://salon.example.com (got "${entry}")`);
    }
    if (production && url.protocol !== 'https:' && !isLoopback(url.hostname)) {
      throw new Error(`CORS_ORIGIN must use https in production (got "${entry}")`);
    }
    return url.origin;
  });
  return [...new Set(origins)];
};

/**
 * TRUST_PROXY: Express "trust proxy" setting, needed behind a reverse proxy (Render, Railway, Nginx…)
 * so that the sign-in limits see the visitor's address instead of the proxy's.
 * Unset/false: no proxy. A number: how many proxies to trust (prefer "1"). "true" trusts every hop,
 * which lets clients spoof X-Forwarded-For unless the API is only reachable through the proxy.
 * Anything else is passed through (e.g. "loopback, 10.0.0.0/8").
 */
export const parseTrustProxy = (value: string | undefined): boolean | number | string => {
  const raw = value?.trim();
  if (!raw || raw === 'false') return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  if (raw === 'true') return true;
  return raw;
};

// Refuses to start with a configuration that would be unsafe or broken; returns warnings to log.
export const checkConfiguration = (env: Environment = process.env) => {
  const production = isProduction(env);
  const warnings: string[] = [];
  const secret = env.JWT_SECRET ?? '';
  if (!secret) throw new Error('JWT_SECRET is missing from the backend environment.');
  if (production && (secret.length < 32 || placeholderSecrets.has(secret))) {
    throw new Error('JWT_SECRET must be a random value of at least 32 characters in production (e.g. `openssl rand -hex 32`).');
  }
  if (production && (!env.DB_PASSWORD || placeholderSecrets.has(env.DB_PASSWORD))) {
    throw new Error('DB_PASSWORD still has its placeholder value.');
  }
  try {
    jwt.sign({}, 'configuration-check', { expiresIn: (env.JWT_EXPIRE || '12h') as SignOptions['expiresIn'] });
  } catch {
    throw new Error(`JWT_EXPIRE is not a valid duration: "${env.JWT_EXPIRE}" (examples: 12h, 30m, 1d).`);
  }
  parseCorsOrigins(env.CORS_ORIGIN, production);
  if (production && env.INITIAL_ADMIN_PASSWORD) {
    warnings.push('INITIAL_ADMIN_PASSWORD is still set: remove it once the administrator account exists.');
  }
  if (env.TRUST_PROXY?.trim() === 'true') {
    warnings.push('TRUST_PROXY=true trusts every X-Forwarded-For hop; prefer the number of proxies (e.g. 1).');
  }
  return warnings;
};
