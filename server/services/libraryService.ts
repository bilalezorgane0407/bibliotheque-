import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { hashPassword } from '../auth/password.ts';
import {
  BORROWING_DURATION_DAYS,
  HOLD_DURATION_HOURS,
  MAX_QUANTITY_PER_TITLE,
  PICKUP_WINDOW_DAYS,
  type AccountStatus,
  type AuditLogRecord,
  type Book,
  type BookDetail,
  type BookWithStats,
  type CartConfirmationItemResult,
  type CartConfirmationResponse,
  type CartItemRecord,
  type Copy,
  type CopyStateLogRecord,
  type CopyStatus,
  type CounterMemberDossier,
  type CounterPickupResult,
  type CounterReturnLookup,
  type DashboardStats,
  type EligibilityReport,
  type LibrarySettings,
  type LoanRecord,
  type NotificationRecord,
  type OverdueEmailRecipient,
  type PhysicalCondition,
  type RequestType,
  type ReservationRecord,
  type ReturnInspectionOutcome,
  type SimulatedEmailRecord,
  type StudentStatus,
  type UserPublic,
  type UserRole,
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

function addHoursIso(date: Date, hours: number): string {
  return new Date(date.getTime() + hours * 60 * 60 * 1000).toISOString();
}

export class LibraryService {
  private readonly db: Database.Database;
  private readonly isDemoSandbox: boolean;

  constructor(db: Database.Database, options?: { isDemoSandbox?: boolean }) {
    this.db = db;
    this.isDemoSandbox = Boolean(options?.isDemoSandbox);
  }

  private generateId(prefix: string): string {
    return `${prefix}-${crypto.randomUUID().slice(0, 12)}`;
  }

  public getSettings(): LibrarySettings {
    const row = this.db
      .prepare(`SELECT * FROM library_settings WHERE id = 'default'`)
      .get() as
      | {
          borrowingDurationDays: number;
          pickupWindowDays: number;
          maxQuantityPerTitle: number;
          realEmailsEnabled: number;
          testEmailRecipient: string;
        }
      | undefined;

    if (!row) {
      return {
        borrowingDurationDays: BORROWING_DURATION_DAYS,
        pickupWindowDays: PICKUP_WINDOW_DAYS,
        maxQuantityPerTitle: MAX_QUANTITY_PER_TITLE,
        realEmailsEnabled: this.isDemoSandbox ? false : true,
        testEmailRecipient: this.isDemoSandbox
          ? 'test.demo@usmba.example'
          : 'bilale.zorgane@usmba.ac.ma',
      };
    }

    return {
      borrowingDurationDays: Number(row.borrowingDurationDays) || BORROWING_DURATION_DAYS,
      pickupWindowDays: Number(row.pickupWindowDays) || PICKUP_WINDOW_DAYS,
      maxQuantityPerTitle: Number(row.maxQuantityPerTitle) || MAX_QUANTITY_PER_TITLE,
      realEmailsEnabled: this.isDemoSandbox ? false : Boolean(row.realEmailsEnabled),
      testEmailRecipient: String(row.testEmailRecipient || 'bilale.zorgane@usmba.ac.ma'),
    };
  }

  public updateSettings(
    patch: Partial<LibrarySettings>,
    actor: AuditActor,
    now: Date = new Date()
  ): LibrarySettings {
    const current = this.getSettings();
    const borrowingDurationDays =
      patch.borrowingDurationDays !== undefined
        ? Math.max(1, Math.min(60, Math.floor(Number(patch.borrowingDurationDays))))
        : current.borrowingDurationDays;
    const pickupWindowDays =
      patch.pickupWindowDays !== undefined
        ? Math.max(1, Math.min(14, Math.floor(Number(patch.pickupWindowDays))))
        : current.pickupWindowDays;
    const maxQuantityPerTitle =
      patch.maxQuantityPerTitle !== undefined
        ? Math.max(1, Math.min(5, Math.floor(Number(patch.maxQuantityPerTitle))))
        : current.maxQuantityPerTitle;
    const realEmailsEnabled =
      this.isDemoSandbox
        ? false
        : patch.realEmailsEnabled !== undefined
          ? Boolean(patch.realEmailsEnabled)
          : current.realEmailsEnabled;
    const testEmailRecipient =
      patch.testEmailRecipient !== undefined && patch.testEmailRecipient.trim()
        ? patch.testEmailRecipient.trim().toLowerCase()
        : current.testEmailRecipient;

    this.db
      .prepare(
        `INSERT OR REPLACE INTO library_settings (id, borrowingDurationDays, pickupWindowDays, maxQuantityPerTitle, realEmailsEnabled, testEmailRecipient)
         VALUES ('default', ?, ?, ?, ?, ?)`
      )
      .run(
        borrowingDurationDays,
        pickupWindowDays,
        maxQuantityPerTitle,
        realEmailsEnabled ? 1 : 0,
        testEmailRecipient
      );

    this.insertAuditLogInternal(
      actor,
      'LIBRARY_SETTINGS_UPDATED',
      'settings',
      'default',
      `Paramètres mis à jour : prêt=${borrowingDurationDays}j, retrait=${pickupWindowDays}j, e-mails réels=${realEmailsEnabled ? 'activés' : 'désactivés'}, destinataire test=${testEmailRecipient}.`,
      now
    );

    return this.getSettings();
  }

  public recordSimulatedEmail(
    params: {
      recipientEmail: string;
      subject: string;
      body: string;
      category: SimulatedEmailRecord['category'];
    },
    now: Date = new Date()
  ): SimulatedEmailRecord {
    const id = this.generateId('sim');
    const createdAt = now.toISOString();
    this.db
      .prepare(
        `INSERT INTO simulated_outbox (id, recipientEmail, subject, body, category, createdAt)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, params.recipientEmail, params.subject, params.body, params.category, createdAt);
    return { id, ...params, createdAt };
  }

  public getSimulatedOutbox(limit = 50): SimulatedEmailRecord[] {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
    const rows = this.db
      .prepare(
        `SELECT id, recipientEmail, subject, body, category, createdAt
         FROM simulated_outbox
         ORDER BY createdAt DESC, rowid DESC
         LIMIT ?`
      )
      .all(safeLimit) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: String(r.id),
      recipientEmail: String(r.recipientEmail),
      subject: String(r.subject),
      body: String(r.body),
      category: r.category as SimulatedEmailRecord['category'],
      createdAt: String(r.createdAt),
    }));
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

  private insertCopyStateLogInternal(
    params: {
      copyId: string;
      copyBarcode: string;
      bookId: string;
      bookTitle: string;
      oldStatus: CopyStatus | null;
      newStatus: CopyStatus;
      memberId?: string | null;
      memberName?: string | null;
      agent?: AuditActor | null;
      requestOrLoanId?: string | null;
      summary: string;
    },
    now: Date
  ): void {
    let resolvedMemberName = params.memberName ?? null;
    if (params.memberId && !resolvedMemberName) {
      const mRow = this.db
        .prepare(`SELECT fullName FROM users WHERE id = ?`)
        .get(params.memberId) as { fullName: string } | undefined;
      resolvedMemberName = mRow?.fullName || null;
    }

    let resolvedAgentName = params.agent?.fullName ?? null;
    if (params.agent?.id && !resolvedAgentName) {
      const aRow = this.db
        .prepare(`SELECT fullName FROM users WHERE id = ?`)
        .get(params.agent.id) as { fullName: string } | undefined;
      resolvedAgentName = aRow?.fullName || null;
    }

    this.db
      .prepare(
        `INSERT INTO copy_state_logs (id, copyId, copyBarcode, bookId, bookTitle, oldStatus, newStatus, memberId, memberName, agentId, agentName, requestOrLoanId, summary, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        this.generateId('csl'),
        params.copyId,
        params.copyBarcode,
        params.bookId,
        params.bookTitle,
        params.oldStatus,
        params.newStatus,
        params.memberId || null,
        resolvedMemberName,
        params.agent?.id || null,
        resolvedAgentName,
        params.requestOrLoanId || null,
        params.summary,
        now.toISOString()
      );
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
        emailVerified: false,
        verifiedEstStudent: false,
        accountActive: false,
        noOverdueLoans: false,
        eligible: false,
        overdueCount: 0,
        reasonCode: 'AUTH_REQUIRED',
        reasonMessage: 'Authentification requise. Veuillez vous connecter avec votre compte académique.',
      };
    }

    this.syncOverdueLoansInternal(now);

    const user = this.db
      .prepare(
        `SELECT id, institution, studentStatus, accountStatus, emailVerified FROM users WHERE id = ?`
      )
      .get(memberId) as
      | {
          id: string;
          institution: string;
          studentStatus: StudentStatus;
          accountStatus: AccountStatus;
          emailVerified?: number;
        }
      | undefined;

    if (!user) {
      return {
        authenticated: false,
        emailVerified: false,
        verifiedEstStudent: false,
        accountActive: false,
        noOverdueLoans: false,
        eligible: false,
        overdueCount: 0,
        reasonCode: 'AUTH_REQUIRED',
        reasonMessage: 'Session utilisateur introuvable. Authentification requise.',
      };
    }

    const emailVerified = user.emailVerified === undefined ? true : Boolean(user.emailVerified);
    const verifiedEstStudent = user.studentStatus === 'verifie';
    const accountActive = user.accountStatus === 'actif';

    if (!emailVerified) {
      return {
        authenticated: true,
        emailVerified: false,
        verifiedEstStudent,
        accountActive,
        noOverdueLoans: true,
        eligible: false,
        overdueCount: 0,
        reasonCode: 'EMAIL_NOT_VERIFIED',
        reasonMessage:
          'Votre adresse e-mail académique n’est pas encore vérifiée. Veuillez saisir le code à usage unique envoyé par e-mail.',
      };
    }

    if (!accountActive) {
      return {
        authenticated: true,
        emailVerified: true,
        verifiedEstStudent,
        accountActive: false,
        noOverdueLoans: false,
        eligible: false,
        overdueCount: 0,
        reasonCode: 'ACCOUNT_SUSPENDED',
        reasonMessage: 'Votre compte est actuellement suspendu par l’administration.',
      };
    }

    if (!verifiedEstStudent) {
      return {
        authenticated: true,
        emailVerified: true,
        verifiedEstStudent: false,
        accountActive: true,
        noOverdueLoans: true,
        eligible: false,
        overdueCount: 0,
        reasonCode: 'EST_STATUS_NOT_VERIFIED',
        reasonMessage:
          'Adresse académique vérifiée, mais votre statut EST Fès est en attente de validation par le personnel de la bibliothèque.',
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
        emailVerified: true,
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
      emailVerified: true,
      verifiedEstStudent: true,
      accountActive: true,
      noOverdueLoans: true,
      eligible: true,
      overdueCount: 0,
      reasonCode: 'ELIGIBLE',
      reasonMessage: 'Membre vérifié et éligible aux emprunts et réservations.',
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
    actor?: AuditActor | null,
    previousCopyStatus: CopyStatus | null = null
  ): string | null {
    const book = this.db
      .prepare(`SELECT title, shelfLocation FROM books WHERE id = ?`)
      .get(bookId) as { title: string; shelfLocation: string } | undefined;
    const copy = this.db
      .prepare(`SELECT barcode, status FROM copies WHERE id = ?`)
      .get(copyId) as { barcode: string; status: CopyStatus } | undefined;

    if (!book || !copy) return null;

    const oldStatus = previousCopyStatus ?? copy.status;
    const settings = this.getSettings();
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

      const nowIso = now.toISOString();
      const pickupDeadline = addDaysIso(now, settings.pickupWindowDays);

      this.db
        .prepare(
          `UPDATE copies
           SET status = 'Réservé', location = 'Banque d’accueil · Retrait réservations (3j)'
           WHERE id = ?`
        )
        .run(copyId);

      // Diagramme 2 & 3 : l'exemplaire réutilisable est immédiatement attribué au premier de la file FIFO
      // et conservé pendant le délai de retrait (3 jours par défaut) sans exposer le code-barres au public.
      this.db
        .prepare(
          `UPDATE reservations
           SET status = 'Disponible pour retrait',
               assignedCopyId = ?,
               availableAt = ?,
               pickupDeadline = ?,
               queuePosition = NULL
           WHERE id = ?`
        )
        .run(copyId, nowIso, pickupDeadline, candidate.id);

      this.recalculateQueuePositionsInternal(bookId);

      const notifMessage = `Votre réservation pour « ${book.title} » est désormais prête à la banque d’accueil. Présentez votre carte membre pour le retrait dans un délai de ${settings.pickupWindowDays} jours, jusqu’au ${formatFrenchDateTime(pickupDeadline)}.`;

      this.insertNotificationInternal(
        candidate.memberId,
        'Ouvrage disponible pour retrait',
        notifMessage,
        'retrait',
        now
      );

      if (this.isDemoSandbox) {
        const memberRow = this.db
          .prepare(`SELECT email FROM users WHERE id = ?`)
          .get(candidate.memberId) as { email: string } | undefined;
        if (memberRow?.email) {
          this.recordSimulatedEmail(
            {
              recipientEmail: memberRow.email,
              subject: `BiblioEST — « ${book.title} » disponible pour retrait (${settings.pickupWindowDays} j)`,
              body: notifMessage,
              category: 'retrait',
            },
            now
          );
        }
      }

      this.insertCopyStateLogInternal(
        {
          copyId,
          copyBarcode: copy.barcode,
          bookId,
          bookTitle: book.title,
          oldStatus,
          newStatus: 'Réservé',
          memberId: candidate.memberId,
          agent: actor || { id: 'system', fullName: 'Système file FIFO', role: 'system' },
          requestOrLoanId: candidate.id,
          summary: `Exemplaire ${copy.barcode} attribué au premier membre FIFO éligible (délai de retrait ${settings.pickupWindowDays} j).`,
        },
        now
      );

      this.insertAuditLogInternal(
        actor,
        'RESERVATION_ASSIGNED_FOR_PICKUP',
        'reservation',
        candidate.id,
        `Exemplaire ${copy.barcode} (« ${book.title} ») attribué automatiquement en priorité FIFO et mis à disposition pour retrait (${settings.pickupWindowDays} jours jusqu’au ${formatFrenchDateTime(pickupDeadline)}).`,
        now
      );

      return candidate.id;
    }

    // Aucun membre en attente éligible : remettre l'exemplaire en rayon
    this.db
      .prepare(`UPDATE copies SET status = 'Disponible', location = ? WHERE id = ?`)
      .run(book.shelfLocation ? `Rayon · ${book.shelfLocation}` : 'Rayon principal', copyId);

    if (oldStatus !== 'Disponible') {
      this.insertCopyStateLogInternal(
        {
          copyId,
          copyBarcode: copy.barcode,
          bookId,
          bookTitle: book.title,
          oldStatus,
          newStatus: 'Disponible',
          agent: actor || { id: 'system', fullName: 'Système circulation', role: 'system' },
          summary: `Exemplaire ${copy.barcode} remis en rayon (Disponible, aucune attente FIFO éligible).`,
        },
        now
      );
    }

    return null;
  }

  private expireOverdueReservationsInternal(now: Date): number {
    const nowIso = now.toISOString();
    const expired = this.db
      .prepare(
        `SELECT r.id, r.memberId, r.bookId, r.status, r.requestType, r.assignedCopyId, b.title as bookTitle
         FROM reservations r
         JOIN books b ON b.id = r.bookId
         WHERE r.status IN ('Retenu 24h', 'Disponible pour retrait') AND r.pickupDeadline < ?
         ORDER BY r.pickupDeadline ASC`
      )
      .all(nowIso) as Array<{
      id: string;
      memberId: string;
      bookId: string;
      status: string;
      requestType: RequestType;
      assignedCopyId: string | null;
      bookTitle: string;
    }>;

    for (const res of expired) {
      const is24hHold = res.status === 'Retenu 24h';
      this.db
        .prepare(
          `UPDATE reservations
           SET status = 'Expirée', completedAt = ?, assignedCopyId = NULL
           WHERE id = ?`
        )
        .run(nowIso, res.id);

      this.insertNotificationInternal(
        res.memberId,
        is24hHold ? 'Retenue 24 h expirée' : 'Réservation expirée',
        is24hHold
          ? `Le délai de retrait de 24 h pour « ${res.bookTitle} » est dépassé. La retenue a expiré et l’exemplaire a été libéré.`
          : `Le délai de retrait de 3 jours pour « ${res.bookTitle} » est dépassé. Votre réservation a expiré et l’exemplaire a été libéré.`,
        'expiration',
        now
      );

      this.insertAuditLogInternal(
        { id: 'system', fullName: 'Système échéances', role: 'system' },
        is24hHold ? 'RESERVATION_HOLD_24H_EXPIRED' : 'RESERVATION_EXPIRED',
        'reservation',
        res.id,
        is24hHold
          ? `Retenue 24 h expirée pour « ${res.bookTitle} » (${res.id}).`
          : `Délai de retrait de 3 jours expiré pour « ${res.bookTitle} » (réservation ${res.id}).`,
        now
      );

      if (res.assignedCopyId) {
        this.assignCopyToNextEligibleReservationInternal(
          res.bookId,
          res.assignedCopyId,
          now,
          { id: 'system', fullName: 'Système échéances', role: 'system' },
          is24hHold ? 'Retenu 24h' : 'Réservé'
        );
      }
    }

    // Notifications d'échéance proche (< 24 heures) pour les réservations FIFO prêtes (3 jours)
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
          COALESCE(SUM(CASE WHEN c.status = 'Retenu 24h' THEN 1 ELSE 0 END), 0) as held24hCopies,
          COALESCE(SUM(CASE WHEN c.status = 'Emprunté' THEN 1 ELSE 0 END), 0) as borrowedCopies,
          COALESCE(SUM(CASE WHEN c.status = 'Réservé' THEN 1 ELSE 0 END), 0) as reservedCopies,
          COALESCE(SUM(CASE WHEN c.status = 'En réparation' THEN 1 ELSE 0 END), 0) as repairCopies,
          COALESCE(SUM(CASE WHEN c.status = 'Retiré définitivement' THEN 1 ELSE 0 END), 0) as withdrawnCopies,
          COALESCE(SUM(CASE WHEN c.status IN ('Disponible', 'Retenu 24h', 'Emprunté', 'Réservé', 'En réparation') THEN 1 ELSE 0 END), 0) as circulatingCopies
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
      held24hCopies: Number(r.held24hCopies),
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

  public getBookDetail(
    bookId: string,
    now: Date = new Date(),
    options?: { includeCopies?: boolean }
  ): BookDetail {
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
    const held24hCopies = copies.filter((c) => c.status === 'Retenu 24h').length;
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
    } else if (availableCopies > 0 && pendingRow.cnt === 0) {
      reservationBlockedReason =
        'Un exemplaire est disponible : la validation du panier créera une retenue de 24 h au comptoir.';
    } else if (circulatingCopies === 0) {
      reservationBlockedReason =
        'Aucun exemplaire en circulation : tous les exemplaires ont été retirés définitivement ou sont indisponibles de façon permanente.';
    }

    const includeCopies = options?.includeCopies !== false;

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
      held24hCopies,
      borrowedCopies,
      reservedCopies,
      repairCopies,
      withdrawnCopies,
      circulatingCopies,
      copies: includeCopies ? copies : [],
      pendingReservationsCount: pendingRow.cnt,
      canBorrow: !Boolean(bookRow.archived) && availableCopies > 0 && pendingRow.cnt === 0,
      canReserve: !Boolean(bookRow.archived) && (availableCopies === 0 || pendingRow.cnt > 0) && circulatingCopies > 0,
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

    const settings = this.getSettings();
    const loanId = this.generateId('ln');
    const borrowedAt = now.toISOString();
    const dueAt = addDaysIso(now, settings.borrowingDurationDays);

    this.db
      .prepare(
        `INSERT INTO loans (id, memberId, copyId, bookId, borrowedAt, dueAt, returnedAt, returnCondition, returnNotes, status)
         VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'En cours')`
      )
      .run(loanId, memberId, String(availableCopy.id), bookId, borrowedAt, dueAt);

    this.insertCopyStateLogInternal(
      {
        copyId: String(availableCopy.id),
        copyBarcode: String(availableCopy.barcode),
        bookId,
        bookTitle: String(book.title),
        oldStatus: 'Disponible',
        newStatus: 'Emprunté',
        memberId,
        agent: actor || { id: memberId, role: 'membre' },
        requestOrLoanId: loanId,
        summary: `Prêt direct enregistré pour « ${String(book.title)} » (${String(availableCopy.barcode)}).`,
      },
      now
    );

    this.insertNotificationInternal(
      memberId,
      'Emprunt confirmé',
      `Votre emprunt pour « ${String(book.title)} » (exemplaire ${String(availableCopy.barcode)}) est confirmé. Date limite de retour : ${formatFrenchDateTime(dueAt)} (${settings.borrowingDurationDays} jours).`,
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
    actor?: AuditActor | null,
    options?: { hideBarcode?: boolean }
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
        `SELECT id, status FROM reservations
         WHERE memberId = ? AND bookId = ? AND status IN ('En attente', 'Retenu 24h', 'Exemplaire attribué', 'Disponible pour retrait')`
      )
      .get(memberId, bookId) as { id: string; status: string } | undefined;
    if (existingRes) {
      throw new DomainError(
        existingRes.status === 'Retenu 24h'
          ? 'Vous avez déjà une retenue de 24 h active pour cet ouvrage.'
          : 'Vous avez déjà une réservation active pour cet ouvrage.',
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

    const pendingQueueRow = this.db
      .prepare(`SELECT COUNT(*) as cnt FROM reservations WHERE bookId = ? AND status = 'En attente'`)
      .get(bookId) as { cnt: number };

    if (hasAvailable && pendingQueueRow.cnt === 0) {
      throw new DomainError(
        'Un exemplaire est disponible et aucune file FIFO n’est prioritaire : passez par le panier pour créer une retenue 24 h.',
        409,
        'COPY_AVAILABLE_NO_RESERVATION'
      );
    }

    const hasCirculating = copies.some((c) => c.status !== 'Retiré définitivement');

    if (!hasCirculating) {
      throw new DomainError(
        'Réservation refusée : tous les exemplaires de cet ouvrage ont été retirés définitivement ou sont indisponibles de façon permanente.',
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
        `INSERT INTO reservations (id, memberId, bookId, requestType, requestedAt, queuePosition, status, assignedCopyId, availableAt, pickupDeadline, completedAt)
         VALUES (?, ?, ?, 'reservation_fifo', ?, ?, 'En attente', NULL, NULL, NULL, NULL)`
      )
      .run(reservationId, memberId, bookId, requestedAt, queuePosition);

    this.recalculateQueuePositionsInternal(bookId);

    this.insertNotificationInternal(
      memberId,
      'Réservation FIFO enregistrée',
      `Votre réservation pour « ${String(book.title)} » a été enregistrée (rang n° ${queuePosition}). Vous serez informé dès qu’un exemplaire sera disponible. Aucune date de disponibilité n’est garantie.`,
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

    return this.getReservationByIdInternal(reservationId, Boolean(options?.hideBarcode))!;
  }

  public reserveBook(memberId: string, bookId: string, now: Date = new Date()): ReservationRecord {
    const tx = this.db.transaction(() => {
      this.syncOverdueLoansInternal(now);
      this.expireOverdueReservationsInternal(now);
      return this.reserveBookInternal(memberId, bookId, now, null, { hideBarcode: true });
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

      const is24hHold = status === 'Retenu 24h';
      this.insertNotificationInternal(
        memberId,
        is24hHold ? 'Retenue 24 h annulée' : 'Réservation annulée',
        is24hHold
          ? `Votre retenue de 24 h pour « ${book?.title || 'Ouvrage'} » a été annulée.`
          : `Votre réservation pour « ${book?.title || 'Ouvrage'} » a été annulée.`,
        'annulation',
        now
      );

      this.insertAuditLogInternal(
        actor,
        is24hHold ? 'RESERVATION_HOLD_24H_CANCELLED' : 'RESERVATION_CANCELLED',
        'reservation',
        reservationId,
        `${is24hHold ? 'Retenue 24 h' : 'Réservation'} ${reservationId} pour « ${book?.title || 'Ouvrage'} » annulée (statut précédent : ${status}).`,
        now
      );

      if (assignedCopyId) {
        this.assignCopyToNextEligibleReservationInternal(
          bookId,
          assignedCopyId,
          now,
          actor,
          is24hHold ? 'Retenu 24h' : 'Réservé'
        );
      }

      this.recalculateQueuePositionsInternal(bookId);

      return this.getReservationByIdInternal(reservationId, actor.role !== 'bibliothecaire')!;
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

      const copyRow = this.db
        .prepare(`SELECT barcode FROM copies WHERE id = ?`)
        .get(copyId) as { barcode: string } | undefined;
      const book = this.db
        .prepare(`SELECT title FROM books WHERE id = ?`)
        .get(bookId) as { title: string } | undefined;

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

        this.insertCopyStateLogInternal(
          {
            copyId,
            copyBarcode: copyRow?.barcode || copyId,
            bookId,
            bookTitle: book?.title || 'Ouvrage',
            oldStatus: 'Emprunté',
            newStatus: 'En réparation',
            memberId,
            agent: actor || { id: 'bibliothecaire', role: 'bibliothecaire' },
            requestOrLoanId: loanId,
            summary: `Retour endommagé mais réparable : exemplaire placé en réparation.`,
          },
          now
        );
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

        this.insertCopyStateLogInternal(
          {
            copyId,
            copyBarcode: copyRow?.barcode || copyId,
            bookId,
            bookTitle: book?.title || 'Ouvrage',
            oldStatus: 'Emprunté',
            newStatus: 'Retiré définitivement',
            memberId,
            agent: actor || { id: 'bibliothecaire', role: 'bibliothecaire' },
            requestOrLoanId: loanId,
            summary: `Retour irréparable : exemplaire retiré définitivement.`,
          },
          now
        );
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
          actor,
          'Emprunté'
        );
      }

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
      const bookRow = this.db
        .prepare(`SELECT title FROM books WHERE id = ?`)
        .get(bookId) as { title: string } | undefined;
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
          actor,
          'En réparation'
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

        this.insertCopyStateLogInternal(
          {
            copyId,
            copyBarcode: String(copy.barcode),
            bookId,
            bookTitle: bookRow?.title || 'Ouvrage',
            oldStatus: 'En réparation',
            newStatus: 'Retiré définitivement',
            agent: actor || { id: 'bibliothecaire', role: 'bibliothecaire' },
            summary: `Inspection post-réparation défavorable : exemplaire retiré définitivement.`,
          },
          now
        );
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

      const settings = this.getSettings();
      const nowIso = now.toISOString();
      const pickupDeadline = addDaysIso(now, settings.pickupWindowDays);

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
        `Votre réservation pour « ${book?.title || 'Ouvrage'} » est désormais disponible au guichet de la bibliothèque. Présentez votre carte membre dans un délai de 3 jours, jusqu’au ${formatFrenchDateTime(pickupDeadline)}.`,
        'retrait',
        now
      );

      this.insertCopyStateLogInternal(
        {
          copyId,
          copyBarcode: copy?.barcode || copyId,
          bookId,
          bookTitle: book?.title || 'Ouvrage',
          oldStatus: 'Disponible',
          newStatus: 'Réservé',
          memberId,
          agent: actor,
          requestOrLoanId: reservationId,
          summary: `Mise à disposition confirmée pour retrait au comptoir (3 jours).`,
        },
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

      return this.getReservationByIdInternal(reservationId, false)!;
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
        actor,
        'Disponible'
      );

      if (!assignedId) {
        throw new DomainError(
          'Aucune réservation éligible en attente dans la file FIFO pour cet ouvrage.',
          409,
          'NO_ELIGIBLE_QUEUE_MEMBER'
        );
      }

      return {
        reservation: this.getReservationByIdInternal(assignedId, false)!,
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
      const resStatus = String(res.status);
      if (
        (resStatus !== 'Disponible pour retrait' && resStatus !== 'Retenu 24h') ||
        !res.assignedCopyId
      ) {
        throw new DomainError(
          'Cette demande n’est pas prête pour un retrait (ou son délai a expiré).',
          409,
          'RESERVATION_NOT_READY'
        );
      }

      const memberId = String(res.memberId);
      const bookId = String(res.bookId);
      const copyId = String(res.assignedCopyId);

      this.assertEligibleInternal(memberId, now);

      const existingLoan = this.db
        .prepare(`SELECT id FROM loans WHERE memberId = ? AND bookId = ? AND status != 'Retourné'`)
        .get(memberId, bookId);
      if (existingLoan) {
        throw new DomainError(
          'Ce membre détient déjà un emprunt actif pour cet ouvrage.',
          409,
          'DUPLICATE_ACTIVE_LOAN'
        );
      }

      const settings = this.getSettings();
      const nowIso = now.toISOString();
      const dueAt = addDaysIso(now, settings.borrowingDurationDays);
      const loanId = this.generateId('ln');

      const copyRow = this.db
        .prepare(`SELECT barcode, status FROM copies WHERE id = ?`)
        .get(copyId) as { barcode: string; status: CopyStatus } | undefined;

      this.db
        .prepare(
          `UPDATE reservations
           SET status = 'Retirée', completedAt = ?
           WHERE id = ?`
        )
        .run(nowIso, reservationId);

      this.db
        .prepare(`UPDATE copies SET status = 'Emprunté', location = 'En prêt membre' WHERE id = ?`)
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

      this.insertCopyStateLogInternal(
        {
          copyId,
          copyBarcode: copyRow?.barcode || copyId,
          bookId,
          bookTitle: book?.title || 'Ouvrage',
          oldStatus: copyRow?.status || (resStatus === 'Retenu 24h' ? 'Retenu 24h' : 'Réservé'),
          newStatus: 'Emprunté',
          memberId,
          agent: actor || { id: 'bibliothecaire', role: 'bibliothecaire' },
          requestOrLoanId: loanId,
          summary: `Retrait validé au comptoir (${resStatus === 'Retenu 24h' ? 'retenue 24 h' : 'réservation FIFO'}) : prêt 7 jours créé.`,
        },
        now
      );

      this.insertNotificationInternal(
        memberId,
        'Retrait confirmé au comptoir',
        `Votre emprunt pour « ${book?.title || 'Ouvrage'} » (exemplaire ${copyRow?.barcode || ''}) est validé. Date limite de retour : ${formatFrenchDateTime(dueAt)}.`,
        'emprunt',
        now
      );

      this.insertAuditLogInternal(
        actor || { id: 'bibliothecaire', role: 'bibliothecaire' },
        'RESERVATION_PICKED_UP',
        'loan',
        loanId,
        `Retrait validé (${reservationId}) : prêt ${loanId} créé pour « ${book?.title || 'Ouvrage'} » (${copyRow?.barcode || copyId}).`,
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
                    WHEN r.status = 'Retenu 24h' THEN 0
                    WHEN r.status = 'Disponible pour retrait' THEN 1
                    WHEN r.status = 'Exemplaire attribué' THEN 2
                    WHEN r.status = 'En attente' THEN 3
                    ELSE 4
                  END,
                  r.requestedAt DESC`
      )
      .all(memberId) as Array<Record<string, unknown>>;

    // Ne jamais exposer les codes-barres physiques des exemplaires dans le parcours public du membre
    return rows.map((r) => this.mapReservationRow(r, false, true));
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
          COALESCE(SUM(CASE WHEN status = 'Retenu 24h' THEN 1 ELSE 0 END), 0) as held24h,
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
          COALESCE(SUM(CASE WHEN status IN ('Disponible pour retrait', 'Retenu 24h') THEN 1 ELSE 0 END), 0) as awaitingPickup
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
      held24hCopies: copyStats.held24h || 0,
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

  public notifyOverdueMembersAdmin(
    actor?: AuditActor | null,
    now: Date = new Date()
  ): {
    overdueLoansCount: number;
    recipients: OverdueEmailRecipient[];
  } {
    this.syncOverdueLoansInternal(now);
    const overdueLoans = this.getAllLoansAdmin(now).filter((l) => l.status === 'En retard');
    if (overdueLoans.length === 0) {
      return { overdueLoansCount: 0, recipients: [] };
    }

    const byMember = new Map<string, OverdueEmailRecipient>();
    for (const loan of overdueLoans) {
      const email = (loan.memberEmail || '').trim();
      if (!email) continue;
      const existing = byMember.get(loan.memberId);
      const bookEntry = {
        title: loan.bookTitle,
        barcode: loan.copyBarcode,
        dueAt: loan.dueAt,
      };
      if (existing) {
        existing.books.push(bookEntry);
      } else {
        byMember.set(loan.memberId, {
          memberId: loan.memberId,
          memberName: loan.memberName || email,
          memberEmail: email,
          books: [bookEntry],
          emailSent: false,
        });
      }
    }

    const recipients = Array.from(byMember.values());
    const tx = this.db.transaction(() => {
      for (const r of recipients) {
        const titles = r.books.map((b) => `« ${b.title} » (${b.barcode})`).join(', ');
        this.insertNotificationInternal(
          r.memberId,
          'Rappel — Emprunt en retard',
          `Bonjour ${r.memberName}, merci de restituer sans délai le(s) ouvrage(s) en retard : ${titles}.`,
          'rappel',
          now
        );
      }

      this.insertAuditLogInternal(
        actor || { id: 'bibliothecaire', role: 'bibliothecaire' },
        'OVERDUE_MEMBERS_NOTIFIED',
        'loan',
        'overdue-batch',
        `Notification de retard déclenchée pour ${recipients.length} membre(s) (${overdueLoans.length} emprunt(s) en retard).`,
        now
      );
    });

    tx.immediate();
    return { overdueLoansCount: overdueLoans.length, recipients };
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
                    WHEN 'Retenu 24h' THEN 0
                    WHEN 'Disponible pour retrait' THEN 1
                    WHEN 'Exemplaire attribué' THEN 2
                    WHEN 'En attente' THEN 3
                    ELSE 4
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
                    WHEN 'Retenu 24h' THEN 1
                    WHEN 'Réservé' THEN 2
                    WHEN 'Emprunté' THEN 3
                    WHEN 'Disponible' THEN 4
                    ELSE 5
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

      this.insertCopyStateLogInternal(
        {
          copyId,
          copyBarcode: input.barcode.trim(),
          bookId,
          bookTitle: book.title,
          oldStatus: null,
          newStatus: initialStatus,
          agent: actor || { id: 'bibliothecaire', role: 'bibliothecaire' },
          summary: `Enregistrement d’un nouvel exemplaire (${initialStatus}).`,
        },
        now
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
          actor,
          'Disponible'
        );
      }

      return {
        copy: this.getCopyByIdInternal(copyId)!,
        assignedReservationId,
      };
    });

    return tx.immediate();
  }

  public registerCopiesBatch(
    bookId: string,
    input: {
      barcodes: string[];
      physicalCondition: PhysicalCondition;
      location: string;
    },
    now: Date = new Date(),
    actor?: AuditActor | null
  ): {
    created: Copy[];
    skippedBarcodes: string[];
    assignedReservationsCount: number;
  } {
    const tx = this.db.transaction(() => {
      const book = this.db.prepare(`SELECT id, title FROM books WHERE id = ?`).get(bookId) as
        | { id: string; title: string }
        | undefined;
      if (!book) {
        throw new DomainError('Ouvrage introuvable.', 404, 'BOOK_NOT_FOUND');
      }

      const cleaned = Array.from(
        new Set(input.barcodes.map((b) => b.trim()).filter(Boolean))
      );
      if (cleaned.length === 0) {
        throw new DomainError(
          'Veuillez saisir au moins un code-barres valide.',
          400,
          'EMPTY_BARCODES'
        );
      }

      const created: Copy[] = [];
      const skippedBarcodes: string[] = [];
      let assignedReservationsCount = 0;

      const isDamaged =
        input.physicalCondition === 'Endommagé' || input.physicalCondition === 'Hors service';
      const initialStatus: CopyStatus =
        input.physicalCondition === 'Hors service'
          ? 'Retiré définitivement'
          : input.physicalCondition === 'Endommagé'
            ? 'En réparation'
            : 'Disponible';

      for (const barcode of cleaned) {
        const dup = this.db
          .prepare(`SELECT id FROM copies WHERE barcode = ?`)
          .get(barcode);
        if (dup) {
          skippedBarcodes.push(barcode);
          continue;
        }

        const copyId = this.generateId('cp');
        this.db
          .prepare(
            `INSERT INTO copies (id, bookId, barcode, status, physicalCondition, location, needsInspection, createdAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            copyId,
            bookId,
            barcode,
            initialStatus,
            input.physicalCondition,
            input.location.trim(),
            input.physicalCondition === 'Endommagé' ? 1 : 0,
            now.toISOString()
          );

        this.insertCopyStateLogInternal(
          {
            copyId,
            copyBarcode: barcode,
            bookId,
            bookTitle: book.title,
            oldStatus: null,
            newStatus: initialStatus,
            agent: actor || { id: 'bibliothecaire', role: 'bibliothecaire' },
            summary: `Ajout en lot de l’exemplaire (${initialStatus}).`,
          },
          now
        );

        if (!isDamaged) {
          const assigned = this.assignCopyToNextEligibleReservationInternal(
            bookId,
            copyId,
            now,
            actor,
            'Disponible'
          );
          if (assigned) assignedReservationsCount += 1;
        }

        const row = this.getCopyByIdInternal(copyId);
        if (row) created.push(row);
      }

      this.insertAuditLogInternal(
        actor || { id: 'bibliothecaire', role: 'bibliothecaire' },
        'COPIES_BATCH_REGISTERED',
        'book',
        bookId,
        `Ajout en lot de ${created.length} exemplaire(s) pour « ${book.title} » (${skippedBarcodes.length} ignoré(s)).`,
        now
      );

      return { created, skippedBarcodes, assignedReservationsCount };
    });

    return tx.immediate();
  }

  public toggleLoanOverdueTest(
    loanId: string,
    actor: AuditActor,
    now: Date = new Date()
  ): LoanRecord {
    const tx = this.db.transaction(() => {
      const loan = this.db
        .prepare(`SELECT * FROM loans WHERE id = ?`)
        .get(loanId) as Record<string, unknown> | undefined;
      if (!loan) {
        throw new DomainError('Opération d’emprunt introuvable.', 404, 'LOAN_NOT_FOUND');
      }
      if (String(loan.status) === 'Retourné') {
        throw new DomainError(
          'Impossible de modifier l’état d’un emprunt déjà restitué.',
          409,
          'LOAN_ALREADY_RETURNED'
        );
      }

      const settings = this.getSettings();
      const currentlyOverdue = String(loan.status) === 'En retard';
      const nextStatus = currentlyOverdue ? 'En cours' : 'En retard';
      const nextDueAt = currentlyOverdue
        ? addDaysIso(now, settings.borrowingDurationDays)
        : addDaysIso(now, -3);

      this.db
        .prepare(`UPDATE loans SET status = ?, dueAt = ? WHERE id = ?`)
        .run(nextStatus, nextDueAt, loanId);

      this.insertAuditLogInternal(
        actor,
        'LOAN_OVERDUE_TEST_TOGGLED',
        'loan',
        loanId,
        `État de test de l’emprunt ${loanId} basculé vers « ${nextStatus} » (échéance : ${formatFrenchDateTime(nextDueAt)}).`,
        now
      );

      return this.getLoanByIdInternal(loanId)!;
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

      const bookTitleRow = this.db
        .prepare(`SELECT title FROM books WHERE id = ?`)
        .get(String(existing.bookId)) as { title: string } | undefined;

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
          actor,
          existing.status as CopyStatus
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

        if (String(existing.status) !== status) {
          this.insertCopyStateLogInternal(
            {
              copyId,
              copyBarcode: String(existing.barcode),
              bookId: String(existing.bookId),
              bookTitle: bookTitleRow?.title || 'Ouvrage',
              oldStatus: existing.status as CopyStatus,
              newStatus: status,
              agent: actor || { id: 'bibliothecaire', role: 'bibliothecaire' },
              summary: `Statut modifié manuellement par le personnel (${physicalCondition}).`,
            },
            now
          );
        }
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

  private mapUserPublicRow(row: Record<string, unknown>): UserPublic {
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

  public listMembersAdmin(): UserPublic[] {
    const rows = this.db
      .prepare(
        `SELECT id, fullName, email, role, institution, studentStatus, accountStatus, emailVerified, isAdmin, cne, filiere, authSource, isDemo, createdAt
         FROM users
         ORDER BY isDemo ASC, role DESC, isAdmin DESC, fullName ASC`
      )
      .all() as Array<Record<string, unknown>>;

    return rows.map((row) => this.mapUserPublicRow(row));
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
      `Statut de ${existing.fullName} (${existing.email}) mis à jour : statut EST=${studentStatus}, compte=${accountStatus}.`,
      now
    );

    const row = this.db
      .prepare(
        `SELECT id, fullName, email, role, institution, studentStatus, accountStatus, emailVerified, isAdmin, cne, filiere, authSource, isDemo, createdAt
         FROM users WHERE id = ?`
      )
      .get(userId) as Record<string, unknown>;

    return this.mapUserPublicRow(row);
  }

  public updateStaffRoleAdmin(
    targetUserId: string,
    role: UserRole,
    isAdminFlag: boolean,
    actor: AuditActor & { id: string },
    now: Date = new Date()
  ): UserPublic {
    const existing = this.db
      .prepare(`SELECT id, fullName, email, role, isAdmin FROM users WHERE id = ?`)
      .get(targetUserId) as
      | { id: string; fullName: string; email: string; role: UserRole; isAdmin: number }
      | undefined;

    if (!existing) {
      throw new DomainError('Compte utilisateur introuvable.', 404, 'USER_NOT_FOUND');
    }

    const nextIsAdmin = role === 'bibliothecaire' && isAdminFlag;

    if (actor.id === targetUserId && !nextIsAdmin) {
      throw new DomainError(
        'Un administrateur ne peut pas révoquer ses propres droits d’administration.',
        409,
        'CANNOT_REVOKE_OWN_ADMIN'
      );
    }

    if (Boolean(existing.isAdmin) && !nextIsAdmin) {
      const otherAdmins = this.db
        .prepare(`SELECT COUNT(*) as cnt FROM users WHERE isAdmin = 1 AND id != ?`)
        .get(targetUserId) as { cnt: number };
      if (otherAdmins.cnt === 0) {
        throw new DomainError(
          'Au moins un administrateur de la bibliothèque doit rester actif.',
          409,
          'LAST_ADMIN_REQUIRED'
        );
      }
    }

    if (role === 'bibliothecaire') {
      this.db
        .prepare(
          `UPDATE users SET role = 'bibliothecaire', isAdmin = ?, studentStatus = 'verifie', emailVerified = 1 WHERE id = ?`
        )
        .run(nextIsAdmin ? 1 : 0, targetUserId);
    } else {
      this.db
        .prepare(`UPDATE users SET role = 'membre', isAdmin = 0 WHERE id = ?`)
        .run(targetUserId);
    }

    this.insertAuditLogInternal(
      actor,
      'STAFF_ROLE_UPDATED',
      'user',
      targetUserId,
      `Rôle de ${existing.fullName} (${existing.email}) modifié : ${role}${nextIsAdmin ? ' (Administrateur)' : ''}.`,
      now
    );

    const row = this.db
      .prepare(
        `SELECT id, fullName, email, role, institution, studentStatus, accountStatus, emailVerified, isAdmin, cne, filiere, authSource, isDemo, createdAt
         FROM users WHERE id = ?`
      )
      .get(targetUserId) as Record<string, unknown>;

    return this.mapUserPublicRow(row);
  }

  public registerAcademicCandidate(
    input: {
      fullName: string;
      email: string;
      password: string;
      filiere?: string | null;
      cne?: string | null;
    },
    now: Date = new Date()
  ): { user: UserPublic; verificationCode: string; expiresAt: string } {
    const email = input.email.trim().toLowerCase();
    const fullName = input.fullName.trim();
    if (!fullName || fullName.length < 2) {
      throw new DomainError('Le nom complet est obligatoire.', 400, 'INVALID_FULL_NAME');
    }
    if (!email || !email.includes('@')) {
      throw new DomainError('Adresse e-mail académique invalide.', 400, 'INVALID_EMAIL');
    }
    if (!input.password || input.password.length < 8) {
      throw new DomainError(
        'Le mot de passe de connexion doit contenir au moins 8 caractères.',
        400,
        'WEAK_PASSWORD'
      );
    }

    const domain = email.split('@')[1] || '';
    const isAllowedDomain =
      domain === 'usmba.ac.ma' ||
      domain === 'est-usmba.ac.ma' ||
      domain.endsWith('.ac.ma') ||
      domain.endsWith('.edu.ma') ||
      (this.isDemoSandbox && domain.endsWith('.example'));

    if (!isAllowedDomain) {
      throw new DomainError(
        this.isDemoSandbox
          ? 'Utilisez une adresse académique existante (@usmba.ac.ma, @est-usmba.ac.ma) ou fictive sous le domaine .example en mode Démo.'
          : 'Utilisez une adresse académique déjà fournie par l’établissement (ex. @usmba.ac.ma ou @est-usmba.ac.ma). BiblioEST ne crée pas de boîte e-mail scolaire.',
        400,
        'NON_ACADEMIC_EMAIL'
      );
    }

    const existing = this.db
      .prepare(`SELECT id FROM users WHERE LOWER(email) = LOWER(?)`)
      .get(email);
    if (existing) {
      throw new DomainError(
        'Un compte existe déjà pour cette adresse e-mail académique.',
        409,
        'EMAIL_ALREADY_REGISTERED'
      );
    }

    const userId = this.generateId('usr');
    const passwordHash = hashPassword(input.password);
    const verificationCode = String(crypto.randomInt(100000, 999999));
    const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
    const institution = domain === 'est-usmba.ac.ma' || domain.includes('est') ? 'EST Fès' : 'USMBA';

    const tx = this.db.transaction(() => {
      // Règle métier : l'inscription publique crée uniquement un membre avec e-mail non vérifié et statut EST en attente.
      this.db
        .prepare(
          `INSERT INTO users (id, fullName, email, passwordHash, role, institution, studentStatus, accountStatus, emailVerified, isAdmin, cne, filiere, authSource, isDemo, createdAt)
           VALUES (?, ?, ?, ?, 'membre', ?, 'en_attente', 'actif', 0, 0, ?, ?, 'local', ?, ?)`
        )
        .run(
          userId,
          fullName,
          email,
          passwordHash,
          institution,
          input.cne?.trim() || null,
          input.filiere?.trim() || null,
          this.isDemoSandbox ? 1 : 0,
          now.toISOString()
        );

      this.db
        .prepare(
          `INSERT INTO email_verification_codes (id, userId, email, code, expiresAt, consumedAt, createdAt)
           VALUES (?, ?, ?, ?, ?, NULL, ?)`
        )
        .run(this.generateId('otp'), userId, email, verificationCode, expiresAt, now.toISOString());

      this.insertAuditLogInternal(
        { id: userId, fullName, role: 'membre' },
        'MEMBER_REGISTERED_PENDING_EMAIL',
        'user',
        userId,
        `Inscription publique avec l’adresse académique existante ${email} (validation e-mail requise, statut EST en attente).`,
        now
      );

      if (this.isDemoSandbox) {
        this.recordSimulatedEmail(
          {
            recipientEmail: email,
            subject: 'BiblioEST (Démo) — Code de vérification de votre adresse académique',
            body: `Bonjour ${fullName},\n\nVotre code à usage unique pour valider votre adresse ${email} est : ${verificationCode}\nCe code est valable 15 minutes.\n\nRemarque : après validation de l’adresse, votre statut EST Fès reste en attente de validation par la bibliothèque.`,
            category: 'verification',
          },
          now
        );
      }
    });

    tx.immediate();

    const row = this.db
      .prepare(
        `SELECT id, fullName, email, role, institution, studentStatus, accountStatus, emailVerified, isAdmin, cne, filiere, authSource, isDemo, createdAt
         FROM users WHERE id = ?`
      )
      .get(userId) as Record<string, unknown>;

    return {
      user: this.mapUserPublicRow(row),
      verificationCode,
      expiresAt,
    };
  }

  public verifyEmailCode(
    emailInput: string,
    codeInput: string,
    now: Date = new Date()
  ): UserPublic {
    const email = emailInput.trim().toLowerCase();
    const code = codeInput.trim();
    if (!email || !code) {
      throw new DomainError('Adresse e-mail et code de vérification requis.', 400, 'MISSING_OTP');
    }

    const user = this.db
      .prepare(`SELECT id, fullName, email, emailVerified, studentStatus FROM users WHERE LOWER(email) = LOWER(?)`)
      .get(email) as
      | { id: string; fullName: string; email: string; emailVerified: number; studentStatus: StudentStatus }
      | undefined;

    if (!user) {
      throw new DomainError('Aucun compte trouvé pour cette adresse e-mail.', 404, 'USER_NOT_FOUND');
    }

    const otpRow = this.db
      .prepare(
        `SELECT id, code, expiresAt, consumedAt
         FROM email_verification_codes
         WHERE userId = ? AND consumedAt IS NULL
         ORDER BY createdAt DESC, rowid DESC
         LIMIT 1`
      )
      .get(user.id) as
      | { id: string; code: string; expiresAt: string; consumedAt: string | null }
      | undefined;

    if (!otpRow || otpRow.code !== code) {
      throw new DomainError(
        'Code de vérification invalide. Vérifiez le code reçu par e-mail.',
        400,
        'INVALID_OTP_CODE'
      );
    }

    if (otpRow.expiresAt < now.toISOString()) {
      throw new DomainError(
        'Ce code à usage unique a expiré. Demandez un nouveau code.',
        400,
        'OTP_EXPIRED'
      );
    }

    const tx = this.db.transaction(() => {
      this.db
        .prepare(`UPDATE email_verification_codes SET consumedAt = ? WHERE id = ?`)
        .run(now.toISOString(), otpRow.id);

      // Diagramme 1 : adresse vérifiée ≠ statut EST vérifié -> studentStatus reste tel quel (en_attente).
      this.db
        .prepare(`UPDATE users SET emailVerified = 1 WHERE id = ?`)
        .run(user.id);

      this.insertAuditLogInternal(
        { id: user.id, fullName: user.fullName, role: 'membre' },
        'EMAIL_VERIFIED_AWAITING_EST',
        'user',
        user.id,
        `Adresse académique ${user.email} vérifiée par code OTP. Statut EST Fès : ${user.studentStatus}.`,
        now
      );
    });

    tx.immediate();

    const row = this.db
      .prepare(
        `SELECT id, fullName, email, role, institution, studentStatus, accountStatus, emailVerified, isAdmin, cne, filiere, authSource, isDemo, createdAt
         FROM users WHERE id = ?`
      )
      .get(user.id) as Record<string, unknown>;

    return this.mapUserPublicRow(row);
  }

  public resendVerificationCode(
    emailInput: string,
    now: Date = new Date()
  ): { email: string; verificationCode: string; expiresAt: string } {
    const email = emailInput.trim().toLowerCase();
    const user = this.db
      .prepare(`SELECT id, fullName, email, emailVerified FROM users WHERE LOWER(email) = LOWER(?)`)
      .get(email) as { id: string; fullName: string; email: string; emailVerified: number } | undefined;

    if (!user) {
      throw new DomainError('Aucun compte trouvé pour cette adresse e-mail.', 404, 'USER_NOT_FOUND');
    }
    if (Boolean(user.emailVerified)) {
      throw new DomainError(
        'Cette adresse e-mail est déjà vérifiée.',
        409,
        'EMAIL_ALREADY_VERIFIED'
      );
    }

    const verificationCode = String(crypto.randomInt(100000, 999999));
    const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();

    this.db
      .prepare(
        `INSERT INTO email_verification_codes (id, userId, email, code, expiresAt, consumedAt, createdAt)
         VALUES (?, ?, ?, ?, ?, NULL, ?)`
      )
      .run(this.generateId('otp'), user.id, user.email, verificationCode, expiresAt, now.toISOString());

    if (this.isDemoSandbox) {
      this.recordSimulatedEmail(
        {
          recipientEmail: user.email,
          subject: 'BiblioEST (Démo) — Nouveau code de vérification',
          body: `Bonjour ${user.fullName},\n\nVotre nouveau code à usage unique est : ${verificationCode}\nValable 15 minutes.`,
          category: 'verification',
        },
        now
      );
    }

    return { email: user.email, verificationCode, expiresAt };
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
          COALESCE(SUM(CASE WHEN status = 'Retenu 24h' THEN 1 ELSE 0 END), 0) as held24h,
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
        held24h: Number(row.held24h || 0),
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
        held24h: 0,
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
          held24hCopies: st.held24h,
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
          `SELECT ci.id, ci.bookId, ci.quantity, b.title as bookTitle, b.archived as bookArchived
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
        bookArchived: number;
      }>;

      if (items.length === 0) {
        throw new DomainError('Votre panier de demandes est vide.', 400, 'EMPTY_CART');
      }

      // Diagramme 1 : vérifier l'éligibilité du membre avant tout traitement des lignes.
      // Un membre non éligible voit son panier refusé globalement sans modification d'état.
      this.assertEligibleInternal(memberId, now);

      const results: CartConfirmationItemResult[] = [];
      let heldCount = 0;
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

        if (Boolean(item.bookArchived)) {
          refusedCount++;
          results.push({
            bookId: item.bookId,
            bookTitle: item.bookTitle,
            outcome: 'refuse',
            code: 'BOOK_ARCHIVED',
            message: 'Cet ouvrage est archivé et ne peut pas être demandé.',
          });
          continue;
        }

        const activeLoan = this.db
          .prepare(
            `SELECT id FROM loans WHERE memberId = ? AND bookId = ? AND status != 'Retourné'`
          )
          .get(memberId, item.bookId);
        if (activeLoan) {
          refusedCount++;
          results.push({
            bookId: item.bookId,
            bookTitle: item.bookTitle,
            outcome: 'refuse',
            code: 'DUPLICATE_ACTIVE_LOAN',
            message: 'Refusé : vous détenez déjà un exemplaire actif de cet ouvrage.',
          });
          continue;
        }

        const existingReq = this.db
          .prepare(
            `SELECT id, status FROM reservations
             WHERE memberId = ? AND bookId = ? AND status IN ('En attente', 'Retenu 24h', 'Exemplaire attribué', 'Disponible pour retrait')`
          )
          .get(memberId, item.bookId) as { id: string; status: string } | undefined;
        if (existingReq) {
          refusedCount++;
          results.push({
            bookId: item.bookId,
            bookTitle: item.bookTitle,
            outcome: 'refuse',
            code: 'DUPLICATE_RESERVATION',
            message:
              existingReq.status === 'Retenu 24h'
                ? 'Refusé : vous avez déjà une retenue 24 h active pour cet ouvrage.'
                : 'Refusé : vous avez déjà une réservation active pour cet ouvrage.',
          });
          continue;
        }

        const pendingFifoRow = this.db
          .prepare(
            `SELECT COUNT(*) as cnt FROM reservations WHERE bookId = ? AND status = 'En attente'`
          )
          .get(item.bookId) as { cnt: number };

        const availableCopy = this.db
          .prepare(
            `SELECT id, barcode FROM copies
             WHERE bookId = ?
               AND status = 'Disponible'
               AND needsInspection = 0
               AND physicalCondition NOT IN ('Endommagé', 'Hors service')
             ORDER BY barcode ASC
             LIMIT 1`
          )
          .get(item.bookId) as { id: string; barcode: string } | undefined;

        if (availableCopy && pendingFifoRow.cnt === 0) {
          const lockResult = this.db
            .prepare(
              `UPDATE copies
               SET status = 'Retenu 24h', location = 'Banque d’accueil · Retrait 24h'
               WHERE id = ? AND status = 'Disponible' AND needsInspection = 0`
            )
            .run(availableCopy.id);

          if (lockResult.changes !== 1) {
            refusedCount++;
            results.push({
              bookId: item.bookId,
              bookTitle: item.bookTitle,
              outcome: 'refuse',
              code: 'COPY_RACE_CONFLICT',
              message: 'Conflit concurrent sur cet exemplaire : veuillez réessayer.',
            });
            continue;
          }

          const reservationId = this.generateId('res');
          const nowIso = now.toISOString();
          const pickupDeadline = addHoursIso(now, HOLD_DURATION_HOURS);

          this.db
            .prepare(
              `INSERT INTO reservations (id, memberId, bookId, requestType, requestedAt, queuePosition, status, assignedCopyId, availableAt, pickupDeadline, completedAt)
               VALUES (?, ?, ?, 'retenue_24h', ?, NULL, 'Retenu 24h', ?, ?, ?, NULL)`
            )
            .run(reservationId, memberId, item.bookId, nowIso, availableCopy.id, nowIso, pickupDeadline);

          this.insertCopyStateLogInternal(
            {
              copyId: availableCopy.id,
              copyBarcode: availableCopy.barcode,
              bookId: item.bookId,
              bookTitle: item.bookTitle,
              oldStatus: 'Disponible',
              newStatus: 'Retenu 24h',
              memberId,
              agent: { id: memberId, role: 'membre' },
              requestOrLoanId: reservationId,
              summary: `Retenue 24 h créée lors de la validation du panier (expiration le ${formatFrenchDateTime(pickupDeadline)}).`,
            },
            now
          );

          this.insertNotificationInternal(
            memberId,
            'Retenue 24 h créée — À retirer au comptoir',
            `Votre demande pour « ${item.bookTitle} » est acceptée. Un exemplaire vous est retenu pendant 24 h au comptoir, jusqu’au ${formatFrenchDateTime(pickupDeadline)}. Présentez votre carte membre pour le retrait.`,
            'retrait',
            now
          );

          heldCount++;
          this.db.prepare(`DELETE FROM cart_items WHERE id = ?`).run(item.id);
          const reservation = this.getReservationByIdInternal(reservationId, true)!;
          results.push({
            bookId: item.bookId,
            bookTitle: item.bookTitle,
            outcome: 'retenue_24h_creee',
            message: `Demande acceptée : à retirer au comptoir avant le ${formatFrenchDateTime(pickupDeadline)} (retenue 24 h).`,
            reservation,
          });
          continue;
        }

        // Sinon (aucune copie libre ou file FIFO prioritaire existante) -> tenter réservation FIFO
        try {
          const reservation = this.reserveBookInternal(
            memberId,
            item.bookId,
            now,
            { id: memberId, role: 'membre' },
            { hideBarcode: true }
          );
          reservedCount++;
          this.db.prepare(`DELETE FROM cart_items WHERE id = ?`).run(item.id);
          results.push({
            bookId: item.bookId,
            bookTitle: item.bookTitle,
            outcome: 'reservation_enregistree',
            message: `Réservation FIFO enregistrée (rang n° ${reservation.queuePosition ?? 1}). Aucune date de disponibilité n’est promise.`,
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
                : 'Impossible d’enregistrer la demande pour cet ouvrage.',
          });
        }
      }

      this.insertAuditLogInternal(
        { id: memberId, role: 'membre' },
        'CART_CONFIRMED',
        'cart',
        memberId,
        `Confirmation du panier : ${heldCount} retenue(s) 24 h, ${reservedCount} réservation(s) FIFO, ${refusedCount} refus.`,
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

  // --- Comptoir / Circulation (scannage carte membre & code-barres exemplaire, réservé au personnel) ---

  public searchMembersAtCounter(query: string): UserPublic[] {
    const q = query.trim();
    if (!q) {
      return [];
    }
    const like = `%${q}%`;
    const rows = this.db
      .prepare(
        `SELECT id, fullName, email, role, institution, studentStatus, accountStatus, emailVerified, isAdmin, cne, filiere, authSource, isDemo, createdAt
         FROM users
         WHERE LOWER(id) = LOWER(?)
            OR LOWER(COALESCE(cne, '')) = LOWER(?)
            OR LOWER(email) = LOWER(?)
            OR fullName LIKE ?
            OR email LIKE ?
            OR COALESCE(cne, '') LIKE ?
         ORDER BY CASE WHEN LOWER(COALESCE(cne, '')) = LOWER(?) OR LOWER(email) = LOWER(?) OR LOWER(id) = LOWER(?) THEN 0 ELSE 1 END,
                  fullName ASC
         LIMIT 15`
      )
      .all(q, q, q, like, like, like, q, q, q) as Array<Record<string, unknown>>;

    return rows.map((r) => this.mapUserPublicRow(r));
  }

  public lookupMemberAtCounter(query: string, now: Date = new Date()): CounterMemberDossier {
    this.processDeadlines(now);
    const q = query.trim();
    if (!q) {
      throw new DomainError(
        'Veuillez scanner ou saisir une carte membre (CNE, e-mail académique ou identifiant).',
        400,
        'MEMBER_QUERY_REQUIRED'
      );
    }

    const exactRow = this.db
      .prepare(
        `SELECT id, fullName, email, role, institution, studentStatus, accountStatus, emailVerified, isAdmin, cne, filiere, authSource, isDemo, createdAt
         FROM users
         WHERE LOWER(id) = LOWER(?)
            OR LOWER(COALESCE(cne, '')) = LOWER(?)
            OR LOWER(email) = LOWER(?)
         LIMIT 1`
      )
      .get(q, q, q) as Record<string, unknown> | undefined;

    let userRow = exactRow;
    if (!userRow) {
      const like = `%${q}%`;
      const matches = this.db
        .prepare(
          `SELECT id, fullName, email, role, institution, studentStatus, accountStatus, emailVerified, isAdmin, cne, filiere, authSource, isDemo, createdAt
           FROM users
           WHERE fullName LIKE ? OR email LIKE ? OR COALESCE(cne, '') LIKE ?
           ORDER BY fullName ASC
           LIMIT 5`
        )
        .all(like, like, like) as Array<Record<string, unknown>>;

      if (matches.length === 0) {
        throw new DomainError(
          `Aucun membre trouvé pour la carte ou recherche « ${q} ».`,
          404,
          'MEMBER_NOT_FOUND'
        );
      }
      if (matches.length > 1) {
        throw new DomainError(
          `Plusieurs comptes correspondent à « ${q} ». Précisez le CNE ou sélectionnez le membre dans la liste.`,
          409,
          'AMBIGUOUS_MEMBER_QUERY'
        );
      }
      userRow = matches[0];
    }

    return this.buildCounterMemberDossierInternal(userRow, now);
  }

  private buildCounterMemberDossierInternal(
    userRow: Record<string, unknown>,
    now: Date
  ): CounterMemberDossier {
    const member = this.mapUserPublicRow(userRow);
    const eligibility = this.checkEligibility(member.id, now);

    const reservationRows = this.db
      .prepare(
        `SELECT r.*, b.title as bookTitle, b.authors as bookAuthors, b.coverImage as bookCoverImage,
                b.shelfLocation as shelfLocation, c.barcode as assignedCopyBarcode
         FROM reservations r
         JOIN books b ON b.id = r.bookId
         LEFT JOIN copies c ON c.id = r.assignedCopyId
         WHERE r.memberId = ?
         ORDER BY r.requestedAt ASC`
      )
      .all(member.id) as Array<Record<string, unknown>>;

    const mappedRes = reservationRows.map((r) => this.mapReservationRow(r, false, false));
    const holds24h = mappedRes.filter((r) => r.status === 'Retenu 24h');
    const fifoReadyPickups = mappedRes.filter((r) => r.status === 'Disponible pour retrait');
    const fifoWaiting = mappedRes.filter((r) => r.status === 'En attente');

    const loans = this.getMemberLoans(member.id, now);
    const activeLoans = loans.filter((l) => l.status !== 'Retourné');
    const pastLoans = loans.filter((l) => l.status === 'Retourné');

    return {
      member,
      eligibility,
      holds24h,
      fifoReadyPickups,
      fifoWaiting,
      activeLoans,
      pastLoans,
    };
  }

  public checkoutCopyAtCounter(
    memberId: string,
    barcodeInput: string,
    actor: AuditActor,
    now: Date = new Date()
  ): CounterPickupResult {
    const tx = this.db.transaction(() => {
      this.syncOverdueLoansInternal(now);
      this.expireOverdueReservationsInternal(now);

      const barcode = barcodeInput.trim();
      if (!barcode) {
        throw new DomainError(
          'Veuillez scanner ou saisir le code-barres de l’exemplaire physique.',
          400,
          'BARCODE_REQUIRED'
        );
      }

      const memberRow = this.db
        .prepare(
          `SELECT id, fullName, email, role, institution, studentStatus, accountStatus, emailVerified, isAdmin, cne, filiere, authSource, isDemo, createdAt
           FROM users WHERE id = ?`
        )
        .get(memberId) as Record<string, unknown> | undefined;

      if (!memberRow) {
        throw new DomainError('Membre introuvable.', 404, 'USER_NOT_FOUND');
      }

      // Vérifie l'éligibilité au moment du retrait au comptoir sans modifier l'état en cas de blocage
      this.assertEligibleInternal(memberId, now);

      const copyRow = this.db
        .prepare(
          `SELECT c.*, b.title as bookTitle, b.archived as bookArchived
           FROM copies c
           JOIN books b ON b.id = c.bookId
           WHERE LOWER(c.barcode) = LOWER(?)`
        )
        .get(barcode) as
        | (Record<string, unknown> & { bookTitle: string; bookArchived: number })
        | undefined;

      if (!copyRow) {
        throw new DomainError(
          `Aucun exemplaire physique enregistré avec le code-barres « ${barcode} ».`,
          404,
          'COPY_NOT_FOUND'
        );
      }

      const copyId = String(copyRow.id);
      const copyBookId = String(copyRow.bookId);
      const copyStatus = copyRow.status as CopyStatus;

      if (Boolean(copyRow.bookArchived)) {
        throw new DomainError(
          `L’ouvrage « ${copyRow.bookTitle} » est archivé.`,
          409,
          'BOOK_ARCHIVED'
        );
      }

      const matchingRequest = this.db
        .prepare(
          `SELECT * FROM reservations
           WHERE memberId = ?
             AND assignedCopyId = ?
             AND status IN ('Retenu 24h', 'Disponible pour retrait')
           LIMIT 1`
        )
        .get(memberId, copyId) as Record<string, unknown> | undefined;

      if (!matchingRequest) {
        const otherHolder = this.db
          .prepare(
            `SELECT r.id, r.status, u.fullName as holderName
             FROM reservations r
             JOIN users u ON u.id = r.memberId
             WHERE r.assignedCopyId = ? AND r.status IN ('Retenu 24h', 'Disponible pour retrait')
             LIMIT 1`
          )
          .get(copyId) as { id: string; status: string; holderName: string } | undefined;

        if (otherHolder) {
          throw new DomainError(
            `Retrait refusé : l’exemplaire ${String(copyRow.barcode)} est actuellement réservé/retenu pour un autre membre (${otherHolder.holderName}). Aucun état n’a été modifié.`,
            409,
            'COPY_ASSIGNED_TO_OTHER_MEMBER'
          );
        }

        const memberBookRequest = this.db
          .prepare(
            `SELECT r.id, r.status, c.barcode as expectedBarcode
             FROM reservations r
             LEFT JOIN copies c ON c.id = r.assignedCopyId
             WHERE r.memberId = ?
               AND r.bookId = ?
               AND r.status IN ('Retenu 24h', 'Disponible pour retrait')
             LIMIT 1`
          )
          .get(memberId, copyBookId) as
          | { id: string; status: string; expectedBarcode: string | null }
          | undefined;

        if (memberBookRequest && memberBookRequest.expectedBarcode) {
          throw new DomainError(
            `Mauvais exemplaire scanné pour « ${copyRow.bookTitle} » : la demande du membre porte sur l’exemplaire ${memberBookRequest.expectedBarcode}, pas sur ${String(copyRow.barcode)}.`,
            409,
            'WRONG_COPY_FOR_REQUEST'
          );
        }

        if (copyStatus !== 'Disponible') {
          throw new DomainError(
            `Retrait refusé : l’exemplaire ${String(copyRow.barcode)} est au statut « ${copyStatus} » et ne correspond à aucune demande prête pour ce membre.`,
            409,
            'COPY_NOT_AVAILABLE'
          );
        }

        throw new DomainError(
          `Retrait refusé : aucune retenue 24 h ni réservation FIFO prête à retirer n’existe pour ce membre sur l’exemplaire ${String(copyRow.barcode)}. Le membre doit d’abord valider sa demande depuis son panier.`,
          409,
          'NO_MATCHING_REQUEST_FOR_COPY'
        );
      }

      const activeSameBookLoan = this.db
        .prepare(
          `SELECT id FROM loans WHERE memberId = ? AND bookId = ? AND status != 'Retourné'`
        )
        .get(memberId, copyBookId);
      if (activeSameBookLoan) {
        throw new DomainError(
          'Ce membre détient déjà un emprunt actif pour cet ouvrage.',
          409,
          'DUPLICATE_ACTIVE_LOAN'
        );
      }

      if (copyStatus !== 'Retenu 24h' && copyStatus !== 'Réservé') {
        throw new DomainError(
          `Incohérence d’état détectée : l’exemplaire ${String(copyRow.barcode)} est au statut « ${copyStatus} ».`,
          409,
          'INVALID_COPY_STATE'
        );
      }

      const requestId = String(matchingRequest.id);
      const reqStatus = String(matchingRequest.status);
      const settings = this.getSettings();
      const nowIso = now.toISOString();
      const dueAt = addDaysIso(now, settings.borrowingDurationDays);
      const loanId = this.generateId('ln');

      this.db
        .prepare(
          `UPDATE reservations
           SET status = 'Retirée', completedAt = ?
           WHERE id = ?`
        )
        .run(nowIso, requestId);

      this.db
        .prepare(
          `UPDATE copies SET status = 'Emprunté', location = 'En prêt membre' WHERE id = ?`
        )
        .run(copyId);

      this.db
        .prepare(
          `INSERT INTO loans (id, memberId, copyId, bookId, borrowedAt, dueAt, returnedAt, returnCondition, returnNotes, status)
           VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'En cours')`
        )
        .run(loanId, memberId, copyId, copyBookId, nowIso, dueAt);

      this.insertCopyStateLogInternal(
        {
          copyId,
          copyBarcode: String(copyRow.barcode),
          bookId: copyBookId,
          bookTitle: copyRow.bookTitle,
          oldStatus: copyStatus,
          newStatus: 'Emprunté',
          memberId,
          memberName: String(memberRow.fullName),
          agent: actor,
          requestOrLoanId: loanId,
          summary: `Retrait validé au comptoir par scan carte + code-barres (${reqStatus === 'Retenu 24h' ? 'retenue 24 h' : 'réservation FIFO'}). Prêt ${settings.borrowingDurationDays} j jusqu’au ${formatFrenchDateTime(dueAt)}.`,
        },
        now
      );

      this.insertNotificationInternal(
        memberId,
        'Emprunt remis au comptoir',
        `Votre emprunt de « ${copyRow.bookTitle} » (exemplaire ${String(copyRow.barcode)}) a été validé au comptoir. Date limite de retour : ${formatFrenchDateTime(dueAt)}.`,
        'emprunt',
        now
      );

      this.insertAuditLogInternal(
        actor,
        'COUNTER_PICKUP_VALIDATED',
        'loan',
        loanId,
        `Retrait comptoir validé par ${actor.fullName || actor.id || 'bibliothécaire'} : membre ${String(memberRow.fullName)} + exemplaire ${String(copyRow.barcode)} (« ${copyRow.bookTitle} »). Échéance : ${formatFrenchDateTime(dueAt)}.`,
        now
      );

      const loan = this.getLoanByIdInternal(loanId)!;
      const fulfilledRequest = this.getReservationByIdInternal(requestId, false)!;
      const dossier = this.buildCounterMemberDossierInternal(memberRow, now);

      return {
        loan,
        fulfilledRequest,
        dossier,
      };
    });

    return tx.immediate();
  }

  public lookupCopyForReturnAtCounter(
    barcodeInput: string,
    now: Date = new Date()
  ): CounterReturnLookup {
    this.syncOverdueLoansInternal(now);
    const barcode = barcodeInput.trim();
    if (!barcode) {
      throw new DomainError(
        'Veuillez scanner ou saisir un code-barres d’exemplaire.',
        400,
        'BARCODE_REQUIRED'
      );
    }

    const c = this.db
      .prepare(
        `SELECT c.*, b.title as bookTitle
         FROM copies c
         JOIN books b ON b.id = c.bookId
         WHERE LOWER(c.barcode) = LOWER(?)`
      )
      .get(barcode) as (Record<string, unknown> & { bookTitle: string }) | undefined;

    if (!c) {
      throw new DomainError(
        `Aucun exemplaire enregistré pour le code-barres « ${barcode} ».`,
        404,
        'COPY_NOT_FOUND'
      );
    }

    const loanRow = this.db
      .prepare(
        `SELECT l.*, b.title as bookTitle, b.authors as bookAuthors, b.coverImage as bookCoverImage,
                b.shelfLocation as shelfLocation, c.barcode as copyBarcode,
                u.fullName as memberName, u.email as memberEmail, u.cne as memberCne
         FROM loans l
         JOIN books b ON b.id = l.bookId
         JOIN copies c ON c.id = l.copyId
         JOIN users u ON u.id = l.memberId
         WHERE l.copyId = ? AND l.status != 'Retourné'
         ORDER BY l.borrowedAt DESC
         LIMIT 1`
      )
      .get(String(c.id)) as Record<string, unknown> | undefined;

    return {
      copy: {
        id: String(c.id),
        bookId: String(c.bookId),
        barcode: String(c.barcode),
        status: c.status as CopyStatus,
        physicalCondition: c.physicalCondition as PhysicalCondition,
        location: String(c.location),
        needsInspection: Boolean(c.needsInspection),
        createdAt: String(c.createdAt),
        bookTitle: String(c.bookTitle),
      },
      activeLoan: loanRow ? this.mapLoanRow(loanRow, true) : null,
    };
  }

  public getCopyStateLogsAdmin(limit = 100): CopyStateLogRecord[] {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const rows = this.db
      .prepare(
        `SELECT * FROM copy_state_logs
         ORDER BY createdAt DESC, rowid DESC
         LIMIT ?`
      )
      .all(safeLimit) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: String(row.id),
      copyId: String(row.copyId),
      copyBarcode: String(row.copyBarcode),
      bookId: String(row.bookId),
      bookTitle: String(row.bookTitle),
      oldStatus: row.oldStatus ? (String(row.oldStatus) as CopyStatus) : null,
      newStatus: String(row.newStatus) as CopyStatus,
      memberId: row.memberId ? String(row.memberId) : null,
      memberName: row.memberName ? String(row.memberName) : null,
      agentId: row.agentId ? String(row.agentId) : null,
      agentName: row.agentName ? String(row.agentName) : null,
      requestOrLoanId: row.requestOrLoanId ? String(row.requestOrLoanId) : null,
      summary: String(row.summary),
      createdAt: String(row.createdAt),
    }));
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

  private getReservationByIdInternal(
    reservationId: string,
    hideBarcode = false
  ): ReservationRecord | null {
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
    return r ? this.mapReservationRow(r, false, hideBarcode) : null;
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
    includeMemberPii: boolean,
    hideBarcode = false
  ): ReservationRecord {
    const base: ReservationRecord = {
      id: String(r.id),
      memberId: String(r.memberId),
      bookId: String(r.bookId),
      requestType: (r.requestType ? String(r.requestType) : 'reservation_fifo') as RequestType,
      requestedAt: String(r.requestedAt),
      queuePosition: r.queuePosition !== null && r.queuePosition !== undefined ? Number(r.queuePosition) : null,
      status: r.status as ReservationRecord['status'],
      assignedCopyId: hideBarcode ? null : r.assignedCopyId ? String(r.assignedCopyId) : null,
      availableAt: r.availableAt ? String(r.availableAt) : null,
      pickupDeadline: r.pickupDeadline ? String(r.pickupDeadline) : null,
      completedAt: r.completedAt ? String(r.completedAt) : null,
      bookTitle: String(r.bookTitle),
      bookAuthors: String(r.bookAuthors),
      bookCoverImage: String(r.bookCoverImage),
      shelfLocation: String(r.shelfLocation),
      assignedCopyBarcode:
        hideBarcode || !r.assignedCopyBarcode ? null : String(r.assignedCopyBarcode),
    };

    if (includeMemberPii) {
      base.memberName = r.memberName ? String(r.memberName) : undefined;
      base.memberEmail = r.memberEmail ? String(r.memberEmail) : undefined;
      base.memberCne = r.memberCne ? String(r.memberCne) : null;
    }

    return base;
  }
}
