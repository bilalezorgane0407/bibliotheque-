import type {
  AccountStatus,
  Book,
  BookDetail,
  BookWithStats,
  Copy,
  CopyStatus,
  DashboardStats,
  EligibilityReport,
  LoanRecord,
  NotificationRecord,
  PhysicalCondition,
  ReservationRecord,
  ReturnInspectionOutcome,
  SsoAdapterStatus,
  StudentStatus,
  UserPublic,
} from '../../shared/types.ts';

export class ApiError extends Error {
  public readonly status: number;
  public readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function isCrossSiteIframe(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.self === window.top) return false;
    return window.top?.location.origin !== window.location.origin;
  } catch {
    return true;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const extraHeaders: Record<string, string> = {};
  if (isCrossSiteIframe()) {
    extraHeaders['X-BiblioEST-Embed'] = 'cross-site-iframe';
  }

  const res = await fetch(path, {
    credentials: 'include',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
      ...(init?.headers || {}),
    },
    ...init,
  });

  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : null;

  if (!res.ok) {
    throw new ApiError(
      data?.error || 'Une erreur est survenue lors de la communication avec le serveur.',
      res.status,
      data?.code
    );
  }

  return data as T;
}

export const api = {
  getMe: () =>
    request<{
      authenticated?: boolean;
      cookieReceived?: boolean;
      user: UserPublic | null;
      eligibility: EligibilityReport;
      sso: SsoAdapterStatus;
    }>('/api/auth/me'),

  login: (email: string, password: string) =>
    request<{ user: UserPublic; eligibility: EligibilityReport }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  register: (payload: {
    fullName: string;
    email: string;
    password: string;
    cne?: string;
    filiere?: string;
  }) =>
    request<{ user: UserPublic; eligibility: EligibilityReport }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  listBooks: (params?: {
    search?: string;
    category?: string;
    language?: string;
    year?: number | null;
    availableOnly?: boolean;
  }) => {
    const sp = new URLSearchParams();
    if (params?.search) sp.set('search', params.search);
    if (params?.category && params.category !== 'Toutes') sp.set('category', params.category);
    if (params?.language && params.language !== 'Toutes') sp.set('language', params.language);
    if (params?.year) sp.set('year', String(params.year));
    if (params?.availableOnly) sp.set('availableOnly', 'true');
    const qs = sp.toString();
    return request<{ books: BookWithStats[] }>(`/api/books${qs ? `?${qs}` : ''}`);
  },

  getBookDetail: (bookId: string) =>
    request<{ book: BookDetail }>(`/api/books/${encodeURIComponent(bookId)}`),

  borrowBook: (bookId: string) =>
    request<{ loan: LoanRecord }>(`/api/books/${encodeURIComponent(bookId)}/borrow`, {
      method: 'POST',
    }),

  reserveBook: (bookId: string) =>
    request<{ reservation: ReservationRecord; message: string }>(
      `/api/books/${encodeURIComponent(bookId)}/reserve`,
      { method: 'POST' }
    ),

  getMyLoans: () => request<{ loans: LoanRecord[] }>('/api/loans/mine'),

  getMyReservations: () =>
    request<{ reservations: ReservationRecord[] }>('/api/reservations/mine'),

  cancelReservation: (reservationId: string) =>
    request<{ reservation: ReservationRecord }>(
      `/api/reservations/${encodeURIComponent(reservationId)}/cancel`,
      { method: 'POST' }
    ),

  getMyNotifications: () =>
    request<{ notifications: NotificationRecord[] }>('/api/notifications/mine'),

  markNotificationRead: (id: string) =>
    request<{ ok: boolean }>(`/api/notifications/${encodeURIComponent(id)}/read`, {
      method: 'POST',
    }),

  markAllNotificationsRead: () =>
    request<{ ok: boolean }>('/api/notifications/read-all', { method: 'POST' }),

  // Administration bibliothécaire
  adminGetStats: () => request<{ stats: DashboardStats }>('/api/admin/stats'),

  adminGetBooks: () => request<{ books: BookWithStats[] }>('/api/admin/books'),

  adminCreateBook: (payload: Omit<Book, 'id' | 'archived' | 'createdAt'>) =>
    request<{ book: BookDetail }>('/api/admin/books', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  adminUpdateBook: (bookId: string, patch: Partial<Omit<Book, 'id' | 'createdAt'>>) =>
    request<{ book: BookDetail }>(`/api/admin/books/${encodeURIComponent(bookId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  adminGetCopies: () =>
    request<{ copies: Array<Copy & { bookTitle: string; bookCategory: string }> }>(
      '/api/admin/copies'
    ),

  adminRegisterCopy: (
    bookId: string,
    payload: { barcode: string; physicalCondition: PhysicalCondition; location: string }
  ) =>
    request<{ copy: Copy; assignedReservationId: string | null }>(
      `/api/admin/books/${encodeURIComponent(bookId)}/copies`,
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  adminUpdateCopyStatus: (
    copyId: string,
    payload: { status: CopyStatus; physicalCondition: PhysicalCondition; location: string }
  ) =>
    request<{ copy: Copy }>(`/api/admin/copies/${encodeURIComponent(copyId)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  adminCompleteRepair: (copyId: string) =>
    request<{ copy: Copy }>(`/api/admin/copies/${encodeURIComponent(copyId)}/complete-repair`, {
      method: 'POST',
    }),

  adminInspectRepairedCopy: (
    copyId: string,
    payload: { outcome: ReturnInspectionOutcome; physicalCondition: PhysicalCondition }
  ) =>
    request<{ copy: Copy; assignedReservationId: string | null }>(
      `/api/admin/copies/${encodeURIComponent(copyId)}/inspect`,
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  adminGetLoans: () => request<{ loans: LoanRecord[] }>('/api/admin/loans'),

  adminSendOverdueReminders: () =>
    request<{ acceptedCount: number; failedCount: number; skippedCount: number }>(
      '/api/admin/overdue-reminders',
      { method: 'POST' }
    ),

  adminSendEmailTest: () =>
    request<{ accepted: boolean }>('/api/admin/email-test', { method: 'POST' }),

  adminReturnLoan: (
    loanId: string,
    payload: {
      outcome: ReturnInspectionOutcome;
      physicalCondition: PhysicalCondition;
      notes?: string;
    }
  ) =>
    request<{ loan: LoanRecord; assignedReservationId: string | null }>(
      `/api/admin/loans/${encodeURIComponent(loanId)}/return`,
      { method: 'POST', body: JSON.stringify(payload) }
    ),

  adminGetReservations: () =>
    request<{ reservations: ReservationRecord[] }>('/api/admin/reservations'),

  adminPickupReservation: (reservationId: string) =>
    request<{ loan: LoanRecord }>(
      `/api/admin/reservations/${encodeURIComponent(reservationId)}/pickup`,
      { method: 'POST' }
    ),

  adminCancelReservation: (reservationId: string) =>
    request<{ reservation: ReservationRecord }>(
      `/api/admin/reservations/${encodeURIComponent(reservationId)}/cancel`,
      { method: 'POST' }
    ),

  adminProcessDeadlines: () =>
    request<{ expiredCount: number }>('/api/admin/reservations/process-deadlines', {
      method: 'POST',
    }),

  adminGetMembers: () => request<{ members: UserPublic[] }>('/api/admin/members'),

  adminUpdateMemberVerification: (
    userId: string,
    studentStatus: StudentStatus,
    accountStatus: AccountStatus
  ) =>
    request<{ member: UserPublic }>(
      `/api/admin/members/${encodeURIComponent(userId)}/verification`,
      { method: 'PATCH', body: JSON.stringify({ studentStatus, accountStatus }) }
    ),
};

export function formatDateFr(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(iso));
}

export function formatDateTimeFr(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function daysRemainingFromNow(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const diffMs = new Date(iso).getTime() - Date.now();
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
}
