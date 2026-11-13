import { ArrowRight, CheckCircle2, Clock, ShoppingBag } from 'lucide-react';
import type { BookWithStats } from '../../shared/types.ts';
import { BookCover } from './BookCover.tsx';

interface BookCardProps {
  book: BookWithStats;
  inCart?: boolean;
  onSelect: (bookId: string) => void;
  onAddToCart?: (bookId: string) => Promise<void> | void;
  onGoToCart?: () => void;
}

export function BookCard({
  book,
  inCart = false,
  onSelect,
  onAddToCart,
  onGoToCart,
}: BookCardProps) {
  const isAvailable = book.availableCopies > 0;
  const canReserve = !isAvailable && book.circulatingCopies > 0;
  const canRequest = isAvailable || canReserve;

  return (
    <article className="group flex flex-row sm:flex-col overflow-hidden rounded-xl border border-stone-200 bg-white transition-colors hover:border-emerald-800/60">
      {/* Couverture cliquable : vignette compacte à gauche sur mobile, grand format vertical sur >= sm */}
      <button
        type="button"
        onClick={() => onSelect(book.id)}
        aria-label={`Consulter la fiche de ${book.title}`}
        className="w-24 shrink-0 sm:w-full aspect-[3/4] overflow-hidden border-r sm:border-r-0 sm:border-b border-stone-100 bg-stone-50 cursor-pointer block"
      >
        <BookCover
          src={book.coverImage}
          alt={`Couverture de ${book.title}`}
          title={book.title}
          category={book.category}
          className="h-full w-full transition-transform duration-200 group-hover:scale-[1.02]"
        />
      </button>

      <div className="flex flex-1 min-w-0 flex-col justify-between p-3.5 sm:p-5">
        <div>
          {/* Métadonnées sans pilules : texte propre avec séparateurs typographiques */}
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-stone-500">
            <span className="font-medium text-emerald-900 truncate max-w-full">
              {book.category}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{book.publicationYear}</span>
            <span aria-hidden="true" className="hidden sm:inline">·</span>
            <span className="font-mono hidden sm:inline">{book.shelfLocation}</span>
          </div>

          <h3 className="mt-1.5 sm:mt-2 font-editorial text-base sm:text-lg font-semibold leading-snug text-stone-900 group-hover:text-emerald-950">
            <button
              type="button"
              onClick={() => onSelect(book.id)}
              className="text-left line-clamp-2 hover:text-emerald-900 cursor-pointer"
            >
              {book.title}
            </button>
          </h3>
          <p className="mt-0.5 sm:mt-1 text-xs sm:text-sm text-stone-600 line-clamp-1">
            {book.authors}
          </p>
        </div>

        <div className="mt-3 sm:mt-4 space-y-2.5 border-t border-stone-100 pt-2.5 sm:pt-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {isAvailable ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 tabular-nums">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                <span>
                  {book.availableCopies} dispo{book.availableCopies > 1 ? 's' : ''} / {book.totalCopies}
                </span>
              </span>
            ) : canReserve ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800 tabular-nums">
                <Clock className="h-3.5 w-3.5 shrink-0" />
                <span>Emprunté · Réservable</span>
              </span>
            ) : (
              <span className="text-xs font-medium text-stone-500">
                Hors circulation
              </span>
            )}

            <button
              type="button"
              onClick={() => onSelect(book.id)}
              className="inline-flex min-h-[32px] items-center gap-1 text-xs font-semibold text-emerald-900 hover:text-emerald-700 whitespace-nowrap cursor-pointer"
            >
              Consulter
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {onAddToCart && canRequest && (
            <div>
              {inCart && onGoToCart ? (
                <button
                  type="button"
                  onClick={onGoToCart}
                  className="inline-flex w-full min-h-[38px] items-center justify-center gap-1.5 rounded-lg border border-emerald-800 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-950 hover:bg-emerald-100 cursor-pointer"
                >
                  <ShoppingBag className="h-3.5 w-3.5 shrink-0" />
                  Dans le panier
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void onAddToCart(book.id)}
                  className="inline-flex w-full min-h-[38px] items-center justify-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-stone-800 hover:border-emerald-800 hover:text-emerald-950 cursor-pointer"
                >
                  <ShoppingBag className="h-3.5 w-3.5 shrink-0" />
                  Ajouter au panier
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
