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
    const { fullName, email, password, cne, filiere, institution } = req.body as {
      fullName?: string;
      email?: string;
      password?: string;
      cne?: string;
      filiere?: string;
      institution?: string;
    };

    if (!fullName || !email || !password || password.length < 8) {
      res.status(400).json({
        error:
          'Nom complet, adresse e-mail et mot de passe (8 caractères minimum) sont requis.',
      });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail.endsWith('@usmba.ac.ma') && !normalizedEmail.endsWith('@est-usmba.ac.ma')) {
      res.status(400).json({
        error: 'Seules les adresses universitaires USMBA (@usmba.ac.ma) sont acceptées.',
      });
      return;
    }

    const existing = db
      .prepare(`SELECT id FROM users WHERE LOWER(email) = ?`)
      .get(normalizedEmail);
    if (existing) {
      res.status(409).json({
        error: 'Un compte associé à cette adresse e-mail USMBA existe déjà.',
      });
      return;
    }

    // Règle métier : l'inscription locale ne confère JAMAIS automatiquement le statut étudiant EST Fès vérifié.
    const userId = `usr-${crypto.randomUUID().slice(0, 12)}`;
    const nowIso = getNow().toISOString();
    const targetInstitution = institution?.trim() || 'EST Fès';
    const initialStudentStatus: StudentStatus =
      targetInstitution === 'EST Fès' ? 'en_attente' : 'non_est';

    db.prepare(
      `INSERT INTO users (id, fullName, email, passwordHash, role, institution, studentStatus, accountStatus, cne, filiere, authSource, createdAt)
       VALUES (?, ?, ?, ?, 'membre', ?, ?, 'actif', ?, ?, 'local', ?)`
    ).run(
      userId,
      fullName.trim(),
      normalizedEmail,
      hashPassword(password),
      targetInstitution,
      initialStudentStatus,
      cne?.trim() || null,
      filiere?.trim() || null,
      nowIso
    );

    const user = db
      .prepare(
        `SELECT id, fullName, email, role, institution, studentStatus, accountStatus, cne, filiere, authSource, createdAt
         FROM users WHERE id = ?`
      )
      .get(userId) as UserPublic;

    setSessionCookie(req, res, user.id);
    const eligibility = service.checkEligibility(user.id, getNow());
    console.info('[auth:register]', {
      status: 201,
      outcome: 'REGISTERED',
      userId: user.id,
      studentStatus: user.studentStatus,
      https: isHttpsRequest(req),
    });
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
      if (process.env.EMAIL_SEND_ENABLED !== 'true' || !apiKey || !from) {
        res.status(503).json({
          error:
            'L’envoi d’e-mails n’est pas configuré. Ajoutez RESEND_API_KEY et EMAIL_FROM dans les secrets du serveur, puis activez EMAIL_SEND_ENABLED.',
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
