// Checks the API address baked into the web app at build time (VITE_API_URL).
// Used by vite.config.ts: a production build fails with a clear message instead of shipping an app
// that would call http://localhost:3000, i.e. each visitor's own computer.

export const developmentApiUrl = 'http://localhost:3000/api';

type ApiUrlEnvironment = { VITE_API_URL?: string; VITE_ALLOW_LOCAL_API?: string };

const isLocalHost = (hostname: string) =>
  ['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(hostname) || hostname.endsWith('.localhost');

export const resolveApiUrl = (env: ApiUrlEnvironment, { production }: { production: boolean }): string => {
  const value = env.VITE_API_URL?.trim();
  if (!value) {
    if (production) {
      throw new Error(
        'VITE_API_URL is required to build the web app for production (e.g. VITE_API_URL=https://api.example.com/api). ' +
        'Without it the app would call http://localhost:3000 on each visitor\'s computer.'
      );
    }
    return developmentApiUrl;
  }

  // Same-origin path, e.g. "/api" when the hosting platform proxies it to the API.
  if (value.startsWith('/') && !value.startsWith('//')) return value.replace(/\/+$/, '') || '/';

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`VITE_API_URL is not a valid URL: "${value}"`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`VITE_API_URL must be an http(s) URL or a path starting with "/" (got "${value}")`);
  }
  if (production) {
    const local = isLocalHost(url.hostname);
    if (local && env.VITE_ALLOW_LOCAL_API !== 'true') {
      throw new Error(
        `VITE_API_URL points to ${url.host}, which is each visitor's own computer once deployed. ` +
        'Use the public API address (VITE_ALLOW_LOCAL_API=true is only for previewing a build on this machine).'
      );
    }
    if (!local && url.protocol !== 'https:') {
      throw new Error(`VITE_API_URL must use https in production, otherwise tokens and data travel in clear text (got "${value}")`);
    }
  }
  return url.href.replace(/\/+$/, '');
};
