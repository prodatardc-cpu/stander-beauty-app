import jwt, { type SignOptions } from 'jsonwebtoken';

const algorithm = 'HS256';
const defaultLifetime = '12h';
const defaultSessionMaxDays = 7;

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is missing from the backend environment.');
  }
  return secret;
};

const sessionMaxAgeSeconds = () => {
  const days = Number(process.env.SESSION_MAX_DAYS ?? defaultSessionMaxDays);
  return (Number.isFinite(days) && days > 0 ? days : defaultSessionMaxDays) * 24 * 60 * 60;
};

type TokenSubject = { id: string; email: string; role: string; authVersion: number };
export type AuthClaims = { userId: string; tokenVersion: number; sessionStart: number };

// `sessionStart` is carried over when GET /auth/me refreshes the token, so a stolen token
// cannot be renewed beyond SESSION_MAX_DAYS after the original sign-in.
export const createAuthToken = (user: TokenSubject, sessionStart = Math.floor(Date.now() / 1000)) =>
  jwt.sign(
    { id: user.id, email: user.email, role: user.role, tokenVersion: user.authVersion, sessionStart },
    getJwtSecret(),
    { algorithm, expiresIn: (process.env.JWT_EXPIRE || defaultLifetime) as SignOptions['expiresIn'] }
  );

export const verifyAuthToken = (token: string): AuthClaims | null => {
  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(token, getJwtSecret(), { algorithms: [algorithm] });
  } catch {
    return null;
  }
  if (typeof payload === 'string') return null;
  const userId = typeof payload.id === 'string' ? payload.id : typeof payload.sub === 'string' ? payload.sub : null;
  // Tokens issued before sessionStart existed fall back to their issue date.
  const sessionStart = Number(payload.sessionStart ?? payload.iat);
  if (!userId || !Number.isFinite(sessionStart) || Date.now() / 1000 - sessionStart > sessionMaxAgeSeconds()) return null;
  return { userId, tokenVersion: Number(payload.tokenVersion ?? 0), sessionStart };
};
