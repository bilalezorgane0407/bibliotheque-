import crypto from 'node:crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import type Database from 'better-sqlite3';
import {
  createAuthMiddleware,
  setSessionCookie,
  clearSessionCookie,
  hasSessionCookie,
  isHttpsRequest,
  isCrossSiteIframeContext,
  buildCookieOptions,
  type AuthenticatedRequest,
} from './auth/session.ts';
import { verifyPassword } from './auth/password.ts';
import { googleAuthAdapter } from './auth/googleAuthAdapter.ts';
import { DomainError, LibraryService } from './services/libraryService.ts';
import {
  MAX_QUANTITY_PER_TITLE,
  type AccountStatus,
  type CopyStatus,
  type PhysicalCondition,
  type ReturnInspectionOutcome,
  type StudentStatus,
  type UserPublic,
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

export function createApp(db: Database.Database, getNow: () => Date = () => new Date()) {
  const app = express();
  const service = new LibraryService(db);
  const { attachUser, requireAuth, requireLibrarian } = createAuthMiddleware(db);
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

  // --- Authentification Google Institutionnelle & SSO USMBA ---

  app.get('/api/auth/google/status', (_req, res) => {
    res.json(googleAuthAdapter.getStatus());
  });

  app.get('/api/auth/google/url', (_req, res) => {
    if (!googleAuthAdapter.isConfigured()) {
      const status = googleAuthAdapter.getStatus();
      res.status(501).json({
        error: status.message,
        code: 'GOOGLE_OAUTH_NOT_CONFIGURED',
        googleAuth: status,
      });
      return;
    }

    const state = createSignedOAuthState();
    const nonce = crypto.randomBytes(16).toString('hex');
    const authorizationUrl = googleAuthAdapter.buildAuthorizationUrl(state, nonce);
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
      const claims = await googleAuthAdapter.exchangeCodeForClaims(code);
      const resolution = await googleAuthAdapter.resolveProvisionedUser(db, claims, now);

      setSessionCookie(req, res, resolution.user.id);
      service.recordAuditLog(
        resolution.user,
        'AUTH_GOOGLE_LOGIN',
        'user',
        resolution.user.id,
        `Connexion Google OIDC vérifiée pour ${resolution.user.email} (statut EST Fès : ${resolution.user.studentStatus}).`,
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
        `SELECT id, fullName, email, role, institution, studentStatus, accountStatus, cne, filiere, authSource, isDemo, createdAt
         FROM users WHERE id = ?`
      )
      .get(entry.userId) as (UserPublic & { isDemo?: number | boolean }) | undefined;

    if (!row) {
      res.status(404).json({ error: 'Compte introuvable.' });
      return;
    }

    const user: UserPublic = { ...row, isDemo: Boolean(row.isDemo) };
    setSessionCookie(req, res, user.id);
    const eligibility = service.checkEligibility(user.id, getNow());
    res.json({
      authenticated: true,
      user,
      eligibility,
      requiresLibrarianValidation: entry.requiresLibrarianValidation,
    });
  });

  app.get('/api/auth/me', (req: AuthenticatedRequest, res) => {
    const now = getNow();
    service.processDeadlines(now);
    const user = req.user || null;
    const eligibility = service.checkEligibility(user?.id, now);
    const cookieReceived = hasSessionCookie(req);
    res.json({
      authenticated: Boolean(user),
      cookieReceived,
      user,
      eligibility,
      googleAuth: googleAuthAdapter.getStatus(),
      demoModeEnabled: process.env.DISABLE_DEMO_MODE !== 'true',
    });
  });

  app.post('/api/auth/demo-login', (req: Request, res: Response) => {
    if (process.env.DISABLE_DEMO_MODE === 'true') {
      res.status(403).json({
        error: 'Les comptes de démonstration sont désactivés dans cet environnement.',
        code: 'DEMO_MODE_DISABLED',
      });
      return;
    }

    const { userId, email } = req.body as { userId?: string; email?: string };
    const row = (
      userId
        ? db.prepare(`SELECT * FROM users WHERE id = ? AND isDemo = 1`).get(userId.trim())
        : email
          ? db
              .prepare(`SELECT * FROM users WHERE LOWER(email) = LOWER(?) AND isDemo = 1`)
              .get(email.trim())
          : undefined
    ) as (UserPublic & { passwordHash: string; isDemo?: number }) | undefined;

    if (!row) {
      res.status(404).json({
        error: 'Compte d’évaluation fictif introuvable.',
        code: 'DEMO_ACCOUNT_NOT_FOUND',
      });
      return;
    }

    const { passwordHash: _ignored, isDemo, ...userBase } = row;
    const userPublic: UserPublic = { ...userBase, isDemo: Boolean(isDemo) };
    const now = getNow();
    setSessionCookie(req, res, userPublic.id);
    const eligibility = service.checkEligibility(userPublic.id, now);
    service.recordAuditLog(
      userPublic,
      'AUTH_DEMO_LOGIN',
      'user',
      userPublic.id,
      `Connexion via compte fictif d’évaluation (${userPublic.email}).`,
      now
    );
    res.json({ authenticated: true, user: userPublic, eligibility });
  });

  app.post('/api/auth/login', (req: Request, res: Response) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) {
      res.status(400).json({ error: 'Adresse e-mail et mot de passe requis.' });
      return;
    }

    const row = db
      .prepare(`SELECT * FROM users WHERE LOWER(email) = LOWER(?)`)
      .get(email.trim()) as (UserPublic & { passwordHash: string; isDemo?: number }) | undefined;

    if (row && (!Boolean(row.isDemo) || row.authSource === 'google_oidc')) {
      res.status(403).json({
        error:
          'Les comptes institutionnels s’authentifient exclusivement via le bouton « Se connecter avec Google ». Aucun mot de passe Google ne doit être saisi ici.',
        code: 'GOOGLE_OAUTH_REQUIRED',
      });
      return;
    }

    if (process.env.DISABLE_DEMO_MODE === 'true') {
      res.status(403).json({
        error:
          'L’authentification locale de démonstration est désactivée. Utilisez le bouton « Se connecter avec Google ».',
        code: 'DEMO_MODE_DISABLED',
      });
      return;
    }

    const passwordValid = row ? verifyPassword(password, row.passwordHash) : false;
    if (!row || !passwordValid) {
      res.status(401).json({
        error: 'Identifiants de démonstration invalides.',
        code: 'INVALID_CREDENTIALS',
      });
      return;
    }

    const { passwordHash: _ignored, isDemo, ...userBase } = row;
    const userPublic: UserPublic = { ...userBase, isDemo: Boolean(isDemo) };
    const now = getNow();
    setSessionCookie(req, res, userPublic.id);
    const eligibility = service.checkEligibility(userPublic.id, now);
    service.recordAuditLog(
      userPublic,
      'AUTH_DEMO_LOGIN',
      'user',
      userPublic.id,
      `Connexion via compte fictif d’évaluation (${userPublic.email}).`,
      now
    );
    res.json({ authenticated: true, user: userPublic, eligibility });
  });

  app.post('/api/auth/register', (_req: Request, res: Response) => {
    res.status(403).json({
      error:
        'Les comptes académiques sont fournis et administrés par l’école. La création autonome de compte ou d’adresse académique est désactivée.',
      code: 'SELF_REGISTRATION_DISABLED',
    });
  });

  app.post('/api/auth/logout', (req, res) => {
    clearSessionCookie(req, res);
    console.info('[auth:logout]', { status: 200, https: isHttpsRequest(req) });
    res.json({ ok: true });
  });

  // --- Catalogue public & consultation ---

  app.get('/api/books', (req, res) => {
    service.processDeadlines(getNow());
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const language = typeof req.query.language === 'string' ? req.query.language : undefined;
    const yearRaw = typeof req.query.year === 'string' ? Number(req.query.year) : NaN;
    const year = Number.isFinite(yearRaw) && yearRaw > 0 ? yearRaw : null;
    const availableOnly = req.query.availableOnly === 'true';

    const books = service.listBooks({
      search,
      category,
      language,
      year,
      availableOnly,
      includeArchived: false,
    });
    res.json({ books });
  });

  app.get('/api/books/:id', (req, res, next) => {
    try {
      const detail = service.getBookDetail(req.params.id, getNow());
      res.json({ book: detail });
    } catch (err) {
      next(err);
    }
  });

  // --- Opérations Membre (emprunts, réservations, notifications) ---

  app.post('/api/books/:id/borrow', requireAuth, (req: AuthenticatedRequest, res, next) => {
    try {
      const loan = service.borrowBook(req.user!.id, String(req.params.id), getNow());
      res.status(201).json({ loan });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/books/:id/reserve', requireAuth, (req: AuthenticatedRequest, res, next) => {
    try {
      const reservation = service.reserveBook(req.user!.id, String(req.params.id), getNow());
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
    const loans = service.getMemberLoans(req.user!.id, getNow());
    res.json({ loans });
  });

  app.get('/api/reservations/mine', requireAuth, (req: AuthenticatedRequest, res) => {
    const reservations = service.getMemberReservations(req.user!.id, getNow());
    res.json({ reservations });
  });

  app.post('/api/reservations/:id/cancel', requireAuth, (req: AuthenticatedRequest, res, next) => {
    try {
      const reservation = service.cancelReservation(
        String(req.params.id),
        req.user!,
        getNow()
      );
      res.json({ reservation });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/notifications/mine', requireAuth, (req: AuthenticatedRequest, res) => {
    const notifications = service.getMemberNotifications(req.user!.id);
    res.json({ notifications });
  });

  app.post('/api/notifications/:id/read', requireAuth, (req: AuthenticatedRequest, res) => {
    service.markNotificationRead(String(req.params.id), req.user!.id, getNow());
    res.json({ ok: true });
  });

  app.post('/api/notifications/read-all', requireAuth, (req: AuthenticatedRequest, res) => {
    service.markAllNotificationsRead(req.user!.id, getNow());
    res.json({ ok: true });
  });

  // --- Panier de demandes (ne réserve jamais d'exemplaire avant confirmation serveur) ---

  app.get('/api/cart', requireAuth, (req: AuthenticatedRequest, res) => {
    const items = service.getCart(req.user!.id, getNow());
    res.json({ items, maxQuantityPerTitle: MAX_QUANTITY_PER_TITLE });
  });

  app.post('/api/cart/items', requireAuth, (req: AuthenticatedRequest, res, next) => {
    try {
      const { bookId, quantity } = req.body as { bookId?: string; quantity?: number };
      if (!bookId) {
        res.status(400).json({ error: 'Identifiant d’ouvrage requis.' });
        return;
      }
      const items = service.addToCart(
        req.user!.id,
        bookId,
        quantity === undefined ? 1 : Number(quantity),
        getNow()
      );
      res.status(201).json({ items });
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/cart/items/:bookId', requireAuth, (req: AuthenticatedRequest, res, next) => {
    try {
      const { quantity } = req.body as { quantity?: number };
      if (quantity === undefined) {
        res.status(400).json({ error: 'Quantité requise.' });
        return;
      }
      const items = service.updateCartItemQuantity(
        req.user!.id,
        String(req.params.bookId),
        Number(quantity),
        getNow()
      );
      res.json({ items });
    } catch (err) {
      next(err);
    }
  });

  app.delete('/api/cart/items/:bookId', requireAuth, (req: AuthenticatedRequest, res, next) => {
    try {
      const items = service.removeFromCart(
        req.user!.id,
        String(req.params.bookId),
        getNow()
      );
      res.json({ items });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/cart/confirm', requireAuth, (req: AuthenticatedRequest, res, next) => {
    try {
      const confirmation = service.confirmCart(req.user!.id, getNow());
      res.json(confirmation);
    } catch (err) {
      next(err);
    }
  });

  // --- Espace Bibliothécaire (strictement protégé par requireLibrarian) ---

  app.get('/api/admin/stats', requireLibrarian, (_req, res) => {
    res.json({ stats: service.getDashboardStats(getNow()) });
  });

  app.get('/api/admin/books', requireLibrarian, (_req, res) => {
    const books = service.listBooks({ includeArchived: true });
    res.json({ books });
  });

  app.post('/api/admin/books', requireLibrarian, (req: AuthenticatedRequest, res, next) => {
    try {
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

      const book = service.createBook(
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
        getNow(),
        req.user!
      );
      res.status(201).json({ book });
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/admin/books/:id', requireLibrarian, (req: AuthenticatedRequest, res, next) => {
    try {
      const book = service.updateBook(String(req.params.id), req.body, req.user!, getNow());
      res.json({ book });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/admin/copies', requireLibrarian, (_req, res) => {
    res.json({ copies: service.getAllCopiesAdmin() });
  });

  app.post('/api/admin/books/:id/copies', requireLibrarian, (req: AuthenticatedRequest, res, next) => {
    try {
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
      const result = service.registerCopy(
        String(req.params.id),
        { barcode, physicalCondition, location },
        getNow(),
        req.user!
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/admin/copies/:id', requireLibrarian, (req: AuthenticatedRequest, res, next) => {
    try {
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
      const copy = service.updateCopyStatusAdmin(
        String(req.params.id),
        status,
        physicalCondition,
        location,
        getNow(),
        req.user!
      );
      res.json({ copy });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/admin/copies/:id/complete-repair', requireLibrarian, (req: AuthenticatedRequest, res, next) => {
    try {
      const copy = service.completeCopyRepair(String(req.params.id), req.user!, getNow());
      res.json({ copy });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/admin/copies/:id/inspect', requireLibrarian, (req: AuthenticatedRequest, res, next) => {
    try {
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
      const result = service.inspectRepairedCopy(
        String(req.params.id),
        outcome,
        physicalCondition,
        getNow(),
        req.user!
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/admin/loans', requireLibrarian, (_req, res) => {
    res.json({ loans: service.getAllLoansAdmin(getNow()) });
  });

  app.post('/api/admin/loans', requireLibrarian, (req: AuthenticatedRequest, res, next) => {
    try {
      const { memberId, bookId, copyId } = req.body as {
        memberId?: string;
        bookId?: string;
        copyId?: string | null;
      };
      if (!memberId || !bookId) {
        res.status(400).json({ error: 'Membre et ouvrage requis pour enregistrer un prêt.' });
        return;
      }
      const loan = service.createLoanAdmin(memberId, bookId, copyId || null, req.user!, getNow());
      res.status(201).json({ loan });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/admin/loans/:id/return', requireLibrarian, (req: AuthenticatedRequest, res, next) => {
    try {
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
      const result = service.returnLoan(
        String(req.params.id),
        outcome,
        physicalCondition,
        notes,
        getNow(),
        req.user!
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/admin/reservations', requireLibrarian, (_req, res) => {
    res.json({ reservations: service.getAllReservationsAdmin(getNow()) });
  });

  app.post('/api/admin/reservations/allocate', requireLibrarian, (req: AuthenticatedRequest, res, next) => {
    try {
      const { bookId } = req.body as { bookId?: string };
      if (!bookId) {
        res.status(400).json({ error: 'Identifiant d’ouvrage requis.' });
        return;
      }
      const result = service.allocateAvailableCopyToQueueAdmin(bookId, req.user!, getNow());
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
        const reservation = service.confirmReservationAvailability(
          String(req.params.id),
          req.user!,
          getNow()
        );
        res.json({ reservation });
      } catch (err) {
        next(err);
      }
    }
  );

  app.post('/api/admin/reservations/:id/pickup', requireLibrarian, (req: AuthenticatedRequest, res, next) => {
    try {
      const loan = service.fulfillReservationPickup(String(req.params.id), getNow(), req.user!);
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
        const reservation = service.cancelReservation(
          String(req.params.id),
          req.user!,
          getNow()
        );
        res.json({ reservation });
      } catch (err) {
        next(err);
      }
    }
  );

  app.post('/api/admin/reservations/process-deadlines', requireLibrarian, (_req, res) => {
    const expiredCount = service.processDeadlines(getNow());
    res.json({ expiredCount });
  });

  app.get('/api/admin/members', requireLibrarian, (_req, res) => {
    res.json({ members: service.listMembersAdmin() });
  });

  app.patch('/api/admin/members/:id/verification', requireLibrarian, (req: AuthenticatedRequest, res, next) => {
    try {
      const { studentStatus, accountStatus } = req.body as {
        studentStatus?: StudentStatus;
        accountStatus?: AccountStatus;
      };
      if (!studentStatus || !accountStatus) {
        res.status(400).json({ error: 'studentStatus et accountStatus requis.' });
        return;
      }
      const member = service.updateMemberVerificationAdmin(
        String(req.params.id),
        studentStatus,
        accountStatus,
        req.user!,
        getNow()
      );
      res.json({ member });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/admin/audit-logs', requireLibrarian, (req, res) => {
    const limitRaw = typeof req.query.limit === 'string' ? Number(req.query.limit) : 100;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 100;
    res.json({ logs: service.getAuditLogsAdmin(limit) });
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

  return { app, service };
}
