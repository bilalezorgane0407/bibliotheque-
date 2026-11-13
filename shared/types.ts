export type UserRole = 'membre' | 'bibliothecaire';

export type StudentStatus = 'verifie' | 'en_attente' | 'non_est' | 'suspendu';

export type AccountStatus = 'actif' | 'suspendu';

export type AuthSource = 'local' | 'usmba_sso';

export type CopyStatus =
  | 'Disponible'
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

export type ReservationStatus =
  | 'En attente'
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
  cne: string | null;
  filiere: string | null;
  authSource: AuthSource;
  createdAt: string;
}

export interface EligibilityReport {
  authenticated: boolean;
  verifiedEstStudent: boolean;
  accountActive: boolean;
  noOverdueLoans: boolean;
  eligible: boolean;
  overdueCount: number;
  reasonCode:
    | 'ELIGIBLE'
    | 'AUTH_REQUIRED'
    | 'ACCOUNT_SUSPENDED'
    | 'EST_STATUS_NOT_VERIFIED'
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

export interface SsoAdapterStatus {
  provider: string;
  protocol: 'OIDC / CAS USMBA';
  configured: boolean;
  issuerUrl: string | null;
  authorizationEndpoint: string | null;
  message: string;
  documentationPath: string;
}

export interface DashboardStats {
  totalTitles: number;
  totalPhysicalCopies: number;
  availableCopies: number;
  borrowedCopies: number;
  reservedCopies: number;
  repairCopies: number;
  withdrawnCopies: number;
  pendingReservations: number;
  awaitingPickupReservations: number;
  overdueLoans: number;
  activeLoans: number;
}

export const EST_DEPARTMENTS = [
  'Génie Informatique',
  'Génie Électrique',
  'Techniques de Management',
  'Génie Mécanique',
  'Mathématiques & Génie des Procédés',
] as const;

export const BOOK_LANGUAGES = ['Français', 'Anglais', 'Arabe'] as const;

export const BORROWING_DURATION_DAYS = 7;
export const PICKUP_WINDOW_DAYS = 3;
