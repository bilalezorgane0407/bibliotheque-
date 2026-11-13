import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BookmarkCheck,
  BookOpenCheck,
  CheckCircle2,
  Clock,
  Info,
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
  onBack: () => void;
  onRequireAuth: () => void;
  onOperationComplete: () => Promise<void>;
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
  onBack,
  onRequireAuth,
  onOperationComplete,
  onGoToReservations,
  onGoToLoans,
}: BookDetailPageProps) {
  const [book, setBook] = useState<BookDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: 'success' | 'error';
    message: string;
    followUp?: 'loans' | 'reservations';
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

  if (loading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="h-8 w-40 animate-pulse rounded bg-stone-200" />
        <div className="mt-8 grid gap-8 lg:grid-cols-12">
          <div className="lg:col-span-4 aspect-[3/4] animate-pulse rounded-xl bg-stone-200" />
          <div className="lg:col-span-8 space-y-4">
            <div className="h-10 w-3/4 animate-pulse rounded bg-stone-200" />
            <div className="h-32 animate-pulse rounded bg-stone-100" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !book) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-900 cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" />
          Retour au catalogue
        </button>
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-900">
          {error || 'Ouvrage introuvable.'}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-900 hover:text-emerald-700 cursor-pointer"
      >
        <ArrowLeft className="h-4 w-4" />
        Retour au catalogue
      </button>

      <div className="mt-6 grid gap-10 lg:grid-cols-12 items-start">
        {/* Couverture */}
        <div className="lg:col-span-4">
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

        {/* Détails bibliographiques et actions */}
        <div className="lg:col-span-8 space-y-8">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-stone-600">
              <span className="font-semibold text-emerald-900">{book.category}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono">{book.shelfLocation}</span>
              <span aria-hidden="true">·</span>
              <span>{book.language}</span>
            </div>

            <h1 className="mt-2 font-editorial text-3xl font-semibold text-stone-950 sm:text-4xl text-balance">
              {book.title}
            </h1>
            <p className="mt-2 text-base font-medium text-stone-700">{book.authors}</p>
            <p className="mt-4 text-sm leading-relaxed text-stone-700 max-w-prose">
              {book.description}
            </p>
          </div>

          {/* Fiche bibliographique structurée */}
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-y border-stone-200 py-5 sm:grid-cols-4 text-sm">
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
              <dd className="mt-0.5 font-mono text-xs text-stone-900">
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

          {/* Résumé d'inventaire */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-lg border border-stone-200 bg-stone-50/70 p-3.5">
              <div className="font-mono text-xl font-semibold text-emerald-900 tabular-nums">
                {book.availableCopies}
              </div>
              <div className="text-xs text-stone-600">Disponible{book.availableCopies > 1 ? 's' : ''}</div>
            </div>
            <div className="rounded-lg border border-stone-200 bg-stone-50/70 p-3.5">
              <div className="font-mono text-xl font-semibold text-stone-900 tabular-nums">
                {book.borrowedCopies}
              </div>
              <div className="text-xs text-stone-600">Emprunté{book.borrowedCopies > 1 ? 's' : ''}</div>
            </div>
            <div className="rounded-lg border border-stone-200 bg-stone-50/70 p-3.5">
              <div className="font-mono text-xl font-semibold text-stone-900 tabular-nums">
                {book.reservedCopies}
              </div>
              <div className="text-xs text-stone-600">En attente retrait</div>
            </div>
            <div className="rounded-lg border border-stone-200 bg-stone-50/70 p-3.5">
              <div className="font-mono text-xl font-semibold text-stone-900 tabular-nums">
                {book.pendingReservationsCount}
              </div>
              <div className="text-xs text-stone-600">File d’attente FIFO</div>
            </div>
          </div>

          {/* Éligibilité et boutons d'action */}
          <div className="rounded-xl border border-stone-200 bg-white p-5 space-y-4">
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
                  className="shrink-0 whitespace-nowrap rounded-lg bg-emerald-900 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 cursor-pointer"
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
                    className="mt-2 text-xs font-semibold text-emerald-900 underline cursor-pointer"
                  >
                    Consulter Mes emprunts
                  </button>
                )}
                {feedback.followUp === 'reservations' && (
                  <button
                    type="button"
                    onClick={onGoToReservations}
                    className="mt-2 text-xs font-semibold text-emerald-900 underline cursor-pointer"
                  >
                    Consulter Mes réservations
                  </button>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              {book.canBorrow && (
                <button
                  type="button"
                  disabled={actionBusy || Boolean(user && eligibility && !eligibility.eligible)}
                  onClick={() => void handleBorrow()}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  <BookOpenCheck className="h-4 w-4" />
                  {actionBusy ? 'Enregistrement…' : 'Emprunter cet ouvrage (7 jours)'}
                </button>
              )}

              {book.canReserve && (
                <button
                  type="button"
                  disabled={actionBusy || Boolean(user && eligibility && !eligibility.eligible)}
                  onClick={() => void handleReserve()}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  <Clock className="h-4 w-4" />
                  {actionBusy ? 'Enregistrement…' : 'Réserver (file d’attente FIFO)'}
                </button>
              )}

              {!book.canBorrow && !book.canReserve && (
                <p className="text-sm font-medium text-red-800">
                  {book.reservationBlockedReason ||
                    'Cet ouvrage ne peut ni être emprunté ni être réservé.'}
                </p>
              )}
            </div>

            {book.canReserve && (
              <p className="text-xs text-stone-500">
                Règle de file d’attente : premier arrivé, premier servi. Aucune date de disponibilité n’est garantie lors de la réservation. Une fois attribué, l’exemplaire reste réservé pendant 3 jours.
              </p>
            )}
          </div>

          {/* Tableau des exemplaires physiques individuels */}
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
              <div className="mt-4 overflow-x-auto rounded-xl border border-stone-200">
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
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
