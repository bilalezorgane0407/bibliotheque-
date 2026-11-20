import type {
  AccountStatus,
  AuditLogRecord,
  Book,
  BookDetail,
  BookWithStats,
  CartConfirmationResponse,
  CartItemRecord,
  Copy,
  CopyStateLogRecord,
  CopyStatus,
  CounterMemberDossier,
  CounterPickupResult,
  CounterReturnLookup,
  DashboardStats,
  DemoState,
  EligibilityReport,
  GoogleAuthStatus,
  LibrarySettings,
  LoanRecord,
  NotificationRecord,
  OverdueNotificationResult,
  PhysicalCondition,
  ReservationRecord,
  ReturnInspectionOutcome,
  SimulatedEmailRecord,
  StudentStatus,
  UserPublic,
  UserRole,
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
      googleAuth: GoogleAuthStatus;
      demoModeEnabled: boolean;
      isDemoSession?: boolean;
      simulatedNow?: string;
      settings?: LibrarySettings;
    }>('/api/auth/me'),

  getGoogleAuthUrl: () =>
    request<{ authorizationUrl: string }>('/api/auth/google/url'),

  completeGoogleHandoff: (handoffToken: string) =>
    request<{
      authenticated: boolean;
      user: UserPublic;
      eligibility: EligibilityReport;
      requiresLibrarianValidation?: boolean;
    }>('/api/auth/google/handoff', {
      method: 'POST',
      body: JSON.stringify({ handoffToken }),
    }),

  completeFirebaseGoogleLogin: (payload: {
    idToken?: string;
    accessToken?: string | null;
  }) =>
    request<{
      authenticated: boolean;
      user: UserPublic;
      eligibility: EligibilityReport;
      requiresLibrarianValidation?: boolean;
    }>('/api/auth/google/firebase', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  registerAcademic: (payload: {
    fullName: string;
    email: string;
    password: string;
    filiere?: string;
    cne?: string;
    demoMode?: boolean;
  }) =>
    request<{
      user: UserPublic;
      emailVerificationRequired: boolean;
      expiresAt: string;
      emailDispatched: boolean;
      demoVerificationCode?: string;
      message: string;
    }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  verifyEmailCode: (payload: { email: string; code: string; demoMode?: boolean }) =>
    request<{
      authenticated: boolean;
      user: UserPublic;
      eligibility: EligibilityReport;
      isDemoSession?: boolean;
      message: string;
    }>('/api/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  resendVerificationCode: (payload: { email: string; demoMode?: boolean }) =>
    request<{
      ok: boolean;
      email: string;
      expiresAt: string;
      demoVerificationCode?: string;
    }>('/api/auth/resend-verification', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  demoLogin: (userId: string) =>
    request<{
      authenticated: boolean;
      user: UserPublic;
      eligibility: EligibilityReport;
      isDemoSession?: boolean;
      simulatedNow?: string;
    }>('/api/auth/demo-login', {
      method: 'POST',
      body: JSON.stringify({ userId }),
    }),

  login: (email: string, password: string) =>
    request<{
      user: UserPublic;
      eligibility: EligibilityReport;
      isDemoSession?: boolean;
    }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  // Bac à sable Mode Démo
  getDemoState: () => request<DemoState>('/api/demo/state'),

  demoReset: () =>
    request<DemoState>('/api/demo/reset', {
      method: 'POST',
    }),

  demoAdvanceClock: (payload: {
    addHours?: number;
    setOffsetHours?: number;
    addDays?: number;
    setOffsetDays?: number;
  }) =>
    request<DemoState & { expiredReservationsCount: number }>('/api/demo/clock', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

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

  // Panier de demandes (ne réserve jamais d'exemplaire avant confirmation serveur)
  getCart: () =>
    request<{ items: CartItemRecord[]; maxQuantityPerTitle: number }>('/api/cart'),

  addToCart: (bookId: string, quantity = 1) =>
    request<{ items: CartItemRecord[] }>('/api/cart/items', {
      method: 'POST',
      body: JSON.stringify({ bookId, quantity }),
    }),

  updateCartItemQuantity: (bookId: string, quantity: number) =>
    request<{ items: CartItemRecord[] }>(`/api/cart/items/${encodeURIComponent(bookId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ quantity }),
    }),

  removeFromCart: (bookId: string) =>
    request<{ items: CartItemRecord[] }>(`/api/cart/items/${encodeURIComponent(bookId)}`, {
      method: 'DELETE',
    }),

  confirmCart: () =>
    request<CartConfirmationResponse>('/api/cart/confirm', { method: 'POST' }),

  // Administration bibliothécaire & administrateur
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

  adminRegisterCopiesBatch: (
    bookId: string,
    payload: {
      barcodes: string[] | string;
      physicalCondition: PhysicalCondition;
      location: string;
    }
  ) =>
    request<{
      created: Copy[];
      skippedBarcodes: string[];
      assignedReservationsCount: number;
    }>(`/api/admin/books/${encodeURIComponent(bookId)}/copies/batch`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

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

  adminCreateLoan: (payload: {
    memberId: string;
    bookId: string;
    copyId?: string | null;
  }) =>
    request<{ loan: LoanRecord }>('/api/admin/loans', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  adminToggleLoanOverdueTest: (loanId: string) =>
    request<{ loan: LoanRecord }>(
      `/api/admin/loans/${encodeURIComponent(loanId)}/toggle-overdue-test`,
      { method: 'POST' }
    ),

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

  adminNotifyOverdueMembers: (payload?: { googleAccessToken?: string }) =>
    request<OverdueNotificationResult>('/api/admin/loans/notify-overdue', {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),

  adminSendTestEmail: (payload?: { googleAccessToken?: string; recipientEmail?: string }) =>
    request<{
      ok: boolean;
      demoSimulated: boolean;
      recipientEmail: string;
      transport?: string;
      record?: SimulatedEmailRecord;
      message: string;
    }>('/api/admin/email/test', {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),

  adminGetReservations: () =>
    request<{ reservations: ReservationRecord[] }>('/api/admin/reservations'),

  adminAllocateQueue: (bookId: string) =>
    request<{ reservation: ReservationRecord; copy: Copy }>(
      '/api/admin/reservations/allocate',
      { method: 'POST', body: JSON.stringify({ bookId }) }
    ),

  adminConfirmReservationAvailability: (reservationId: string) =>
    request<{ reservation: ReservationRecord }>(
      `/api/admin/reservations/${encodeURIComponent(reservationId)}/confirm-availability`,
      { method: 'POST' }
    ),

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

  adminUpdateMemberRole: (userId: string, role: UserRole, isAdmin: boolean) =>
    request<{ member: UserPublic }>(
      `/api/admin/members/${encodeURIComponent(userId)}/role`,
      { method: 'PATCH', body: JSON.stringify({ role, isAdmin }) }
    ),

  adminGetSettings: () => request<{ settings: LibrarySettings }>('/api/admin/settings'),

  adminUpdateSettings: (patch: Partial<LibrarySettings>) =>
    request<{ settings: LibrarySettings }>('/api/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  // Comptoir & Circulation (scan carte membre & code-barres exemplaire, réservé au personnel)
  adminSearchCounterMembers: (q: string) =>
    request<{ members: UserPublic[] }>(
      `/api/admin/counter/members/search?q=${encodeURIComponent(q)}`
    ),

  adminLookupCounterMember: (q: string) =>
    request<{ dossier: CounterMemberDossier }>(
      `/api/admin/counter/member?q=${encodeURIComponent(q)}`
    ),

  adminCounterCheckout: (memberId: string, barcode: string) =>
    request<CounterPickupResult>('/api/admin/counter/checkout', {
      method: 'POST',
      body: JSON.stringify({ memberId, barcode }),
    }),

  adminCounterScanReturn: (barcode: string) =>
    request<CounterReturnLookup>('/api/admin/counter/scan-return', {
      method: 'POST',
      body: JSON.stringify({ barcode }),
    }),

  adminGetCopyStateLogs: (limit = 100) =>
    request<{ logs: CopyStateLogRecord[] }>(`/api/admin/copy-state-logs?limit=${limit}`),

  adminGetAuditLogs: (limit = 100) =>
    request<{ logs: AuditLogRecord[] }>(`/api/admin/audit-logs?limit=${limit}`),
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

export function daysRemainingFromNow(
  iso: string | null | undefined,
  referenceNowIso?: string | null
): number | null {
  if (!iso) return null;
  const baseMs = referenceNowIso ? new Date(referenceNowIso).getTime() : Date.now();
  const diffMs = new Date(iso).getTime() - baseMs;
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
}
