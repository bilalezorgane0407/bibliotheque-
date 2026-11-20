import { useEffect, useMemo, useState } from 'react';
import { FlaskConical, RotateCcw } from 'lucide-react';
import type {
  BookWithStats,
  CartItemRecord,
  DemoState,
  EligibilityReport,
  GoogleAuthStatus,
  LibrarySettings,
  NotificationRecord,
  UserPublic,
} from '../shared/types.ts';
import { ApiError, api, formatDateTimeFr, isCrossSiteIframe } from './lib/api.ts';
import { firebaseSignOut } from './lib/firebaseAuth.ts';
import { Navbar, type AppPage } from './components/Navbar.tsx';
import { HomePage } from './components/HomePage.tsx';
import { CataloguePage } from './components/CataloguePage.tsx';
import { BookDetailPage } from './components/BookDetailPage.tsx';
import { CartPage } from './components/CartPage.tsx';
import { LoansPage } from './components/LoansPage.tsx';
import { ReservationsPage } from './components/ReservationsPage.tsx';
import { ProfileNotificationsPage } from './components/ProfileNotificationsPage.tsx';
import { LibrarianDashboard } from './components/LibrarianDashboard.tsx';
import { AuthView } from './components/AuthView.tsx';
import { DemoPanel } from './components/DemoPanel.tsx';

export default function App() {
  const [page, setPage] = useState<AppPage>('home');
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [catalogueFilters, setCatalogueFilters] = useState<{
    search?: string;
    category?: string;
    availableOnly?: boolean;
  }>({});

  const [user, setUser] = useState<UserPublic | null>(null);
  const [eligibility, setEligibility] = useState<EligibilityReport | null>(null);
  const [googleAuth, setGoogleAuth] = useState<GoogleAuthStatus | null>(null);
  const [demoModeEnabled, setDemoModeEnabled] = useState<boolean>(false);
  const [isDemoSession, setIsDemoSession] = useState<boolean>(false);
  const [simulatedNow, setSimulatedNow] = useState<string | null>(null);
  const [settings, setSettings] = useState<LibrarySettings | null>(null);
  const [demoState, setDemoState] = useState<DemoState | null>(null);
  const [demoPanelOpen, setDemoPanelOpen] = useState(false);

  const [books, setBooks] = useState<BookWithStats[]>([]);
  const [booksLoading, setBooksLoading] = useState(true);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [cartItems, setCartItems] = useState<CartItemRecord[]>([]);
  const [cartNotice, setCartNotice] = useState<{
    kind: 'success' | 'error';
    message: string;
  } | null>(null);

  const refreshDemoState = async (enabledFlag?: boolean) => {
    const enabled = enabledFlag ?? demoModeEnabled;
    if (!enabled) {
      setDemoState(null);
      return;
    }
    try {
      const state = await api.getDemoState();
      setDemoState(state);
    } catch {
      setDemoState(null);
    }
  };

  const refreshSessionAndNotifications = async () => {
    try {
      const me = await api.getMe();
      setUser(me.user);
      setEligibility(me.eligibility);
      setGoogleAuth(me.googleAuth);
      setDemoModeEnabled(me.demoModeEnabled);
      setIsDemoSession(Boolean(me.isDemoSession));
      setSimulatedNow(me.simulatedNow || null);
      setSettings(me.settings || null);

      if (me.demoModeEnabled) {
        void refreshDemoState(true);
      } else {
        setDemoState(null);
      }

      if (me.user) {
        const [notifRes, cartRes] = await Promise.all([
          api.getMyNotifications(),
          api.getCart(),
        ]);
        setNotifications(notifRes.notifications);
        setCartItems(cartRes.items);
      } else {
        setNotifications([]);
        setCartItems([]);
      }
    } catch {
      setUser(null);
      setEligibility(null);
      setIsDemoSession(false);
      setSimulatedNow(null);
      setNotifications([]);
      setCartItems([]);
    }
  };

  const refreshHomeBooks = async () => {
    setBooksLoading(true);
    try {
      const res = await api.listBooks();
      setBooks(res.books);
    } catch {
      setBooks([]);
    } finally {
      setBooksLoading(false);
    }
  };

  useEffect(() => {
    void refreshSessionAndNotifications();
    void refreshHomeBooks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const navigate = (nextPage: AppPage) => {
    setCartNotice(null);
    // Garde front-end : un étudiant ne peut pas ouvrir la vue administration
    if (nextPage === 'admin' && user?.role !== 'bibliothecaire') {
      setPage(user ? 'home' : 'auth');
      return;
    }
    setPage(nextPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openBook = (bookId: string) => {
    setCartNotice(null);
    setSelectedBookId(bookId);
    setPage('book');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSearchCatalogue = (params: {
    search: string;
    category: string;
    availableOnly: boolean;
  }) => {
    setCatalogueFilters(params);
    setPage('catalogue');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleAddToCart = async (bookId: string) => {
    if (!user) {
      navigate('auth');
      return;
    }
    try {
      const res = await api.addToCart(bookId, 1);
      setCartItems(res.items);
      setCartNotice({
        kind: 'success',
        message:
          'Ouvrage ajouté au panier de demandes (aucun exemplaire réservé avant confirmation).',
      });
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : 'Impossible d’ajouter cet ouvrage au panier.';
      setCartNotice({ kind: 'error', message: msg });
      throw err;
    }
  };

  const handleAuthenticated = async (preferredPage?: AppPage) => {
    const me = await api.getMe();
    if (!me.user) {
      if (isCrossSiteIframe() && !me.cookieReceived) {
        throw new ApiError(
          'Connexion validée par le serveur, mais votre navigateur bloque les cookies tiers dans cet aperçu intégré. Ouvrez l’application dans un onglet indépendant ou autorisez les cookies pour ce site.',
          401,
          'IFRAME_COOKIE_BLOCKED'
        );
      }
      throw new ApiError(
        'Connexion validée par le serveur mais le cookie de session n’a pas été conservé par le navigateur. Autorisez les cookies pour ce site.',
        401,
        'COOKIE_NOT_PERSISTED'
      );
    }
    setUser(me.user);
    setEligibility(me.eligibility);
    setGoogleAuth(me.googleAuth);
    setDemoModeEnabled(me.demoModeEnabled);
    setIsDemoSession(Boolean(me.isDemoSession));
    setSimulatedNow(me.simulatedNow || null);
    setSettings(me.settings || null);

    const [notifRes, cartRes] = await Promise.all([
      api.getMyNotifications(),
      api.getCart(),
      refreshHomeBooks(),
      me.demoModeEnabled ? refreshDemoState(true) : Promise.resolve(),
    ]);
    setNotifications(notifRes.notifications);
    setCartItems(cartRes.items);

    if (preferredPage && (preferredPage !== 'admin' || me.user.role === 'bibliothecaire')) {
      setPage(preferredPage);
    } else {
      setPage(me.user.role === 'bibliothecaire' ? 'admin' : 'home');
    }
  };

  const handleSwitchDemoProfile = async (userId: string, navigateTo?: AppPage) => {
    await api.demoLogin(userId);
    await handleAuthenticated(navigateTo);
  };

  const handleResetDemo = async () => {
    const freshState = await api.demoReset();
    setDemoState(freshState);
    await Promise.all([refreshSessionAndNotifications(), refreshHomeBooks()]);
  };

  const handleAdvanceClock = async (
    payload: { addHours?: number; addDays?: number } | null
  ) => {
    const nextState = await api.demoAdvanceClock(
      payload === null ? { setOffsetHours: 0 } : payload
    );
    setDemoState(nextState);
    await Promise.all([refreshSessionAndNotifications(), refreshHomeBooks()]);
  };

  const handleLogout = async () => {
    await Promise.allSettled([api.logout(), firebaseSignOut()]);
    setUser(null);
    setEligibility(null);
    setIsDemoSession(false);
    setSimulatedNow(null);
    setNotifications([]);
    setCartItems([]);
    await refreshHomeBooks();
    setPage('home');
  };

  const unreadNotificationsCount = notifications.filter((n) => !n.readAt).length;
  const cartBookIds = useMemo(
    () => new Set(cartItems.map((item) => item.bookId)),
    [cartItems]
  );

  return (
    <div className="min-h-screen flex flex-col bg-white text-stone-900">
      <Navbar
        currentPage={page}
        user={user}
        unreadNotificationsCount={unreadNotificationsCount}
        cartCount={cartItems.length}
        onNavigate={navigate}
      />

      {demoModeEnabled && (
        <div
          className={`border-b ${
            isDemoSession
              ? 'border-amber-300 bg-amber-50/90 text-amber-950'
              : 'border-stone-200 bg-stone-50 text-stone-700'
          }`}
        >
          <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-2 text-xs sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <FlaskConical
                className={`h-3.5 w-3.5 shrink-0 ${
                  isDemoSession ? 'text-amber-800' : 'text-stone-600'
                }`}
              />
              {isDemoSession ? (
                <span>
                  <strong>Mode Démo actif</strong> · Bac à sable isolé (.example) · Aucun vrai e-mail envoyé
                  {simulatedNow && (
                    <span className="ml-1.5 font-mono text-[11px] tabular-nums">
                      · Horloge : {formatDateTimeFr(simulatedNow)}
                    </span>
                  )}
                </span>
              ) : (
                <span>
                  Mode Démo disponible (comptes fictifs <span className="font-mono">.example</span> isolés des données réelles)
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {isDemoSession && (
                <>
                  <button
                    type="button"
                    onClick={() => void handleAdvanceClock({ addHours: 25 })}
                    className="min-h-[32px] rounded border border-amber-300 bg-white px-2.5 font-mono text-[11px] font-semibold text-amber-950 hover:bg-amber-100/60 cursor-pointer"
                  >
                    +25 h
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleAdvanceClock({ addDays: 1 })}
                    className="min-h-[32px] rounded border border-amber-300 bg-white px-2.5 font-mono text-[11px] font-semibold text-amber-950 hover:bg-amber-100/60 cursor-pointer"
                  >
                    +1 j
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleAdvanceClock({ addDays: 4 })}
                    className="min-h-[32px] rounded border border-amber-300 bg-white px-2.5 font-mono text-[11px] font-semibold text-amber-950 hover:bg-amber-100/60 cursor-pointer"
                  >
                    +4 j
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleResetDemo()}
                    className="inline-flex min-h-[32px] items-center gap-1 rounded border border-amber-300 bg-white px-2.5 text-[11px] font-semibold text-amber-950 hover:bg-amber-100/60 cursor-pointer"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Réinitialiser la démo
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setDemoPanelOpen(true)}
                className={`min-h-[32px] rounded px-3 text-[11px] font-semibold cursor-pointer ${
                  isDemoSession
                    ? 'bg-amber-900 text-white hover:bg-amber-950'
                    : 'border border-stone-300 bg-white text-stone-900 hover:border-emerald-900'
                }`}
              >
                {isDemoSession ? 'Scénarios & Profils Démo' : 'Ouvrir Mode Démo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {cartNotice && (page === 'catalogue' || page === 'home') && (
        <div className="border-b border-stone-200 bg-stone-50">
          <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-2.5 text-xs sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6 lg:px-8">
            <span
              className={
                cartNotice.kind === 'error'
                  ? 'font-medium text-red-800'
                  : 'font-medium text-emerald-950'
              }
            >
              {cartNotice.message}
            </span>
            <div className="flex flex-wrap items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => navigate('cart')}
                className="min-h-[36px] font-semibold text-emerald-900 underline cursor-pointer"
              >
                Ouvrir le panier ({cartItems.length})
              </button>
              <button
                type="button"
                onClick={() => setCartNotice(null)}
                className="min-h-[36px] text-stone-500 hover:text-stone-900 cursor-pointer"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="flex-1">
        {page === 'home' && (
          <HomePage
            books={books}
            loading={booksLoading}
            onOpenBook={openBook}
            onSearchCatalogue={handleSearchCatalogue}
          />
        )}

        {page === 'catalogue' && (
          <CataloguePage
            initialFilters={catalogueFilters}
            cartBookIds={cartBookIds}
            cartCount={cartItems.length}
            onOpenBook={openBook}
            onAddToCart={
              user?.role === 'bibliothecaire'
                ? undefined
                : async (id) => {
                    try {
                      await handleAddToCart(id);
                    } catch {
                      // géré par cartNotice dans le bandeau
                    }
                  }
            }
            onGoToCart={() => navigate('cart')}
          />
        )}

        {page === 'book' && selectedBookId && (
          <BookDetailPage
            bookId={selectedBookId}
            user={user}
            eligibility={eligibility}
            inCart={cartBookIds.has(selectedBookId)}
            onBack={() => navigate('catalogue')}
            onRequireAuth={() => navigate('auth')}
            onAddToCart={
              user?.role === 'bibliothecaire'
                ? undefined
                : async (id) => {
                    await handleAddToCart(id);
                  }
            }
            onGoToCart={() => navigate('cart')}
          />
        )}

        {page === 'cart' && (
          <CartPage
            user={user}
            eligibility={eligibility}
            items={cartItems}
            borrowingDurationDays={settings?.borrowingDurationDays}
            onRequireAuth={() => navigate('auth')}
            onOpenBook={openBook}
            onBrowseCatalogue={() => navigate('catalogue')}
            onCartChanged={async () => {
              await Promise.all([refreshSessionAndNotifications(), refreshHomeBooks()]);
            }}
            onGoToLoans={() => navigate('loans')}
            onGoToReservations={() => navigate('reservations')}
          />
        )}

        {page === 'loans' && (
          <LoansPage
            user={user}
            simulatedNow={simulatedNow}
            onRequireAuth={() => navigate('auth')}
            onOpenBook={openBook}
            onBrowseCatalogue={() => navigate('catalogue')}
          />
        )}

        {page === 'reservations' && (
          <ReservationsPage
            user={user}
            onRequireAuth={() => navigate('auth')}
            onOpenBook={openBook}
            onBrowseCatalogue={() => navigate('catalogue')}
            onUpdated={async () => {
              await Promise.all([refreshSessionAndNotifications(), refreshHomeBooks()]);
            }}
          />
        )}

        {page === 'profile' && (
          <ProfileNotificationsPage
            user={user}
            eligibility={eligibility}
            googleAuth={googleAuth}
            notifications={notifications}
            onRequireAuth={() => navigate('auth')}
            onRefresh={refreshSessionAndNotifications}
            onLogout={handleLogout}
          />
        )}

        {page === 'admin' && (
          <LibrarianDashboard
            user={user}
            isDemoSession={isDemoSession}
            onDataMutated={async () => {
              await Promise.all([refreshHomeBooks(), refreshSessionAndNotifications()]);
            }}
          />
        )}

        {page === 'auth' && (
          <AuthView
            googleAuth={googleAuth}
            demoModeEnabled={demoModeEnabled}
            demoProfiles={demoState?.profiles}
            onAuthenticated={async () => {
              await handleAuthenticated();
            }}
            onOpenDemoOutbox={() => {
              void refreshDemoState(true);
              setDemoPanelOpen(true);
            }}
          />
        )}
      </main>

      <DemoPanel
        open={demoPanelOpen}
        demoState={demoState}
        currentUser={user}
        onClose={() => setDemoPanelOpen(false)}
        onSwitchProfile={handleSwitchDemoProfile}
        onResetDemo={handleResetDemo}
        onAdvanceClock={handleAdvanceClock}
        onRefreshState={() => refreshDemoState(true)}
      />

      <footer className="border-t border-stone-200 bg-stone-50/60">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-xs text-stone-600 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p className="font-medium text-stone-800">
            BiblioEST · École Supérieure de Technologie de Fès — Université Sidi Mohamed Ben Abdellah
          </p>
          <p>
            Règlement : prêt de {settings?.borrowingDurationDays ?? 7} jours · réservation chronologique FIFO · délai de retrait{' '}
            {settings?.pickupWindowDays ?? 3} jours
          </p>
        </div>
      </footer>
    </div>
  );
}
