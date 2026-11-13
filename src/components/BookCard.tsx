import { ArrowRight, CheckCircle2, Clock } from 'lucide-react';
import type { BookWithStats } from '../../shared/types.ts';
import { BookCover } from './BookCover.tsx';

interface BookCardProps {
  book: BookWithStats;
  onSelect: (bookId: string) => void;
}

export function BookCard({ book, onSelect }: BookCardProps) {
  const isAvailable = book.availableCopies > 0;
  const canReserve = !isAvailable && book.circulatingCopies > 0;

  return (
    <article
      onClick={() => onSelect(book.id)}
      className="group flex flex-col overflow-hidden rounded-xl border border-stone-200 bg-white transition-colors hover:border-emerald-800/60 cursor-pointer"
    >
      <div className="aspect-[3/4] w-full overflow-hidden border-b border-stone-100 bg-stone-50">
        <BookCover
          src={book.coverImage}
          alt={`Couverture de ${book.title}`}
          title={book.title}
          category={book.category}
          className="h-full w-full transition-transform duration-300 group-hover:scale-[1.02]"
        />
      </div>

      <div className="flex flex-1 flex-col justify-between p-5">
        <div>
          {/* Métadonnées sans pilules : texte propre avec séparateurs typographiques */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-500">
            <span className="font-medium text-emerald-900">{book.category}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{book.publicationYear}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{book.shelfLocation}</span>
          </div>

          <h3 className="mt-2 font-editorial text-lg font-semibold leading-snug text-stone-900 group-hover:text-emerald-950 line-clamp-2">
            {book.title}
          </h3>
          <p className="mt-1 text-sm text-stone-600 line-clamp-1">{book.authors}</p>
        </div>

        <div className="mt-5 flex items-center justify-between border-t border-stone-100 pt-3.5">
          {isAvailable ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 tabular-nums">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              {book.availableCopies} disponible{book.availableCopies > 1 ? 's' : ''} / {book.totalCopies}
            </span>
          ) : canReserve ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800 tabular-nums">
              <Clock className="h-3.5 w-3.5 shrink-0" />
              Emprunté · Réservation ouverte
            </span>
          ) : (
            <span className="text-xs font-medium text-stone-500">
              Hors circulation
            </span>
          )}

          <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-900 group-hover:translate-x-0.5 transition-transform">
            Consulter
            <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </div>
      </div>
    </article>
  );
}
