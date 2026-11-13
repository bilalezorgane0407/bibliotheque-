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
import { hashPassword, verifyPassword } from './auth/password.ts';
import { usmbaSsoAdapter } from './auth/usmbaSsoAdapter.ts';
import { DomainError, LibraryService } from './services/libraryService.ts';
import type {
  AccountStatus,
  CopyStatus,
  LoanRecord,
  PhysicalCondition,
  ReturnInspectionOutcome,
  StudentStatus,
  UserPublic,
} from '../shared/types.ts';

const emailVerificationSendLimits = new Map<string, { count: number; resetAt: number }>();
function allowVerificationEmail(ip: string, nowMs: number): boolean {
  const limit = emailVerificationSendLimits.get(ip);
  if (!limit || limit.resetAt <= nowMs) {
    emailVerificationSendLimits.set(ip, { count: 1, resetAt: nowMs + 60 * 60_000 });
    return true;
  }
  if (limit.count >= 5) return false;
  limit.count += 1;
  return true;
}

export function createApp(db: Database.Database, getNow: () => Date = () => new Date()) {
  const app = express();
  const service = new LibraryService(db);
  const { attachUser, requireAuth, requireLibrarian } = createAuthMiddleware(db);

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

  // --- Authentification & SSO USMBA ---

  app.get('/api/auth/sso/status', (_req, res) => {
    res.json(usmbaSsoAdapter.getStatus());
  });

  app.get('/api/auth/sso/login', (_req, res) => {
    if (!usmbaSsoAdapter.isConfigured()) {
      res.status(501).json({
        error:
          'Le fournisseur SSO officiel de l’USMBA n’est pas configuré dans cet environnement.',
        code: 'SSO_NOT_CONFIGURED',
        sso: usmbaSsoAdapter.getStatus(),
      });
      return;
    }
    const state = crypto.randomBytes(16).toString('hex');
    const url = usmbaSsoAdapter.buildAuthorizationUrl(state);
    res.json({ authorizationUrl: url });
  });

  app.get('/api/auth/me', (req: AuthenticatedRequest, res) => {
    const now = getNow();
    service.processDeadlines(now);
    const user = req.user || null;
    const eligibility = service.checkEligibility(user?.id, now);
    const cookieReceived = hasSessionCookie(req);
    const https = isHttpsRequest(req);
    const crossSiteIframe = isCrossSiteIframeContext(req);
    console.info('[auth:me]', {
      status: 200,
      authenticated: Boolean(user),
      userId: user?.id || null,
      role: user?.role || null,
      cookiePresent: cookieReceived,
      https,
      crossSiteIframe,
    });
    res.json({
      authenticated: Boolean(user),
      cookieReceived,
      user,
      eligibility,
      sso: usmbaSsoAdapter.getStatus(),
    });
  });

  app.post('/api/auth/login', (req: Request, res: Response) => {
    const { email, password } = req.body as { email?: string; password?: string };
    const https = isHttpsRequest(req);
    if (!email || !password) {
      console.info('[auth:login]', { status: 400, outcome: 'MISSING_FIELDS', https });
      res.status(400).json({ error: 'Adresse e-mail et mot de passe requis.' });
      return;
    }

    const row = db
      .prepare(`SELECT * FROM users WHERE LOWER(email) = LOWER(?)`)
      .get(email.trim()) as (UserPublic & { passwordHash: string }) | undefined;

    const passwordValid = row ? verifyPassword(password, row.passwordHash) : false;
    if (!row || !passwordValid) {
      console.info('[auth:login]', {
        status: 401,
        outcome: row ? 'INVALID_PASSWORD' : 'USER_NOT_FOUND',
        https,
      });
      res.status(401).json({
        error: 'Identifiants invalides. Vérifiez votre adresse USMBA et votre mot de passe.',
        code: 'INVALID_CREDENTIALS',
      });
      return;
    }

    const { passwordHash: _ignored, ...userPublic } = row;
    setSessionCookie(req, res, userPublic.id);
    const cookieOpts = buildCookieOptions(req);
    const eligibility = service.checkEligibility(userPublic.id, getNow());
    console.info('[auth:login]', {
      status: 200,
      outcome: 'AUTHENTICATED',
      userId: userPublic.id,
      role: userPublic.role,
      eligible: eligibility.eligible,
      https,
      sameSite: cookieOpts.sameSite,
      secure: Boolean(cookieOpts.secure),
      partitioned: Boolean(cookieOpts.partitioned),
    });
    res.json({ authenticated: true, user: userPublic, eligibility });
  });

  app.post('/api/auth/register', (req: Request, res: Response) => {
    const { fullName, email, password, cne, filiere } = req.body as {
      fullName?: string;
      email?: string;
      password?: string;
      cne?: string;
      filiere?: string;
    };

    if (!fullName?.trim() || !email || !password || password.length < 8) {
      res.status(400).json({
        error:
          'Nom complet, adresse e-mail et mot de passe (8 caractères minimum) sont requis.',
      });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) ||
      (!normalizedEmail.endsWith('@usmba.ac.ma') && !normalizedEmail.endsWith('@est-usmba.ac.ma'))
    ) {
      res.status(400).json({
        error: 'Utilisez une adresse académique institutionnelle @usmba.ac.ma ou @est-usmba.ac.ma.',
      });
      return;
    }

    const existing = db.prepare(`SELECT id FROM users WHERE LOWER(email) = ?`).get(normalizedEmail);
    if (existing) {
      res.status(409).json({
        error: 'Un compte associé à cette adresse e-mail USMBA existe déjà.',
      });
      return;
    }

    db.prepare(`DELETE FROM pending_registrations WHERE expiresAt <= ?`).run(getNow().toISOString());
    const pending = db
      .prepare(`SELECT lastSentAt FROM pending_registrations WHERE email = ?`)
      .get(normalizedEmail) as { lastSentAt: string } | undefined;
    const now = getNow();
    if (pending && now.getTime() - new Date(pending.lastSentAt).getTime() < 60_000) {
      res.status(429).json({ error: 'Un code vient d’être envoyé. Attendez une minute avant de le renvoyer.' });
      return;
    }

    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from = process.env.EMAIL_FROM?.trim();
    if (process.env.EMAIL_SEND_ENABLED !== 'true' || !apiKey || !from) {
      res.status(503).json({
        error: 'La vérification par e-mail n’est pas configurée. L’administrateur doit configurer l’envoi d’e-mails.',
        code: 'EMAIL_SENDING_NOT_CONFIGURED',
      });
      return;
    }
    if (!allowVerificationEmail(req.ip || 'unknown', now.getTime())) {
      res.status(429).json({ error: 'Trop de demandes d’inscription depuis cette connexion. Réessayez dans une heure.' });
      return;
    }

    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
    const secret = process.env.SESSION_SECRET || crypto
      .createHash('sha256')
      .update(process.cwd() + '_biblioest_dev_session_key')
      .digest('hex');
    const codeHash = crypto.createHmac('sha256', secret).update(`${normalizedEmail}:${code}`).digest('hex');
    const expiresAt = new Date(now.getTime() + 10 * 60_000).toISOString();
    const lastSentAt = now.toISOString();
    db.prepare(
      `INSERT INTO pending_registrations (email, fullName, passwordHash, cne, filiere, codeHash, expiresAt, attempts, lastSentAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT(email) DO UPDATE SET fullName = excluded.fullName, passwordHash = excluded.passwordHash,
         cne = excluded.cne, filiere = excluded.filiere, codeHash = excluded.codeHash,
         expiresAt = excluded.expiresAt, attempts = 0, lastSentAt = excluded.lastSentAt`
    ).run(
      normalizedEmail,
      fullName.trim(),
      hashPassword(password),
      cne?.trim() || null,
      filiere?.trim() || null,
      codeHash,
      expiresAt,
      lastSentAt
    );

    void fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [normalizedEmail],
        subject: 'Votre code de vérification BiblioEST',
        text: `Bonjour ${fullName.trim()},\n\nVotre code de vérification BiblioEST est : ${code}\n\nIl expire dans 10 minutes. Si vous n’avez pas demandé cette inscription, ignorez ce message.\n\nBibliothèque de l’EST Fès · USMBA`,
      }),
      signal: AbortSignal.timeout(10000),
    }).then(async (providerResponse) => {
      if (providerResponse.ok) {
        console.info('[auth:register]', { status: 202, outcome: 'VERIFICATION_SENT' });
        res.status(202).json({ verificationRequired: true, email: normalizedEmail });
        return;
      }
      const providerError = await providerResponse.text();
      console.error('[auth:register] email provider rejected verification email', {
        status: providerResponse.status,
        providerError,
      });
      db.prepare(`DELETE FROM pending_registrations WHERE email = ?`).run(normalizedEmail);
      res.status(502).json({ error: 'Le fournisseur e-mail a refusé le message de vérification.', code: 'EMAIL_PROVIDER_REJECTED' });
    }).catch((err: unknown) => {
      db.prepare(`DELETE FROM pending_registrations WHERE email = ?`).run(normalizedEmail);
      console.error('[auth:register] verification email failed', err);
      if (!res.headersSent) res.status(502).json({ error: 'Impossible d’envoyer le code de vérification.', code: 'EMAIL_SEND_FAILED' });
    });
  });

  app.post('/api/auth/register/resend', async (req: Request, res: Response) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!email) {
      res.status(400).json({ error: 'Adresse e-mail requise.' });
      return;
    }
    const pending = db.prepare(`SELECT email, fullName, lastSentAt FROM pending_registrations WHERE email = ?`)
      .get(email) as { email: string; fullName: string; lastSentAt: string } | undefined;
    if (!pending) {
      res.status(404).json({ error: 'Aucune inscription en attente pour cette adresse.' });
      return;
    }
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from = process.env.EMAIL_FROM?.trim();
    if (process.env.EMAIL_SEND_ENABLED !== 'true' || !apiKey || !from) {
      res.status(503).json({ error: 'L’envoi d’e-mails n’est pas configuré.', code: 'EMAIL_SENDING_NOT_CONFIGURED' });
      return;
    }
    const now = getNow();
    if (!allowVerificationEmail(req.ip || 'unknown', now.getTime())) {
      res.status(429).json({ error: 'Trop de demandes de code. Réessayez dans une heure.' });
      return;
    }
    if (now.getTime() - new Date(pending.lastSentAt).getTime() < 60_000) {
      res.status(429).json({ error: 'Attendez une minute avant de demander un nouveau code.' });
      return;
    }
    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
    const secret = process.env.SESSION_SECRET || crypto.createHash('sha256').update(process.cwd() + '_biblioest_dev_session_key').digest('hex');
    const codeHash = crypto.createHmac('sha256', secret).update(`${email}:${code}`).digest('hex');
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from,
          to: [email],
          subject: 'Votre nouveau code BiblioEST',
          text: `Bonjour ${pending.fullName},\n\nVotre nouveau code de vérification BiblioEST est : ${code}\n\nIl expire dans 10 minutes.\n\nBibliothèque de l’EST Fès · USMBA`,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        res.status(502).json({ error: 'Le fournisseur e-mail a refusé le message de vérification.', code: 'EMAIL_PROVIDER_REJECTED' });
        return;
      }
      db.prepare(`UPDATE pending_registrations SET codeHash = ?, expiresAt = ?, attempts = 0, lastSentAt = ? WHERE email = ?`)
        .run(codeHash, new Date(now.getTime() + 10 * 60_000).toISOString(), now.toISOString(), email);
      res.json({ sent: true });
    } catch {
      res.status(502).json({ error: 'Impossible d’envoyer le code de vérification.', code: 'EMAIL_SEND_FAILED' });
    }
  });

  app.post('/api/auth/register/verify', (req: Request, res: Response) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    if (!email || !/^\d{6}$/.test(code)) {
      res.status(400).json({ error: 'Adresse e-mail et code à 6 chiffres requis.' });
      return;
    }
    const pending = db.prepare(`SELECT * FROM pending_registrations WHERE email = ?`)
      .get(email) as {
        email: string; fullName: string; passwordHash: string; cne: string | null; filiere: string | null;
        codeHash: string; expiresAt: string; attempts: number;
      } | undefined;
    if (!pending || new Date(pending.expiresAt).getTime() <= getNow().getTime() || pending.attempts >= 5) {
      if (pending) db.prepare(`DELETE FROM pending_registrations WHERE email = ?`).run(email);
      res.status(400).json({ error: 'Code invalide ou expiré. Demandez un nouveau code.' });
      return;
    }
    const secret = process.env.SESSION_SECRET || crypto.createHash('sha256').update(process.cwd() + '_biblioest_dev_session_key').digest('hex');
    const submittedHash = crypto.createHmac('sha256', secret).update(`${email}:${code}`).digest('hex');
    const submitted = Buffer.from(submittedHash, 'hex');
    const expected = Buffer.from(pending.codeHash, 'hex');
    if (submitted.length !== expected.length || !crypto.timingSafeEqual(submitted, expected)) {
      const attempts = pending.attempts + 1;
      db.prepare(`UPDATE pending_registrations SET attempts = ? WHERE email = ?`).run(attempts, email);
      if (attempts >= 5) db.prepare(`DELETE FROM pending_registrations WHERE email = ?`).run(email);
      res.status(400).json({ error: attempts >= 5 ? 'Trop de codes incorrects. Recommencez l’inscription.' : 'Code incorrect.' });
      return;
    }

    const existing = db.prepare(`SELECT id FROM users WHERE LOWER(email) = ?`).get(email);
    if (existing) {
      db.prepare(`DELETE FROM pending_registrations WHERE email = ?`).run(email);
      res.status(409).json({ error: 'Un compte associé à cette adresse académique existe déjà.' });
      return;
    }
    const userId = `usr-${crypto.randomUUID().slice(0, 12)}`;
    const nowIso = getNow().toISOString();
    const userInstitution = 'EST Fès';
    const initialStudentStatus: StudentStatus = 'en_attente';
    const createUser = db.transaction(() => {
      db.prepare(
        `INSERT INTO users (id, fullName, email, passwordHash, role, institution, studentStatus, accountStatus, cne, filiere, authSource, createdAt)
         VALUES (?, ?, ?, ?, 'membre', ?, ?, 'actif', ?, ?, 'local', ?)`
      ).run(userId, pending.fullName, email, pending.passwordHash, userInstitution, initialStudentStatus, pending.cne, pending.filiere, nowIso);
      db.prepare(`DELETE FROM pending_registrations WHERE email = ?`).run(email);
    });
    createUser();
    const user = db.prepare(
      `SELECT id, fullName, email, role, institution, studentStatus, accountStatus, cne, filiere, authSource, createdAt FROM users WHERE id = ?`
    ).get(userId) as UserPublic;
    setSessionCookie(req, res, user.id);
    const eligibility = service.checkEligibility(user.id, getNow());
    res.status(201).json({ user, eligibility });
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

  // --- Espace Bibliothécaire (strictement protégé par requireLibrarian) ---

  app.get('/api/admin/stats', requireLibrarian, (_req, res) => {
    res.json({ stats: service.getDashboardStats(getNow()) });
  });

  app.get('/api/admin/books', requireLibrarian, (_req, res) => {
    const books = service.listBooks({ includeArchived: true });
    res.json({ books });
  });

  app.post('/api/admin/books', requireLibrarian, (req, res, next) => {
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
        getNow()
      );
      res.status(201).json({ book });
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/admin/books/:id', requireLibrarian, (req, res, next) => {
    try {
      const book = service.updateBook(String(req.params.id), req.body);
      res.json({ book });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/admin/copies', requireLibrarian, (_req, res) => {
    res.json({ copies: service.getAllCopiesAdmin() });
  });

  app.post('/api/admin/books/:id/copies', requireLibrarian, (req, res, next) => {
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
        getNow()
      );
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/admin/copies/:id', requireLibrarian, (req, res, next) => {
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
        getNow()
      );
      res.json({ copy });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/admin/copies/:id/complete-repair', requireLibrarian, (req, res, next) => {
    try {
      const copy = service.completeCopyRepair(String(req.params.id));
      res.json({ copy });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/admin/copies/:id/inspect', requireLibrarian, (req, res, next) => {
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
        getNow()
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/admin/loans', requireLibrarian, (_req, res) => {
    res.json({ loans: service.getAllLoansAdmin(getNow()) });
  });

  app.post('/api/admin/overdue-reminders', requireLibrarian, async (_req, res, next) => {
    try {
      const apiKey = process.env.RESEND_API_KEY?.trim();
      const from = process.env.EMAIL_FROM?.trim();
      if (
        process.env.EMAIL_SEND_ENABLED !== 'true' ||
        process.env.EMAIL_BULK_REMINDERS_ENABLED !== 'true' ||
        !apiKey ||
        !from
      ) {
        res.status(503).json({
          error:
            'L’envoi groupé est désactivé. Configurez les secrets du serveur et activez explicitement EMAIL_BULK_REMINDERS_ENABLED après le test.',
          code: 'EMAIL_SENDING_NOT_CONFIGURED',
        });
        return;
      }

      const overdueLoans = service
        .getAllLoansAdmin(getNow())
        .filter((loan) => loan.status === 'En retard');
      const recipients = new Map<string, { name: string; email: string; loans: LoanRecord[] }>();
      const skippedMembers = new Set<string>();

      for (const loan of overdueLoans) {
        const email = loan.memberEmail?.trim();
        const normalizedEmail = email?.toLowerCase();
        const emailDomain = normalizedEmail?.split('@')[1] || '';
        if (
          !email ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
          /\.(example|test|invalid|localhost)$/.test(emailDomain)
        ) {
          skippedMembers.add(loan.memberId);
          continue;
        }

        const recipient = recipients.get(loan.memberId) || {
          name: loan.memberName || 'Membre',
          email,
          loans: [],
        };
        recipient.loans.push(loan);
        recipients.set(loan.memberId, recipient);
      }

      let acceptedCount = 0;
      let failedCount = 0;
      const dateKey = getNow().toISOString().slice(0, 10);
      for (const [memberId, recipient] of recipients) {
        const loanLines = recipient.loans.map((loan) => {
          const dueDate = new Intl.DateTimeFormat('fr-FR', {
            dateStyle: 'long',
            timeZone: 'Africa/Casablanca',
          }).format(new Date(loan.dueAt));
          return `- « ${loan.bookTitle} » (code ${loan.copyBarcode}), échéance le ${dueDate}`;
        });
        const text = [
          `Bonjour ${recipient.name},`,
          '',
          'Selon nos registres, le ou les emprunts suivants sont en retard :',
          ...loanLines,
          '',
          'Merci de rapporter ces ouvrages à la bibliothèque de l’EST Fès. Si vous les avez déjà rendus, vous pouvez ignorer ce message ou contacter le personnel de la bibliothèque.',
          '',
          'Bibliothèque de l’EST Fès · USMBA',
        ].join('\n');
        const idempotencyKey = crypto
          .createHash('sha256')
          .update(`${memberId}:${dateKey}:${recipient.loans.map((loan) => loan.id).sort().join(',')}`)
          .digest('hex');

        try {
          const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              'Idempotency-Key': idempotencyKey,
            },
            body: JSON.stringify({
              from,
              to: [recipient.email],
              subject: 'Rappel : emprunt(s) en retard — Bibliothèque EST Fès',
              text,
            }),
            signal: AbortSignal.timeout(10000),
          });
          if (response.ok) acceptedCount += 1;
          else failedCount += 1;
        } catch {
          failedCount += 1;
        }
      }

      res.json({ acceptedCount, failedCount, skippedCount: skippedMembers.size });
    } catch (err) {
      next(err);
    }
  });

  // Envoi de contrôle isolé : aucun message n'est adressé aux membres.
  app.post('/api/admin/email-test', requireLibrarian, async (_req, res, next) => {
    try {
      const apiKey = process.env.RESEND_API_KEY?.trim();
      const from = process.env.EMAIL_FROM?.trim();
      const recipient = process.env.EMAIL_TEST_RECIPIENT?.trim();
      if (process.env.EMAIL_SEND_ENABLED !== 'true' || !apiKey || !from || !recipient) {
        res.status(503).json({
          error:
            'Configurez EMAIL_SEND_ENABLED=true, RESEND_API_KEY, EMAIL_FROM et EMAIL_TEST_RECIPIENT dans les secrets du serveur.',
          code: 'EMAIL_SENDING_NOT_CONFIGURED',
        });
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
        res.status(503).json({
          error: 'EMAIL_TEST_RECIPIENT doit contenir une adresse e-mail valide.',
          code: 'INVALID_EMAIL_TEST_RECIPIENT',
        });
        return;
      }

      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `biblioest-test:${crypto.createHash('sha256').update(recipient.toLowerCase()).digest('hex')}:${getNow().toISOString().slice(0, 13)}`,
        },
        body: JSON.stringify({
          from,
          to: [recipient],
          subject: 'Test d’envoi — Bibliothèque EST Fès',
          text: [
            'Bonjour,',
            '',
            'Ceci est un message de test de la configuration e-mail de la Bibliothèque EST Fès.',
            'Aucun rappel de retard n’a été envoyé aux membres.',
            '',
            'Bibliothèque de l’EST Fès · USMBA',
          ].join('\n'),
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        const providerError = await response.text();
        console.error('[email:test] provider rejected request', { status: response.status, providerError });
        res.status(502).json({ error: 'Le fournisseur e-mail a refusé le message de test.', code: 'EMAIL_PROVIDER_REJECTED' });
        return;
      }
      res.json({ accepted: true });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/admin/loans/:id/return', requireLibrarian, (req, res, next) => {
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
        getNow()
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/admin/reservations', requireLibrarian, (_req, res) => {
    res.json({ reservations: service.getAllReservationsAdmin(getNow()) });
  });

  app.post('/api/admin/reservations/:id/pickup', requireLibrarian, (req, res, next) => {
    try {
      const loan = service.fulfillReservationPickup(String(req.params.id), getNow());
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

  app.patch('/api/admin/members/:id/verification', requireLibrarian, (req, res, next) => {
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
        accountStatus
      );
      res.json({ member });
    } catch (err) {
      next(err);
    }
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
