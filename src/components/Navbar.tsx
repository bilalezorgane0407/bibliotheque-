import { Menu, ShoppingBag, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { UserPublic } from '../../shared/types.ts';

export type AppPage =
  | 'home'
  | 'catalogue'
  | 'book'
  | 'cart'
  | 'loans'
  | 'reservations'
  | 'profile'
  | 'admin'
  | 'auth';

interface NavbarProps {
  currentPage: AppPage;
  user: UserPublic | null;
  unreadNotificationsCount: number;
  cartCount: number;
  onNavigate: (page: AppPage) => void;
}

export function Navbar({
  currentPage,
  user,
  unreadNotificationsCount,
  cartCount,
  onNavigate,
}: NavbarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const isLibrarian = user?.role === 'bibliothecaire';

  const navItems: Array<{ id: AppPage; label: string }> = isLibrarian
    ? [
        { id: 'home', label: 'Accueil' },
        { id: 'catalogue', label: 'Catalogue' },
        { id: 'admin', label: 'Administration' },
        { id: 'profile', label: 'Mon profil' },
      ]
    : [
        { id: 'home', label: 'Accueil' },
        { id: 'catalogue', label: 'Catalogue' },
        { id: 'cart', label: cartCount > 0 ? `Panier (${cartCount})` : 'Panier' },
        { id: 'loans', label: 'Mes emprunts' },
        { id: 'reservations', label: 'Mes demandes' },
        { id: 'profile', label: 'Mon profil' },
      ];

  const handleNav = (page: AppPage) => {
    setMobileOpen(false);
    onNavigate(page);
  };

  useEffect(() => {
    if (!mobileOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileOpen(false);
        menuButtonRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [mobileOpen]);

  const primaryActionLabel = user
    ? unreadNotificationsCount > 0
      ? `Notifications (${unreadNotificationsCount})`
      : 'Espace membre'
    : 'Se connecter';

  const primaryActionTarget: AppPage = user ? 'profile' : 'auth';

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-stone-200 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 sm:h-16 max-w-7xl items-center justify-between gap-3 md:gap-4 lg:gap-8 px-4 sm:px-6 lg:px-8">
          {/* Zone 1 : Wordmark unique sur une ligne */}
          <button
            type="button"
            onClick={() => handleNav('home')}
            className="font-editorial text-xl font-bold tracking-tight text-emerald-950 whitespace-nowrap shrink-0 cursor-pointer py-1"
          >
            BiblioEST
          </button>

          {/* Zone 2 : Liens de navigation concis sur une ligne (tablette / desktop) */}
          <nav
            aria-label="Navigation principale"
            className="hidden md:flex items-center gap-3.5 lg:gap-6 text-xs lg:text-sm font-medium"
          >
            {navItems.map((item) => {
              const active = currentPage === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNav(item.id)}
                  aria-current={active ? 'page' : undefined}
                  className={`whitespace-nowrap shrink-0 py-1.5 transition-colors cursor-pointer border-b-2 tabular-nums ${
                    active
                      ? 'border-emerald-900 text-emerald-950 font-semibold'
                      : 'border-transparent text-stone-600 hover:text-emerald-900 hover:border-stone-300'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3 : Action principale + bouton menu mobile */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => handleNav(primaryActionTarget)}
              className="whitespace-nowrap shrink-0 max-w-[148px] sm:max-w-none truncate rounded-lg bg-emerald-900 px-3 sm:px-4 min-h-[40px] md:min-h-[38px] text-xs font-semibold text-white transition-colors hover:bg-emerald-800 cursor-pointer tabular-nums inline-flex items-center justify-center"
            >
              {primaryActionLabel}
            </button>

            <button
              ref={menuButtonRef}
              type="button"
              onClick={() => setMobileOpen((prev) => !prev)}
              aria-label={mobileOpen ? 'Fermer le menu de navigation' : 'Ouvrir le menu de navigation'}
              aria-expanded={mobileOpen}
              aria-controls="mobile-nav-drawer"
              className="md:hidden inline-flex h-11 w-11 items-center justify-center rounded-lg border border-stone-200 bg-white text-stone-800 hover:bg-stone-50 cursor-pointer"
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </header>

      {/* Tiroir mobile superposé (ne pousse pas la page et n'ajoute pas de barre fixe) */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            aria-hidden="true"
            onClick={() => {
              setMobileOpen(false);
              menuButtonRef.current?.focus();
            }}
            className="fixed inset-0 bg-stone-950/40 backdrop-blur-[1px]"
          />

          <nav
            id="mobile-nav-drawer"
            aria-label="Menu mobile"
            className="fixed inset-y-0 right-0 flex w-72 max-w-[85vw] flex-col bg-white border-l border-stone-200 shadow-xl"
          >
            <div className="flex h-14 items-center justify-between border-b border-stone-200 px-4">
              <span className="font-editorial text-lg font-bold text-emerald-950">
                Navigation
              </span>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => {
                  setMobileOpen(false);
                  menuButtonRef.current?.focus();
                }}
                aria-label="Fermer le menu"
                className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-stone-700 hover:bg-stone-100 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 space-y-1 p-3 overflow-y-auto">
              {navItems.map((item) => {
                const active = currentPage === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNav(item.id)}
                    aria-current={active ? 'page' : undefined}
                    className={`flex w-full min-h-[44px] items-center justify-between rounded-lg px-3.5 py-2.5 text-left text-sm transition-colors cursor-pointer tabular-nums ${
                      active
                        ? 'bg-emerald-50 text-emerald-950 font-semibold'
                        : 'text-stone-700 font-medium hover:bg-stone-50'
                    }`}
                  >
                    <span className="inline-flex items-center gap-2">
                      {item.id === 'cart' && <ShoppingBag className="h-4 w-4 shrink-0 text-emerald-900" />}
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="border-t border-stone-200 p-4">
              {user ? (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-stone-900 truncate">{user.fullName}</p>
                  <button
                    type="button"
                    onClick={() => handleNav('profile')}
                    className="w-full min-h-[44px] rounded-lg bg-emerald-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 cursor-pointer tabular-nums"
                  >
                    {unreadNotificationsCount > 0
                      ? `Notifications (${unreadNotificationsCount})`
                      : 'Mon compte USMBA'}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => handleNav('auth')}
                  className="w-full min-h-[44px] rounded-lg bg-emerald-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 cursor-pointer"
                >
                  Se connecter
                </button>
              )}
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
