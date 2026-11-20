export type UserRole = 'membre' | 'bibliothecaire';

export type StudentStatus = 'verifie' | 'en_attente' | 'non_est' | 'suspendu';

export type AccountStatus = 'actif' | 'suspendu';

export type AuthSource = 'local' | 'usmba_sso' | 'google_oidc';

export type CopyStatus =
  | 'Disponible'
  | 'Retenu 24h'
  | 'Emprunté'
  | 'Réservé'
  | 'En réparation'
  | 'Retiré définitivement';

export type PhysicalCondition =
  | 'Neuf'
  | 'Bon état'
  | 'Usure légère'
  | 'Endommagé'
  | 'Hors service';

export type LoanStatus = 'En cours' | 'Retourné' | 'En retard';

export type RequestType = 'retenue_24h' | 'reservation_fifo';

export type ReservationStatus =
  | 'En attente'
  | 'Retenu 24h'
  | 'Exemplaire attribué'
  | 'Disponible pour retrait'
  | 'Retirée'
  | 'Annulée'
  | 'Expirée';

export type ReturnInspectionOutcome =
  | 'reutilisable'
  | 'endommage'
  | 'retire_definitivement';

export interface UserPublic {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  institution: string;
  studentStatus: StudentStatus;
  accountStatus: AccountStatus;
  emailVerified?: boolean;
  isAdmin?: boolean;
  cne: string | null;
  filiere: string | null;
  authSource: AuthSource;
  isDemo?: boolean;
  createdAt: string;
}

export interface EligibilityReport {
  authenticated: boolean;
  emailVerified: boolean;
  verifiedEstStudent: boolean;
  accountActive: boolean;
  noOverdueLoans: boolean;
  eligible: boolean;
  overdueCount: number;
  reasonCode:
    | 'ELIGIBLE'
    | 'AUTH_REQUIRED'
    | 'EMAIL_NOT_VERIFIED'
    | 'EST_STATUS_NOT_VERIFIED'
    | 'ACCOUNT_SUSPENDED'
    | 'OVERDUE_RETURN';
  reasonMessage: string;
}

export interface Book {
  id: string;
  title: string;
  authors: string;
  isbn: string | null;
  category: string;
  description: string;
  publisher: string;
  publicationYear: number;
  edition: string;
  language: string;
  coverImage: string;
  shelfLocation: string;
  archived: boolean;
  featured: boolean;
  isDemo?: boolean;
  createdAt: string;
}

export interface Copy {
  id: string;
  bookId: string;
  barcode: string;
  status: CopyStatus;
  physicalCondition: PhysicalCondition;
  location: string;
  needsInspection: boolean;
  createdAt: string;
}

export interface BookWithStats extends Book {
  totalCopies: number;
  availableCopies: number;
  held24hCopies?: number;
  borrowedCopies: number;
  reservedCopies: number;
  repairCopies: number;
  withdrawnCopies: number;
  circulatingCopies: number;
}

export interface BookDetail extends BookWithStats {
  copies: Copy[];
  pendingReservationsCount: number;
  canBorrow: boolean;
  canReserve: boolean;
  reservationBlockedReason: string | null;
}

export interface LoanRecord {
  id: string;
  memberId: string;
  copyId: string;
  bookId: string;
  borrowedAt: string;
  dueAt: string;
  returnedAt: string | null;
  returnCondition: string | null;
  returnNotes: string | null;
  status: LoanStatus;
  bookTitle: string;
  bookAuthors: string;
  bookCoverImage: string;
  shelfLocation: string;
  copyBarcode: string;
  memberName?: string;
  memberEmail?: string;
  memberCne?: string | null;
}

export interface ReservationRecord {
  id: string;
  memberId: string;
  bookId: string;
  requestType: RequestType;
  requestedAt: string;
  queuePosition: number | null;
  status: ReservationStatus;
  assignedCopyId: string | null;
  availableAt: string | null;
  pickupDeadline: string | null;
  completedAt: string | null;
  bookTitle: string;
  bookAuthors: string;
  bookCoverImage: string;
  shelfLocation: string;
  assignedCopyBarcode?: string | null;
  memberName?: string;
  memberEmail?: string;
  memberCne?: string | null;
}

export interface NotificationRecord {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: 'emprunt' | 'reservation' | 'retrait' | 'rappel' | 'expiration' | 'annulation' | 'retour';
  createdAt: string;
  readAt: string | null;
}

export interface CartItemRecord {
  id: string;
  bookId: string;
  quantity: number;
  addedAt: string;
  book: BookWithStats;
}

export type CartConfirmationOutcome =
  | 'retenue_24h_creee'
  | 'reservation_enregistree'
  | 'refuse';

export interface CartConfirmationItemResult {
  bookId: string;
  bookTitle: string;
  outcome: CartConfirmationOutcome;
  message: string;
  code?: string;
  loan?: LoanRecord;
  reservation?: ReservationRecord;
}

export interface CartConfirmationResponse {
  results: CartConfirmationItemResult[];
  remainingCartCount: number;
}

export interface CopyStateLogRecord {
  id: string;
  copyId: string;
  copyBarcode: string;
  bookId: string;
  bookTitle: string;
  oldStatus: CopyStatus | null;
  newStatus: CopyStatus;
  memberId: string | null;
  memberName: string | null;
  agentId: string | null;
  agentName: string | null;
  requestOrLoanId: string | null;
  summary: string;
  createdAt: string;
}

export interface CounterMemberDossier {
  member: UserPublic;
  eligibility: EligibilityReport;
  holds24h: ReservationRecord[];
  fifoReadyPickups: ReservationRecord[];
  fifoWaiting: ReservationRecord[];
  activeLoans: LoanRecord[];
  pastLoans: LoanRecord[];
}

export interface CounterPickupResult {
  loan: LoanRecord;
  fulfilledRequest: ReservationRecord;
  dossier: CounterMemberDossier;
}

export interface CounterReturnLookup {
  copy: Copy & { bookTitle: string };
  activeLoan: LoanRecord | null;
}

export interface AuditLogRecord {
  id: string;
  actorId: string | null;
  actorName: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  createdAt: string;
}

export interface GoogleAuthStatus {
  provider: string;
  configured: boolean;
  firebaseAuthConfigured?: boolean;
  clientIdConfigured: boolean;
  redirectUri: string;
  sharedRedirectUri: string | null;
  allowedDomain: string | null;
  eligibilitySourceConfigured: boolean;
  missingVariables: string[];
  recoveryUrl: string;
  message: string;
}

export interface DashboardStats {
  totalTitles: number;
  totalPhysicalCopies: number;
  availableCopies: number;
  held24hCopies: number;
  borrowedCopies: number;
  reservedCopies: number;
  repairCopies: number;
  withdrawnCopies: number;
  pendingReservations: number;
  allocatedReservations: number;
  awaitingPickupReservations: number;
  overdueLoans: number;
  activeLoans: number;
}

export interface OverdueEmailRecipient {
  memberId: string;
  memberName: string;
  memberEmail: string;
  books: Array<{ title: string; barcode: string; dueAt: string }>;
  emailSent: boolean;
}

export interface OverdueNotificationResult {
  notifiedMembersCount: number;
  overdueLoansCount: number;
  emailsSentCount: number;
  smtpConfigured: boolean;
  gmailApiUsed?: boolean;
  demoSimulated?: boolean;
  recipients: OverdueEmailRecipient[];
  subject: string;
  summaryMessage: string;
}

export interface LibrarySettings {
  borrowingDurationDays: number;
  pickupWindowDays: number;
  maxQuantityPerTitle: number;
  realEmailsEnabled: boolean;
  testEmailRecipient: string;
}

export interface SimulatedEmailRecord {
  id: string;
  recipientEmail: string;
  subject: string;
  body: string;
  category: 'verification' | 'rappel_retard' | 'retrait' | 'test';
  createdAt: string;
}

export interface DemoState {
  demoModeEnabled: boolean;
  isDemoSession: boolean;
  simulatedNow: string;
  clockOffsetDays: number;
  clockOffsetHours: number;
  profiles: UserPublic[];
  outbox: SimulatedEmailRecord[];
  settings: LibrarySettings;
}

export type DemoScenarioStatus = 'a_verifier' | 'reussi' | 'echoue';

export const EST_DEPARTMENTS = [
  'Génie Informatique',
  'Génie Électrique',
  'Techniques de Management',
  'Génie Mécanique',
  'Mathématiques & Génie des Procédés',
] as const;

export const BOOK_LANGUAGES = ['Français', 'Anglais', 'Arabe'] as const;

export const HOLD_DURATION_HOURS = 24;
export const BORROWING_DURATION_DAYS = 7;
export const PICKUP_WINDOW_DAYS = 3;
export const MAX_QUANTITY_PER_TITLE = 1;
