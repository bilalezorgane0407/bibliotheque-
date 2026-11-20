import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { GoogleAuthStatus, StudentStatus, UserPublic, UserRole } from '../../shared/types.ts';

export interface GoogleOidcConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  allowedDomain: string | null;
  librarianEmails: Set<string>;
  adminEmails: Set<string>;
  eligibilitySourceUrl: string | null;
  eligibilityEmails: Set<string>;
  requirePreprovisioned: boolean;
}

export interface GoogleUserInfoClaims {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  hd?: string;
}

export interface GoogleAuthResolution {
  user: UserPublic;
  eligibilityVerifiedBySource: boolean;
  requiresLibrarianValidation: boolean;
}

function parseEmailList(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isAcademicGoogleEmail(
  email: string,
  allowedDomain?: string | null,
  hd?: string | null
): boolean {
  const normalizedEmail = email.trim().toLowerCase();
  const domain = normalizedEmail.split('@')[1] || '';
  const hostedDomain = (hd || '').trim().toLowerCase();

  if (allowedDomain) {
    const allowed = allowedDomain.trim().toLowerCase();
    return domain === allowed || hostedDomain === allowed;
  }

  if (domain === 'usmba.ac.ma' || domain === 'est-usmba.ac.ma') {
    return true;
  }
  if (domain.endsWith('.ac.ma') || domain.endsWith('.edu.ma') || domain.endsWith('.edu')) {
    return true;
  }
  if (
    hostedDomain === 'usmba.ac.ma' ||
    hostedDomain === 'est-usmba.ac.ma' ||
    hostedDomain.endsWith('.ac.ma') ||
    hostedDomain.endsWith('.edu.ma')
  ) {
    return true;
  }

  return false;
}

function readFirebaseConfigApiKey(): string | null {
  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (!fs.existsSync(configPath)) return null;
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
      apiKey?: string;
      projectId?: string;
    };
    if (raw.apiKey && raw.projectId) {
      return raw.apiKey.trim();
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Adaptateur d'authentification Google institutionnelle (OAuth 2.0 / OpenID Connect / Firebase Auth).
 * Distingue strictement :
 * 1) la vérification de l'adresse e-mail académique par Google, et
 * 2) la validation du statut d'appartenance à l'EST Fès (effectuée par le personnel autorisé ou une source officielle).
 */
export class GoogleAuthAdapter {
  private readonly env: NodeJS.ProcessEnv;
  private readonly fetchFn: typeof fetch;

  constructor(env: NodeJS.ProcessEnv = process.env, fetchFn: typeof fetch = fetch) {
    this.env = env;
    this.fetchFn = fetchFn;
  }

  public getConfig(): GoogleOidcConfig {
    const clientId = (
      this.env.GOOGLE_CLIENT_ID ||
      this.env.GOOGLE_OAUTH_CLIENT_ID ||
      ''
    ).trim();
    const clientSecret = (
      this.env.GOOGLE_CLIENT_SECRET ||
      this.env.GOOGLE_OAUTH_CLIENT_SECRET ||
      ''
    ).trim();

    const appUrl = (this.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
    const redirectUri = (
      this.env.GOOGLE_REDIRECT_URI ||
      this.env.GOOGLE_OAUTH_REDIRECT_URI ||
      `${appUrl}/api/auth/google/callback`
    ).trim();

    const allowedDomainRaw = (this.env.GOOGLE_ALLOWED_HOSTED_DOMAIN || '').trim().toLowerCase();

    return {
      clientId,
      clientSecret,
      redirectUri,
      allowedDomain: allowedDomainRaw || null,
      librarianEmails: parseEmailList(this.env.LIBRARIAN_EMAILS),
      adminEmails: parseEmailList(this.env.ADMIN_EMAILS),
      eligibilitySourceUrl: (this.env.EST_ELIGIBILITY_SOURCE_URL || '').trim() || null,
      eligibilityEmails: parseEmailList(this.env.EST_ELIGIBILITY_EMAILS),
      requirePreprovisioned: this.env.GOOGLE_REQUIRE_PREPROVISIONED === 'true',
    };
  }

  public isConfigured(): boolean {
    const cfg = this.getConfig();
    return Boolean(cfg.clientId && cfg.clientSecret && cfg.redirectUri);
  }

  public getFirebaseApiKey(): string | null {
    return (this.env.FIREBASE_WEB_API_KEY || '').trim() || readFirebaseConfigApiKey();
  }

  public isFirebaseConfigured(): boolean {
    return Boolean(this.getFirebaseApiKey());
  }

  public isEligibilitySourceConfigured(): boolean {
    const cfg = this.getConfig();
    return Boolean(cfg.eligibilitySourceUrl || cfg.eligibilityEmails.size > 0);
  }

  public getStatus(): GoogleAuthStatus {
    const cfg = this.getConfig();
    const missingVariables: string[] = [];
    if (!cfg.clientId) missingVariables.push('GOOGLE_CLIENT_ID');
    if (!cfg.clientSecret) missingVariables.push('GOOGLE_CLIENT_SECRET');

    const configured = missingVariables.length === 0;
    const firebaseAuthConfigured = this.isFirebaseConfigured();
    const sharedUrl = (this.env.SHARED_APP_URL || '').trim();
    const sharedRedirectUri = sharedUrl
      ? `${sharedUrl.replace(/\/$/, '')}/api/auth/google/callback`
      : null;

    return {
      provider: 'Google Workspace Éducation / USMBA (OAuth 2.0 / OIDC)',
      configured,
      firebaseAuthConfigured,
      clientIdConfigured: Boolean(cfg.clientId),
      redirectUri: cfg.redirectUri,
      sharedRedirectUri,
      allowedDomain: cfg.allowedDomain,
      eligibilitySourceConfigured: this.isEligibilitySourceConfigured(),
      missingVariables,
      recoveryUrl: 'https://accounts.google.com/signin/recovery',
      message:
        configured || firebaseAuthConfigured
          ? 'Connexion avec adresse académique active. La vérification de l’adresse confirme la boîte universitaire ; l’accès aux emprunts nécessite la validation du statut EST Fès par le personnel autorisé.'
          : 'Les identifiants Google OAuth ne sont pas encore configurés dans cet environnement. Renseignez GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET côté serveur pour activer la connexion Google officielle.',
    };
  }

  public buildAuthorizationUrl(state: string, nonce: string): string {
    const cfg = this.getConfig();
    if (!cfg.clientId || !cfg.clientSecret) {
      throw new Error(
        'Connexion Google indisponible : GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET doivent être configurés côté serveur.'
      );
    }

    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      prompt: 'select_account',
      access_type: 'online',
    });

    if (cfg.allowedDomain) {
      params.set('hd', cfg.allowedDomain);
    }

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  public async exchangeCodeForClaims(code: string): Promise<GoogleUserInfoClaims> {
    const cfg = this.getConfig();
    if (!cfg.clientId || !cfg.clientSecret) {
      throw new Error('Identifiants Google OAuth manquants côté serveur.');
    }

    const tokenRes = await this.fetchFn('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: cfg.redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });

    if (!tokenRes.ok) {
      throw new Error('Échec de l’échange du code d’autorisation auprès de Google OAuth.');
    }

    const tokenData = (await tokenRes.json()) as { access_token?: string };
    if (!tokenData.access_token) {
      throw new Error('Jeton d’accès Google absent de la réponse OAuth.');
    }

    const userInfoRes = await this.fetchFn('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!userInfoRes.ok) {
      throw new Error('Impossible de vérifier l’identité auprès du point d’entrée Google OIDC.');
    }

    const claims = (await userInfoRes.json()) as GoogleUserInfoClaims;
    if (!claims.email || !claims.email_verified) {
      throw new Error('Le compte Google retourné ne possède pas d’adresse e-mail vérifiée.');
    }

    return claims;
  }

  public async verifyFirebaseOrGoogleToken(params: {
    idToken?: string;
    accessToken?: string | null;
  }): Promise<GoogleUserInfoClaims> {
    const { idToken, accessToken } = params;
    let claims: GoogleUserInfoClaims | null = null;

    if (accessToken) {
      const userInfoRes = await this.fetchFn('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (userInfoRes.ok) {
        const data = (await userInfoRes.json()) as Partial<GoogleUserInfoClaims>;
        if (data.email && data.email_verified) {
          claims = {
            sub: data.sub || data.email,
            email: data.email,
            email_verified: Boolean(data.email_verified),
            name: data.name,
            hd: data.hd,
          };
        }
      }
    }

    if (!claims && idToken) {
      const apiKey = this.getFirebaseApiKey();
      if (!apiKey) {
        throw new Error('Vérification Firebase non configurée côté serveur.');
      }
      const lookupRes = await this.fetchFn(
        `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken }),
        }
      );
      if (!lookupRes.ok) {
        throw new Error('Jeton Google / Firebase invalide ou expiré.');
      }
      const lookupData = (await lookupRes.json()) as {
        users?: Array<{
          localId?: string;
          email?: string;
          emailVerified?: boolean;
          displayName?: string;
        }>;
      };
      const fbUser = lookupData.users?.[0];
      if (!fbUser?.email || !fbUser.emailVerified) {
        throw new Error('Le compte Google retourné ne possède pas d’adresse e-mail vérifiée.');
      }
      claims = {
        sub: fbUser.localId || fbUser.email,
        email: fbUser.email,
        email_verified: true,
        name: fbUser.displayName,
      };
    }

    if (!claims) {
      throw new Error('Impossible de vérifier votre compte Google auprès des serveurs Google.');
    }

    return claims;
  }

  private async checkExternalEstEligibility(email: string): Promise<boolean | null> {
    const cfg = this.getConfig();
    if (cfg.eligibilityEmails.has(email.toLowerCase())) {
      return true;
    }

    if (!cfg.eligibilitySourceUrl) {
      return null;
    }

    try {
      const url = new URL(cfg.eligibilitySourceUrl);
      url.searchParams.set('email', email.toLowerCase());
      const res = await this.fetchFn(url.toString(), { method: 'GET' });
      if (!res.ok) return null;
      const data = (await res.json()) as { eligible?: boolean; institution?: string };
      if (typeof data.eligible === 'boolean') {
        return data.eligible && (!data.institution || data.institution === 'EST Fès');
      }
      return null;
    } catch {
      return null;
    }
  }

  public async resolveProvisionedUser(
    db: Database.Database,
    claims: GoogleUserInfoClaims,
    now: Date = new Date(),
    options?: { requireAcademicEmail?: boolean }
  ): Promise<GoogleAuthResolution> {
    const cfg = this.getConfig();
    const email = claims.email.trim().toLowerCase();

    if (cfg.allowedDomain) {
      const emailDomain = email.split('@')[1] || '';
      const hd = (claims.hd || '').toLowerCase();
      if (emailDomain !== cfg.allowedDomain && hd !== cfg.allowedDomain) {
        throw new Error(
          `Seuls les comptes Google administrés par le domaine ${cfg.allowedDomain} sont acceptés.`
        );
      }
    } else if (
      options?.requireAcademicEmail &&
      this.env.ALLOW_ALL_GOOGLE_ACCOUNTS !== 'true' &&
      !isAcademicGoogleEmail(email, cfg.allowedDomain, claims.hd)
    ) {
      throw new Error(
        'Seules les adresses Gmail académiques (ex. @usmba.ac.ma, @est-usmba.ac.ma ou domaine universitaire .ac.ma) sont autorisées.'
      );
    }

    const existing = db
      .prepare(`SELECT * FROM users WHERE LOWER(email) = LOWER(?)`)
      .get(email) as
      | (UserPublic & {
          passwordHash: string;
          isDemo?: number;
          emailVerified?: number;
          isAdmin?: number;
        })
      | undefined;

    if (!existing && cfg.requirePreprovisioned) {
      throw new Error(
        'Ce compte Google n’est pas pré-provisionné dans le registre de la bibliothèque EST Fès. Contactez l’administration.'
      );
    }

    const externalCheck = await this.checkExternalEstEligibility(email);
    const isAdminEmail = cfg.adminEmails.has(email);
    const isProvisionedLibrarian = cfg.librarianEmails.has(email) || isAdminEmail;

    if (existing) {
      const nextRole: UserRole =
        isProvisionedLibrarian || existing.role === 'bibliothecaire'
          ? 'bibliothecaire'
          : 'membre';
      const nextIsAdmin = isAdminEmail || Boolean(existing.isAdmin) ? 1 : 0;

      // Préserver le statut EST existant (ou le passer à 'verifie' si confirmé par la source officielle / personnel)
      let nextStudentStatus: StudentStatus = existing.studentStatus;
      if (existing.studentStatus !== 'suspendu' && (externalCheck === true || isProvisionedLibrarian)) {
        nextStudentStatus = 'verifie';
      }

      const eligibilityVerifiedBySource =
        externalCheck === true || nextStudentStatus === 'verifie';

      db.prepare(
        `UPDATE users
         SET fullName = ?, role = ?, studentStatus = ?, emailVerified = 1, isAdmin = ?, authSource = 'google_oidc', isDemo = 0
         WHERE id = ?`
      ).run(
        claims.name?.trim() || existing.fullName,
        nextRole,
        nextStudentStatus,
        nextIsAdmin,
        existing.id
      );

      const updated = db
        .prepare(
          `SELECT id, fullName, email, role, institution, studentStatus, accountStatus, emailVerified, isAdmin, cne, filiere, authSource, isDemo, createdAt
           FROM users WHERE id = ?`
        )
        .get(existing.id) as UserPublic & {
        isDemo?: number;
        emailVerified?: number;
        isAdmin?: number;
      };

      return {
        user: {
          ...updated,
          emailVerified: Boolean(updated.emailVerified),
          isAdmin: Boolean(updated.isAdmin),
          isDemo: Boolean(updated.isDemo),
        },
        eligibilityVerifiedBySource,
        requiresLibrarianValidation: nextStudentStatus !== 'verifie',
      };
    }

    // Nouvel utilisateur : l'adresse académique est vérifiée par Google,
    // mais le statut EST Fès reste en attente sauf validation par la source officielle ou liste du personnel.
    const role: UserRole = isProvisionedLibrarian ? 'bibliothecaire' : 'membre';
    const isAdmin = isAdminEmail ? 1 : 0;
    const eligibilityVerifiedBySource = externalCheck === true || isProvisionedLibrarian;
    const studentStatus: StudentStatus = eligibilityVerifiedBySource ? 'verifie' : 'en_attente';
    const domain = email.split('@')[1] || '';
    const institution =
      domain === 'est-usmba.ac.ma'
        ? 'EST Fès'
        : domain === 'usmba.ac.ma'
          ? 'USMBA'
          : claims.hd || domain || 'USMBA';
    const userId = `usr-${crypto.randomUUID().slice(0, 12)}`;
    const unguessablePlaceholderHash = `google_oidc:${crypto.randomBytes(32).toString('hex')}`;

    db.prepare(
      `INSERT INTO users (id, fullName, email, passwordHash, role, institution, studentStatus, accountStatus, emailVerified, isAdmin, cne, filiere, authSource, isDemo, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'actif', 1, ?, NULL, NULL, 'google_oidc', 0, ?)`
    ).run(
      userId,
      claims.name?.trim() || email.split('@')[0],
      email,
      unguessablePlaceholderHash,
      role,
      institution,
      studentStatus,
      isAdmin,
      now.toISOString()
    );

    const created = db
      .prepare(
        `SELECT id, fullName, email, role, institution, studentStatus, accountStatus, emailVerified, isAdmin, cne, filiere, authSource, isDemo, createdAt
         FROM users WHERE id = ?`
      )
      .get(userId) as UserPublic & {
      isDemo?: number;
      emailVerified?: number;
      isAdmin?: number;
    };

    return {
      user: {
        ...created,
        emailVerified: Boolean(created.emailVerified),
        isAdmin: Boolean(created.isAdmin),
        isDemo: Boolean(created.isDemo),
      },
      eligibilityVerifiedBySource,
      requiresLibrarianValidation: studentStatus !== 'verifie',
    };
  }
}

export const googleAuthAdapter = new GoogleAuthAdapter();
