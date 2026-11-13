import { Menu, X } from 'lucide-react';
import { useState } from 'react';
import type { UserPublic } from '../../shared/types.ts';

export type AppPage =
  | 'home'
  | 'catalogue'
  | 'book'
  | 'loans'
  | 'reservations'
  | 'profile'
  | 'admin'
  | 'auth';

interface NavbarProps {
  currentPage: AppPage;
  user: UserPublic | null;
  unreadNotificationsCount: number;
  onNavigate: (page: AppPage) => void;
}

export function Navbar({
  currentPage,
  user,
  unreadNotificationsCount,
  onNavigate,
}: NavbarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

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
        { id: 'loans', label: 'Mes emprunts' },
        { id: 'reservations', label: 'Mes réservations' },
        { id: 'profile', label: 'Mon profil' },
      ];

  const handleNav = (page: AppPage) => {
    setMobileOpen(false);
    onNavigate(page);
  };

  return (
    <header className="sticky top-0 z-40 border-b border-stone-200 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-8 px-4 sm:px-6 lg:px-8">
        {/* Zone 1 : Wordmark unique sur une ligne */}
        <button
          type="button"
          onClick={() => handleNav('home')}
          className="font-editorial text-xl font-bold tracking-tight text-emerald-950 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-800"
        >
          BiblioEST
        </button>

        {/* Zone 2 : Liens de navigation concis sur une ligne */}
        <nav
          aria-label="Navigation principale"
          className="hidden md:flex items-center gap-7 text-sm font-medium"
        >
          {navItems.map((item) => {
            const active = currentPage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNav(item.id)}
                className={`whitespace-nowrap shrink-0 py-1 transition-colors cursor-pointer border-b-2 ${
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

        {/* Zone 3 : Action principale unique */}
        <div className="hidden md:flex items-center shrink-0">
          {user ? (
            <button
              type="button"
              onClick={() => handleNav('profile')}
              className="whitespace-nowrap shrink-0 rounded-lg bg-emerald-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-800 cursor-pointer tabular-nums"
            >
              {unreadNotificationsCount > 0
                ? `Notifications (${unreadNotificationsCount})`
                : 'Espace membre'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleNav('auth')}
              className="whitespace-nowrap shrink-0 rounded-lg bg-emerald-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-800 cursor-pointer"
            >
              Se connecter
            </button>
          )}
        </div>

        {/* Bouton menu mobile */}
        <button
          type="button"
          onClick={() => setMobileOpen((prev) => !prev)}
          aria-label={mobileOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
          className="md:hidden inline-flex h-11 w-11 items-center justify-center rounded-lg border border-stone-200 text-stone-700 hover:bg-stone-50"
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Menu mobile */}
      {mobileOpen && (
        <div className="md:hidden border-t border-stone-200 bg-white px-4 py-4 space-y-2">
          {navItems.map((item) => {
            const active = currentPage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNav(item.id)}
                className={`block w-full text-left rounded-lg px-3 py-2.5 text-sm font-medium ${
                  active
                    ? 'bg-emerald-50 text-emerald-950 font-semibold'
                    : 'text-stone-700 hover:bg-stone-50'
                }`}
              >
                {item.label}
              </button>
            );
          })}
          <div className="pt-2 border-t border-stone-100">
            {user ? (
              <button
                type="button"
                onClick={() => handleNav('profile')}
                className="w-full rounded-lg bg-emerald-900 px-4 py-2.5 text-sm font-semibold text-white"
              >
                {unreadNotificationsCount > 0
                  ? `Notifications (${unreadNotificationsCount})`
                  : 'Mon compte USMBA'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleNav('auth')}
                className="w-full rounded-lg bg-emerald-900 px-4 py-2.5 text-sm font-semibold text-white"
              >
                Se connecter
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
