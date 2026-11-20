import crypto from 'node:crypto';
import type { CookieOptions, Request, Response, NextFunction } from 'express';
import type Database from 'better-sqlite3';
import type { UserPublic } from '../../shared/types.ts';

const COOKIE_NAME = 'biblioest_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function getSessionSecret(): string {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16) {
    return process.env.SESSION_SECRET;
  }
  return crypto
    .createHash('sha256')
    .update(process.cwd() + '_biblioest_dev_session_key')
    .digest('hex');
}

export interface SessionPayload {
  userId: string;
  isDemoSession?: boolean;
  exp: number;
}

export function createSessionToken(userId: string, isDemoSession = false): string {
  const payload: SessionPayload = {
    userId,
    ...(isDemoSession ? { isDemoSession: true } : {}),
    exp: Date.now() + SESSION_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  if (!encoded || !sig) return null;

  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (!payload.userId || typeof payload.exp !== 'number' || payload.exp < Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const result: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const rawValue = part.slice(idx + 1).trim();
    let value = rawValue;
    try {
      value = decodeURIComponent(rawValue);
    } catch {
      value = rawValue;
    }
    if (key) result[key] = value;
  }
  return result;
}

function isFromTrustedProxy(req: Request): boolean {
  const trustFn = req.app?.get?.('trust proxy fn') as ((addr: string, hop: number) => boolean) | undefined;
  const remoteAddr = req.socket?.remoteAddress;
  if (typeof trustFn === 'function' && remoteAddr) {
    return trustFn(remoteAddr, 0);
  }
  return false;
}

function getForwardedHeaderProto(forwarded: string | string[] | undefined): string | null {
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (!raw) return null;
  const firstHop = raw.split(',')[0];
  const match = /proto\s*=\s*"?(https?)"?/i.exec(firstHop);
  return match ? match[1].toLowerCase() : null;
}

function matchesHttpsAppUrl(req: Request, trustedProxy: boolean): boolean {
  const appUrlRaw = process.env.APP_URL;
  if (!appUrlRaw || !appUrlRaw.startsWith('https://')) return false;
  try {
    const expectedHost = new URL(appUrlRaw).host.toLowerCase();
    const forwardedHost = trustedProxy ? req.headers['x-forwarded-host'] : undefined;
    const rawHost = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost || req.headers.host;
    if (typeof rawHost !== 'string') return false;
    const requestHost = rawHost.split(',')[0].trim().toLowerCase();
    return Boolean(requestHost) && requestHost === expectedHost;
  } catch {
    return false;
  }
}

export function isHttpsRequest(req: Request): boolean {
  if (req.secure) return true;
  if (!isFromTrustedProxy(req)) return false;

  const rfcProto = getForwardedHeaderProto(req.headers.forwarded);
  if (rfcProto === 'https') return true;

  const sslHeader = req.headers['x-forwarded-ssl'];
  if (typeof sslHeader === 'string' && sslHeader.toLowerCase() === 'on') return true;

  const schemeHeader = req.headers['x-forwarded-scheme'];
  if (typeof schemeHeader === 'string' && schemeHeader.toLowerCase() === 'https') return true;

  return matchesHttpsAppUrl(req, true);
}

export function isCrossSiteIframeContext(req: Request): boolean {
  if (process.env.COOKIE_SAMESITE === 'none') return true;
  const embedHeader = req.headers['x-biblioest-embed'];
  if (embedHeader === 'cross-site-iframe') return true;
  const fetchDest = req.headers['sec-fetch-dest'];
  if (fetchDest === 'iframe') return true;
  return false;
}

export function buildCookieOptions(
  req: Request,
  maxAge?: number
): CookieOptions & { partitioned?: boolean } {
  const https = isHttpsRequest(req);
  if (!https) {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
      ...(maxAge !== undefined ? { maxAge } : {}),
    };
  }

  if (isCrossSiteIframeContext(req)) {
    return {
      httpOnly: true,
      sameSite: 'none',
      secure: true,
      partitioned: true,
      path: '/',
      ...(maxAge !== undefined ? { maxAge } : {}),
    };
  }

  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    ...(maxAge !== undefined ? { maxAge } : {}),
  };
}

export function setSessionCookie(
  req: Request,
  res: Response,
  userId: string,
  isDemoSession = false
): void {
  const token = createSessionToken(userId, isDemoSession);
  res.cookie(COOKIE_NAME, token, buildCookieOptions(req, SESSION_TTL_MS));
}

export function clearSessionCookie(req: Request, res: Response): void {
  res.clearCookie(COOKIE_NAME, buildCookieOptions(req));
}

export function hasSessionCookie(req: Request): boolean {
  const cookies = parseCookies(req.headers.cookie);
  return Boolean(cookies[COOKIE_NAME]);
}

export interface AuthenticatedRequest extends Request {
  user?: UserPublic | null;
  isDemoSession?: boolean;
}

export function createAuthMiddleware(
  realDb: Database.Database,
  demoDb?: Database.Database,
  isDemoEnabled: () => boolean = () => true
) {
  const userSelectSql = `
    SELECT id, fullName, email, role, institution, studentStatus, accountStatus, emailVerified, isAdmin, cne, filiere, authSource, isDemo, createdAt
    FROM users
    WHERE id = ?
  `;
  const getRealUserStmt = realDb.prepare(userSelectSql);
  const getDemoUserStmt = (demoDb || realDb).prepare(userSelectSql);

  function attachUser(req: AuthenticatedRequest, _res: Response, next: NextFunction): void {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[COOKIE_NAME];
    if (!token) {
      req.user = null;
      req.isDemoSession = false;
      next();
      return;
    }

    const payload = verifySessionToken(token);
    if (!payload) {
      req.user = null;
      req.isDemoSession = false;
      next();
      return;
    }

    if (payload.isDemoSession) {
      if (!isDemoEnabled()) {
        req.user = null;
        req.isDemoSession = false;
        next();
        return;
      }
      const row = getDemoUserStmt.get(payload.userId) as
        | (UserPublic & { isDemo?: number | boolean; emailVerified?: number | boolean; isAdmin?: number | boolean })
        | undefined;
      req.user = row
        ? {
            ...row,
            emailVerified: row.emailVerified === undefined ? true : Boolean(row.emailVerified),
            isAdmin: Boolean(row.isAdmin),
            isDemo: true,
          }
        : null;
      req.isDemoSession = Boolean(req.user);
      next();
      return;
    }

    const row = getRealUserStmt.get(payload.userId) as
      | (UserPublic & { isDemo?: number | boolean; emailVerified?: number | boolean; isAdmin?: number | boolean })
      | undefined;
    req.user = row
      ? {
          ...row,
          emailVerified: row.emailVerified === undefined ? true : Boolean(row.emailVerified),
          isAdmin: Boolean(row.isAdmin),
          isDemo: Boolean(row.isDemo),
        }
      : null;
    req.isDemoSession = false;
    next();
  }

  function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    if (!req.user) {
      res.status(401).json({
        error: 'Authentification requise. Veuillez vous connecter avec votre compte académique.',
        code: 'AUTH_REQUIRED',
      });
      return;
    }
    next();
  }

  function requireLibrarian(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    if (!req.user) {
      res.status(401).json({
        error: 'Authentification requise.',
        code: 'AUTH_REQUIRED',
      });
      return;
    }
    if (req.user.role !== 'bibliothecaire') {
      res.status(403).json({
        error: 'Accès refusé. Cet espace est strictement réservé aux bibliothécaires habilités de l’EST Fès.',
        code: 'FORBIDDEN_ROLE',
      });
      return;
    }
    next();
  }

  function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    if (!req.user) {
      res.status(401).json({
        error: 'Authentification requise.',
        code: 'AUTH_REQUIRED',
      });
      return;
    }
    if (req.user.role !== 'bibliothecaire' || !req.user.isAdmin) {
      res.status(403).json({
        error: 'Accès refusé. Cette action est réservée à l’administrateur de la bibliothèque.',
        code: 'FORBIDDEN_ADMIN',
      });
      return;
    }
    next();
  }

  return { attachUser, requireAuth, requireLibrarian, requireAdmin };
}
