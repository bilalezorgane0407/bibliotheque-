import crypto from 'node:crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import type Database from 'better-sqlite3';
import {
  createAuthMiddleware,
  setSessionCookie,
  clearSessionCookie,
  hasSessionCookie,
  isHttpsRequest,
  type AuthenticatedRequest,
} from './auth/session.ts';
import { verifyPassword } from './auth/password.ts';
import { GoogleAuthAdapter, googleAuthAdapter } from './auth/googleAuthAdapter.ts';
import { resetDemoDatabase } from './db/database.ts';
import { DomainError, LibraryService } from './services/libraryService.ts';
import { isSmtpConfigured, sendEmailViaSmtp, sendEmailViaGmailApi } from './services/emailService.ts';
import {
  MAX_QUANTITY_PER_TITLE,
  type AccountStatus,
  type CopyStatus,
  type DemoState,
  type LibrarySettings,
  type OverdueNotificationResult,
  type PhysicalCondition,
  type ReturnInspectionOutcome,
  type StudentStatus,
  type UserPublic,
  type UserRole,
} from '../shared/types.ts';

function getOAuthStateSecret(): string {
  return process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16
    ? process.env.SESSION_SECRET
    : crypto
        .createHash('sha256')
        .update(process.cwd() + '_biblioest_oauth_state_key')
        .digest('hex');
}

function renderOAuthPopupHtml(payload: Record<string, unknown>, fallbackText: string): string {
  const serialized = JSON.stringify(payload).replace(/</g, '\\u003c');
  const safeText = fallbackText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <title>BiblioEST · Authentification Google</title>
    <style>
      body { font-family: system-ui, -apple-system, sans-serif; background: #fbf9f5; color: #1f2937; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; }
      .card { max-width: 440px; border: 1px solid #d1d5db; background: #ffffff; padding: 24px; }
      h1 { font-size: 16px; margin: 0 0 8px; color: #163056; }
      p { font-size: 14px; line-height: 1.5; margin: 0 0 16px; color: #4b5563; }
      a { color: #163056; font-weight: 600; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>BiblioEST · EST Fès (USMBA)</h1>
      <p>${safeText}</p>
      <a href="/">Retourner à l’application</a>
    </div>
    <script>
      (function () {
        var payload = ${serialized};
        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(payload, '*');
            setTimeout(function () { window.close(); }, 180);
          }
        } catch (e) {}
      })();
    </script>
  </body>
</html>`;
}

function mapUserPublicRow(row: Record<string, unknown>): UserPublic {
  return {
    id: String(row.id),
    fullName: String(row.fullName),
    email: String(row.email),
    role: row.role as UserPublic['role'],
    institution: String(row.institution),
    studentStatus: row.studentStatus as StudentStatus,
    accountStatus: row.accountStatus as AccountStatus,
    emailVerified: row.emailVerified === undefined ? true : Boolean(row.emailVerified),
    isAdmin: Boolean(row.isAdmin),
    cne: row.cne ? String(row.cne) : null,
    filiere: row.filiere ? String(row.filiere) : null,
    authSource: row.authSource as UserPublic['authSource'],
    isDemo: Boolean(row.isDemo),
    createdAt: String(row.createdAt),
  };
}

export function createApp(
  db: Database.Database,
  getNow: () => Date = () => new Date(),
  authAdapter: GoogleAuthAdapter = googleAuthAdapter,
  demoDb?: Database.Database
) {
  const app = express();
  const realService = new LibraryService(db, { isDemoSandbox: false });
  const activeDemoDb = demoDb || db;
  const demoService = new LibraryService(activeDemoDb, { isDemoSandbox: true });

  const isDemoModeEnabled = (): boolean => {
    if (process.env.DISABLE_DEMO_MODE === 'true') return false;
    if (process.env.NODE_ENV === 'production' && process.env.ENABLE_DEMO_IN_PROD !== 'true') {
      return false;
    }
    return true;
  };

  const getDemoClockOffsetHours = (): number => {
    try {
      const hoursRow = activeDemoDb
        .prepare(`SELECT value FROM demo_meta WHERE key = 'clock_offset_hours'`)
        .get() as { value?: string } | undefined;
      if (hoursRow?.value !== undefined) {
        const parsedHours = Number(hoursRow.value);
        if (Number.isFinite(parsedHours)) return parsedHours;
      }
      const daysRow = activeDemoDb
        .prepare(`SELECT value FROM demo_meta WHERE key = 'clock_offset_days'`)
        .get() as { value?: string } | undefined;
      const parsedDays = Number(daysRow?.value ?? '0');
      return Number.isFinite(parsedDays) ? parsedDays * 24 : 0;
    } catch {
      return 0;
    }
  };

  const getDemoNow = (): Date => {
    const offsetHours = getDemoClockOffsetHours();
    return new Date(getNow().getTime() + offsetHours * 60 * 60 * 1000);
  };

  const getContext = (req: AuthenticatedRequest) => {
    const useDemo = Boolean(req.isDemoSession && isDemoModeEnabled());
    return {
      db: useDemo ? activeDemoDb : db,
      service: useDemo ? demoService : realService,
      now: useDemo ? getDemoNow() : getNow(),
      isDemo: useDemo,
    };
  };

  const buildDemoState = (req: AuthenticatedRequest): DemoState => {
    const enabled = isDemoModeEnabled();
    const clockOffsetHours = enabled ? getDemoClockOffsetHours() : 0;
    const clockOffsetDays = Number((clockOffsetHours / 24).toFixed(2));
    const simulatedNow = enabled ? getDemoNow().toISOString() : getNow().toISOString();
    const profiles = enabled
      ? (
          activeDemoDb
            .prepare(
              `SELECT id, fullName, email, role, institution, studentStatus, accountStatus, emailVerified, isAdmin, cne, filiere, authSource, isDemo, createdAt
               FROM users
               WHERE isDemo = 1
               ORDER BY CASE WHEN role = 'bibliothecaire' THEN 1 ELSE 0 END, isAdmin ASC, createdAt ASC`
            )
            .all() as Array<Record<string, unknown>>
        ).map(mapUserPublicRow)
      : [];
    const outbox = enabled ? demoService.getSimulatedOutbox(50) : [];
    const settings = demoService.getSettings();

    return {
      demoModeEnabled: enabled,
      isDemoSession: Boolean(req.isDemoSession && enabled),
      simulatedNow,
      clockOffsetDays,
      clockOffsetHours,
      profiles,
      outbox,
      settings,
    };
  };

  const { attachUser, requireAuth, requireLibrarian, requireAdmin } = createAuthMiddleware(
    db,
    activeDemoDb,
    isDemoModeEnabled
  );
  const usedStates = new Set<string>();
  const pendingHandoffs = new Map<
    string,
    { userId: string; requiresLibrarianValidation: boolean; exp: number }
  >();

  function createSignedOAuthState(): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    const ts = Date.now().toString(36);
    const body = `${nonce}.${ts}`;
    const sig = crypto
      .createHmac('sha256', getOAuthStateSecret())
      .update(body)
      .digest('base64url');
    return `${body}.${sig}`;
  }

  function verifySignedOAuthState(state: string): boolean {
    if (!state || usedStates.has(state)) return false;
    const parts = state.split('.');
    if (parts.length !== 3) return false;
    const [nonce, tsStr, sig] = parts;
    if (!nonce || !tsStr || !sig) return false;
    const body = `${nonce}.${tsStr}`;
    const expected = crypto
      .createHmac('sha256', getOAuthStateSecret())
      .update(body)
      .digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return false;
    }
    const issuedAt = parseInt(tsStr, 36);
    if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > 10 * 60 * 1000) {
      return false;
    }
    usedStates.add(state);
    if (usedStates.size > 1000) {
      usedStates.clear();
    }
    return true;
  }

  app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);
  app.use(express.json());
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Vary', 'Cookie');
    next();
  });
  app.use(attachUser);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // --- Authentification Google Institutionnelle & Inscription Académique ---

  app.get('/api/auth/google/status', (_req, res) => {
    res.json(authAdapter.getStatus());
  });

  app.get('/api/auth/google/url', (_req, res) => {
    if (!authAdapter.isConfigured()) {
      const status = authAdapter.getStatus();
      res.status(501).json({
        error: status.message,
        code: 'GOOGLE_OAUTH_NOT_CONFIGURED',
        googleAuth: status,
      });
      return;
    }

    const state = createSignedOAuthState();
    const nonce = crypto.randomBytes(16).toString('hex');
    const authorizationUrl = authAdapter.buildAuthorizationUrl(state, nonce);
    res.json({ authorizationUrl });
  });

  app.get(['/api/auth/google/callback', '/api/auth/google/callback/'], async (req, res) => {
    const errorParam = typeof req.query.error === 'string' ? req.query.error : null;
    const code = typeof req.query.code === 'string' ? req.query.code : null;
    const state = typeof req.query.state === 'string' ? req.query.state : null;

    if (errorParam) {
      res
        .status(400)
        .send(
          renderOAuthPopupHtml(
            {
              type: 'OAUTH_AUTH_ERROR',
              error:
                errorParam === 'access_denied'
                  ? 'Connexion Google annulée par l’utilisateur.'
                  : `Erreur retournée par Google OAuth : ${errorParam}`,
            },
            'La connexion Google a été annulée ou refusée. Vous pouvez fermer cette fenêtre.'
          )
        );
      return;
    }

    if (!code || !state || !verifySignedOAuthState(state)) {
      res
        .status(400)
        .send(
          renderOAuthPopupHtml(
            {
              type: 'OAUTH_AUTH_ERROR',
              error: 'Paramètres OAuth invalides ou expirés. Veuillez relancer la connexion.',
            },
            'Requête d’authentification invalide ou expirée. Veuillez fermer cette fenêtre et réessayer.'
          )
        );
      return;
    }

    try {
      const now = getNow();
      const claims = await authAdapter.exchangeCodeForClaims(code);
      const resolution = await authAdapter.resolveProvisionedUser(db, claims, now, {
        requireAcademicEmail: true,
      });

      setSessionCookie(req, res, resolution.user.id, false);
      realService.recordAuditLog(
        resolution.user,
        'AUTH_GOOGLE_LOGIN',
        'user',
        resolution.user.id,
        `Connexion Google OIDC vérifiée pour ${resolution.user.email} (statut EST : ${resolution.user.studentStatus}, rôle : ${resolution.user.role}).`,
        now
      );

      const handoffToken = crypto.randomBytes(24).toString('hex');
      pendingHandoffs.set(handoffToken, {
        userId: resolution.user.id,
        requiresLibrarianValidation: resolution.requiresLibrarianValidation,
        exp: Date.now() + 60 * 1000,
      });

      res.send(
        renderOAuthPopupHtml(
          {
            type: 'OAUTH_AUTH_SUCCESS',
            handoffToken,
            requiresLibrarianValidation: resolution.requiresLibrarianValidation,
          },
          'Authentification Google confirmée. Redirection vers BiblioEST en cours…'
        )
      );
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Impossible de finaliser l’authentification Google.';
      res
        .status(403)
        .send(
          renderOAuthPopupHtml(
            {
              type: 'OAUTH_AUTH_ERROR',
              error: message,
            },
            message
          )
        );
    }
  });

  app.post('/api/auth/google/handoff', (req: Request, res: Response) => {
    const { handoffToken } = req.body as { handoffToken?: string };
    if (!handoffToken) {
      res.status(400).json({ error: 'Jeton de session OAuth manquant.' });
      return;
    }

    const entry = pendingHandoffs.get(handoffToken);
    pendingHandoffs.delete(handoffToken);

    if (!entry || entry.exp < Date.now()) {
      res.status(401).json({ error: 'Session OAuth expirée. Veuillez relancer la connexion Google.' });
      return;
    }

    const row = db
      .prepare(
        `SELECT id, fullName, email, role, institution, studentStatus, accountStatus, emailVerified, isAdmin, cne, filiere, authSource, isDemo, createdAt
         FROM users WHERE id = ?`
      )
      .get(entry.userId) as Record<string, unknown> | undefined;

    if (!row) {
      res.status(404).json({ error: 'Compte introuvable.' });
      return;
    }

    const user = mapUserPublicRow(row);
    setSessionCookie(req, res, user.id, false);
    const eligibility = realService.checkEligibility(user.id, getNow());
    res.json({
      authenticated: true,
      user,
      eligibility,
      requiresLibrarianValidation: entry.requiresLibrarianValidation,
    });
  });

  app.post('/api/auth/google/firebase', async (req: Request, res: Response) => {
    const { idToken, accessToken } = req.body as {
      idToken?: string;
      accessToken?: string | null;
    };

    if (!idToken && !accessToken) {
      res.status(400).json({
        error: 'Jeton d’authentification Google manquant.',
        code: 'MISSING_GOOGLE_TOKEN',
      });
      return;
    }

    try {
      const now = getNow();
      const claims = await authAdapter.verifyFirebaseOrGoogleToken({
        idToken,
        accessToken,
      });
      const resolution = await authAdapter.resolveProvisionedUser(db, claims, now, {
        requireAcademicEmail: true,
      });

      setSessionCookie(req, res, resolution.user.id, false);
      realService.recordAuditLog(
        resolution.user,
        'AUTH_GOOGLE_LOGIN',
        'user',
        resolution.user.id,
        `Connexion Gmail académique vérifiée pour ${resolution.user.email} (statut EST : ${resolution.user.studentStatus}, rôle : ${resolution.user.role}).`,
        now
      );

      const eligibility = realService.checkEligibility(resolution.user.id, now);
      res.json({
        authenticated: true,
        user: resolution.user,
        eligibility,
        requiresLibrarianValidation: resolution.requiresLibrarianValidation,
      });
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Impossible de vérifier votre compte Gmail académique.';
      res.status(403).json({
        error: message,
        code: 'ACADEMIC_GOOGLE_AUTH_REJECTED',
      });
    }
  });

  app.get('/api/auth/me', (req: AuthenticatedRequest, res) => {
    const ctx = getContext(req);
    ctx.service.processDeadlines(ctx.now);
    const user = req.user || null;
    const eligibility = ctx.service.checkEligibility(user?.id, ctx.now);
    const cookieReceived = hasSessionCookie(req);
    res.json({
      authenticated: Boolean(user),
      cookieReceived,
      user,
      eligibility,
      googleAuth: authAdapter.getStatus(),
      demoModeEnabled: isDemoModeEnabled(),
      isDemoSession: ctx.isDemo,
      simulatedNow: ctx.isDemo ? ctx.now.toISOString() : undefined,
      settings: ctx.service.getSettings(),
    });
  });

  // Inscription publique avec adresse académique existante + code à usage unique (Diagramme 1)
  app.post('/api/auth/register', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { fullName, email, password, filiere, cne, demoMode } = req.body as {
        fullName?: string;
        email?: string;
        password?: string;
        filiere?: string;
        cne?: string;
        demoMode?: boolean;
      };

      const useDemo = Boolean(demoMode || req.isDemoSession);
      if (useDemo && !isDemoModeEnabled()) {
        res.status(403).json({
          error: 'Le mode de démonstration est désactivé dans cet environnement.',
          code: 'DEMO_MODE_DISABLED',
        });
        return;
      }

      const targetService = useDemo ? demoService : realService;
      const targetNow = useDemo ? getDemoNow() : getNow();

      const { user, verificationCode, expiresAt } = targetService.registerAcademicCandidate(
        {
          fullName: fullName || '',
          email: email || '',
          password: password || '',
          filiere: filiere || null,
          cne: cne || null,
        },
        targetNow
      );

      let emailDispatched = false;
      if (!useDemo && isSmtpConfigured()) {
        try {
          emailDispatched = await sendEmailViaSmtp({
            to: user.email,
            subject: 'BiblioEST — Code de vérification de votre adresse académique',
            text: [
              `Bonjour ${user.fullName},`,
              '',
              `Votre code à usage unique pour confirmer votre adresse académique est : ${verificationCode}`,
              'Ce code est valable pendant 15 minutes.',
              '',
              'Remarque : la vérification de votre adresse e-mail ne valide pas automatiquement votre statut EST Fès ; celui-ci reste en attente jusqu’à validation par un bibliothécaire.',
              '',
              'La Bibliothèque BiblioEST · EST Fès (USMBA)',
            ].join('\n'),
          });
        } catch (mailErr) {
          console.error('Échec envoi OTP SMTP:', mailErr);
        }
      }

      res.status(201).json({
        user,
        emailVerificationRequired: true,
        expiresAt,
        emailDispatched: useDemo ? false : emailDispatched,
        ...(useDemo ? { demoVerificationCode: verificationCode } : {}),
        message: useDemo
          ? `Compte démo créé pour ${user.email}. Un code à usage unique a été déposé dans le journal des notifications simulées.`
          : emailDispatched
            ? `Un code à usage unique a été envoyé à ${user.email}. Après validation de l’adresse, votre statut EST Fès restera en attente de validation par la bibliothèque.`
            : `Inscription enregistrée pour ${user.email}. Validez le code à usage unique envoyé à votre adresse académique (le statut EST Fès restera en attente jusqu’à validation par la bibliothèque).`,
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/auth/verify-email', (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { email, code, demoMode } = req.body as {
        email?: string;
        code?: string;
        demoMode?: boolean;
      };
      const useDemo = Boolean(demoMode || req.isDemoSession);
      if (useDemo && !isDemoModeEnabled()) {
        res.status(403).json({
          error: 'Le mode de démonstration est désactivé.',
          code: 'DEMO_MODE_DISABLED',
        });
        return;
      }

      const targetService = useDemo ? demoService : realService;
      const targetNow = useDemo ? getDemoNow() : getNow();
      const user = targetService.verifyEmailCode(email || '', code || '', targetNow);
      setSessionCookie(req, res, user.id, useDemo);
      const eligibility = targetService.checkEligibility(user.id, targetNow);

      res.json({
        authenticated: true,
        user,
        eligibility,
        isDemoSession: useDemo,
        message:
          user.studentStatus === 'verifie'
            ? 'Adresse e-mail vérifiée et dossier EST Fès actif.'
            : 'Adresse e-mail vérifiée. Votre statut EST Fès reste en attente de validation par un bibliothécaire.',
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/auth/resend-verification', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { email, demoMode } = req.body as { email?: string; demoMode?: boolean };
      const useDemo = Boolean(demoMode || req.isDemoSession);
      if (useDemo && !isDemoModeEnabled()) {
        res.status(403).json({
          error: 'Le mode de démonstration est désactivé.',
          code: 'DEMO_MODE_DISABLED',
        });
        return;
      }

      const targetService = useDemo ? demoService : realService;
      const targetNow = useDemo ? getDemoNow() : getNow();
      const { email: targetEmail, verificationCode, expiresAt } =
        targetService.resendVerificationCode(email || '', targetNow);

      if (!useDemo && isSmtpConfigured()) {
        try {
          await sendEmailViaSmtp({
            to: targetEmail,
            subject: 'BiblioEST — Nouveau code de vérification',
            text: `Votre nouveau code à usage unique est : ${verificationCode} (valable 15 minutes).`,
          });
        } catch (mailErr) {
          console.error('Échec renvoi OTP SMTP:', mailErr);
        }
      }

      res.json({
        ok: true,
        email: targetEmail,
        expiresAt,
        ...(useDemo ? { demoVerificationCode: verificationCode } : {}),
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/auth/demo-login', (req: Request, res: Response) => {
    if (!isDemoModeEnabled()) {
      res.status(403).json({
        error: 'Les comptes de démonstration sont désactivés dans cet environnement.',
        code: 'DEMO_MODE_DISABLED',
      });
      return;
    }

    const { userId, email } = req.body as { userId?: string; email?: string };
    const row = (
      userId
        ? activeDemoDb.prepare(`SELECT * FROM users WHERE id = ? AND isDemo = 1`).get(userId.trim())
        : email
          ? activeDemoDb
              .prepare(`SELECT * FROM users WHERE LOWER(email) = LOWER(?) AND isDemo = 1`)
              .get(email.trim())
          : undefined
    ) as (Record<string, unknown> & { passwordHash: string }) | undefined;

    if (!row) {
      res.status(404).json({
        error: 'Compte d’évaluation fictif introuvable.',
        code: 'DEMO_ACCOUNT_NOT_FOUND',
      });
      return;
    }

    const userPublic = mapUserPublicRow(row);
    const now = getDemoNow();
    setSessionCookie(req, res, userPublic.id, true);
    const eligibility = demoService.checkEligibility(userPublic.id, now);
    demoService.recordAuditLog(
      userPublic,
      'AUTH_DEMO_LOGIN',
      'user',
      userPublic.id,
      `Connexion via compte fictif d’évaluation (${userPublic.email}).`,
      now
    );
    res.json({
      authenticated: true,
      user: userPublic,
      eligibility,
      isDemoSession: true,
      simulatedNow: now.toISOString(),
    });
  });

  app.post('/api/auth/login', (req: Request, res: Response) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) {
      res.status(400).json({ error: 'Adresse e-mail et mot de passe requis.' });
      return;
    }

    const normalizedEmail = email.trim();
    const realRow = db
      .prepare(`SELECT * FROM users WHERE LOWER(email) = LOWER(?)`)
      .get(normalizedEmail) as (Record<string, unknown> & { passwordHash: string }) | undefined;

    const demoRow =
      isDemoModeEnabled() && activeDemoDb !== db
        ? (activeDemoDb
            .prepare(`SELECT * FROM users WHERE LOWER(email) = LOWER(?) AND isDemo = 1`)
            .get(normalizedEmail) as (Record<string, unknown> & { passwordHash: string }) | undefined)
        : undefined;

    const row = realRow || demoRow;
    const isDemoAccount = Boolean(demoRow && !realRow) || Boolean(row?.isDemo);

    if (row && (row.authSource === 'google_oidc' || String(row.passwordHash).startsWith('google_oidc:'))) {
      res.status(403).json({
        error:
          'Les comptes Google institutionnels s’authentifient exclusivement via le bouton « Se connecter avec Gmail académique ».',
        code: 'GOOGLE_OAUTH_REQUIRED',
      });
      return;
    }

    if (isDemoAccount && !isDemoModeEnabled()) {
      res.status(403).json({
        error:
          'L’authentification de démonstration est désactivée dans cet environnement.',
        code: 'DEMO_MODE_DISABLED',
      });
      return;
    }

    const passwordValid = row ? verifyPassword(password, String(row.passwordHash)) : false;
    if (!row || !passwordValid) {
      res.status(401).json({
        error: 'Identifiants invalides.',
        code: 'INVALID_CREDENTIALS',
      });
      return;
    }

    const userPublic = mapUserPublicRow(row);
    const targetService = isDemoAccount ? demoService : realService;
    const now = isDemoAccount ? getDemoNow() : getNow();
    setSessionCookie(req, res, userPublic.id, isDemoAccount);
    const eligibility = targetService.checkEligibility(userPublic.id, now);
    targetService.recordAuditLog(
      userPublic,
      isDemoAccount ? 'AUTH_DEMO_LOGIN' : 'AUTH_LOCAL_LOGIN',
      'user',
      userPublic.id,
      `Connexion par mot de passe pour ${userPublic.email}.`,
      now
    );
    res.json({
      authenticated: true,
      user: userPublic,
      eligibility,
      isDemoSession: isDemoAccount,
    });
  });

  app.post('/api/auth/logout', (req, res) => {
    clearSessionCookie(req, res);
    console.info('[auth:logout]', { status: 200, https: isHttpsRequest(req) });
    res.json({ ok: true });
  });

  // --- Bac à sable Mode Démo (isolé des données réelles et des vrais envois d'e-mails) ---

  app.get('/api/demo/state', (req: AuthenticatedRequest, res: Response) => {
    if (!isDemoModeEnabled()) {
      res.status(403).json({
        error: 'Le mode de démonstration est désactivé en production.',
        code: 'DEMO_MODE_DISABLED',
      });
      return;
    }
    demoService.processDeadlines(getDemoNow());
    res.json(buildDemoState(req));
  });

  app.post('/api/demo/reset', (req: AuthenticatedRequest, res: Response) => {
    if (!isDemoModeEnabled()) {
      res.status(403).json({
        error: 'Le mode de démonstration est désactivé en production.',
        code: 'DEMO_MODE_DISABLED',
      });
      return;
    }
    resetDemoDatabase(activeDemoDb, getNow());
    demoService.processDeadlines(getDemoNow());
    res.json(buildDemoState(req));
  });

  app.post('/api/demo/clock', (req: AuthenticatedRequest, res: Response) => {
    if (!isDemoModeEnabled()) {
      res.status(403).json({
        error: 'Le mode de démonstration est désactivé en production.',
        code: 'DEMO_MODE_DISABLED',
      });
      return;
    }

    const { addDays, setOffsetDays, addHours, setOffsetHours } = req.body as {
      addDays?: number;
      setOffsetDays?: number;
      addHours?: number;
      setOffsetHours?: number;
    };

    const currentHours = getDemoClockOffsetHours();
    let nextHours = currentHours;
    if (typeof setOffsetHours === 'number' && Number.isFinite(setOffsetHours)) {
      nextHours = Math.max(-30 * 24, Math.min(365 * 24, setOffsetHours));
    } else if (typeof addHours === 'number' && Number.isFinite(addHours)) {
      nextHours = Math.max(-30 * 24, Math.min(365 * 24, currentHours + addHours));
    } else if (typeof setOffsetDays === 'number' && Number.isFinite(setOffsetDays)) {
      nextHours = Math.max(-30 * 24, Math.min(365 * 24, setOffsetDays * 24));
    } else if (typeof addDays === 'number' && Number.isFinite(addDays)) {
      nextHours = Math.max(-30 * 24, Math.min(365 * 24, currentHours + addDays * 24));
    } else {
      res.status(400).json({ error: 'Paramètre addHours, addDays, setOffsetHours ou setOffsetDays requis.' });
      return;
    }

    activeDemoDb
      .prepare(`INSERT OR REPLACE INTO demo_meta (key, value) VALUES ('clock_offset_hours', ?)`)
      .run(String(nextHours));
    activeDemoDb
      .prepare(`INSERT OR REPLACE INTO demo_meta (key, value) VALUES ('clock_offset_days', ?)`)
      .run(String(Number((nextHours / 24).toFixed(2))));

    const expiredReservationsCount = demoService.processDeadlines(getDemoNow());
    res.json({
      ...buildDemoState(req),
      expiredReservationsCount,
    });
  });

  // --- Catalogue public & consultation ---

  app.get('/api/books', (req: AuthenticatedRequest, res) => {
    const ctx = getContext(req);
    ctx.service.processDeadlines(ctx.now);
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const language = typeof req.query.language === 'string' ? req.query.language : undefined;
    const yearRaw = typeof req.query.year === 'string' ? Number(req.query.year) : NaN;
    const year = Number.isFinite(yearRaw) && yearRaw > 0 ? yearRaw : null;
    const availableOnly = req.query.availableOnly === 'true';

    const books = ctx.service.listBooks({
      search,
      category,
      language,
      year,
      availableOnly,
      includeArchived: false,
    });
    res.json({ books });
  });

  app.get('/api/books/:id', (req: AuthenticatedRequest, res, next) => {
    try {
      const ctx = getContext(req);
      const isLibrarian = req.user?.role === 'bibliothecaire';
      const detail = ctx.service.getBookDetail(String(req.params.id), ctx.now, {
        includeCopies: isLibrarian,
      });
      res.json({ book: detail });
    } catch (err) {
      next(err);
    }
  });

  // --- Opérations Membre (emprunts, réservations, notifications) ---

  app.post('/api/books/:id/borrow', requireAuth, (req: AuthenticatedRequest, res, next) => {
    try {
      const ctx = getContext(req);
      const loan = ctx.service.borrowBook(req.user!.id, String(req.params.id), ctx.now);
      res.status(201).json({ loan });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/books/:id/reserve', requireAuth, (req: AuthenticatedRequest, res, next) => {
    try {
      const ctx = getContext(req);
      const reservation = ctx.service.reserveBook(req.user!.id, String(req.params.id), ctx.now);
      res.status(201).json({
        reservation,
        message:
          "Votre réservation a été enregistrée. Vous serez informé dès qu'un exemplaire sera disponible. Aucune date de disponibilité n'est garantie.",
      });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/loans/mine', requireAuth, (req: AuthenticatedRequest, res) => {
    const ctx = getContext(req);
    const loans = ctx.service.getMemberLoans(req.user!.id, ctx.now);
    res.json({ loans });
  });

  app.get('/api/reservations/mine', requireAuth, (req: AuthenticatedRequest, res) => {
    const ctx = getContext(req);
    const reservations = ctx.service.getMemberReservations(req.user!.id, ctx.now);
    res.json({ reservations });
  });

  app.post('/api/reservations/:id/cancel', requireAuth, (req: AuthenticatedRequest, res, next) => {
    try {
      const ctx = getContext(req);
      const reservation = ctx.service.cancelReservation(
        String(req.params.id),
        req.user!,
        ctx.now
      );
      res.json({ reservation });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/notifications/mine', requireAuth, (req: AuthenticatedRequest, res) => {
    const ctx = getContext(req);
    const notifications = ctx.service.getMemberNotifications(req.user!.id);
    res.json({ notifications });
  });

  app.post('/api/notifications/:id/read', requireAuth, (req: AuthenticatedRequest, res) => {
    const ctx = getContext(req);
    ctx.service.markNotificationRead(String(req.params.id), req.user!.id, ctx.now);
    res.json({ ok: true });
  });

  app.post('/api/notifications/read-all', requireAuth, (req: AuthenticatedRequest, res) => {
    const ctx = getContext(req);
    ctx.service.markAllNotificationsRead(req.user!.id, ctx.now);
    res.json({ ok: true });
  });

  // --- Panier de demandes (ne réserve jamais d'exemplaire avant confirmation serveur) ---

  app.get('/api/cart', requireAuth, (req: AuthenticatedRequest, res) => {
    const ctx = getContext(req);
    const items = ctx.service.getCart(req.user!.id, ctx.now);
    res.json({ items, maxQuantityPerTitle: MAX_QUANTITY_PER_TITLE });
  });

  app.post('/api/cart/items', requireAuth, (req: AuthenticatedRequest, res, next) => {
    try {
      const ctx = getContext(req);
      const { bookId, quantity } = req.body as { bookId?: string; quantity?: number };
      if (!bookId) {
        res.status(400).json({ error: 'Identifiant d’ouvrage requis.' });
        return;
      }
      const items = ctx.service.addToCart(
        req.user!.id,
        bookId,
        quantity === undefined ? 1 : Number(quantity),
        ctx.now
      );
      res.status(201).json({ items });
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/cart/items/:bookId', requireAuth, (req: AuthenticatedRequest, res, next) => {
    try {
      const ctx = getContext(req);
      const { quantity } = req.body as { quantity?: number };
      if (quantity === undefined) {
        res.status(400).json({ error: 'Quantité requise.' });
        return;
      }
      const items = ctx.service.updateCartItemQuantity(
        req.user!.id,
        String(req.params.bookId),
        Number(quantity),
        ctx.now
      );
      res.json({ items });
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/cart/items/:bookId', requireAuth, (req: AuthenticatedRequest, res, next) => {
    try {
      const ctx = getContext(req);
      const items = ctx.service.removeFromCart(
        req.user!.id,
        String(req.params.bookId),
        ctx.now
      );
      res.json({ items });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/cart/confirm', requireAuth, (req: AuthenticatedRequest, res, next) => {
    try {
      const ctx = getContext(req);
      const confirmation = ctx.service.confirmCart(req.user!.id, ctx.now);
      res.json(confirmation);
    } catch (err) {
      next(err);
    }
  });

  // --- Espace Bibliothécaire (strictement protégé par requireLibrarian) ---

  app.get('/api/admin/stats', requireLibrarian, (req: AuthenticatedRequest, res) => {
    const ctx = getContext(req);
    res.json({ stats: ctx.service.getDashboardStats(ctx.now) });
  });

  app.get('/api/admin/books', requireLibrarian, (req: AuthenticatedRequest, res) => {
    const ctx = getContext(req);
    const books = ctx.service.listBooks({ includeArchived: true });
    res.json({ books });
  });

  app.post('/api/admin/books', requireLibrarian, (req: AuthenticatedRequest, res, next) => {
    try {
      const ctx = getContext(req);
      const {
        title,
        authors,
        isbn,
        category,
        description,
        publisher,
        publicationYear,
        edition,
        language,
        coverImage,
        shelfLocation,
        featured,
      } = req.body;

      if (!title || !authors || !category || !shelfLocation) {
        res.status(400).json({
          error: 'Titre, auteurs, département et cote de rayonnage sont obligatoires.',
        });
        return;
      }

      const book = ctx.service.createBook(
        {
          title,
          authors,
          isbn: isbn || null,
          category,
          description: description || '',
          publisher: publisher || 'Éditions Universitaires',
          publicationYear: Number(publicationYear) || new Date().getFullYear(),
          edition: edition || '1re édition',
          language: language || 'Français',
          coverImage: coverImage || '/src/assets/images/cover_informatique_1794527753411.jpg',
          shelfLocation,
          featured: Boolean(featured),
        },
        ctx.now,
        req.user!
      );
      res.status(201).json({ book });
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/admin/books/:id', requireLibrarian, (req: AuthenticatedRequest, res, next) => {
    try {
      const ctx = getContext(req);
      const book = ctx.service.updateBook(String(req.params.id), req.body, req.user!, ctx.now);
      res.json({ book });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/admin/copies', requireLibrarian, (req: AuthenticatedRequest, res) => {
    const ctx = getContext(req);
    res.json({ copies: ctx.service.getAllCopiesAdmin() });
  });

  app.post('/api/admin/books/:id/copies', requireLibrarian, (req: AuthenticatedRequest, res, next) => {
    try {
      const ctx = getContext(req);
      const { barcode, physicalCondition, location } = req.body as {
        barcode?: string;
        physicalCondition?: PhysicalCondition;
        location?: string;
      };
      if (!barcode || !physicalCondition || !location) {
        res.status(400).json({
          error: 'Code-barres, état physique et emplacement sont obligatoires.',
        });
        return;
      }
      const result = ctx.service.registerCopy(
        String(req.params.id),
        { barcode, physicalCondition, location },
        ctx.now,
        req.user!
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/admin/books/:id/copies/batch', requireLibrarian, (req: AuthenticatedRequest, res, next) => {
    try {
      const ctx = getContext(req);
      const { barcodes, physicalCondition, location } = req.body as {
        barcodes?: string[] | string;
        physicalCondition?: PhysicalCondition;
        location?: string;
      };
      const barcodeList = Array.isArray(barcodes)
        ? barcodes
        : typeof barcodes === 'string'
          ? barcodes.split(/[\n,;]+/g)
          : [];

      if (barcodeList.length === 0 || !physicalCondition || !location) {
        res.status(400).json({
          error: 'Liste de codes-barres, état physique et emplacement sont obligatoires.',
        });
        return;
      }

      const result = ctx.service.registerCopiesBatch(
        String(req.params.id),
        {
          barcodes: barcodeList,
          physicalCondition,
          location,
        },
        ctx.now,
        req.user!
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/admin/copies/:id', requireLibrarian, (req: AuthenticatedRequest, res, next) => {
    try {
      const ctx = getContext(req);
      const { status, physicalCondition, location } = req.body as {
        status?: CopyStatus;
        physicalCondition?: PhysicalCondition;
        location?: string;
      };
      if (!status || !physicalCondition || !location) {
        res.status(400).json({
          error: 'Statut, état physique et emplacement sont obligatoires.',
        });
        return;
      }
      const copy = ctx.service.updateCopyStatusAdmin(
        String(req.params.id),
        status,
        physicalCondition,
        location,
        ctx.now,
        req.user!
      );
      res.json({ copy });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/admin/copies/:id/complete-repair', requireLibrarian, (req: AuthenticatedRequest, res, next) => {
    try {
      const ctx = getContext(req);
      const copy = ctx.service.completeCopyRepair(String(req.params.id), req.user!, ctx.now);
      res.json({ copy });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/admin/copies/:id/inspect', requireLibrarian, (req: AuthenticatedRequest, res, next) => {
    try {
      const ctx = getContext(req);
      const { outcome, physicalCondition } = req.body as {
        outcome?: ReturnInspectionOutcome;
        physicalCondition?: PhysicalCondition;
      };
      if (!outcome || !physicalCondition) {
        res.status(400).json({
          error: 'Résultat d’inspection et état physique requis.',
        });
        return;
      }
      const result = ctx.service.inspectRepairedCopy(
        String(req.params.id),
        outcome,
        physicalCondition,
        ctx.now,
        req.user!
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/admin/loans', requireLibrarian, (req: AuthenticatedRequest, res) => {
    const ctx = getContext(req);
    res.json({ loans: ctx.service.getAllLoansAdmin(ctx.now) });
  });

  app.post('/api/admin/loans', requireLibrarian, (req: AuthenticatedRequest, res, next) => {
    try {
      const ctx = getContext(req);
      const { memberId, bookId, copyId } = req.body as {
        memberId?: string;
        bookId?: string;
        copyId?: string | null;
      };
      if (!memberId || !bookId) {
        res.status(400).json({ error: 'Membre et ouvrage requis pour enregistrer un prêt.' });
        return;
      }
      const loan = ctx.service.createLoanAdmin(memberId, bookId, copyId || null, req.user!, ctx.now);
      res.status(201).json({ loan });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/admin/loans/:id/toggle-overdue-test', requireLibrarian, (req: AuthenticatedRequest, res, next) => {
    try {
      const ctx = getContext(req);
      const loan = ctx.service.toggleLoanOverdueTest(String(req.params.id), req.user!, ctx.now);
      res.json({ loan });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/admin/loans/:id/return', requireLibrarian, (req: AuthenticatedRequest, res, next) => {
    try {
      const ctx = getContext(req);
      const { outcome, physicalCondition, notes } = req.body as {
        outcome?: ReturnInspectionOutcome;
        physicalCondition?: PhysicalCondition;
        notes?: string;
      };
      if (!outcome || !physicalCondition) {
        res.status(400).json({
          error: 'Décision d’inspection et état physique sont obligatoires lors du retour.',
        });
        return;
      }
      const result = ctx.service.returnLoan(
        String(req.params.id),
        outcome,
        physicalCondition,
        notes,
        ctx.now,
        req.user!
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/admin/loans/notify-overdue', requireLibrarian, async (req: AuthenticatedRequest, res, next) => {
    try {
      const ctx = getContext(req);
      const { googleAccessToken } = req.body as { googleAccessToken?: string };
      const settings = ctx.service.getSettings();
      const { overdueLoansCount, recipients } = ctx.service.notifyOverdueMembersAdmin(req.user!, ctx.now);
      const smtpConfigured = !ctx.isDemo && isSmtpConfigured();
      const subject = 'BiblioEST — Rappel : emprunt(s) en retard à restituer';

      let emailsSentCount = 0;
      let gmailApiUsed = false;

      if (recipients.length > 0) {
        for (const r of recipients) {
          const listLines = r.books
            .map(
              (b) =>
                `- ${b.title} (Code-barres : ${b.barcode}, échéance : ${new Date(b.dueAt).toLocaleDateString('fr-FR')})`
            )
            .join('\n');
          const text = [
            `Bonjour ${r.memberName},`,
            '',
            'Le délai de prêt pour les ouvrages suivants empruntés à la bibliothèque BiblioEST est dépassé :',
            listLines,
            '',
            'Merci de restituer ces exemplaires à la bibliothèque BiblioEST (EST Fès - USMBA) dans les plus brefs délais afin de régulariser votre situation.',
            '',
            'Cordialement,',
            'La Bibliothèque BiblioEST · EST Fès (USMBA)',
          ].join('\n');

          if (ctx.isDemo) {
            ctx.service.recordSimulatedEmail(
              {
                recipientEmail: r.memberEmail,
                subject,
                body: text,
                category: 'rappel_retard',
              },
              ctx.now
            );
            r.emailSent = true;
            emailsSentCount += 1;
            continue;
          }

          if (!settings.realEmailsEnabled) {
            continue;
          }

          let sent = false;
          if (googleAccessToken) {
            try {
              sent = await sendEmailViaGmailApi({
                accessToken: googleAccessToken,
                to: r.memberEmail,
                subject,
                text,
              });
              if (sent) {
                gmailApiUsed = true;
                r.emailSent = true;
                emailsSentCount += 1;
              }
            } catch (gmailErr) {
              console.error('Erreur envoi Gmail API pour', r.memberEmail, ':', gmailErr);
            }
          }

          if (!sent && smtpConfigured) {
            try {
              sent = await sendEmailViaSmtp({ to: r.memberEmail, subject, text });
              if (sent) {
                r.emailSent = true;
                emailsSentCount += 1;
              }
            } catch (mailErr) {
              console.error('Échec envoi SMTP rappel retard pour', r.memberEmail, ':', mailErr);
            }
          }
        }
      }

      let summaryMessage = 'Aucun emprunt en retard à notifier.';
      if (recipients.length > 0) {
        if (ctx.isDemo) {
          summaryMessage = `Mode Démo : ${emailsSentCount} e-mail(s) simulé(s) enregistré(s) dans le journal de démonstration (aucun vrai e-mail envoyé).`;
        } else if (!settings.realEmailsEnabled) {
          summaryMessage = `Notifications internes enregistrées pour ${recipients.length} membre(s). L’envoi réel d’e-mails est désactivé dans les paramètres.`;
        } else if (gmailApiUsed && emailsSentCount > 0) {
          summaryMessage = `${emailsSentCount}/${recipients.length} e-mail(s) de rappel envoyé(s) avec succès via Gmail à ${recipients.map((r) => r.memberEmail).join(', ')}.`;
        } else if (smtpConfigured && emailsSentCount > 0) {
          summaryMessage = `${emailsSentCount}/${recipients.length} e-mail(s) de rappel envoyé(s) via SMTP et notification(s) BiblioEST enregistrée(s).`;
        } else {
          summaryMessage = `Rappel enregistré dans BiblioEST pour ${recipients.length} membre(s). Connectez votre compte Gmail académique pour envoyer directement les e-mails.`;
        }
      }

      const payload: OverdueNotificationResult = {
        notifiedMembersCount: recipients.length,
        overdueLoansCount,
        emailsSentCount,
        smtpConfigured,
        gmailApiUsed,
        demoSimulated: ctx.isDemo,
        recipients,
        subject,
        summaryMessage,
      };
      res.json(payload);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/admin/email/test', requireLibrarian, async (req: AuthenticatedRequest, res: Response) => {
    const ctx = getContext(req);
    const settings = ctx.service.getSettings();
    const { googleAccessToken, recipientEmail } = req.body as {
      googleAccessToken?: string;
      recipientEmail?: string;
    };

    if (
      recipientEmail &&
      recipientEmail.trim().toLowerCase() !== settings.testEmailRecipient.trim().toLowerCase()
    ) {
      res.status(403).json({
        error: `Le bouton de test d’e-mail est strictement limité à l’adresse de test configurée (${settings.testEmailRecipient}).`,
        code: 'TEST_EMAIL_RECIPIENT_RESTRICTED',
      });
      return;
    }

    const targetRecipient = settings.testEmailRecipient;
    const subject = 'BiblioEST — Message de test de notification';
    const body = [
      'Ceci est un e-mail de test envoyé depuis l’espace d’administration BiblioEST.',
      `Destinataire autorisé : ${targetRecipient}`,
      `Date : ${ctx.now.toISOString()}`,
    ].join('\n');

    if (ctx.isDemo) {
      const record = ctx.service.recordSimulatedEmail(
        {
          recipientEmail: targetRecipient,
          subject,
          body,
          category: 'test',
        },
        ctx.now
      );
      res.json({
        ok: true,
        demoSimulated: true,
        recipientEmail: targetRecipient,
        record,
        message: `Mode Démo : e-mail de test enregistré dans le journal simulé pour ${targetRecipient} (aucun vrai e-mail envoyé).`,
      });
      return;
    }

    if (!settings.realEmailsEnabled) {
      res.status(409).json({
        error: 'L’envoi réel d’e-mails est désactivé dans les paramètres de la bibliothèque.',
        code: 'REAL_EMAILS_DISABLED',
      });
      return;
    }

    let sent = false;
    let transport: 'gmail_api' | 'smtp' | 'none' = 'none';

    if (googleAccessToken) {
      try {
        sent = await sendEmailViaGmailApi({
          accessToken: googleAccessToken,
          to: targetRecipient,
          subject,
          text: body,
        });
        if (sent) transport = 'gmail_api';
      } catch (err) {
        console.error('Échec test Gmail API:', err);
      }
    }

    if (!sent && isSmtpConfigured()) {
      try {
        sent = await sendEmailViaSmtp({ to: targetRecipient, subject, text: body });
        if (sent) transport = 'smtp';
      } catch (err) {
        console.error('Échec test SMTP:', err);
      }
    }

    ctx.service.recordAuditLog(
      req.user,
      'ADMIN_TEST_EMAIL',
      'settings',
      'default',
      `Test d'e-mail vers ${targetRecipient} (${sent ? `envoyé via ${transport}` : 'non expédié'}).`,
      ctx.now
    );

    if (!sent) {
      res.status(503).json({
        error: `Aucun transport actif (Gmail API ou SMTP) pour expédier vers ${targetRecipient}. Connectez Gmail ou configurez SMTP.`,
        code: 'EMAIL_TRANSPORT_UNAVAILABLE',
        recipientEmail: targetRecipient,
      });
      return;
    }

    res.json({
      ok: true,
      demoSimulated: false,
      recipientEmail: targetRecipient,
      transport,
      message: `E-mail de test envoyé à l’adresse configurée (${targetRecipient}) via ${transport === 'gmail_api' ? 'Gmail API' : 'SMTP'}.`,
    });
  });

  app.get('/api/admin/reservations', requireLibrarian, (req: AuthenticatedRequest, res) => {
    const ctx = getContext(req);
    res.json({ reservations: ctx.service.getAllReservationsAdmin(ctx.now) });
  });

  app.post('/api/admin/reservations/allocate', requireLibrarian, (req: AuthenticatedRequest, res, next) => {
    try {
      const ctx = getContext(req);
      const { bookId } = req.body as { bookId?: string };
      if (!bookId) {
        res.status(400).json({ error: 'Identifiant d’ouvrage requis.' });
        return;
      }
      const result = ctx.service.allocateAvailableCopyToQueueAdmin(bookId, req.user!, ctx.now);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.post(
    '/api/admin/reservations/:id/confirm-availability',
    requireLibrarian,
    (req: AuthenticatedRequest, res, next) => {
      try {
        const ctx = getContext(req);
        const reservation = ctx.service.confirmReservationAvailability(
          String(req.params.id),
          req.user!,
          ctx.now
        );
        res.json({ reservation });
      } catch (err) {
        next(err);
      }
    }
  );

  app.post('/api/admin/reservations/:id/pickup', requireLibrarian, (req: AuthenticatedRequest, res, next) => {
    try {
      const ctx = getContext(req);
      const loan = ctx.service.fulfillReservationPickup(String(req.params.id), ctx.now, req.user!);
      res.json({ loan });
    } catch (err) {
      next(err);
    }
  });

  app.post(
    '/api/admin/reservations/:id/cancel',
    requireLibrarian,
    (req: AuthenticatedRequest, res, next) => {
      try {
        const ctx = getContext(req);
        const reservation = ctx.service.cancelReservation(
          String(req.params.id),
          req.user!,
          ctx.now
        );
        res.json({ reservation });
      } catch (err) {
        next(err);
      }
    }
  );

  app.post('/api/admin/reservations/process-deadlines', requireLibrarian, (req: AuthenticatedRequest, res) => {
    const ctx = getContext(req);
    const expiredCount = ctx.service.processDeadlines(ctx.now);
    res.json({ expiredCount });
  });

  app.get('/api/admin/members', requireLibrarian, (req: AuthenticatedRequest, res) => {
    const ctx = getContext(req);
    res.json({ members: ctx.service.listMembersAdmin() });
  });

  app.patch('/api/admin/members/:id/verification', requireLibrarian, (req: AuthenticatedRequest, res, next) => {
    try {
      const ctx = getContext(req);
      const { studentStatus, accountStatus } = req.body as {
        studentStatus?: StudentStatus;
        accountStatus?: AccountStatus;
      };
      if (!studentStatus || !accountStatus) {
        res.status(400).json({ error: 'studentStatus et accountStatus requis.' });
        return;
      }
      const member = ctx.service.updateMemberVerificationAdmin(
        String(req.params.id),
        studentStatus,
        accountStatus,
        req.user!,
        ctx.now
      );
      res.json({ member });
    } catch (err) {
      next(err);
    }
  });

  // --- Routes Administrateur de la bibliothèque (Diagramme 1) ---

  app.patch('/api/admin/members/:id/role', requireAdmin, (req: AuthenticatedRequest, res, next) => {
    try {
      const ctx = getContext(req);
      const { role, isAdmin } = req.body as { role?: UserRole; isAdmin?: boolean };
      if (role !== 'membre' && role !== 'bibliothecaire') {
        res.status(400).json({ error: 'Rôle invalide (membre ou bibliothecaire attendu).' });
        return;
      }
      const member = ctx.service.updateStaffRoleAdmin(
        String(req.params.id),
        role,
        Boolean(isAdmin),
        req.user!,
        ctx.now
      );
      res.json({ member });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/admin/settings', requireLibrarian, (req: AuthenticatedRequest, res) => {
    const ctx = getContext(req);
    res.json({ settings: ctx.service.getSettings() });
  });

  app.patch('/api/admin/settings', requireAdmin, (req: AuthenticatedRequest, res, next) => {
    try {
      const ctx = getContext(req);
      const patch = req.body as Partial<LibrarySettings>;
      const settings = ctx.service.updateSettings(patch, req.user!, ctx.now);
      res.json({ settings });
    } catch (err) {
      next(err);
    }
  });

  // --- Comptoir & Circulation (scan carte membre & code-barres exemplaire, réservé au personnel) ---

  app.get('/api/admin/counter/members/search', requireLibrarian, (req: AuthenticatedRequest, res) => {
    const ctx = getContext(req);
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    res.json({ members: ctx.service.searchMembersAtCounter(q) });
  });

  app.get('/api/admin/counter/member', requireLibrarian, (req: AuthenticatedRequest, res, next) => {
    try {
      const ctx = getContext(req);
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      const dossier = ctx.service.lookupMemberAtCounter(q, ctx.now);
      res.json({ dossier });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/admin/counter/checkout', requireLibrarian, (req: AuthenticatedRequest, res, next) => {
    try {
      const ctx = getContext(req);
      const { memberId, barcode } = req.body as { memberId?: string; barcode?: string };
      if (!memberId || !barcode) {
        res.status(400).json({ error: 'Identifiant du membre et code-barres de l’exemplaire requis.' });
        return;
      }
      const result = ctx.service.checkoutCopyAtCounter(memberId, barcode, req.user!, ctx.now);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/admin/counter/scan-return', requireLibrarian, (req: AuthenticatedRequest, res, next) => {
    try {
      const ctx = getContext(req);
      const { barcode } = req.body as { barcode?: string };
      if (!barcode) {
        res.status(400).json({ error: 'Code-barres de l’exemplaire requis.' });
        return;
      }
      const lookup = ctx.service.lookupCopyForReturnAtCounter(barcode, ctx.now);
      res.json(lookup);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/admin/copy-state-logs', requireLibrarian, (req: AuthenticatedRequest, res) => {
    const ctx = getContext(req);
    const limitRaw = typeof req.query.limit === 'string' ? Number(req.query.limit) : 100;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 100;
    res.json({ logs: ctx.service.getCopyStateLogsAdmin(limit) });
  });

  app.get('/api/admin/audit-logs', requireLibrarian, (req: AuthenticatedRequest, res) => {
    const ctx = getContext(req);
    const limitRaw = typeof req.query.limit === 'string' ? Number(req.query.limit) : 100;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 100;
    res.json({ logs: ctx.service.getAuditLogsAdmin(limit) });
  });

  // Gestion centralisée des erreurs métier
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof DomainError) {
      res.status(err.statusCode).json({ error: err.message, code: err.code });
      return;
    }
    console.error('Erreur serveur BiblioEST:', err);
    res.status(500).json({
      error: 'Une erreur interne est survenue lors du traitement de la demande.',
    });
  });

  return { app, service: realService, demoService };
}
