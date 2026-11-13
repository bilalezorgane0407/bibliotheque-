import { useState } from 'react';
import { Search, ArrowRight, BookOpen } from 'lucide-react';
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
      {/* Section Héro Institutionnelle */}
      <section className="border-b border-stone-200 bg-stone-50/60">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
          <div className="grid gap-10 lg:grid-cols-12 items-stretch">
            <div className="lg:col-span-7 flex flex-col justify-between">
              <div>
                <p className="text-xs font-semibold tracking-wide text-emerald-900">
                  Université Sidi Mohamed Ben Abdellah · École Supérieure de Technologie de Fès
                </p>
                <h1 className="mt-3 font-editorial text-4xl font-semibold tracking-tight text-stone-950 sm:text-5xl text-balance leading-[1.12]">
                  Le fonds documentaire scientifique et technique de l’EST Fès
                </h1>
                <p className="mt-4 max-w-2xl text-base leading-relaxed text-stone-600">
                  Consultez la disponibilité réelle de chaque exemplaire physique, empruntez pour 7 jours ou inscrivez-vous dans la file d’attente chronologique FIFO.
                </p>
              </div>

              {/* Recherche principale + Filtres */}
              <form onSubmit={handleSubmit} className="mt-8 space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Rechercher par titre, auteur, ISBN, département ou cote…"
                      className="w-full rounded-lg border border-stone-300 bg-white py-3 pl-10 pr-4 text-sm text-stone-900 placeholder:text-stone-400 focus:border-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-800/15"
                    />
                  </div>
                  <button
                    type="submit"
                    className="whitespace-nowrap shrink-0 rounded-lg bg-emerald-900 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 cursor-pointer"
                  >
                    Rechercher
                  </button>
                </div>

                {/* Filtres interactifs par département & disponibilité */}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedDepartment('Toutes')}
                    className={`whitespace-nowrap shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
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
                      className={`whitespace-nowrap shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                        selectedDepartment === dep
                          ? 'bg-emerald-900 text-white'
                          : 'border border-stone-200 bg-white text-stone-700 hover:border-emerald-800'
                      }`}
                    >
                      {dep}
                    </button>
                  ))}

                  <label className="ml-auto inline-flex items-center gap-2 text-xs font-medium text-stone-700 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={availableOnly}
                      onChange={(e) => setAvailableOnly(e.target.checked)}
                      className="h-4 w-4 rounded border-stone-300 text-emerald-900 focus:ring-emerald-800"
                    />
                    Disponibles uniquement
                  </label>
                </div>
              </form>
            </div>

            {/* Photographie de la salle de lecture */}
            <div className="lg:col-span-5">
              <div className="h-full min-h-[260px] overflow-hidden rounded-xl border border-stone-200 bg-stone-100">
                <img
                  src="/src/assets/images/hero_library_est_1794527752777.jpg"
                  alt="Salle de lecture de la bibliothèque universitaire EST Fès – USMBA"
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
              </div>
            </div>
          </div>

          {/* Bandeau d'indicateurs réels issus de la base */}
          <div className="mt-10 grid grid-cols-2 gap-4 border-t border-stone-200 pt-8 sm:grid-cols-4">
            <div>
              <div className="font-mono text-2xl font-semibold text-emerald-950 tabular-nums">
                {books.length}
              </div>
              <div className="mt-0.5 text-xs text-stone-600">Titres catalogués</div>
            </div>
            <div>
              <div className="font-mono text-2xl font-semibold text-emerald-950 tabular-nums">
                {totalCopies}
              </div>
              <div className="mt-0.5 text-xs text-stone-600">Exemplaires en fonds actif</div>
            </div>
            <div>
              <div className="font-mono text-2xl font-semibold text-emerald-950 tabular-nums">
                {totalAvailable}
              </div>
              <div className="mt-0.5 text-xs text-stone-600">Exemplaires disponibles ce jour</div>
            </div>
            <div>
              <div className="font-mono text-2xl font-semibold text-emerald-950 tabular-nums">
                7 jours / 3 jours
              </div>
              <div className="mt-0.5 text-xs text-stone-600">Durée prêt / Délai retrait</div>
            </div>
          </div>
        </div>
      </section>

      {/* Ouvrages recommandés */}
      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between gap-4 border-b border-stone-200 pb-4">
          <div>
            <h2 className="font-editorial text-2xl font-semibold text-stone-950">
              Ouvrages recommandés par les départements
            </h2>
            <p className="mt-1 text-sm text-stone-600">
              Sélection de manuels essentiels pour les filières DUT et Licences Professionnelles.
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              onSearchCatalogue({ search: '', category: 'Toutes', availableOnly: false })
            }
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-900 hover:text-emerald-700 whitespace-nowrap shrink-0 cursor-pointer"
          >
            Tout le catalogue
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-96 animate-pulse rounded-xl border border-stone-200 bg-stone-100"
              />
            ))}
          </div>
        ) : featuredBooks.length === 0 ? (
          <div className="mt-8 rounded-xl border border-stone-200 p-8 text-center text-sm text-stone-600">
            <BookOpen className="mx-auto h-8 w-8 text-stone-400" />
            <p className="mt-2">Aucun ouvrage recommandé n’est enregistré pour le moment.</p>
          </div>
        ) : (
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {featuredBooks.map((book) => (
              <BookCard key={book.id} book={book} onSelect={onOpenBook} />
            ))}
          </div>
        )}
      </section>

      {/* Ajouts récents */}
      <section className="mx-auto max-w-7xl px-4 pb-16 pt-4 sm:px-6 lg:px-8">
        <div className="border-b border-stone-200 pb-4">
          <h2 className="font-editorial text-2xl font-semibold text-stone-950">
            Acquisitions récentes
          </h2>
          <p className="mt-1 text-sm text-stone-600">
            Derniers titres intégrés au rayonnage de la bibliothèque de l’EST Fès.
          </p>
        </div>

        {!loading && recentBooks.length > 0 && (
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {recentBooks.map((book) => (
              <BookCard key={book.id} book={book} onSelect={onOpenBook} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
