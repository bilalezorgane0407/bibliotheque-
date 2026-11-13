import { useEffect, useState } from 'react';
import {
  ArrowUp,
  BookX,
  RotateCcw,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import {
  BOOK_LANGUAGES,
  EST_DEPARTMENTS,
  type BookWithStats,
} from '../../shared/types.ts';
import { api, ApiError } from '../lib/api.ts';
import { BookCard } from './BookCard.tsx';

interface CataloguePageProps {
  initialFilters?: {
    search?: string;
    category?: string;
    availableOnly?: boolean;
  };
  cartBookIds?: Set<string>;
  cartCount?: number;
  onOpenBook: (bookId: string) => void;
  onAddToCart?: (bookId: string) => Promise<void> | void;
  onGoToCart?: () => void;
}

export function CataloguePage({
  initialFilters,
  cartBookIds,
  cartCount = 0,
  onOpenBook,
  onAddToCart,
  onGoToCart,
}: CataloguePageProps) {
  const [search, setSearch] = useState(initialFilters?.search || '');
  const [category, setCategory] = useState(initialFilters?.category || 'Toutes');
  const [language, setLanguage] = useState('Toutes');
  const [year, setYear] = useState<string>('');
  const [availableOnly, setAvailableOnly] = useState(
    Boolean(initialFilters?.availableOnly)
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [books, setBooks] = useState<BookWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialFilters) {
      if (initialFilters.search !== undefined) setSearch(initialFilters.search);
      if (initialFilters.category !== undefined) setCategory(initialFilters.category);
      if (initialFilters.availableOnly !== undefined)
        setAvailableOnly(initialFilters.availableOnly);
    }
  }, [initialFilters]);

  const fetchCatalogue = async () => {
    setLoading(true);
    setError(null);
    try {
      const parsedYear = year ? Number(year) : null;
      const res = await api.listBooks({
        search: search.trim() || undefined,
        category,
        language,
        year: parsedYear,
        availableOnly,
      });
      setBooks(res.books);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Impossible de charger le catalogue.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchCatalogue();
    }, 180);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, category, language, year, availableOnly]);

  const resetFilters = () => {
    setSearch('');
    setCategory('Toutes');
    setLanguage('Toutes');
    setYear('');
    setAvailableOnly(false);
  };

  const activeFiltersCount =
    (category !== 'Toutes' ? 1 : 0) +
    (language !== 'Toutes' ? 1 : 0) +
    (year.trim() ? 1 : 0) +
    (availableOnly ? 1 : 0);

  const hasAnyFilter = Boolean(search.trim()) || activeFiltersCount > 0;

  return (
    <div id="catalogue-top" className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="border-b border-stone-200 pb-4 sm:pb-5">
        <p className="text-xs font-semibold text-emerald-900">
          Bibliothèque EST Fès · Consultation du fonds
        </p>
        <h1 className="mt-1 font-editorial text-2xl sm:text-3xl font-semibold text-stone-950">
          Catalogue des ouvrages
        </h1>
      </div>

      {/* Barre de recherche immédiate + tiroir de filtres repliable sur mobile */}
      <div className="mt-5 rounded-xl border border-stone-200 bg-stone-50/70 p-3.5 sm:p-5">
        <div className="flex flex-col gap-3 md:grid md:grid-cols-12 md:gap-4">
          <div className="flex gap-2 md:col-span-5">
            <div className="relative flex-1 min-w-0">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
              <input
                type="search"
                aria-label="Rechercher dans le catalogue"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Titre, auteur, ISBN, cote…"
                className="w-full min-h-[44px] rounded-lg border border-stone-300 bg-white py-2.5 pl-10 pr-9 text-sm text-stone-900 focus:border-emerald-800"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="Effacer la recherche"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-md text-stone-500 hover:bg-stone-100 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setFiltersOpen((prev) => !prev)}
              aria-expanded={filtersOpen}
              aria-controls="catalogue-filters-panel"
              className={`md:hidden inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border px-3.5 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer ${
                filtersOpen || activeFiltersCount > 0
                  ? 'border-emerald-800 bg-emerald-50 text-emerald-950'
                  : 'border-stone-300 bg-white text-stone-800'
              }`}
            >
              <SlidersHorizontal className="h-4 w-4" />
              <span>Filtres{activeFiltersCount > 0 ? ` (${activeFiltersCount})` : ''}</span>
            </button>
          </div>

          {/* Filtres secondaires : repliables sur mobile, visibles sur tablette/desktop */}
          <div
            id="catalogue-filters-panel"
            className={`${
              filtersOpen ? 'grid' : 'hidden'
            } gap-3 md:col-span-7 md:grid md:grid-cols-7 md:gap-3`}
          >
            <div className="md:col-span-3">
              <select
                aria-label="Filtrer par département"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full min-h-[44px] rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900"
              >
                <option value="Toutes">Tous les départements</option>
                {EST_DEPARTMENTS.map((dep) => (
                  <option key={dep} value={dep}>
                    {dep}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2">
              <select
                aria-label="Filtrer par langue"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full min-h-[44px] rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900"
              >
                <option value="Toutes">Toutes langues</option>
                {BOOK_LANGUAGES.map((lang) => (
                  <option key={lang} value={lang}>
                    {lang}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2">
              <input
                type="number"
                min={1980}
                max={2030}
                value={year}
                onChange={(e) => setYear(e.target.value)}
                placeholder="Année"
                aria-label="Année de publication"
                className="w-full min-h-[44px] rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm font-mono tabular-nums text-stone-900"
              />
            </div>

            <div className="md:hidden pt-1">
              <label className="inline-flex min-h-[40px] items-center gap-2 text-sm font-medium text-stone-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={availableOnly}
                  onChange={(e) => setAvailableOnly(e.target.checked)}
                  className="h-4 w-4 rounded border-stone-300 text-emerald-900"
                />
                Disponibles uniquement
              </label>
            </div>
          </div>
        </div>

        <div className="mt-3 pt-3 border-t border-stone-200 flex flex-wrap items-center justify-between gap-3">
          <label className="hidden md:inline-flex items-center gap-2 text-sm font-medium text-stone-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={availableOnly}
              onChange={(e) => setAvailableOnly(e.target.checked)}
              className="h-4 w-4 rounded border-stone-300 text-emerald-900"
            />
            Afficher uniquement les ouvrages disponibles
          </label>

          <div className="flex flex-wrap items-center gap-3 text-xs text-stone-600 md:ml-auto">
            <span className="font-mono tabular-nums font-medium text-stone-800">
              {books.length} ouvrage{books.length > 1 ? 's' : ''} trouvé{books.length > 1 ? 's' : ''}
            </span>
            {availableOnly && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-emerald-900 font-medium md:hidden">Disponibles uniquement</span>
              </>
            )}
            {cartCount > 0 && onGoToCart && (
              <button
                type="button"
                onClick={onGoToCart}
                className="inline-flex min-h-[36px] items-center gap-1.5 font-semibold text-emerald-900 hover:underline cursor-pointer tabular-nums"
              >
                <ShoppingBag className="h-3.5 w-3.5" />
                Panier ({cartCount})
              </button>
            )}
            {hasAnyFilter && (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex min-h-[36px] items-center gap-1.5 text-xs font-semibold text-emerald-900 hover:text-emerald-700 cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Réinitialiser
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Résultats */}
      {error ? (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-900">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => void fetchCatalogue()}
            className="mt-3 min-h-[40px] rounded-lg bg-red-900 px-4 py-2 text-xs font-semibold text-white cursor-pointer"
          >
            Réessayer
          </button>
        </div>
      ) : loading ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-36 sm:h-80 animate-pulse rounded-xl border border-stone-200 bg-stone-100"
            />
          ))}
        </div>
      ) : books.length === 0 ? (
        <div className="mt-6 rounded-xl border border-stone-200 bg-white p-8 sm:p-12 text-center">
          <BookX className="mx-auto h-10 w-10 text-stone-400" />
          <h2 className="mt-3 font-editorial text-xl font-semibold text-stone-900">
            Aucun ouvrage ne correspond à vos critères
          </h2>
          <p className="mt-1 text-sm text-stone-600">
            Essayez d’élargir les filtres de département, d’année ou de disponibilité.
          </p>
          <button
            type="button"
            onClick={resetFilters}
            className="mt-5 min-h-[44px] rounded-lg bg-emerald-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 cursor-pointer"
          >
            Voir tout le catalogue
          </button>
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3 xl:grid-cols-4">
            {books.map((book) => (
              <BookCard
                key={book.id}
                book={book}
                inCart={cartBookIds?.has(book.id)}
                onSelect={onOpenBook}
                onAddToCart={onAddToCart}
                onGoToCart={onGoToCart}
              />
            ))}
          </div>

          {books.length > 6 && (
            <div className="mt-8 flex justify-center">
              <button
                type="button"
                onClick={() => {
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-stone-300 bg-white px-4 py-2 text-xs font-semibold text-stone-800 hover:bg-stone-50 cursor-pointer"
              >
                <ArrowUp className="h-4 w-4" />
                Revenir à la recherche
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
