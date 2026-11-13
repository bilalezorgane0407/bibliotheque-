import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { GoogleAuthStatus, StudentStatus, UserPublic, UserRole } from '../../shared/types.ts';

export interface GoogleOidcConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  allowedDomain: string | null;
  librarianEmails: Set<string>;
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

/**
 * Adaptateur d'authentification Google institutionnelle (OAuth 2.0 / OpenID Connect).
 * - Ne simule jamais une authentification Google.
 * - N'expose jamais clientSecret côté client.
 * - Distingue strictement l'identité Google vérifiée de l'appartenance vérifiée à l'EST Fès.
 */
export class GoogleAuthAdapter {
  private readonly env: NodeJS.ProcessEnv;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.env = env;
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
      eligibilitySourceUrl: (this.env.EST_ELIGIBILITY_SOURCE_URL || '').trim() || null,
      eligibilityEmails: parseEmailList(this.env.EST_ELIGIBILITY_EMAILS),
      requirePreprovisioned: this.env.GOOGLE_REQUIRE_PREPROVISIONED === 'true',
    };
  }

  public isConfigured(): boolean {
    const cfg = this.getConfig();
    return Boolean(cfg.clientId && cfg.clientSecret && cfg.redirectUri);
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
    const sharedUrl = (this.env.SHARED_APP_URL || '').trim();
    const sharedRedirectUri = sharedUrl
      ? `${sharedUrl.replace(/\/$/, '')}/api/auth/google/callback`
      : null;

    return {
      provider: 'Google Workspace Éducation / USMBA (OAuth 2.0 / OIDC)',
      configured,
      clientIdConfigured: Boolean(cfg.clientId),
      redirectUri: cfg.redirectUri,
      sharedRedirectUri,
      allowedDomain: cfg.allowedDomain,
      eligibilitySourceConfigured: this.isEligibilitySourceConfigured(),
      missingVariables,
      recoveryUrl: 'https://accounts.google.com/signin/recovery',
      message: configured
        ? this.isEligibilitySourceConfigured()
          ? 'Authentification Google et source d’éligibilité EST Fès configurées.'
          : 'Authentification Google configurée, mais aucune source externe d’éligibilité EST Fès n’est connectée : les nouveaux comptes nécessiteront une validation par un bibliothécaire.'
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

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
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

    const userInfoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
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
      const res = await fetch(url.toString(), { method: 'GET' });
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
    now: Date = new Date()
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
    }

    const existing = db
      .prepare(`SELECT * FROM users WHERE LOWER(email) = LOWER(?)`)
      .get(email) as (UserPublic & { passwordHash: string; isDemo?: number }) | undefined;

    if (!existing && cfg.requirePreprovisioned) {
      throw new Error(
        'Ce compte Google n’est pas pré-provisionné dans le registre de la bibliothèque EST Fès. Contactez l’administration.'
      );
    }

    const externalCheck = await this.checkExternalEstEligibility(email);
    const isProvisionedLibrarian = cfg.librarianEmails.has(email);

    if (existing) {
      // Ne jamais rétrograder ni auto-promouvoir par une saisie utilisateur :
      // le rôle bibliothécaire provient uniquement de la config serveur sécurisée ou de la base admin.
      const nextRole: UserRole =
        isProvisionedLibrarian || existing.role === 'bibliothecaire'
          ? 'bibliothecaire'
          : 'membre';

      let nextStudentStatus: StudentStatus = existing.studentStatus;
      let eligibilityVerifiedBySource = existing.studentStatus === 'verifie';
      if (externalCheck === true) {
        nextStudentStatus = 'verifie';
        eligibilityVerifiedBySource = true;
      }

      db.prepare(
        `UPDATE users
         SET fullName = ?, role = ?, studentStatus = ?, authSource = 'google_oidc', isDemo = 0
         WHERE id = ?`
      ).run(claims.name?.trim() || existing.fullName, nextRole, nextStudentStatus, existing.id);

      const updated = db
        .prepare(
          `SELECT id, fullName, email, role, institution, studentStatus, accountStatus, cne, filiere, authSource, isDemo, createdAt
           FROM users WHERE id = ?`
        )
        .get(existing.id) as UserPublic & { isDemo?: number };

      return {
        user: { ...updated, isDemo: Boolean(updated.isDemo) },
        eligibilityVerifiedBySource,
        requiresLibrarianValidation:
          updated.role === 'membre' && updated.studentStatus !== 'verifie',
      };
    }

    // Nouvel utilisateur vérifié par Google : un domaine seul ne prouve PAS l'appartenance à l'EST Fès
    const role: UserRole = isProvisionedLibrarian ? 'bibliothecaire' : 'membre';
    const eligibilityVerifiedBySource = externalCheck === true || isProvisionedLibrarian;
    const studentStatus: StudentStatus = eligibilityVerifiedBySource ? 'verifie' : 'en_attente';
    const userId = `usr-${crypto.randomUUID().slice(0, 12)}`;
    const unguessablePlaceholderHash = `google_oidc:${crypto.randomBytes(32).toString('hex')}`;

    db.prepare(
      `INSERT INTO users (id, fullName, email, passwordHash, role, institution, studentStatus, accountStatus, cne, filiere, authSource, isDemo, createdAt)
       VALUES (?, ?, ?, ?, ?, 'EST Fès', ?, 'actif', NULL, NULL, 'google_oidc', 0, ?)`
    ).run(
      userId,
      claims.name?.trim() || email.split('@')[0],
      email,
      unguessablePlaceholderHash,
      role,
      studentStatus,
      now.toISOString()
    );

    const created = db
      .prepare(
        `SELECT id, fullName, email, role, institution, studentStatus, accountStatus, cne, filiere, authSource, isDemo, createdAt
         FROM users WHERE id = ?`
      )
      .get(userId) as UserPublic & { isDemo?: number };

    return {
      user: { ...created, isDemo: Boolean(created.isDemo) },
      eligibilityVerifiedBySource,
      requiresLibrarianValidation:
        created.role === 'membre' && created.studentStatus !== 'verifie',
    };
  }
}

export const googleAuthAdapter = new GoogleAuthAdapter();
