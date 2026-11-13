import { useEffect, useState } from 'react';
import { BookX, RotateCcw, Search } from 'lucide-react';
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
  onOpenBook: (bookId: string) => void;
}

export function CataloguePage({ initialFilters, onOpenBook }: CataloguePageProps) {
  const [search, setSearch] = useState(initialFilters?.search || '');
  const [category, setCategory] = useState(initialFilters?.category || 'Toutes');
  const [language, setLanguage] = useState('Toutes');
  const [year, setYear] = useState<string>('');
  const [availableOnly, setAvailableOnly] = useState(
    Boolean(initialFilters?.availableOnly)
  );
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

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="border-b border-stone-200 pb-6">
        <p className="text-xs font-semibold text-emerald-900">
          Bibliothèque EST Fès · Consultation du fonds
        </p>
        <h1 className="mt-1 font-editorial text-3xl font-semibold text-stone-950">
          Catalogue des ouvrages
        </h1>
        <p className="mt-2 text-sm text-stone-600">
          Recherchez par titre, auteur, ISBN, département ou cote de rayonnage et vérifiez l’état de chaque exemplaire.
        </p>
      </div>

      {/* Barre de recherche et filtres */}
      <div className="mt-6 rounded-xl border border-stone-200 bg-stone-50/60 p-5">
        <div className="grid gap-4 md:grid-cols-12">
          <div className="md:col-span-5 relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Titre, auteur, ISBN, cote (ex. INF-01-A)…"
              className="w-full rounded-lg border border-stone-300 bg-white py-2.5 pl-10 pr-4 text-sm text-stone-900 focus:border-emerald-800 focus:outline-none"
            />
          </div>

          <div className="md:col-span-3">
            <select
              aria-label="Filtrer par département"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 focus:border-emerald-800 focus:outline-none"
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
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 focus:border-emerald-800 focus:outline-none"
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
              placeholder="Année (ex. 2024)"
              aria-label="Année de publication"
              className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm font-mono tabular-nums text-stone-900 focus:border-emerald-800 focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-stone-200 pt-4">
          <label className="inline-flex items-center gap-2 text-sm font-medium text-stone-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={availableOnly}
              onChange={(e) => setAvailableOnly(e.target.checked)}
              className="h-4 w-4 rounded border-stone-300 text-emerald-900 focus:ring-emerald-800"
            />
            Afficher uniquement les ouvrages ayant au moins un exemplaire disponible
          </label>

          <div className="flex items-center gap-4">
            <span className="text-xs font-mono text-stone-600 tabular-nums">
              {books.length} ouvrage{books.length > 1 ? 's' : ''} trouvé{books.length > 1 ? 's' : ''}
            </span>
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-900 hover:text-emerald-700 cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Réinitialiser
            </button>
          </div>
        </div>
      </div>

      {/* Résultats */}
      {error ? (
        <div className="mt-8 rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-900">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => void fetchCatalogue()}
            className="mt-3 rounded-lg bg-red-900 px-4 py-2 text-xs font-semibold text-white cursor-pointer"
          >
            Réessayer
          </button>
        </div>
      ) : loading ? (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-96 animate-pulse rounded-xl border border-stone-200 bg-stone-100"
            />
          ))}
        </div>
      ) : books.length === 0 ? (
        <div className="mt-8 rounded-xl border border-stone-200 bg-white p-12 text-center">
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
            className="mt-5 rounded-lg bg-emerald-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 cursor-pointer"
          >
            Voir tout le catalogue
          </button>
        </div>
      ) : (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {books.map((book) => (
            <BookCard key={book.id} book={book} onSelect={onOpenBook} />
          ))}
        </div>
      )}
    </div>
  );
}
