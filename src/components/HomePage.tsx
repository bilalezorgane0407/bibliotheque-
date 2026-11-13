import { useState } from 'react';
import { ArrowRight, BookOpen, CheckCircle2, Search } from 'lucide-react';
import { EST_DEPARTMENTS, type BookWithStats } from '../../shared/types.ts';
import { BookCard } from './BookCard.tsx';

interface HomePageProps {
  books: BookWithStats[];
  loading: boolean;
  onOpenBook: (bookId: string) => void;
  onSearchCatalogue: (params: {
    search: string;
    category: string;
    availableOnly: boolean;
  }) => void;
}

export function HomePage({
  books,
  loading,
  onOpenBook,
  onSearchCatalogue,
}: HomePageProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('Toutes');
  const [availableOnly, setAvailableOnly] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearchCatalogue({
      search: searchQuery,
      category: selectedDepartment,
      availableOnly,
    });
  };

  const featuredBooks = books.filter((b) => b.featured).slice(0, 4);
  const recentBooks = [...books]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 4);

  const totalAvailable = books.reduce((sum, b) => sum + b.availableCopies, 0);
  const totalCopies = books.reduce((sum, b) => sum + b.totalCopies, 0);

  return (
    <div>
      {/* Section d'introduction compacte orientée recherche et actions rapides */}
      <section className="border-b border-stone-200 bg-stone-50/60">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
          <div className="grid gap-8 lg:grid-cols-12 items-center">
            <div className="lg:col-span-7">
              <p className="text-xs font-semibold text-emerald-900">
                USMBA · École Supérieure de Technologie de Fès
              </p>
              <h1 className="mt-1.5 font-editorial text-2xl font-semibold tracking-tight text-stone-950 sm:text-4xl text-balance leading-[1.15]">
                Fonds documentaire de l’EST Fès
              </h1>
              <p className="mt-2 max-w-2xl text-sm sm:text-base leading-relaxed text-stone-600">
                Vérifiez la disponibilité réelle en rayon, empruntez pour 7 jours ou rejoignez la file d’attente FIFO.
              </p>

              {/* Recherche principale + filtres rapides */}
              <form onSubmit={handleSubmit} className="mt-5 space-y-3">
                <div className="flex flex-col gap-2.5 sm:flex-row">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                    <input
                      type="search"
                      aria-label="Rechercher un ouvrage"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Titre, auteur, ISBN ou cote…"
                      className="w-full min-h-[44px] rounded-lg border border-stone-300 bg-white py-2.5 pl-10 pr-4 text-sm text-stone-900 placeholder:text-stone-400 focus:border-emerald-800"
                    />
                  </div>
                  <button
                    type="submit"
                    className="whitespace-nowrap shrink-0 min-h-[44px] rounded-lg bg-emerald-900 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 cursor-pointer"
                  >
                    Rechercher
                  </button>
                </div>

                {/* Sélecteur compact sur téléphone */}
                <div className="flex flex-col gap-2.5 sm:hidden">
                  <select
                    aria-label="Filtrer par département"
                    value={selectedDepartment}
                    onChange={(e) => setSelectedDepartment(e.target.value)}
                    className="w-full min-h-[44px] rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900"
                  >
                    <option value="Toutes">Tous les départements</option>
                    {EST_DEPARTMENTS.map((dep) => (
                      <option key={dep} value={dep}>
                        {dep}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Boutons de département sur tablette/desktop */}
                <div className="hidden sm:flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedDepartment('Toutes')}
                    className={`whitespace-nowrap shrink-0 min-h-[36px] rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                      selectedDepartment === 'Toutes'
                        ? 'bg-emerald-900 text-white'
                        : 'border border-stone-200 bg-white text-stone-700 hover:border-emerald-800'
                    }`}
                  >
                    Tous les départements
                  </button>
                  {EST_DEPARTMENTS.map((dep) => (
                    <button
                      key={dep}
                      type="button"
                      onClick={() => setSelectedDepartment(dep)}
                      className={`whitespace-nowrap shrink-0 min-h-[36px] rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                        selectedDepartment === dep
                          ? 'bg-emerald-900 text-white'
                          : 'border border-stone-200 bg-white text-stone-700 hover:border-emerald-800'
                      }`}
                    >
                      {dep}
                    </button>
                  ))}
                </div>

                {/* Actions fréquentes + case Disponibles */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <label className="inline-flex min-h-[40px] items-center gap-2 text-xs sm:text-sm font-medium text-stone-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={availableOnly}
                      onChange={(e) => setAvailableOnly(e.target.checked)}
                      className="h-4 w-4 rounded border-stone-300 text-emerald-900"
                    />
                    Disponibles uniquement
                  </label>

                  <div className="flex flex-wrap items-center gap-4 text-xs sm:text-sm">
                    <button
                      type="button"
                      onClick={() =>
                        onSearchCatalogue({
                          search: '',
                          category: 'Toutes',
                          availableOnly: true,
                        })
                      }
                      className="inline-flex min-h-[40px] items-center gap-1.5 font-semibold text-emerald-900 hover:text-emerald-700 cursor-pointer"
                    >
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      Disponibles ({totalAvailable})
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onSearchCatalogue({
                          search: '',
                          category: 'Toutes',
                          availableOnly: false,
                        })
                      }
                      className="inline-flex min-h-[40px] items-center gap-1.5 font-semibold text-stone-800 hover:text-emerald-900 cursor-pointer"
                    >
                      Tout le catalogue
                      <ArrowRight className="h-4 w-4 shrink-0" />
                    </button>
                  </div>
                </div>
              </form>
            </div>

            {/* Photographie de la salle de lecture (affichée sur grand écran pour garder la recherche visible d'emblée sur mobile) */}
            <div className="hidden lg:block lg:col-span-5">
              <div className="h-64 xl:h-72 overflow-hidden rounded-xl border border-stone-200 bg-stone-100">
                <img
                  src="/src/assets/images/hero_library_est_1794527752777.jpg"
                  alt="Salle de lecture de la bibliothèque universitaire EST Fès – USMBA"
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Ouvrages recommandés */}
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-stone-200 pb-3.5">
          <div>
            <h2 className="font-editorial text-xl sm:text-2xl font-semibold text-stone-950">
              Ouvrages recommandés
            </h2>
            <p className="mt-0.5 text-xs sm:text-sm text-stone-600">
              Manuels essentiels sélectionnés par les départements.
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              onSearchCatalogue({ search: '', category: 'Toutes', availableOnly: false })
            }
            className="inline-flex min-h-[40px] items-center gap-1.5 text-xs sm:text-sm font-semibold text-emerald-900 hover:text-emerald-700 whitespace-nowrap shrink-0 cursor-pointer"
          >
            Tout le catalogue
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-36 sm:h-80 animate-pulse rounded-xl border border-stone-200 bg-stone-100"
              />
            ))}
          </div>
        ) : featuredBooks.length === 0 ? (
          <div className="mt-6 rounded-xl border border-stone-200 p-8 text-center text-sm text-stone-600">
            <BookOpen className="mx-auto h-8 w-8 text-stone-400" />
            <p className="mt-2">Aucun ouvrage recommandé n’est enregistré pour le moment.</p>
          </div>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-4">
            {featuredBooks.map((book) => (
              <BookCard key={book.id} book={book} onSelect={onOpenBook} />
            ))}
          </div>
        )}
      </section>

      {/* Ajouts récents */}
      <section className="mx-auto max-w-7xl px-4 pb-10 pt-2 sm:px-6 lg:px-8">
        <div className="border-b border-stone-200 pb-3.5">
          <h2 className="font-editorial text-xl sm:text-2xl font-semibold text-stone-950">
            Acquisitions récentes
          </h2>
          <p className="mt-0.5 text-xs sm:text-sm text-stone-600">
            Derniers titres intégrés au rayonnage de l’EST Fès.
          </p>
        </div>

        {!loading && recentBooks.length > 0 && (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-4">
            {recentBooks.map((book) => (
              <BookCard key={book.id} book={book} onSelect={onOpenBook} />
            ))}
          </div>
        )}
      </section>

      {/* Indicateurs secondaires compacts */}
      <section
        aria-label="Repères du fonds documentaire"
        className="border-t border-stone-200 bg-stone-50/50"
      >
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <div className="font-mono text-lg sm:text-xl font-semibold text-emerald-950 tabular-nums">
                {books.length}
              </div>
              <div className="text-xs text-stone-600">Titres catalogués</div>
            </div>
            <div>
              <div className="font-mono text-lg sm:text-xl font-semibold text-emerald-950 tabular-nums">
                {totalCopies}
              </div>
              <div className="text-xs text-stone-600">Exemplaires actifs</div>
            </div>
            <div>
              <div className="font-mono text-lg sm:text-xl font-semibold text-emerald-950 tabular-nums">
                {totalAvailable}
              </div>
              <div className="text-xs text-stone-600">Disponibles ce jour</div>
            </div>
            <div>
              <div className="font-mono text-lg sm:text-xl font-semibold text-emerald-950 tabular-nums">
                7 j / 3 j
              </div>
              <div className="text-xs text-stone-600">Prêt / Délai retrait</div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
