import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BookmarkCheck,
  BookOpenCheck,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Info,
  ShoppingBag,
  Wrench,
  XCircle,
} from 'lucide-react';
import type {
  BookDetail,
  CopyStatus,
  EligibilityReport,
  UserPublic,
} from '../../shared/types.ts';
import { api, ApiError } from '../lib/api.ts';
import { BookCover } from './BookCover.tsx';

interface BookDetailPageProps {
  bookId: string;
  user: UserPublic | null;
  eligibility: EligibilityReport | null;
  inCart?: boolean;
  onBack: () => void;
  onRequireAuth: () => void;
  onOperationComplete: () => Promise<void>;
  onAddToCart?: (bookId: string) => Promise<void>;
  onGoToCart?: () => void;
  onGoToReservations: () => void;
  onGoToLoans: () => void;
}

function getCopyStatusDisplay(status: CopyStatus) {
  switch (status) {
    case 'Disponible':
      return { icon: CheckCircle2, color: 'text-emerald-800', label: 'Disponible en rayon' };
    case 'Emprunté':
      return { icon: Clock, color: 'text-amber-800', label: 'Emprunté' };
    case 'Réservé':
      return { icon: BookmarkCheck, color: 'text-emerald-900', label: 'Réservé (attente retrait)' };
    case 'En réparation':
      return { icon: Wrench, color: 'text-stone-700', label: 'En réparation' };
    case 'Retiré définitivement':
      return { icon: XCircle, color: 'text-red-800', label: 'Retiré définitivement' };
  }
}

export function BookDetailPage({
  bookId,
  user,
  eligibility,
  inCart = false,
  onBack,
  onRequireAuth,
  onOperationComplete,
  onAddToCart,
  onGoToCart,
  onGoToReservations,
  onGoToLoans,
}: BookDetailPageProps) {
  const [book, setBook] = useState<BookDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [cartBusy, setCartBusy] = useState(false);
  const [showSecondaryDetails, setShowSecondaryDetails] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : false
  );
  const [feedback, setFeedback] = useState<{
    kind: 'success' | 'error';
    message: string;
    followUp?: 'loans' | 'reservations' | 'cart';
  } | null>(null);

  const loadBook = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getBookDetail(bookId);
      setBook(res.book);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Impossible de charger la fiche de cet ouvrage.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadBook();
    setFeedback(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  const handleBorrow = async () => {
    if (!user) {
      onRequireAuth();
      return;
    }
    setActionBusy(true);
    setFeedback(null);
    try {
      const res = await api.borrowBook(bookId);
      setFeedback({
        kind: 'success',
        message: `Emprunt confirmé pour l’exemplaire ${res.loan.copyBarcode}. À restituer sous 7 jours.`,
        followUp: 'loans',
      });
      await Promise.all([loadBook(), onOperationComplete()]);
    } catch (err) {
      setFeedback({
        kind: 'error',
        message:
          err instanceof ApiError
            ? err.message
            : 'L’opération d’emprunt a été refusée par le serveur.',
      });
    } finally {
      setActionBusy(false);
    }
  };

  const handleReserve = async () => {
    if (!user) {
      onRequireAuth();
      return;
    }
    setActionBusy(true);
    setFeedback(null);
    try {
      const res = await api.reserveBook(bookId);
      setFeedback({
        kind: 'success',
        message: res.message,
        followUp: 'reservations',
      });
      await Promise.all([loadBook(), onOperationComplete()]);
    } catch (err) {
      setFeedback({
        kind: 'error',
        message:
          err instanceof ApiError
            ? err.message
            : 'La réservation a été refusée par le serveur.',
      });
    } finally {
      setActionBusy(false);
    }
  };

  const handleAddToCart = async () => {
    if (!onAddToCart) return;
    if (!user) {
      onRequireAuth();
      return;
    }
    setCartBusy(true);
    setFeedback(null);
    try {
      await onAddToCart(bookId);
      setFeedback({
        kind: 'success',
        message:
          'Ouvrage ajouté à votre panier de demandes (aucun exemplaire n’est réservé avant confirmation).',
        followUp: 'cart',
      });
    } catch (err) {
      setFeedback({
        kind: 'error',
        message:
          err instanceof ApiError
            ? err.message
            : 'Impossible d’ajouter cet ouvrage au panier.',
      });
    } finally {
      setCartBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="h-8 w-40 animate-pulse rounded bg-stone-200" />
        <div className="mt-6 grid gap-6 md:grid-cols-12">
          <div className="md:col-span-4 h-48 md:h-96 animate-pulse rounded-xl bg-stone-200" />
          <div className="md:col-span-8 space-y-4">
            <div className="h-10 w-3/4 animate-pulse rounded bg-stone-200" />
            <div className="h-32 animate-pulse rounded bg-stone-100" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !book) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-emerald-900 cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
          Retour au catalogue
        </button>
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-900">
          <p>{error || 'Ouvrage introuvable.'}</p>
          <button
            type="button"
            onClick={() => void loadBook()}
            className="mt-3 min-h-[40px] rounded-lg bg-red-900 px-4 py-2 text-xs font-semibold text-white cursor-pointer"
          >
            Réessayer
          </button>
        </div>
      </div>
    );
  }

  const isAvailable = book.availableCopies > 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-emerald-900 hover:text-emerald-700 cursor-pointer"
      >
        <ArrowLeft className="h-4 w-4" />
        Retour au catalogue
      </button>

      {/* En-tête principal : couverture + titre + disponibilité + action principale d'abord */}
      <div className="mt-4 grid gap-6 md:grid-cols-12 items-start">
        {/* Couverture grand format sur tablette/desktop */}
        <div className="hidden md:block md:col-span-4">
          <div className="overflow-hidden rounded-xl border border-stone-200 bg-stone-50 aspect-[3/4]">
            <BookCover
              src={book.coverImage}
              alt={`Couverture de ${book.title}`}
              title={book.title}
              category={book.category}
              className="h-full w-full"
            />
          </div>
        </div>

        <div className="md:col-span-8 space-y-6">
          {/* Bloc titre + couverture compacte sur mobile */}
          <div className="flex gap-4 items-start">
            <div className="md:hidden w-24 shrink-0 aspect-[3/4] overflow-hidden rounded-lg border border-stone-200 bg-stone-50">
              <BookCover
                src={book.coverImage}
                alt={`Couverture de ${book.title}`}
                title={book.title}
                category={book.category}
                className="h-full w-full"
              />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-stone-600">
                <span className="font-semibold text-emerald-900">{book.category}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono">{book.shelfLocation}</span>
                <span aria-hidden="true">·</span>
                <span>{book.language}</span>
              </div>

              <h1 className="mt-1.5 font-editorial text-2xl sm:text-3xl lg:text-4xl font-semibold text-stone-950 text-balance leading-tight">
                {book.title}
              </h1>
              <p className="mt-1.5 text-sm sm:text-base font-medium text-stone-700">
                {book.authors}
              </p>

              {/* Disponibilité immédiate et synthétique */}
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:text-sm tabular-nums">
                {isAvailable ? (
                  <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-800">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    {book.availableCopies} exemplaire{book.availableCopies > 1 ? 's' : ''} disponible{book.availableCopies > 1 ? 's' : ''} sur {book.totalCopies}
                  </span>
                ) : book.canReserve ? (
                  <span className="inline-flex items-center gap-1.5 font-semibold text-amber-800">
                    <Clock className="h-4 w-4 shrink-0" />
                    Aucun disponible ({book.borrowedCopies} emprunté{book.borrowedCopies > 1 ? 's' : ''}) · File FIFO : {book.pendingReservationsCount}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 font-semibold text-red-800">
                    <XCircle className="h-4 w-4 shrink-0" />
                    Indisponible à l’emprunt et à la réservation
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Action principale placée immédiatement au premier plan */}
          <div className="rounded-xl border border-stone-200 bg-white p-4 sm:p-5 space-y-4">
            {!user ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-2.5 text-sm text-stone-700">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-emerald-900" />
                  <span>
                    Authentification requise avec votre compte USMBA pour emprunter ou réserver cet ouvrage.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={onRequireAuth}
                  className="shrink-0 whitespace-nowrap min-h-[44px] rounded-lg bg-emerald-900 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 cursor-pointer"
                >
                  Se connecter
                </button>
              </div>
            ) : eligibility && !eligibility.eligible ? (
              <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-950">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                <div>
                  <p className="font-semibold">Opération restreinte</p>
                  <p className="mt-0.5 text-xs">{eligibility.reasonMessage}</p>
                </div>
              </div>
            ) : null}

            {feedback && (
              <div
                role="status"
                className={`rounded-lg border p-4 text-sm ${
                  feedback.kind === 'success'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
                    : 'border-red-200 bg-red-50 text-red-900'
                }`}
              >
                <p>{feedback.message}</p>
                {feedback.followUp === 'loans' && (
                  <button
                    type="button"
                    onClick={onGoToLoans}
                    className="mt-2 min-h-[36px] text-xs font-semibold text-emerald-900 underline cursor-pointer"
                  >
                    Consulter Mes emprunts
                  </button>
                )}
                {feedback.followUp === 'reservations' && (
                  <button
                    type="button"
                    onClick={onGoToReservations}
                    className="mt-2 min-h-[36px] text-xs font-semibold text-emerald-900 underline cursor-pointer"
                  >
                    Consulter Mes réservations
                  </button>
                )}
                {feedback.followUp === 'cart' && onGoToCart && (
                  <button
                    type="button"
                    onClick={onGoToCart}
                    className="mt-2 min-h-[36px] text-xs font-semibold text-emerald-900 underline cursor-pointer"
                  >
                    Ouvrir le panier de demandes
                  </button>
                )}
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
              {book.canBorrow && (
                <button
                  type="button"
                  disabled={actionBusy || Boolean(user && eligibility && !eligibility.eligible)}
                  onClick={() => void handleBorrow()}
                  className="inline-flex w-full sm:w-auto min-h-[44px] items-center justify-center gap-2 rounded-lg bg-emerald-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  <BookOpenCheck className="h-4 w-4 shrink-0" />
                  {actionBusy ? 'Enregistrement…' : 'Emprunter cet ouvrage (7 jours)'}
                </button>
              )}

              {book.canReserve && (
                <button
                  type="button"
                  disabled={actionBusy || Boolean(user && eligibility && !eligibility.eligible)}
                  onClick={() => void handleReserve()}
                  className="inline-flex w-full sm:w-auto min-h-[44px] items-center justify-center gap-2 rounded-lg bg-emerald-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  <Clock className="h-4 w-4 shrink-0" />
                  {actionBusy ? 'Enregistrement…' : 'Réserver (file d’attente FIFO)'}
                </button>
              )}

              {onAddToCart && (book.canBorrow || book.canReserve) && (
                inCart && onGoToCart ? (
                  <button
                    type="button"
                    onClick={onGoToCart}
                    className="inline-flex w-full sm:w-auto min-h-[44px] items-center justify-center gap-2 rounded-lg border border-emerald-800 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-950 hover:bg-emerald-100 cursor-pointer"
                  >
                    <ShoppingBag className="h-4 w-4 shrink-0" />
                    Dans le panier · Ouvrir
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={cartBusy}
                    onClick={() => void handleAddToCart()}
                    className="inline-flex w-full sm:w-auto min-h-[44px] items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-800 hover:border-emerald-800 hover:text-emerald-950 disabled:opacity-50 cursor-pointer"
                  >
                    <ShoppingBag className="h-4 w-4 shrink-0" />
                    {cartBusy ? 'Ajout…' : 'Ajouter au panier'}
                  </button>
                )
              )}

              {!book.canBorrow && !book.canReserve && (
                <p className="text-sm font-medium text-red-800">
                  {book.reservationBlockedReason ||
                    'Cet ouvrage ne peut ni être emprunté ni être réservé.'}
                </p>
              )}
            </div>

            {book.canReserve && (
              <p className="text-xs text-stone-500 leading-relaxed">
                File d’attente chronologique FIFO : aucune date de disponibilité n’est garantie. Délai de retrait de 3 jours après attribution.
              </p>
            )}
          </div>

          {/* Informations secondaires repliables (résumé long + détails bibliographiques + compteurs) */}
          <div className="rounded-xl border border-stone-200 bg-stone-50/40 p-4 sm:p-5">
            {!showSecondaryDetails && book.description && (
              <p className="text-sm leading-relaxed text-stone-700 line-clamp-2 mb-3">
                {book.description}
              </p>
            )}

            <button
              type="button"
              onClick={() => setShowSecondaryDetails((prev) => !prev)}
              aria-expanded={showSecondaryDetails}
              aria-controls="book-secondary-details"
              className="inline-flex min-h-[40px] w-full items-center justify-between gap-2 text-xs sm:text-sm font-semibold text-emerald-950 cursor-pointer text-left"
            >
              <span>
                {showSecondaryDetails
                  ? 'Masquer le résumé et les détails bibliographiques'
                  : 'Afficher le résumé complet et les détails bibliographiques'}
              </span>
              {showSecondaryDetails ? (
                <ChevronUp className="h-4 w-4 shrink-0 text-stone-600" />
              ) : (
                <ChevronDown className="h-4 w-4 shrink-0 text-stone-600" />
              )}
            </button>

            {showSecondaryDetails && (
              <div id="book-secondary-details" className="mt-4 space-y-5 border-t border-stone-200 pt-4">
                {book.description && (
                  <p className="text-sm leading-relaxed text-stone-700 max-w-prose">
                    {book.description}
                  </p>
                )}

                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-y border-stone-200 py-4 sm:grid-cols-4 text-sm">
                  <div>
                    <dt className="text-xs text-stone-500">Éditeur</dt>
                    <dd className="mt-0.5 font-medium text-stone-900">{book.publisher}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-stone-500">Année / Édition</dt>
                    <dd className="mt-0.5 font-medium text-stone-900 tabular-nums">
                      {book.publicationYear} · {book.edition}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-stone-500">ISBN</dt>
                    <dd className="mt-0.5 font-mono text-xs text-stone-900 break-all">
                      {book.isbn || 'Non renseigné'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-stone-500">Cote rayonnage</dt>
                    <dd className="mt-0.5 font-mono text-xs font-semibold text-emerald-950">
                      {book.shelfLocation}
                    </dd>
                  </div>
                </dl>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-lg border border-stone-200 bg-white p-3">
                    <div className="font-mono text-lg font-semibold text-emerald-900 tabular-nums">
                      {book.availableCopies}
                    </div>
                    <div className="text-xs text-stone-600">
                      Disponible{book.availableCopies > 1 ? 's' : ''}
                    </div>
                  </div>
                  <div className="rounded-lg border border-stone-200 bg-white p-3">
                    <div className="font-mono text-lg font-semibold text-stone-900 tabular-nums">
                      {book.borrowedCopies}
                    </div>
                    <div className="text-xs text-stone-600">
                      Emprunté{book.borrowedCopies > 1 ? 's' : ''}
                    </div>
                  </div>
                  <div className="rounded-lg border border-stone-200 bg-white p-3">
                    <div className="font-mono text-lg font-semibold text-stone-900 tabular-nums">
                      {book.reservedCopies}
                    </div>
                    <div className="text-xs text-stone-600">En attente retrait</div>
                  </div>
                  <div className="rounded-lg border border-stone-200 bg-white p-3">
                    <div className="font-mono text-lg font-semibold text-stone-900 tabular-nums">
                      {book.pendingReservationsCount}
                    </div>
                    <div className="text-xs text-stone-600">File d’attente FIFO</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Exemplaires physiques : cartes compactes sur téléphone (zéro scroll horizontal), tableau sur >= md */}
          <div>
            <h2 className="font-editorial text-xl font-semibold text-stone-950">
              Exemplaires physiques ({book.copies.length})
            </h2>
            <p className="mt-1 text-xs text-stone-500">
              Chaque code-barres correspond à un exemplaire physique indépendant.
            </p>

            {book.copies.length === 0 ? (
              <div className="mt-4 rounded-lg border border-stone-200 p-6 text-sm text-stone-600">
                Aucun exemplaire physique enregistré pour ce titre.
              </div>
            ) : (
              <>
                {/* Vue mobile en cartes compactes */}
                <div className="mt-4 space-y-2.5 md:hidden">
                  {book.copies.map((copy) => {
                    const st = getCopyStatusDisplay(copy.status);
                    const Icon = st.icon;
                    return (
                      <div
                        key={copy.id}
                        className="rounded-xl border border-stone-200 bg-white p-3.5 space-y-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-mono text-xs font-semibold text-stone-900">
                            {copy.barcode}
                          </span>
                          <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${st.color}`}>
                            <Icon className="h-3.5 w-3.5 shrink-0" />
                            {st.label}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-600">
                          <span>
                            État : {copy.physicalCondition}
                            {copy.needsInspection && copy.status === 'En réparation'
                              ? ' (inspection requise)'
                              : ''}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{copy.location}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Vue tablette / ordinateur en tableau */}
                <div className="mt-4 hidden md:block rounded-xl border border-stone-200 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-stone-200 bg-stone-50 text-xs font-semibold text-stone-700">
                      <tr>
                        <th className="px-4 py-3">Code-barres</th>
                        <th className="px-4 py-3">Statut</th>
                        <th className="px-4 py-3">État physique</th>
                        <th className="px-4 py-3">Localisation</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100 bg-white">
                      {book.copies.map((copy) => {
                        const st = getCopyStatusDisplay(copy.status);
                        const Icon = st.icon;
                        return (
                          <tr key={copy.id} className="hover:bg-stone-50/70">
                            <td className="px-4 py-3 font-mono text-xs font-medium text-stone-900">
                              {copy.barcode}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${st.color}`}>
                                <Icon className="h-3.5 w-3.5 shrink-0" />
                                {st.label}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-stone-700">
                              {copy.physicalCondition}
                              {copy.needsInspection && copy.status === 'En réparation' && (
                                <span className="ml-1.5 text-stone-500">(inspection requise)</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-xs text-stone-600">
                              {copy.location}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
