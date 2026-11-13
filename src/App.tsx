import { useEffect, useMemo, useState } from 'react';
import type {
  BookWithStats,
  CartItemRecord,
  EligibilityReport,
  GoogleAuthStatus,
  NotificationRecord,
  UserPublic,
} from '../shared/types.ts';
import { ApiError, api, isCrossSiteIframe } from './lib/api.ts';
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
  const [demoModeEnabled, setDemoModeEnabled] = useState<boolean>(true);
  const [books, setBooks] = useState<BookWithStats[]>([]);
  const [booksLoading, setBooksLoading] = useState(true);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [cartItems, setCartItems] = useState<CartItemRecord[]>([]);
  const [cartNotice, setCartNotice] = useState<{
    kind: 'success' | 'error';
    message: string;
  } | null>(null);

  const refreshSessionAndNotifications = async () => {
    try {
      const me = await api.getMe();
      setUser(me.user);
      setEligibility(me.eligibility);
      setGoogleAuth(me.googleAuth);
      setDemoModeEnabled(me.demoModeEnabled);

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

  const handleAuthenticated = async () => {
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
    const [notifRes, cartRes] = await Promise.all([
      api.getMyNotifications(),
      api.getCart(),
    ]);
    setNotifications(notifRes.notifications);
    setCartItems(cartRes.items);
    setPage(me.user.role === 'bibliothecaire' ? 'admin' : 'home');
  };

  const handleLogout = async () => {
    await api.logout();
    setUser(null);
    setEligibility(null);
    setNotifications([]);
    setCartItems([]);
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
            onOperationComplete={async () => {
              await Promise.all([refreshSessionAndNotifications(), refreshHomeBooks()]);
            }}
            onAddToCart={
              user?.role === 'bibliothecaire'
                ? undefined
                : async (id) => {
                    await handleAddToCart(id);
                  }
            }
            onGoToCart={() => navigate('cart')}
            onGoToLoans={() => navigate('loans')}
            onGoToReservations={() => navigate('reservations')}
          />
        )}

        {page === 'cart' && (
          <CartPage
            user={user}
            eligibility={eligibility}
            items={cartItems}
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
            onDataMutated={async () => {
              await Promise.all([refreshHomeBooks(), refreshSessionAndNotifications()]);
            }}
          />
        )}

        {page === 'auth' && (
          <AuthView
            googleAuth={googleAuth}
            demoModeEnabled={demoModeEnabled}
            onAuthenticated={handleAuthenticated}
          />
        )}
      </main>

      <footer className="border-t border-stone-200 bg-stone-50/60">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-xs text-stone-600 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p className="font-medium text-stone-800">
            BiblioEST · École Supérieure de Technologie de Fès — Université Sidi Mohamed Ben Abdellah
          </p>
          <p>
            Règlement : prêt de 7 jours · réservation chronologique FIFO · délai de retrait 3 jours
          </p>
        </div>
      </footer>
    </div>
  );
}
