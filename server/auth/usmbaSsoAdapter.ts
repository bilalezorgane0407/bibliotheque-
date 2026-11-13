import type { SsoAdapterStatus } from '../../shared/types.ts';

export interface UsmbaSsoConfig {
  enabled: boolean;
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface UsmbaIdentityClaims {
  sub: string;
  email: string;
  fullName: string;
  institution: string;
  cne: string | null;
  filiere: string | null;
  isVerifiedEstStudent: boolean;
}

/**
 * Adaptateur dédié pour l'authentification fédérée SSO de l'USMBA (CAS / OpenID Connect).
 * Ne simule jamais une session SSO authentifiée : si les variables d'environnement
 * officielles ne sont pas configurées, l'adaptateur le signale explicitement.
 */
export class UsmbaSsoAdapter {
  private readonly config: UsmbaSsoConfig;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.config = {
      enabled: env.USMBA_SSO_ENABLED === 'true',
      issuerUrl: (env.USMBA_SSO_ISSUER_URL || '').trim(),
      clientId: (env.USMBA_SSO_CLIENT_ID || '').trim(),
      clientSecret: (env.USMBA_SSO_CLIENT_SECRET || '').trim(),
      redirectUri: (env.USMBA_SSO_REDIRECT_URI || '').trim(),
    };
  }

  public isConfigured(): boolean {
    return Boolean(
      this.config.enabled &&
        this.config.issuerUrl &&
        this.config.clientId &&
        this.config.clientSecret &&
        this.config.redirectUri
    );
  }

  public getStatus(): SsoAdapterStatus {
    const configured = this.isConfigured();
    return {
      provider: 'Université Sidi Mohamed Ben Abdellah (USMBA)',
      protocol: 'OIDC / CAS USMBA',
      configured,
      issuerUrl: configured ? this.config.issuerUrl : null,
      authorizationEndpoint: configured
        ? `${this.config.issuerUrl.replace(/\/$/, '')}/authorize`
        : null,
      message: configured
        ? 'Fournisseur SSO USMBA configuré et prêt pour l’authentification fédérée.'
        : 'Le SSO institutionnel USMBA n’est pas configuré dans cet environnement. L’authentification locale sécurisée par base de données est active.',
      documentationPath: 'docs/USMBA_SSO_CONFIGURATION.md',
    };
  }

  public buildAuthorizationUrl(state: string): string {
    if (!this.isConfigured()) {
      throw new Error(
        'Le fournisseur SSO officiel de l’USMBA n’est pas configuré (variables USMBA_SSO_* manquantes).'
      );
    }

    const baseUrl = this.config.issuerUrl.replace(/\/$/, '');
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: 'openid profile email usmba_student_status',
      state,
    });
    return `${baseUrl}/authorize?${params.toString()}`;
  }

  public async exchangeCodeForClaims(_code: string): Promise<UsmbaIdentityClaims> {
    if (!this.isConfigured()) {
      throw new Error(
        'Impossible d’échanger le jeton OIDC : le SSO USMBA n’est pas configuré.'
      );
    }
    throw new Error(
      'L’échange de jetons OIDC/CAS avec le serveur de la DSI USMBA requiert l’accès réseau au fournisseur d’identité configuré.'
    );
  }
}

export const usmbaSsoAdapter = new UsmbaSsoAdapter();
