import { useEffect, useState } from 'react';
import type {
  BookWithStats,
  EligibilityReport,
  NotificationRecord,
  SsoAdapterStatus,
  UserPublic,
} from '../shared/types.ts';
import { ApiError, api, isCrossSiteIframe } from './lib/api.ts';
import { Navbar, type AppPage } from './components/Navbar.tsx';
import { HomePage } from './components/HomePage.tsx';
import { CataloguePage } from './components/CataloguePage.tsx';
import { BookDetailPage } from './components/BookDetailPage.tsx';
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
  const [sso, setSso] = useState<SsoAdapterStatus | null>(null);
  const [books, setBooks] = useState<BookWithStats[]>([]);
  const [booksLoading, setBooksLoading] = useState(true);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);

  const refreshSessionAndNotifications = async () => {
    try {
      const me = await api.getMe();
      setUser(me.user);
      setEligibility(me.eligibility);
      setSso(me.sso);

      if (me.user) {
        const notifRes = await api.getMyNotifications();
        setNotifications(notifRes.notifications);
      } else {
        setNotifications([]);
      }
    } catch {
      setUser(null);
      setEligibility(null);
      setNotifications([]);
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
    // Garde front-end : un étudiant ne peut pas ouvrir la vue administration
    if (nextPage === 'admin' && user?.role !== 'bibliothecaire') {
      setPage(user ? 'home' : 'auth');
      return;
    }
    setPage(nextPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openBook = (bookId: string) => {
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
    setSso(me.sso);
    const notifRes = await api.getMyNotifications();
    setNotifications(notifRes.notifications);
    setPage(me.user.role === 'bibliothecaire' ? 'admin' : 'home');
  };

  const handleLogout = async () => {
    await api.logout();
    setUser(null);
    setEligibility(null);
    setNotifications([]);
    setPage('home');
  };

  const unreadNotificationsCount = notifications.filter((n) => !n.readAt).length;

  return (
    <div className="min-h-screen flex flex-col bg-white text-stone-900">
      <Navbar
        currentPage={page}
        user={user}
        unreadNotificationsCount={unreadNotificationsCount}
        onNavigate={navigate}
      />

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
            onOpenBook={openBook}
          />
        )}

        {page === 'book' && selectedBookId && (
          <BookDetailPage
            bookId={selectedBookId}
            user={user}
            eligibility={eligibility}
            onBack={() => navigate('catalogue')}
            onRequireAuth={() => navigate('auth')}
            onOperationComplete={async () => {
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
            sso={sso}
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
          <AuthView sso={sso} onAuthenticated={handleAuthenticated} />
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
