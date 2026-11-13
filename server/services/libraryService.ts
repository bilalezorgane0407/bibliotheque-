import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  BORROWING_DURATION_DAYS,
  MAX_QUANTITY_PER_TITLE,
  PICKUP_WINDOW_DAYS,
  type AuditLogRecord,
  type Book,
  type BookDetail,
  type BookWithStats,
  type CartConfirmationItemResult,
  type CartConfirmationResponse,
  type CartItemRecord,
  type Copy,
  type CopyStatus,
  type DashboardStats,
  type EligibilityReport,
  type LoanRecord,
  type NotificationRecord,
  type PhysicalCondition,
  type ReservationRecord,
  type ReturnInspectionOutcome,
  type StudentStatus,
  type AccountStatus,
  type UserPublic,
} from '../../shared/types.ts';

type AuditActor = {
  id?: string | null;
  fullName?: string | null;
  role?: string | null;
};

export class DomainError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode = 400, code = 'DOMAIN_ERROR') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function formatFrenchDateTime(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

function addDaysIso(date: Date, days: number): string {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

export class LibraryService {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  private generateId(prefix: string): string {
    return `${prefix}-${crypto.randomUUID().slice(0, 12)}`;
  }

  private syncOverdueLoansInternal(now: Date): void {
    const nowIso = now.toISOString();
    this.db
      .prepare(
        `UPDATE loans SET status = 'En retard' WHERE status = 'En cours' AND dueAt < ?`
      )
      .run(nowIso);
  }

  private insertNotificationInternal(
    userId: string,
    title: string,
    message: string,
    type: NotificationRecord['type'],
    now: Date
  ): void {
    this.db
      .prepare(
        `INSERT INTO notifications (id, userId, title, message, type, createdAt, readAt)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`
      )
      .run(this.generateId('ntf'), userId, title, message, type, now.toISOString());
  }

  private insertAuditLogInternal(
    actor: AuditActor | null | undefined,
    action: string,
    entityType: string,
    entityId: string,
    summary: string,
    now: Date
  ): void {
    this.db
      .prepare(
        `INSERT INTO audit_logs (id, actorId, actorName, actorRole, action, entityType, entityId, summary, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        this.generateId('aud'),
        actor?.id || null,
        actor?.fullName || null,
        actor?.role || null,
        action,
        entityType,
        entityId,
        summary,
        now.toISOString()
      );
  }

  public recordAuditLog(
    actor: AuditActor | null | undefined,
    action: string,
    entityType: string,
    entityId: string,
    summary: string,
    now: Date = new Date()
  ): void {
    this.insertAuditLogInternal(actor, action, entityType, entityId, summary, now);
  }

  private recalculateQueuePositionsInternal(bookId: string): void {
    const pending = this.db
      .prepare(
        `SELECT id FROM reservations
         WHERE bookId = ? AND status = 'En attente'
         ORDER BY requestedAt ASC, rowid ASC, id ASC`
      )
      .all(bookId) as Array<{ id: string }>;

    const updateStmt = this.db.prepare(`UPDATE reservations SET queuePosition = ? WHERE id = ?`);
    pending.forEach((row, index) => {
      updateStmt.run(index + 1, row.id);
    });
  }

  public checkEligibility(memberId: string | null | undefined, now: Date = new Date()): EligibilityReport {
    if (!memberId) {
      return {
        authenticated: false,
        verifiedEstStudent: false,
        accountActive: false,
        noOverdueLoans: false,
        eligible: false,
        overdueCount: 0,
        reasonCode: 'AUTH_REQUIRED',
        reasonMessage: 'Authentification requise. Veuillez vous connecter avec votre compte USMBA.',
      };
    }

    this.syncOverdueLoansInternal(now);

    const user = this.db
      .prepare(
        `SELECT id, institution, studentStatus, accountStatus FROM users WHERE id = ?`
      )
      .get(memberId) as
      | { id: string; institution: string; studentStatus: StudentStatus; accountStatus: AccountStatus }
      | undefined;

    if (!user) {
      return {
        authenticated: false,
        verifiedEstStudent: false,
        accountActive: false,
        noOverdueLoans: false,
        eligible: false,
        overdueCount: 0,
        reasonCode: 'AUTH_REQUIRED',
        reasonMessage: 'Session utilisateur introuvable. Authentification requise.',
      };
    }

    const accountActive = user.accountStatus === 'actif';
    if (!accountActive) {
      return {
        authenticated: true,
        verifiedEstStudent: user.institution === 'EST Fès' && user.studentStatus === 'verifie',
        accountActive: false,
        noOverdueLoans: false,
        eligible: false,
        overdueCount: 0,
        reasonCode: 'ACCOUNT_SUSPENDED',
        reasonMessage: 'Votre compte est actuellement suspendu par l’administration.',
      };
    }

    const verifiedEstStudent = user.institution === 'EST Fès' && user.studentStatus === 'verifie';
    if (!verifiedEstStudent) {
      return {
        authenticated: true,
        verifiedEstStudent: false,
        accountActive: true,
        noOverdueLoans: true,
        eligible: false,
        overdueCount: 0,
        reasonCode: 'EST_STATUS_NOT_VERIFIED',
        reasonMessage:
          'Statut d’étudiant EST Fès non vérifié. Votre inscription auprès de l’EST Fès doit être confirmée avant d’emprunter ou de réserver.',
      };
    }

    const nowIso = now.toISOString();
    const overdueRow = this.db
      .prepare(
        `SELECT COUNT(*) as cnt FROM loans
         WHERE memberId = ? AND status != 'Retourné' AND (status = 'En retard' OR dueAt < ?)`
      )
      .get(memberId, nowIso) as { cnt: number };

    const overdueCount = overdueRow.cnt;
    if (overdueCount > 0) {
      return {
        authenticated: true,
        verifiedEstStudent: true,
        accountActive: true,
        noOverdueLoans: false,
        eligible: false,
        overdueCount,
        reasonCode: 'OVERDUE_RETURN',
        reasonMessage: `Retour en retard détecté (${overdueCount} ouvrage${overdueCount > 1 ? 's' : ''}). Veuillez restituer vos emprunts en retard avant toute nouvelle opération.`,
      };
    }

    return {
      authenticated: true,
      verifiedEstStudent: true,
      accountActive: true,
      noOverdueLoans: true,
      eligible: true,
      overdueCount: 0,
      reasonCode: 'ELIGIBLE',
      reasonMessage: 'Membre éligible aux emprunts et réservations.',
    };
  }

  private assertEligibleInternal(memberId: string | null | undefined, now: Date): EligibilityReport {
    const report = this.checkEligibility(memberId, now);
    if (!report.authenticated) {
      throw new DomainError(report.reasonMessage, 401, report.reasonCode);
    }
    if (!report.eligible) {
      throw new DomainError(report.reasonMessage, 403, report.reasonCode);
    }
    return report;
  }

  private assignCopyToNextEligibleReservationInternal(
    bookId: string,
    copyId: string,
    now: Date,
    actor?: AuditActor | null
  ): string | null {
    const book = this.db
      .prepare(`SELECT title FROM books WHERE id = ?`)
      .get(bookId) as { title: string } | undefined;
    const copy = this.db
      .prepare(`SELECT barcode FROM copies WHERE id = ?`)
      .get(copyId) as { barcode: string } | undefined;

    if (!book || !copy) return null;

    const pendingList = this.db
      .prepare(
        `SELECT id, memberId, requestedAt FROM reservations
         WHERE bookId = ? AND status = 'En attente'
         ORDER BY requestedAt ASC, rowid ASC, id ASC`
      )
      .all(bookId) as Array<{ id: string; memberId: string; requestedAt: string }>;

    for (const candidate of pendingList) {
      const eligibility = this.checkEligibility(candidate.memberId, now);
      if (!eligibility.eligible) {
        continue;
      }

      this.db
        .prepare(
          `UPDATE copies
           SET status = 'Réservé', location = 'Banque d’accueil · En attente de confirmation'
           WHERE id = ?`
        )
        .run(copyId);

      // Règle 7 & 8 : l'exemplaire est proposé au premier membre éligible,
      // mais le délai de retrait de 3 jours ne démarre qu'après confirmation par le bibliothécaire.
      this.db
        .prepare(
          `UPDATE reservations
           SET status = 'Exemplaire attribué',
               assignedCopyId = ?,
               availableAt = NULL,
               pickupDeadline = NULL,
               queuePosition = NULL
           WHERE id = ?`
        )
        .run(copyId, candidate.id);

      this.recalculateQueuePositionsInternal(bookId);

      this.insertNotificationInternal(
        candidate.memberId,
        'Exemplaire attribué — confirmation bibliothèque en attente',
        `Un exemplaire de « ${book.title} » (${copy.barcode}) vous a été attribué selon l’ordre FIFO. Le délai de retrait de 3 jours commencera dès que le bibliothécaire aura confirmé sa mise à disposition.`,
        'reservation',
        now
      );

      this.insertAuditLogInternal(
        actor,
        'RESERVATION_PROPOSED',
        'reservation',
        candidate.id,
        `Exemplaire ${copy.barcode} (« ${book.title} ») attribué en priorité FIFO à la réservation ${candidate.id} (confirmation de mise à disposition requise).`,
        now
      );

      return candidate.id;
    }

    // Aucun membre en attente éligible : remettre l'exemplaire en rayon
    const bookShelf = this.db
      .prepare(`SELECT shelfLocation FROM books WHERE id = ?`)
      .get(bookId) as { shelfLocation: string } | undefined;

    this.db
      .prepare(`UPDATE copies SET status = 'Disponible', location = ? WHERE id = ?`)
      .run(bookShelf ? `Rayon · ${bookShelf.shelfLocation}` : 'Rayon principal', copyId);

    return null;
  }

  private expireOverdueReservationsInternal(now: Date): number {
    const nowIso = now.toISOString();
    const expired = this.db
      .prepare(
        `SELECT r.id, r.memberId, r.bookId, r.assignedCopyId, b.title as bookTitle
         FROM reservations r
         JOIN books b ON b.id = r.bookId
         WHERE r.status = 'Disponible pour retrait' AND r.pickupDeadline < ?
         ORDER BY r.pickupDeadline ASC`
      )
      .all(nowIso) as Array<{
      id: string;
      memberId: string;
      bookId: string;
      assignedCopyId: string | null;
      bookTitle: string;
    }>;

    for (const res of expired) {
      this.db
        .prepare(
          `UPDATE reservations
           SET status = 'Expirée', completedAt = ?, assignedCopyId = NULL
           WHERE id = ?`
        )
        .run(nowIso, res.id);

      this.insertNotificationInternal(
        res.memberId,
        'Réservation expirée',
        `Le délai de retrait de 3 jours pour « ${res.bookTitle} » est dépassé. Votre réservation a expiré et l’exemplaire a été libéré.`,
        'expiration',
        now
      );

      this.insertAuditLogInternal(
        { id: 'system', fullName: 'Système échéances', role: 'system' },
        'RESERVATION_EXPIRED',
        'reservation',
        res.id,
        `Délai de retrait de 3 jours expiré pour « ${res.bookTitle} » (réservation ${res.id}).`,
        now
      );

      if (res.assignedCopyId) {
        this.assignCopyToNextEligibleReservationInternal(res.bookId, res.assignedCopyId, now);
      }
    }

    // Notifications d'échéance proche (< 24 heures)
    const soonIso = addDaysIso(now, 1);
    const approaching = this.db
      .prepare(
        `SELECT r.id, r.memberId, r.pickupDeadline, b.title as bookTitle
         FROM reservations r
         JOIN books b ON b.id = r.bookId
         WHERE r.status = 'Disponible pour retrait'
           AND r.pickupDeadline >= ?
           AND r.pickupDeadline <= ?`
      )
      .all(nowIso, soonIso) as Array<{
      id: string;
      memberId: string;
      pickupDeadline: string;
      bookTitle: string;
    }>;

    for (const item of approaching) {
      const existingReminder = this.db
        .prepare(
          `SELECT id FROM notifications
           WHERE userId = ? AND type = 'rappel' AND message LIKE ?`
        )
        .get(item.memberId, `%${item.bookTitle}%retrait%`);

      if (!existingReminder) {
        this.insertNotificationInternal(
          item.memberId,
          'Date limite de retrait proche',
          `Rappel : votre délai de retrait pour « ${item.bookTitle} » expire le ${formatFrenchDateTime(item.pickupDeadline)}.`,
          'rappel',
          now
        );
      }
    }

    return expired.length;
  }

  public processDeadlines(now: Date = new Date()): number {
    const tx = this.db.transaction(() => {
      this.syncOverdueLoansInternal(now);
      return this.expireOverdueReservationsInternal(now);
    });
    return tx.immediate();
  }

  public listBooks(filters?: {
    search?: string;
    category?: string;
    language?: string;
    year?: number | null;
    availableOnly?: boolean;
    includeArchived?: boolean;
  }): BookWithStats[] {
    const includeArchived = Boolean(filters?.includeArchived);
    const rows = this.db
      .prepare(
        `SELECT b.*,
          COALESCE(SUM(CASE WHEN c.status != 'Retiré définitivement' THEN 1 ELSE 0 END), 0) as totalCopies,
          COALESCE(SUM(CASE WHEN c.status = 'Disponible' AND c.needsInspection = 0 THEN 1 ELSE 0 END), 0) as availableCopies,
          COALESCE(SUM(CASE WHEN c.status = 'Emprunté' THEN 1 ELSE 0 END), 0) as borrowedCopies,
          COALESCE(SUM(CASE WHEN c.status = 'Réservé' THEN 1 ELSE 0 END), 0) as reservedCopies,
          COALESCE(SUM(CASE WHEN c.status = 'En réparation' THEN 1 ELSE 0 END), 0) as repairCopies,
          COALESCE(SUM(CASE WHEN c.status = 'Retiré définitivement' THEN 1 ELSE 0 END), 0) as withdrawnCopies,
          COALESCE(SUM(CASE WHEN c.status IN ('Disponible', 'Emprunté', 'Réservé', 'En réparation') THEN 1 ELSE 0 END), 0) as circulatingCopies
         FROM books b
         LEFT JOIN copies c ON c.bookId = b.id
         WHERE (? = 1 OR b.archived = 0)
         GROUP BY b.id
         ORDER BY b.featured DESC, b.createdAt DESC`
      )
      .all(includeArchived ? 1 : 0) as Array<Record<string, unknown>>;

    let books: BookWithStats[] = rows.map((r) => ({
      id: String(r.id),
      title: String(r.title),
      authors: String(r.authors),
      isbn: r.isbn ? String(r.isbn) : null,
      category: String(r.category),
      description: String(r.description),
      publisher: String(r.publisher),
      publicationYear: Number(r.publicationYear),
      edition: String(r.edition),
      language: String(r.language),
      coverImage: String(r.coverImage),
      shelfLocation: String(r.shelfLocation),
      archived: Boolean(r.archived),
      featured: Boolean(r.featured),
      isDemo: Boolean(r.isDemo),
      createdAt: String(r.createdAt),
      totalCopies: Number(r.totalCopies),
      availableCopies: Number(r.availableCopies),
      borrowedCopies: Number(r.borrowedCopies),
      reservedCopies: Number(r.reservedCopies),
      repairCopies: Number(r.repairCopies),
      withdrawnCopies: Number(r.withdrawnCopies),
      circulatingCopies: Number(r.circulatingCopies),
    }));

    if (filters?.search) {
      const q = filters.search.trim().toLowerCase();
      books = books.filter(
        (b) =>
          b.title.toLowerCase().includes(q) ||
          b.authors.toLowerCase().includes(q) ||
          (b.isbn && b.isbn.toLowerCase().includes(q)) ||
          b.category.toLowerCase().includes(q) ||
          b.shelfLocation.toLowerCase().includes(q)
      );
    }

    if (filters?.category && filters.category !== 'Toutes') {
      books = books.filter((b) => b.category === filters.category);
    }

    if (filters?.language && filters.language !== 'Toutes') {
      books = books.filter((b) => b.language === filters.language);
    }

    if (filters?.year) {
      books = books.filter((b) => b.publicationYear === filters.year);
    }

    if (filters?.availableOnly) {
      books = books.filter((b) => b.availableCopies > 0);
    }

    return books;
  }

  public getBookDetail(bookId: string, now: Date = new Date()): BookDetail {
    this.processDeadlines(now);

    const bookRow = this.db
      .prepare(`SELECT * FROM books WHERE id = ?`)
      .get(bookId) as Record<string, unknown> | undefined;

    if (!bookRow) {
      throw new DomainError('Ouvrage introuvable dans le catalogue.', 404, 'BOOK_NOT_FOUND');
    }

    const copyRows = this.db
      .prepare(`SELECT * FROM copies WHERE bookId = ? ORDER BY barcode ASC`)
      .all(bookId) as Array<Record<string, unknown>>;

    const copies: Copy[] = copyRows.map((c) => ({
      id: String(c.id),
      bookId: String(c.bookId),
      barcode: String(c.barcode),
      status: c.status as CopyStatus,
      physicalCondition: c.physicalCondition as PhysicalCondition,
      location: String(c.location),
      needsInspection: Boolean(c.needsInspection),
      createdAt: String(c.createdAt),
    }));

    const availableCopies = copies.filter(
      (c) =>
        c.status === 'Disponible' &&
        !c.needsInspection &&
        c.physicalCondition !== 'Endommagé' &&
        c.physicalCondition !== 'Hors service'
    ).length;
    const borrowedCopies = copies.filter((c) => c.status === 'Emprunté').length;
    const reservedCopies = copies.filter((c) => c.status === 'Réservé').length;
    const repairCopies = copies.filter((c) => c.status === 'En réparation').length;
    const withdrawnCopies = copies.filter((c) => c.status === 'Retiré définitivement').length;
    const totalCopies = copies.length - withdrawnCopies;
    const circulatingCopies = copies.filter((c) => c.status !== 'Retiré définitivement').length;

    const pendingRow = this.db
      .prepare(`SELECT COUNT(*) as cnt FROM reservations WHERE bookId = ? AND status = 'En attente'`)
      .get(bookId) as { cnt: number };

    let reservationBlockedReason: string | null = null;
    if (Boolean(bookRow.archived)) {
      reservationBlockedReason = 'Cet ouvrage est archivé et ne peut plus être emprunté ni réservé.';
    } else if (availableCopies > 0) {
      reservationBlockedReason =
        'Au moins un exemplaire est disponible en rayon pour un emprunt immédiat.';
    } else if (circulatingCopies === 0) {
      reservationBlockedReason =
        'Aucun exemplaire en circulation : tous les exemplaires ont été retirés définitivement ou sont indisponibles de façon permanente.';
    }

    return {
      id: String(bookRow.id),
      title: String(bookRow.title),
      authors: String(bookRow.authors),
      isbn: bookRow.isbn ? String(bookRow.isbn) : null,
      category: String(bookRow.category),
      description: String(bookRow.description),
      publisher: String(bookRow.publisher),
      publicationYear: Number(bookRow.publicationYear),
      edition: String(bookRow.edition),
      language: String(bookRow.language),
      coverImage: String(bookRow.coverImage),
      shelfLocation: String(bookRow.shelfLocation),
      archived: Boolean(bookRow.archived),
      featured: Boolean(bookRow.featured),
      isDemo: Boolean(bookRow.isDemo),
      createdAt: String(bookRow.createdAt),
      totalCopies,
      availableCopies,
      borrowedCopies,
      reservedCopies,
      repairCopies,
      withdrawnCopies,
      circulatingCopies,
      copies,
      pendingReservationsCount: pendingRow.cnt,
      canBorrow: !Boolean(bookRow.archived) && availableCopies > 0,
      canReserve: !Boolean(bookRow.archived) && availableCopies === 0 && circulatingCopies > 0,
      reservationBlockedReason,
    };
  }

  private borrowBookInternal(
    memberId: string,
    bookId: string,
    now: Date,
    preferredCopyId?: string | null,
    actor?: AuditActor | null
  ): LoanRecord {
    this.assertEligibleInternal(memberId, now);

    const book = this.db
      .prepare(`SELECT * FROM books WHERE id = ?`)
      .get(bookId) as Record<string, unknown> | undefined;

    if (!book) {
      throw new DomainError('Ouvrage introuvable.', 404, 'BOOK_NOT_FOUND');
    }
    if (Boolean(book.archived)) {
      throw new DomainError('Cet ouvrage est archivé et ne peut pas être emprunté.', 409, 'BOOK_ARCHIVED');
    }

    const existingMemberLoan = this.db
      .prepare(
        `SELECT id FROM loans WHERE memberId = ? AND bookId = ? AND status != 'Retourné'`
      )
      .get(memberId, bookId);
    if (existingMemberLoan) {
      throw new DomainError(
        'Vous détenez déjà un exemplaire actif de cet ouvrage.',
        409,
        'DUPLICATE_ACTIVE_LOAN'
      );
    }

    const availableCopy = preferredCopyId
      ? (this.db
          .prepare(
            `SELECT * FROM copies
             WHERE id = ?
               AND bookId = ?
               AND status = 'Disponible'
               AND needsInspection = 0
               AND physicalCondition NOT IN ('Endommagé', 'Hors service')`
          )
          .get(preferredCopyId, bookId) as Record<string, unknown> | undefined)
      : (this.db
          .prepare(
            `SELECT * FROM copies
             WHERE bookId = ?
               AND status = 'Disponible'
               AND needsInspection = 0
               AND physicalCondition NOT IN ('Endommagé', 'Hors service')
             ORDER BY barcode ASC
             LIMIT 1`
          )
          .get(bookId) as Record<string, unknown> | undefined);

    if (!availableCopy) {
      throw new DomainError(
        'Aucun exemplaire disponible pour cet ouvrage. Vous pouvez effectuer une réservation si des exemplaires sont en circulation.',
        409,
        'NO_AVAILABLE_COPY'
      );
    }

    const updateResult = this.db
      .prepare(
        `UPDATE copies SET status = 'Emprunté'
         WHERE id = ? AND status = 'Disponible' AND needsInspection = 0`
      )
      .run(String(availableCopy.id));

    if (updateResult.changes !== 1) {
      throw new DomainError(
        'Conflit concurrent : cet exemplaire vient d’être attribué.',
        409,
        'COPY_RACE_CONFLICT'
      );
    }

    const loanId = this.generateId('ln');
    const borrowedAt = now.toISOString();
    const dueAt = addDaysIso(now, BORROWING_DURATION_DAYS);

    this.db
      .prepare(
        `INSERT INTO loans (id, memberId, copyId, bookId, borrowedAt, dueAt, returnedAt, returnCondition, returnNotes, status)
         VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'En cours')`
      )
      .run(loanId, memberId, String(availableCopy.id), bookId, borrowedAt, dueAt);

    this.insertNotificationInternal(
      memberId,
      'Emprunt confirmé',
      `Votre emprunt pour « ${String(book.title)} » (exemplaire ${String(availableCopy.barcode)}) est confirmé. Date limite de retour : ${formatFrenchDateTime(dueAt)} (7 jours).`,
      'emprunt',
      now
    );

    this.insertAuditLogInternal(
      actor || { id: memberId, role: 'membre' },
      'LOAN_CREATED',
      'loan',
      loanId,
      `Prêt enregistré pour « ${String(book.title)} » (exemplaire ${String(availableCopy.barcode)}, membre ${memberId}).`,
      now
    );

    return this.getLoanByIdInternal(loanId)!;
  }

  public borrowBook(memberId: string, bookId: string, now: Date = new Date()): LoanRecord {
    const tx = this.db.transaction(() => {
      this.syncOverdueLoansInternal(now);
      this.expireOverdueReservationsInternal(now);
      return this.borrowBookInternal(memberId, bookId, now);
    });

    return tx.immediate();
  }

  public createLoanAdmin(
    memberId: string,
    bookId: string,
    copyId: string | null | undefined,
    actor: AuditActor,
    now: Date = new Date()
  ): LoanRecord {
    const tx = this.db.transaction(() => {
      this.syncOverdueLoansInternal(now);
      this.expireOverdueReservationsInternal(now);
      return this.borrowBookInternal(memberId, bookId, now, copyId || null, actor);
    });
    return tx.immediate();
  }

  private reserveBookInternal(
    memberId: string,
    bookId: string,
    now: Date,
    actor?: AuditActor | null
  ): ReservationRecord {
    this.assertEligibleInternal(memberId, now);

    const book = this.db
      .prepare(`SELECT * FROM books WHERE id = ?`)
      .get(bookId) as Record<string, unknown> | undefined;

    if (!book) {
      throw new DomainError('Ouvrage introuvable.', 404, 'BOOK_NOT_FOUND');
    }
    if (Boolean(book.archived)) {
      throw new DomainError(
        'Cet ouvrage est archivé et ne peut pas être réservé.',
        409,
        'BOOK_ARCHIVED'
      );
    }

    const activeLoan = this.db
      .prepare(
        `SELECT id FROM loans WHERE memberId = ? AND bookId = ? AND status != 'Retourné'`
      )
      .get(memberId, bookId);
    if (activeLoan) {
      throw new DomainError(
        'Vous empruntez déjà cet ouvrage actuellement.',
        409,
        'ALREADY_BORROWED'
      );
    }

    const existingRes = this.db
      .prepare(
        `SELECT id FROM reservations
         WHERE memberId = ? AND bookId = ? AND status IN ('En attente', 'Exemplaire attribué', 'Disponible pour retrait')`
      )
      .get(memberId, bookId);
    if (existingRes) {
      throw new DomainError(
        'Vous avez déjà une réservation active pour cet ouvrage.',
        409,
        'DUPLICATE_RESERVATION'
      );
    }

    const copies = this.db
      .prepare(`SELECT * FROM copies WHERE bookId = ?`)
      .all(bookId) as Array<Record<string, unknown>>;

    const hasAvailable = copies.some(
      (c) =>
        c.status === 'Disponible' &&
        !Boolean(c.needsInspection) &&
        c.physicalCondition !== 'Endommagé' &&
        c.physicalCondition !== 'Hors service'
    );

    if (hasAvailable) {
      throw new DomainError(
        'Un exemplaire est actuellement disponible : veuillez emprunter l’ouvrage directement.',
        409,
        'COPY_AVAILABLE_NO_RESERVATION'
      );
    }

    const hasCirculating = copies.some(
      (c) => c.status !== 'Retiré définitivement'
    );

    if (!hasCirculating) {
      throw new DomainError(
        'Réservation refusée : tous les exemplaires de cet ouvrage ont été retirés définitivement et ne peuvent plus retourner en circulation.',
        409,
        'NO_CIRCULATING_COPIES'
      );
    }

    const maxQueueRow = this.db
      .prepare(
        `SELECT COALESCE(MAX(queuePosition), 0) as maxPos
         FROM reservations
         WHERE bookId = ? AND status = 'En attente'`
      )
      .get(bookId) as { maxPos: number };

    const queuePosition = maxQueueRow.maxPos + 1;
    const reservationId = this.generateId('res');
    const requestedAt = now.toISOString();

    this.db
      .prepare(
        `INSERT INTO reservations (id, memberId, bookId, requestedAt, queuePosition, status, assignedCopyId, availableAt, pickupDeadline, completedAt)
         VALUES (?, ?, ?, ?, ?, 'En attente', NULL, NULL, NULL, NULL)`
      )
      .run(reservationId, memberId, bookId, requestedAt, queuePosition);

    this.recalculateQueuePositionsInternal(bookId);

    this.insertNotificationInternal(
      memberId,
      'Réservation enregistrée',
      `Votre réservation a été enregistrée. Vous serez informé dès qu'un exemplaire sera disponible. Aucune date de disponibilité n'est garantie.`,
      'reservation',
      now
    );

    this.insertAuditLogInternal(
      actor || { id: memberId, role: 'membre' },
      'RESERVATION_CREATED',
      'reservation',
      reservationId,
      `Réservation FIFO #${queuePosition} enregistrée pour « ${String(book.title)} » (membre ${memberId}).`,
      now
    );

    return this.getReservationByIdInternal(reservationId)!;
  }

  public reserveBook(memberId: string, bookId: string, now: Date = new Date()): ReservationRecord {
    const tx = this.db.transaction(() => {
      this.syncOverdueLoansInternal(now);
      this.expireOverdueReservationsInternal(now);
      return this.reserveBookInternal(memberId, bookId, now);
    });

    return tx.immediate();
  }

  public cancelReservation(
    reservationId: string,
    actor: AuditActor & Pick<UserPublic, 'id' | 'role'>,
    now: Date = new Date()
  ): ReservationRecord {
    const tx = this.db.transaction(() => {
      this.expireOverdueReservationsInternal(now);

      const res = this.db
        .prepare(`SELECT * FROM reservations WHERE id = ?`)
        .get(reservationId) as Record<string, unknown> | undefined;

      if (!res) {
        throw new DomainError('Réservation introuvable.', 404, 'RESERVATION_NOT_FOUND');
      }

      if (actor.role !== 'bibliothecaire' && String(res.memberId) !== actor.id) {
        throw new DomainError(
          'Vous ne pouvez annuler que vos propres réservations.',
          403,
          'FORBIDDEN_RESERVATION_CANCEL'
        );
      }

      const status = String(res.status);
      if (status === 'Retirée' || status === 'Annulée' || status === 'Expirée') {
        throw new DomainError(
          'Cette réservation est déjà terminée et ne peut pas être annulée.',
          409,
          'RESERVATION_ALREADY_CLOSED'
        );
      }

      const assignedCopyId = res.assignedCopyId ? String(res.assignedCopyId) : null;
      const bookId = String(res.bookId);
      const memberId = String(res.memberId);
      const nowIso = now.toISOString();

      this.db
        .prepare(
          `UPDATE reservations
           SET status = 'Annulée', queuePosition = NULL, assignedCopyId = NULL, completedAt = ?
           WHERE id = ?`
        )
        .run(nowIso, reservationId);

      const book = this.db
        .prepare(`SELECT title FROM books WHERE id = ?`)
        .get(bookId) as { title: string } | undefined;

      this.insertNotificationInternal(
        memberId,
        'Réservation annulée',
        `Votre réservation pour « ${book?.title || 'Ouvrage'} » a été annulée.`,
        'annulation',
        now
      );

      this.insertAuditLogInternal(
        actor,
        'RESERVATION_CANCELLED',
        'reservation',
        reservationId,
        `Réservation ${reservationId} pour « ${book?.title || 'Ouvrage'} » annulée (statut précédent : ${status}).`,
        now
      );

      if (assignedCopyId) {
        this.assignCopyToNextEligibleReservationInternal(bookId, assignedCopyId, now, actor);
      }

      this.recalculateQueuePositionsInternal(bookId);

      return this.getReservationByIdInternal(reservationId)!;
    });

    return tx.immediate();
  }

  public returnLoan(
    loanId: string,
    outcome: ReturnInspectionOutcome,
    physicalCondition: PhysicalCondition,
    notes?: string,
    now: Date = new Date(),
    actor?: AuditActor | null
  ): { loan: LoanRecord; assignedReservationId: string | null } {
    const tx = this.db.transaction(() => {
      this.expireOverdueReservationsInternal(now);

      const loan = this.db
        .prepare(`SELECT * FROM loans WHERE id = ?`)
        .get(loanId) as Record<string, unknown> | undefined;

      if (!loan) {
        throw new DomainError('Opération d’emprunt introuvable.', 404, 'LOAN_NOT_FOUND');
      }
      if (String(loan.status) === 'Retourné') {
        throw new DomainError('Cet emprunt a déjà été enregistré comme retourné.', 409, 'LOAN_ALREADY_RETURNED');
      }

      const copyId = String(loan.copyId);
      const bookId = String(loan.bookId);
      const memberId = String(loan.memberId);
      const nowIso = now.toISOString();

      this.db
        .prepare(
          `UPDATE loans
           SET returnedAt = ?, returnCondition = ?, returnNotes = ?, status = 'Retourné'
           WHERE id = ?`
        )
        .run(nowIso, physicalCondition, notes || null, loanId);

      let assignedReservationId: string | null = null;

      if (outcome === 'endommage') {
        this.db
          .prepare(
            `UPDATE copies
             SET status = 'En réparation',
                 physicalCondition = 'Endommagé',
                 location = 'Atelier Reliure',
                 needsInspection = 1
             WHERE id = ?`
          )
          .run(copyId);
      } else if (outcome === 'retire_definitivement') {
        this.db
          .prepare(
            `UPDATE copies
             SET status = 'Retiré définitivement',
                 physicalCondition = 'Hors service',
                 location = 'Archives Réforme',
                 needsInspection = 0
             WHERE id = ?`
          )
          .run(copyId);
      } else {
        const usableCondition: PhysicalCondition =
          physicalCondition === 'Endommagé' || physicalCondition === 'Hors service'
            ? 'Bon état'
            : physicalCondition;

        this.db
          .prepare(
            `UPDATE copies
             SET physicalCondition = ?, needsInspection = 0
             WHERE id = ?`
          )
          .run(usableCondition, copyId);

        assignedReservationId = this.assignCopyToNextEligibleReservationInternal(
          bookId,
          copyId,
          now,
          actor
        );
      }

      const book = this.db
        .prepare(`SELECT title FROM books WHERE id = ?`)
        .get(bookId) as { title: string } | undefined;

      this.insertNotificationInternal(
        memberId,
        'Retour d’ouvrage enregistré',
        `La restitution de « ${book?.title || 'Ouvrage'} » a été validée par la bibliothèque (état constaté : ${physicalCondition}).`,
        'retour',
        now
      );

      this.insertAuditLogInternal(
        actor || { id: 'bibliothecaire', role: 'bibliothecaire' },
        'LOAN_RETURNED',
        'loan',
        loanId,
        `Retour validé pour « ${book?.title || 'Ouvrage'} » — décision : ${outcome}, état : ${physicalCondition}.`,
        now
      );

      return {
        loan: this.getLoanByIdInternal(loanId)!,
        assignedReservationId,
      };
    });

    return tx.immediate();
  }

  public completeCopyRepair(
    copyId: string,
    actor?: AuditActor | null,
    now: Date = new Date()
  ): Copy {
    const tx = this.db.transaction(() => {
      const copy = this.db
        .prepare(`SELECT * FROM copies WHERE id = ?`)
        .get(copyId) as Record<string, unknown> | undefined;

      if (!copy) {
        throw new DomainError('Exemplaire introuvable.', 404, 'COPY_NOT_FOUND');
      }
      if (String(copy.status) !== 'En réparation') {
        throw new DomainError(
          'Seul un exemplaire en réparation peut être marqué comme réparé.',
          409,
          'COPY_NOT_IN_REPAIR'
        );
      }

      // La réparation est terminée, mais l'inspection post-réparation reste obligatoire (needsInspection = 1)
      this.db
        .prepare(
          `UPDATE copies
           SET physicalCondition = 'Bon état',
               location = 'Zone Inspection Post-Réparation',
               needsInspection = 1
           WHERE id = ?`
        )
        .run(copyId);

      this.insertAuditLogInternal(
        actor || { id: 'bibliothecaire', role: 'bibliothecaire' },
        'COPY_REPAIR_COMPLETED',
        'copy',
        copyId,
        `Réparation terminée pour l'exemplaire ${String(copy.barcode)} — inspection requise avant remise en circulation.`,
        now
      );

      return this.getCopyByIdInternal(copyId)!;
    });

    return tx.immediate();
  }

  public inspectRepairedCopy(
    copyId: string,
    outcome: ReturnInspectionOutcome,
    physicalCondition: PhysicalCondition,
    now: Date = new Date(),
    actor?: AuditActor | null
  ): { copy: Copy; assignedReservationId: string | null } {
    const tx = this.db.transaction(() => {
      this.expireOverdueReservationsInternal(now);

      const copy = this.db
        .prepare(`SELECT * FROM copies WHERE id = ?`)
        .get(copyId) as Record<string, unknown> | undefined;

      if (!copy) {
        throw new DomainError('Exemplaire introuvable.', 404, 'COPY_NOT_FOUND');
      }
      if (String(copy.status) !== 'En réparation') {
        throw new DomainError(
          'Cet exemplaire n’est pas en attente d’inspection après réparation.',
          409,
          'COPY_NOT_IN_REPAIR'
        );
      }

      const bookId = String(copy.bookId);
      let assignedReservationId: string | null = null;

      if (outcome === 'reutilisable') {
        const cleanCondition: PhysicalCondition =
          physicalCondition === 'Endommagé' || physicalCondition === 'Hors service'
            ? 'Bon état'
            : physicalCondition;

        this.db
          .prepare(
            `UPDATE copies SET physicalCondition = ?, needsInspection = 0 WHERE id = ?`
          )
          .run(cleanCondition, copyId);

        assignedReservationId = this.assignCopyToNextEligibleReservationInternal(
          bookId,
          copyId,
          now,
          actor
        );
      } else if (outcome === 'endommage') {
        this.db
          .prepare(
            `UPDATE copies
             SET status = 'En réparation',
                 physicalCondition = 'Endommagé',
                 location = 'Atelier Reliure',
                 needsInspection = 1
             WHERE id = ?`
          )
          .run(copyId);
      } else {
        this.db
          .prepare(
            `UPDATE copies
             SET status = 'Retiré définitivement',
                 physicalCondition = 'Hors service',
                 location = 'Archives Réforme',
                 needsInspection = 0
             WHERE id = ?`
          )
          .run(copyId);
      }

      this.insertAuditLogInternal(
        actor || { id: 'bibliothecaire', role: 'bibliothecaire' },
        'COPY_INSPECTED',
        'copy',
        copyId,
        `Inspection post-réparation de ${String(copy.barcode)} : ${outcome} (${physicalCondition}).`,
        now
      );

      return {
        copy: this.getCopyByIdInternal(copyId)!,
        assignedReservationId,
      };
    });

    return tx.immediate();
  }

  public confirmReservationAvailability(
    reservationId: string,
    actor: AuditActor,
    now: Date = new Date()
  ): ReservationRecord {
    const tx = this.db.transaction(() => {
      this.syncOverdueLoansInternal(now);
      this.expireOverdueReservationsInternal(now);

      const res = this.db
        .prepare(`SELECT * FROM reservations WHERE id = ?`)
        .get(reservationId) as Record<string, unknown> | undefined;

      if (!res) {
        throw new DomainError('Réservation introuvable.', 404, 'RESERVATION_NOT_FOUND');
      }

      if (String(res.status) !== 'Exemplaire attribué' || !res.assignedCopyId) {
        throw new DomainError(
          'Seule une réservation au statut « Exemplaire attribué » peut être confirmée pour mise à disposition.',
          409,
          'RESERVATION_NOT_ALLOCATED'
        );
      }

      const memberId = String(res.memberId);
      const bookId = String(res.bookId);
      const copyId = String(res.assignedCopyId);

      // Vérifier l'éligibilité du membre au moment de la confirmation
      this.assertEligibleInternal(memberId, now);

      const nowIso = now.toISOString();
      const pickupDeadline = addDaysIso(now, PICKUP_WINDOW_DAYS);

      this.db
        .prepare(
          `UPDATE copies
           SET status = 'Réservé', location = 'Banque d’accueil · Retrait réservations (3j)'
           WHERE id = ?`
        )
        .run(copyId);

      this.db
        .prepare(
          `UPDATE reservations
           SET status = 'Disponible pour retrait',
               availableAt = ?,
               pickupDeadline = ?
           WHERE id = ?`
        )
        .run(nowIso, pickupDeadline, reservationId);

      const book = this.db
        .prepare(`SELECT title FROM books WHERE id = ?`)
        .get(bookId) as { title: string } | undefined;
      const copy = this.db
        .prepare(`SELECT barcode FROM copies WHERE id = ?`)
        .get(copyId) as { barcode: string } | undefined;

      this.insertNotificationInternal(
        memberId,
        'Ouvrage disponible pour retrait',
        `Votre exemplaire de « ${book?.title || 'Ouvrage'} » (${copy?.barcode || ''}) est désormais disponible au guichet de la bibliothèque. Vous disposez de 3 jours pour le retirer, jusqu’au ${formatFrenchDateTime(pickupDeadline)}.`,
        'retrait',
        now
      );

      this.insertAuditLogInternal(
        actor,
        'RESERVATION_AVAILABILITY_CONFIRMED',
        'reservation',
        reservationId,
        `Mise à disposition confirmée pour « ${book?.title || 'Ouvrage'} » (${copy?.barcode || ''}). Délai de retrait de 3 jours jusqu’au ${formatFrenchDateTime(pickupDeadline)}.`,
        now
      );

      return this.getReservationByIdInternal(reservationId)!;
    });

    return tx.immediate();
  }

  public allocateAvailableCopyToQueueAdmin(
    bookId: string,
    actor: AuditActor,
    now: Date = new Date()
  ): { reservation: ReservationRecord; copy: Copy } {
    const tx = this.db.transaction(() => {
      this.syncOverdueLoansInternal(now);
      this.expireOverdueReservationsInternal(now);

      const availableCopy = this.db
        .prepare(
          `SELECT * FROM copies
           WHERE bookId = ?
             AND status = 'Disponible'
             AND needsInspection = 0
             AND physicalCondition NOT IN ('Endommagé', 'Hors service')
           ORDER BY barcode ASC
           LIMIT 1`
        )
        .get(bookId) as Record<string, unknown> | undefined;

      if (!availableCopy) {
        throw new DomainError(
          'Aucun exemplaire disponible et inspecté pour cet ouvrage.',
          409,
          'NO_AVAILABLE_COPY'
        );
      }

      const assignedId = this.assignCopyToNextEligibleReservationInternal(
        bookId,
        String(availableCopy.id),
        now,
        actor
      );

      if (!assignedId) {
        throw new DomainError(
          'Aucune réservation éligible en attente dans la file FIFO pour cet ouvrage.',
          409,
          'NO_ELIGIBLE_QUEUE_MEMBER'
        );
      }

      return {
        reservation: this.getReservationByIdInternal(assignedId)!,
        copy: this.getCopyByIdInternal(String(availableCopy.id))!,
      };
    });

    return tx.immediate();
  }

  public fulfillReservationPickup(
    reservationId: string,
    now: Date = new Date(),
    actor?: AuditActor | null
  ): LoanRecord {
    const tx = this.db.transaction(() => {
      this.syncOverdueLoansInternal(now);
      this.expireOverdueReservationsInternal(now);

      const res = this.db
        .prepare(`SELECT * FROM reservations WHERE id = ?`)
        .get(reservationId) as Record<string, unknown> | undefined;

      if (!res) {
        throw new DomainError('Réservation introuvable.', 404, 'RESERVATION_NOT_FOUND');
      }
      if (String(res.status) !== 'Disponible pour retrait' || !res.assignedCopyId) {
        throw new DomainError(
          'Cette réservation n’est pas prête pour un retrait (ou son délai a expiré).',
          409,
          'RESERVATION_NOT_READY'
        );
      }

      const memberId = String(res.memberId);
      const bookId = String(res.bookId);
      const copyId = String(res.assignedCopyId);

      this.assertEligibleInternal(memberId, now);

      const nowIso = now.toISOString();
      const dueAt = addDaysIso(now, BORROWING_DURATION_DAYS);
      const loanId = this.generateId('ln');

      this.db
        .prepare(
          `UPDATE reservations
           SET status = 'Retirée', completedAt = ?
           WHERE id = ?`
        )
        .run(nowIso, reservationId);

      this.db
        .prepare(`UPDATE copies SET status = 'Emprunté' WHERE id = ?`)
        .run(copyId);

      this.db
        .prepare(
          `INSERT INTO loans (id, memberId, copyId, bookId, borrowedAt, dueAt, returnedAt, returnCondition, returnNotes, status)
           VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'En cours')`
        )
        .run(loanId, memberId, copyId, bookId, nowIso, dueAt);

      const book = this.db
        .prepare(`SELECT title FROM books WHERE id = ?`)
        .get(bookId) as { title: string } | undefined;

      this.insertNotificationInternal(
        memberId,
        'Retrait de réservation confirmé',
        `Vous avez retiré « ${book?.title || 'Ouvrage'} ». Date limite de retour : ${formatFrenchDateTime(dueAt)}.`,
        'emprunt',
        now
      );

      this.insertAuditLogInternal(
        actor || { id: 'bibliothecaire', role: 'bibliothecaire' },
        'RESERVATION_PICKED_UP',
        'loan',
        loanId,
        `Retrait de réservation ${reservationId} validé : prêt ${loanId} créé pour « ${book?.title || 'Ouvrage'} ».`,
        now
      );

      return this.getLoanByIdInternal(loanId)!;
    });

    return tx.immediate();
  }

  public getMemberLoans(memberId: string, now: Date = new Date()): LoanRecord[] {
    this.syncOverdueLoansInternal(now);
    const rows = this.db
      .prepare(
        `SELECT l.*, b.title as bookTitle, b.authors as bookAuthors, b.coverImage as bookCoverImage,
                b.shelfLocation as shelfLocation, c.barcode as copyBarcode
         FROM loans l
         JOIN books b ON b.id = l.bookId
         JOIN copies c ON c.id = l.copyId
         WHERE l.memberId = ?
         ORDER BY CASE WHEN l.status != 'Retourné' THEN 0 ELSE 1 END, l.borrowedAt DESC`
      )
      .all(memberId) as Array<Record<string, unknown>>;

    return rows.map((r) => this.mapLoanRow(r, false));
  }

  public getMemberReservations(memberId: string, now: Date = new Date()): ReservationRecord[] {
    this.processDeadlines(now);
    const rows = this.db
      .prepare(
        `SELECT r.*, b.title as bookTitle, b.authors as bookAuthors, b.coverImage as bookCoverImage,
                b.shelfLocation as shelfLocation, c.barcode as assignedCopyBarcode
         FROM reservations r
         JOIN books b ON b.id = r.bookId
         LEFT JOIN copies c ON c.id = r.assignedCopyId
         WHERE r.memberId = ?
         ORDER BY CASE
                    WHEN r.status = 'Disponible pour retrait' THEN 0
                    WHEN r.status = 'Exemplaire attribué' THEN 1
                    WHEN r.status = 'En attente' THEN 2
                    ELSE 3
                  END,
                  r.requestedAt DESC`
      )
      .all(memberId) as Array<Record<string, unknown>>;

    return rows.map((r) => this.mapReservationRow(r, false));
  }

  public getMemberNotifications(memberId: string): NotificationRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM notifications WHERE userId = ? ORDER BY createdAt DESC LIMIT 50`
      )
      .all(memberId) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: String(r.id),
      userId: String(r.userId),
      title: String(r.title),
      message: String(r.message),
      type: r.type as NotificationRecord['type'],
      createdAt: String(r.createdAt),
      readAt: r.readAt ? String(r.readAt) : null,
    }));
  }

  public markNotificationRead(notificationId: string, userId: string, now: Date = new Date()): void {
    this.db
      .prepare(`UPDATE notifications SET readAt = ? WHERE id = ? AND userId = ?`)
      .run(now.toISOString(), notificationId, userId);
  }

  public markAllNotificationsRead(userId: string, now: Date = new Date()): void {
    this.db
      .prepare(`UPDATE notifications SET readAt = ? WHERE userId = ? AND readAt IS NULL`)
      .run(now.toISOString(), userId);
  }

  // --- Fonctions réservées au bibliothécaire ---

  public getDashboardStats(now: Date = new Date()): DashboardStats {
    this.processDeadlines(now);

    const titlesRow = this.db
      .prepare(`SELECT COUNT(*) as cnt FROM books WHERE archived = 0`)
      .get() as { cnt: number };

    const copyStats = this.db
      .prepare(
        `SELECT
          COUNT(*) as allRows,
          COALESCE(SUM(CASE WHEN status != 'Retiré définitivement' THEN 1 ELSE 0 END), 0) as totalPhysical,
          COALESCE(SUM(CASE WHEN status = 'Disponible' AND needsInspection = 0 THEN 1 ELSE 0 END), 0) as available,
          COALESCE(SUM(CASE WHEN status = 'Emprunté' THEN 1 ELSE 0 END), 0) as borrowed,
          COALESCE(SUM(CASE WHEN status = 'Réservé' THEN 1 ELSE 0 END), 0) as reserved,
          COALESCE(SUM(CASE WHEN status = 'En réparation' THEN 1 ELSE 0 END), 0) as repair,
          COALESCE(SUM(CASE WHEN status = 'Retiré définitivement' THEN 1 ELSE 0 END), 0) as withdrawn
         FROM copies`
      )
      .get() as Record<string, number>;

    const resStats = this.db
      .prepare(
        `SELECT
          COALESCE(SUM(CASE WHEN status = 'En attente' THEN 1 ELSE 0 END), 0) as pending,
          COALESCE(SUM(CASE WHEN status = 'Exemplaire attribué' THEN 1 ELSE 0 END), 0) as allocated,
          COALESCE(SUM(CASE WHEN status = 'Disponible pour retrait' THEN 1 ELSE 0 END), 0) as awaitingPickup
         FROM reservations`
      )
      .get() as Record<string, number>;

    const loanStats = this.db
      .prepare(
        `SELECT
          COALESCE(SUM(CASE WHEN status != 'Retourné' THEN 1 ELSE 0 END), 0) as activeLoans,
          COALESCE(SUM(CASE WHEN status = 'En retard' THEN 1 ELSE 0 END), 0) as overdueLoans
         FROM loans`
      )
      .get() as Record<string, number>;

    return {
      totalTitles: titlesRow.cnt,
      totalPhysicalCopies: copyStats.totalPhysical || 0,
      availableCopies: copyStats.available || 0,
      borrowedCopies: copyStats.borrowed || 0,
      reservedCopies: copyStats.reserved || 0,
      repairCopies: copyStats.repair || 0,
      withdrawnCopies: copyStats.withdrawn || 0,
      pendingReservations: resStats.pending || 0,
      allocatedReservations: resStats.allocated || 0,
      awaitingPickupReservations: resStats.awaitingPickup || 0,
      overdueLoans: loanStats.overdueLoans || 0,
      activeLoans: loanStats.activeLoans || 0,
    };
  }

  public getAllLoansAdmin(now: Date = new Date()): LoanRecord[] {
    this.syncOverdueLoansInternal(now);
    const rows = this.db
      .prepare(
        `SELECT l.*, b.title as bookTitle, b.authors as bookAuthors, b.coverImage as bookCoverImage,
                b.shelfLocation as shelfLocation, c.barcode as copyBarcode,
                u.fullName as memberName, u.email as memberEmail, u.cne as memberCne
         FROM loans l
         JOIN books b ON b.id = l.bookId
         JOIN copies c ON c.id = l.copyId
         JOIN users u ON u.id = l.memberId
         ORDER BY CASE WHEN l.status = 'En retard' THEN 0 WHEN l.status = 'En cours' THEN 1 ELSE 2 END,
                  l.borrowedAt DESC`
      )
      .all() as Array<Record<string, unknown>>;

    return rows.map((r) => this.mapLoanRow(r, true));
  }

  public getAllReservationsAdmin(now: Date = new Date()): ReservationRecord[] {
    this.processDeadlines(now);
    const rows = this.db
      .prepare(
        `SELECT r.*, b.title as bookTitle, b.authors as bookAuthors, b.coverImage as bookCoverImage,
                b.shelfLocation as shelfLocation, c.barcode as assignedCopyBarcode,
                u.fullName as memberName, u.email as memberEmail, u.cne as memberCne
         FROM reservations r
         JOIN books b ON b.id = r.bookId
         JOIN users u ON u.id = r.memberId
         LEFT JOIN copies c ON c.id = r.assignedCopyId
         ORDER BY CASE r.status
                    WHEN 'Exemplaire attribué' THEN 0
                    WHEN 'Disponible pour retrait' THEN 1
                    WHEN 'En attente' THEN 2
                    ELSE 3
                  END,
                  r.requestedAt ASC, r.rowid ASC, r.id ASC`
      )
      .all() as Array<Record<string, unknown>>;

    return rows.map((r) => this.mapReservationRow(r, true));
  }

  public getAllCopiesAdmin(): Array<Copy & { bookTitle: string; bookCategory: string }> {
    const rows = this.db
      .prepare(
        `SELECT c.*, b.title as bookTitle, b.category as bookCategory
         FROM copies c
         JOIN books b ON b.id = c.bookId
         ORDER BY CASE c.status
                    WHEN 'En réparation' THEN 0
                    WHEN 'Réservé' THEN 1
                    WHEN 'Emprunté' THEN 2
                    WHEN 'Disponible' THEN 3
                    ELSE 4
                  END,
                  c.barcode ASC`
      )
      .all() as Array<Record<string, unknown>>;

    return rows.map((c) => ({
      id: String(c.id),
      bookId: String(c.bookId),
      barcode: String(c.barcode),
      status: c.status as CopyStatus,
      physicalCondition: c.physicalCondition as PhysicalCondition,
      location: String(c.location),
      needsInspection: Boolean(c.needsInspection),
      createdAt: String(c.createdAt),
      bookTitle: String(c.bookTitle),
      bookCategory: String(c.bookCategory),
    }));
  }

  public createBook(
    input: Omit<Book, 'id' | 'archived' | 'createdAt'>,
    now: Date = new Date(),
    actor?: AuditActor | null
  ): BookDetail {
    const id = this.generateId('bk');
    this.db
      .prepare(
        `INSERT INTO books (id, title, authors, isbn, category, description, publisher, publicationYear, edition, language, coverImage, shelfLocation, archived, featured, isDemo, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
      )
      .run(
        id,
        input.title.trim(),
        input.authors.trim(),
        input.isbn ? input.isbn.trim() : null,
        input.category,
        input.description.trim(),
        input.publisher.trim(),
        Number(input.publicationYear),
        input.edition.trim(),
        input.language,
        input.coverImage,
        input.shelfLocation.trim(),
        input.featured ? 1 : 0,
        input.isDemo ? 1 : 0,
        now.toISOString()
      );
    this.insertAuditLogInternal(
      actor || { id: 'bibliothecaire', role: 'bibliothecaire' },
      'BOOK_CREATED',
      'book',
      id,
      `Ouvrage « ${input.title.trim()} » ajouté au catalogue (${input.shelfLocation.trim()}).`,
      now
    );
    return this.getBookDetail(id, now);
  }

  public updateBook(
    bookId: string,
    patch: Partial<Omit<Book, 'id' | 'createdAt'>>,
    actor?: AuditActor | null,
    now: Date = new Date()
  ): BookDetail {
    const existing = this.db.prepare(`SELECT * FROM books WHERE id = ?`).get(bookId) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      throw new DomainError('Ouvrage introuvable.', 404, 'BOOK_NOT_FOUND');
    }

    const nextTitle = patch.title !== undefined ? patch.title.trim() : String(existing.title);
    const nextArchived = patch.archived !== undefined ? (patch.archived ? 1 : 0) : Number(existing.archived);

    this.db
      .prepare(
        `UPDATE books
         SET title = ?, authors = ?, isbn = ?, category = ?, description = ?,
             publisher = ?, publicationYear = ?, edition = ?, language = ?,
             coverImage = ?, shelfLocation = ?, archived = ?, featured = ?
         WHERE id = ?`
      )
      .run(
        nextTitle,
        patch.authors !== undefined ? patch.authors.trim() : String(existing.authors),
        patch.isbn !== undefined ? (patch.isbn ? patch.isbn.trim() : null) : existing.isbn,
        patch.category !== undefined ? patch.category : String(existing.category),
        patch.description !== undefined ? patch.description.trim() : String(existing.description),
        patch.publisher !== undefined ? patch.publisher.trim() : String(existing.publisher),
        patch.publicationYear !== undefined
          ? Number(patch.publicationYear)
          : Number(existing.publicationYear),
        patch.edition !== undefined ? patch.edition.trim() : String(existing.edition),
        patch.language !== undefined ? patch.language : String(existing.language),
        patch.coverImage !== undefined ? patch.coverImage : String(existing.coverImage),
        patch.shelfLocation !== undefined ? patch.shelfLocation.trim() : String(existing.shelfLocation),
        nextArchived,
        patch.featured !== undefined ? (patch.featured ? 1 : 0) : Number(existing.featured),
        bookId
      );

    this.insertAuditLogInternal(
      actor || { id: 'bibliothecaire', role: 'bibliothecaire' },
      'BOOK_UPDATED',
      'book',
      bookId,
      `Notice de l’ouvrage « ${nextTitle} » mise à jour${nextArchived !== Number(existing.archived) ? (nextArchived ? ' (archivé)' : ' (désarchivé)') : ''}.`,
      now
    );

    return this.getBookDetail(bookId);
  }

  public registerCopy(
    bookId: string,
    input: { barcode: string; physicalCondition: PhysicalCondition; location: string },
    now: Date = new Date(),
    actor?: AuditActor | null
  ): { copy: Copy; assignedReservationId: string | null } {
    const tx = this.db.transaction(() => {
      const book = this.db.prepare(`SELECT id, title FROM books WHERE id = ?`).get(bookId) as
        | { id: string; title: string }
        | undefined;
      if (!book) {
        throw new DomainError('Ouvrage introuvable.', 404, 'BOOK_NOT_FOUND');
      }

      const dup = this.db
        .prepare(`SELECT id FROM copies WHERE barcode = ?`)
        .get(input.barcode.trim());
      if (dup) {
        throw new DomainError('Un exemplaire avec ce code-barres existe déjà.', 409, 'DUPLICATE_BARCODE');
      }

      const copyId = this.generateId('cp');
      const isDamaged =
        input.physicalCondition === 'Endommagé' || input.physicalCondition === 'Hors service';
      const initialStatus: CopyStatus =
        input.physicalCondition === 'Hors service'
          ? 'Retiré définitivement'
          : input.physicalCondition === 'Endommagé'
            ? 'En réparation'
            : 'Disponible';

      this.db
        .prepare(
          `INSERT INTO copies (id, bookId, barcode, status, physicalCondition, location, needsInspection, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          copyId,
          bookId,
          input.barcode.trim(),
          initialStatus,
          input.physicalCondition,
          input.location.trim(),
          input.physicalCondition === 'Endommagé' ? 1 : 0,
          now.toISOString()
        );

      this.insertAuditLogInternal(
        actor || { id: 'bibliothecaire', role: 'bibliothecaire' },
        'COPY_REGISTERED',
        'copy',
        copyId,
        `Nouvel exemplaire ${input.barcode.trim()} enregistré pour « ${book.title} » (${initialStatus}).`,
        now
      );

      let assignedReservationId: string | null = null;
      if (!isDamaged) {
        assignedReservationId = this.assignCopyToNextEligibleReservationInternal(
          bookId,
          copyId,
          now,
          actor
        );
      }

      return {
        copy: this.getCopyByIdInternal(copyId)!,
        assignedReservationId,
      };
    });

    return tx.immediate();
  }

  public updateCopyStatusAdmin(
    copyId: string,
    status: CopyStatus,
    physicalCondition: PhysicalCondition,
    location: string,
    now: Date = new Date(),
    actor?: AuditActor | null
  ): Copy {
    const tx = this.db.transaction(() => {
      const existing = this.db
        .prepare(`SELECT * FROM copies WHERE id = ?`)
        .get(copyId) as Record<string, unknown> | undefined;
      if (!existing) {
        throw new DomainError('Exemplaire introuvable.', 404, 'COPY_NOT_FOUND');
      }

      if (String(existing.status) === 'Emprunté' && status !== 'Emprunté') {
        throw new DomainError(
          'Un exemplaire actuellement emprunté doit passer par la procédure de retour et d’inspection.',
          409,
          'COPY_CURRENTLY_BORROWED'
        );
      }

      if (status === 'Disponible') {
        this.db
          .prepare(
            `UPDATE copies SET physicalCondition = ?, location = ?, needsInspection = 0 WHERE id = ?`
          )
          .run(physicalCondition, location.trim(), copyId);
        this.assignCopyToNextEligibleReservationInternal(
          String(existing.bookId),
          copyId,
          now,
          actor
        );
      } else {
        this.db
          .prepare(
            `UPDATE copies SET status = ?, physicalCondition = ?, location = ?, needsInspection = ? WHERE id = ?`
          )
          .run(
            status,
            physicalCondition,
            location.trim(),
            status === 'En réparation' ? 1 : 0,
            copyId
          );
      }

      this.insertAuditLogInternal(
        actor || { id: 'bibliothecaire', role: 'bibliothecaire' },
        'COPY_STATUS_UPDATED',
        'copy',
        copyId,
        `Statut de l'exemplaire ${String(existing.barcode)} modifié : ${status} (${physicalCondition}).`,
        now
      );

      return this.getCopyByIdInternal(copyId)!;
    });

    return tx.immediate();
  }

  public listMembersAdmin(): UserPublic[] {
    const rows = this.db
      .prepare(
        `SELECT id, fullName, email, role, institution, studentStatus, accountStatus, cne, filiere, authSource, isDemo, createdAt
         FROM users
         ORDER BY isDemo ASC, role DESC, fullName ASC`
      )
      .all() as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: String(row.id),
      fullName: String(row.fullName),
      email: String(row.email),
      role: row.role as UserPublic['role'],
      institution: String(row.institution),
      studentStatus: row.studentStatus as StudentStatus,
      accountStatus: row.accountStatus as AccountStatus,
      cne: row.cne ? String(row.cne) : null,
      filiere: row.filiere ? String(row.filiere) : null,
      authSource: row.authSource as UserPublic['authSource'],
      isDemo: Boolean(row.isDemo),
      createdAt: String(row.createdAt),
    }));
  }

  public updateMemberVerificationAdmin(
    userId: string,
    studentStatus: StudentStatus,
    accountStatus: AccountStatus,
    actor?: AuditActor | null,
    now: Date = new Date()
  ): UserPublic {
    const existing = this.db
      .prepare(`SELECT id, fullName, email FROM users WHERE id = ?`)
      .get(userId) as { id: string; fullName: string; email: string } | undefined;
    if (!existing) {
      throw new DomainError('Utilisateur introuvable.', 404, 'USER_NOT_FOUND');
    }

    this.db
      .prepare(`UPDATE users SET studentStatus = ?, accountStatus = ? WHERE id = ?`)
      .run(studentStatus, accountStatus, userId);

    this.insertAuditLogInternal(
      actor || { id: 'bibliothecaire', role: 'bibliothecaire' },
      'MEMBER_VERIFICATION_UPDATED',
      'user',
      userId,
      `Statut de ${existing.fullName} (${existing.email}) mis à jour : éligibilité=${studentStatus}, compte=${accountStatus}.`,
      now
    );

    const row = this.db
      .prepare(
        `SELECT id, fullName, email, role, institution, studentStatus, accountStatus, cne, filiere, authSource, isDemo, createdAt
         FROM users WHERE id = ?`
      )
      .get(userId) as Record<string, unknown>;

    return {
      id: String(row.id),
      fullName: String(row.fullName),
      email: String(row.email),
      role: row.role as UserPublic['role'],
      institution: String(row.institution),
      studentStatus: row.studentStatus as StudentStatus,
      accountStatus: row.accountStatus as AccountStatus,
      cne: row.cne ? String(row.cne) : null,
      filiere: row.filiere ? String(row.filiere) : null,
      authSource: row.authSource as UserPublic['authSource'],
      isDemo: Boolean(row.isDemo),
      createdAt: String(row.createdAt),
    };
  }

  // --- Panier de demandes (ne réserve jamais d'exemplaire avant confirmation serveur) ---

  public getCart(userId: string, now: Date = new Date()): CartItemRecord[] {
    this.processDeadlines(now);
    const rows = this.db
      .prepare(
        `SELECT ci.id as cartItemId, ci.bookId, ci.quantity, ci.addedAt, b.*
         FROM cart_items ci
         JOIN books b ON b.id = ci.bookId
         WHERE ci.userId = ?
         ORDER BY ci.addedAt ASC`
      )
      .all(userId) as Array<Record<string, unknown>>;

    const copyStatsRows = this.db
      .prepare(
        `SELECT bookId,
          COUNT(*) as allRows,
          COALESCE(SUM(CASE WHEN status != 'Retiré définitivement' THEN 1 ELSE 0 END), 0) as totalPhysical,
          COALESCE(SUM(CASE WHEN status = 'Disponible' AND needsInspection = 0 AND physicalCondition NOT IN ('Endommagé', 'Hors service') THEN 1 ELSE 0 END), 0) as available,
          COALESCE(SUM(CASE WHEN status = 'Emprunté' THEN 1 ELSE 0 END), 0) as borrowed,
          COALESCE(SUM(CASE WHEN status = 'Réservé' THEN 1 ELSE 0 END), 0) as reserved,
          COALESCE(SUM(CASE WHEN status = 'En réparation' THEN 1 ELSE 0 END), 0) as repair,
          COALESCE(SUM(CASE WHEN status = 'Retiré définitivement' THEN 1 ELSE 0 END), 0) as withdrawn
         FROM copies
         GROUP BY bookId`
      )
      .all() as Array<Record<string, unknown>>;

    const statsMap = new Map<string, Record<string, number>>();
    for (const row of copyStatsRows) {
      statsMap.set(String(row.bookId), {
        totalPhysical: Number(row.totalPhysical || 0),
        available: Number(row.available || 0),
        borrowed: Number(row.borrowed || 0),
        reserved: Number(row.reserved || 0),
        repair: Number(row.repair || 0),
        withdrawn: Number(row.withdrawn || 0),
      });
    }

    return rows.map((row) => {
      const bookId = String(row.bookId);
      const st = statsMap.get(bookId) || {
        totalPhysical: 0,
        available: 0,
        borrowed: 0,
        reserved: 0,
        repair: 0,
        withdrawn: 0,
      };
      return {
        id: String(row.cartItemId),
        bookId,
        quantity: Number(row.quantity),
        addedAt: String(row.addedAt),
        book: {
          id: bookId,
          title: String(row.title),
          authors: String(row.authors),
          isbn: row.isbn ? String(row.isbn) : null,
          category: String(row.category),
          description: String(row.description),
          publisher: String(row.publisher),
          publicationYear: Number(row.publicationYear),
          edition: String(row.edition),
          language: String(row.language),
          coverImage: String(row.coverImage),
          shelfLocation: String(row.shelfLocation),
          archived: Boolean(row.archived),
          featured: Boolean(row.featured),
          isDemo: Boolean(row.isDemo),
          createdAt: String(row.createdAt),
          totalCopies: st.totalPhysical,
          availableCopies: st.available,
          borrowedCopies: st.borrowed,
          reservedCopies: st.reserved,
          repairCopies: st.repair,
          withdrawnCopies: st.withdrawn,
          circulatingCopies: st.totalPhysical,
        },
      };
    });
  }

  public addToCart(
    userId: string,
    bookId: string,
    quantity = 1,
    now: Date = new Date()
  ): CartItemRecord[] {
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new DomainError('La quantité doit être égale à 1.', 400, 'INVALID_QUANTITY');
    }
    if (quantity > MAX_QUANTITY_PER_TITLE) {
      throw new DomainError(
        'Règlement BiblioEST : un membre ne peut demander qu’un seul exemplaire par titre.',
        409,
        'MAX_QUANTITY_PER_TITLE'
      );
    }

    const book = this.db
      .prepare(`SELECT id, archived FROM books WHERE id = ?`)
      .get(bookId) as { id: string; archived: number } | undefined;

    if (!book) {
      throw new DomainError('Ouvrage introuvable.', 404, 'BOOK_NOT_FOUND');
    }
    if (Boolean(book.archived)) {
      throw new DomainError(
        'Cet ouvrage est archivé et ne peut pas être ajouté au panier de demandes.',
        409,
        'BOOK_ARCHIVED'
      );
    }

    const existing = this.db
      .prepare(`SELECT id, quantity FROM cart_items WHERE userId = ? AND bookId = ?`)
      .get(userId, bookId) as { id: string; quantity: number } | undefined;

    if (existing) {
      throw new DomainError(
        'Cet ouvrage figure déjà dans votre panier de demandes (limite de 1 exemplaire par titre).',
        409,
        'MAX_QUANTITY_PER_TITLE'
      );
    }

    this.db
      .prepare(
        `INSERT INTO cart_items (id, userId, bookId, quantity, addedAt)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(this.generateId('crt'), userId, bookId, MAX_QUANTITY_PER_TITLE, now.toISOString());

    return this.getCart(userId, now);
  }

  public updateCartItemQuantity(
    userId: string,
    bookId: string,
    quantity: number,
    now: Date = new Date()
  ): CartItemRecord[] {
    if (!Number.isInteger(quantity) || quantity < 0) {
      throw new DomainError('Quantité invalide.', 400, 'INVALID_QUANTITY');
    }
    if (quantity === 0) {
      return this.removeFromCart(userId, bookId, now);
    }
    if (quantity > MAX_QUANTITY_PER_TITLE) {
      throw new DomainError(
        'Règlement BiblioEST : la quantité maximale autorisée est de 1 exemplaire par titre.',
        409,
        'MAX_QUANTITY_PER_TITLE'
      );
    }
    return this.getCart(userId, now);
  }

  public removeFromCart(
    userId: string,
    bookId: string,
    now: Date = new Date()
  ): CartItemRecord[] {
    this.db
      .prepare(`DELETE FROM cart_items WHERE userId = ? AND bookId = ?`)
      .run(userId, bookId);
    return this.getCart(userId, now);
  }

  public clearCart(userId: string): void {
    this.db.prepare(`DELETE FROM cart_items WHERE userId = ?`).run(userId);
  }

  public confirmCart(
    memberId: string,
    now: Date = new Date()
  ): CartConfirmationResponse {
    const tx = this.db.transaction(() => {
      this.syncOverdueLoansInternal(now);
      this.expireOverdueReservationsInternal(now);

      const items = this.db
        .prepare(
          `SELECT ci.id, ci.bookId, ci.quantity, b.title as bookTitle
           FROM cart_items ci
           JOIN books b ON b.id = ci.bookId
           WHERE ci.userId = ?
           ORDER BY ci.addedAt ASC`
        )
        .all(memberId) as Array<{
        id: string;
        bookId: string;
        quantity: number;
        bookTitle: string;
      }>;

      if (items.length === 0) {
        throw new DomainError('Votre panier de demandes est vide.', 400, 'EMPTY_CART');
      }

      const eligibility = this.checkEligibility(memberId, now);
      const results: CartConfirmationItemResult[] = [];
      let borrowedCount = 0;
      let reservedCount = 0;
      let refusedCount = 0;

      for (const item of items) {
        if (item.quantity > MAX_QUANTITY_PER_TITLE) {
          refusedCount++;
          results.push({
            bookId: item.bookId,
            bookTitle: item.bookTitle,
            outcome: 'refuse',
            code: 'MAX_QUANTITY_PER_TITLE',
            message: 'Quantité refusée : limite de 1 exemplaire par titre.',
          });
          continue;
        }

        if (!eligibility.eligible) {
          refusedCount++;
          results.push({
            bookId: item.bookId,
            bookTitle: item.bookTitle,
            outcome: 'refuse',
            code: eligibility.reasonCode,
            message: eligibility.reasonMessage,
          });
          continue;
        }

        try {
          const loan = this.borrowBookInternal(memberId, item.bookId, now, null, {
            id: memberId,
            role: 'membre',
          });
          borrowedCount++;
          this.db.prepare(`DELETE FROM cart_items WHERE id = ?`).run(item.id);
          results.push({
            bookId: item.bookId,
            bookTitle: item.bookTitle,
            outcome: 'emprunt_enregistre',
            message: `Emprunt enregistré pour 7 jours (exemplaire ${loan.copyBarcode}).`,
            loan,
          });
        } catch (err) {
          if (err instanceof DomainError && err.code === 'NO_AVAILABLE_COPY') {
            try {
              const reservation = this.reserveBookInternal(memberId, item.bookId, now, {
                id: memberId,
                role: 'membre',
              });
              reservedCount++;
              this.db.prepare(`DELETE FROM cart_items WHERE id = ?`).run(item.id);
              results.push({
                bookId: item.bookId,
                bookTitle: item.bookTitle,
                outcome: 'reservation_enregistree',
                message: `Aucun exemplaire libre : réservation FIFO #${reservation.queuePosition ?? 1} enregistrée. Aucune date de disponibilité n'est garantie.`,
                reservation,
              });
            } catch (resErr) {
              refusedCount++;
              results.push({
                bookId: item.bookId,
                bookTitle: item.bookTitle,
                outcome: 'refuse',
                code: resErr instanceof DomainError ? resErr.code : 'RESERVATION_REFUSED',
                message:
                  resErr instanceof Error
                    ? resErr.message
                    : 'Impossible d’enregistrer la réservation.',
              });
            }
          } else {
            refusedCount++;
            results.push({
              bookId: item.bookId,
              bookTitle: item.bookTitle,
              outcome: 'refuse',
              code: err instanceof DomainError ? err.code : 'REQUEST_REFUSED',
              message:
                err instanceof Error ? err.message : 'Demande refusée lors de la vérification serveur.',
            });
          }
        }
      }

      this.insertAuditLogInternal(
        { id: memberId, role: 'membre' },
        'CART_CONFIRMED',
        'cart',
        memberId,
        `Confirmation du panier : ${borrowedCount} emprunt(s), ${reservedCount} réservation(s), ${refusedCount} refus.`,
        now
      );

      const remainingRow = this.db
        .prepare(`SELECT COUNT(*) as cnt FROM cart_items WHERE userId = ?`)
        .get(memberId) as { cnt: number };

      return {
        results,
        remainingCartCount: remainingRow.cnt,
      };
    });

    return tx.immediate();
  }

  public getAuditLogsAdmin(limit = 100): AuditLogRecord[] {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const rows = this.db
      .prepare(
        `SELECT * FROM audit_logs
         ORDER BY createdAt DESC, rowid DESC
         LIMIT ?`
      )
      .all(safeLimit) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: String(row.id),
      actorId: row.actorId ? String(row.actorId) : null,
      actorName: row.actorName ? String(row.actorName) : null,
      actorRole: row.actorRole ? String(row.actorRole) : null,
      action: String(row.action),
      entityType: String(row.entityType),
      entityId: String(row.entityId),
      summary: String(row.summary),
      createdAt: String(row.createdAt),
    }));
  }

  private getCopyByIdInternal(copyId: string): Copy | null {
    const c = this.db.prepare(`SELECT * FROM copies WHERE id = ?`).get(copyId) as
      | Record<string, unknown>
      | undefined;
    if (!c) return null;
    return {
      id: String(c.id),
      bookId: String(c.bookId),
      barcode: String(c.barcode),
      status: c.status as CopyStatus,
      physicalCondition: c.physicalCondition as PhysicalCondition,
      location: String(c.location),
      needsInspection: Boolean(c.needsInspection),
      createdAt: String(c.createdAt),
    };
  }

  private getLoanByIdInternal(loanId: string): LoanRecord | null {
    const r = this.db
      .prepare(
        `SELECT l.*, b.title as bookTitle, b.authors as bookAuthors, b.coverImage as bookCoverImage,
                b.shelfLocation as shelfLocation, c.barcode as copyBarcode
         FROM loans l
         JOIN books b ON b.id = l.bookId
         JOIN copies c ON c.id = l.copyId
         WHERE l.id = ?`
      )
      .get(loanId) as Record<string, unknown> | undefined;
    return r ? this.mapLoanRow(r, false) : null;
  }

  private getReservationByIdInternal(reservationId: string): ReservationRecord | null {
    const r = this.db
      .prepare(
        `SELECT r.*, b.title as bookTitle, b.authors as bookAuthors, b.coverImage as bookCoverImage,
                b.shelfLocation as shelfLocation, c.barcode as assignedCopyBarcode
         FROM reservations r
         JOIN books b ON b.id = r.bookId
         LEFT JOIN copies c ON c.id = r.assignedCopyId
         WHERE r.id = ?`
      )
      .get(reservationId) as Record<string, unknown> | undefined;
    return r ? this.mapReservationRow(r, false) : null;
  }

  private mapLoanRow(r: Record<string, unknown>, includeMemberPii: boolean): LoanRecord {
    const base: LoanRecord = {
      id: String(r.id),
      memberId: String(r.memberId),
      copyId: String(r.copyId),
      bookId: String(r.bookId),
      borrowedAt: String(r.borrowedAt),
      dueAt: String(r.dueAt),
      returnedAt: r.returnedAt ? String(r.returnedAt) : null,
      returnCondition: r.returnCondition ? String(r.returnCondition) : null,
      returnNotes: r.returnNotes ? String(r.returnNotes) : null,
      status: r.status as LoanRecord['status'],
      bookTitle: String(r.bookTitle),
      bookAuthors: String(r.bookAuthors),
      bookCoverImage: String(r.bookCoverImage),
      shelfLocation: String(r.shelfLocation),
      copyBarcode: String(r.copyBarcode),
    };

    if (includeMemberPii) {
      base.memberName = r.memberName ? String(r.memberName) : undefined;
      base.memberEmail = r.memberEmail ? String(r.memberEmail) : undefined;
      base.memberCne = r.memberCne ? String(r.memberCne) : null;
    }

    return base;
  }

  private mapReservationRow(
    r: Record<string, unknown>,
    includeMemberPii: boolean
  ): ReservationRecord {
    const base: ReservationRecord = {
      id: String(r.id),
      memberId: String(r.memberId),
      bookId: String(r.bookId),
      requestedAt: String(r.requestedAt),
      queuePosition: r.queuePosition !== null && r.queuePosition !== undefined ? Number(r.queuePosition) : null,
      status: r.status as ReservationRecord['status'],
      assignedCopyId: r.assignedCopyId ? String(r.assignedCopyId) : null,
      availableAt: r.availableAt ? String(r.availableAt) : null,
      pickupDeadline: r.pickupDeadline ? String(r.pickupDeadline) : null,
      completedAt: r.completedAt ? String(r.completedAt) : null,
      bookTitle: String(r.bookTitle),
      bookAuthors: String(r.bookAuthors),
      bookCoverImage: String(r.bookCoverImage),
      shelfLocation: String(r.shelfLocation),
      assignedCopyBarcode: r.assignedCopyBarcode ? String(r.assignedCopyBarcode) : null,
    };

    if (includeMemberPii) {
      base.memberName = r.memberName ? String(r.memberName) : undefined;
      base.memberEmail = r.memberEmail ? String(r.memberEmail) : undefined;
      base.memberCne = r.memberCne ? String(r.memberCne) : null;
    }

    return base;
  }
}
