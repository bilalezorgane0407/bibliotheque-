import { useEffect, useState } from 'react';
import {
  BookmarkCheck,
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import type { ReservationRecord, ReservationStatus, UserPublic } from '../../shared/types.ts';
import { api, ApiError, formatDateFr, formatDateTimeFr } from '../lib/api.ts';
import { BookCover } from './BookCover.tsx';

interface ReservationsPageProps {
  user: UserPublic | null;
  onRequireAuth: () => void;
  onOpenBook: (bookId: string) => void;
  onBrowseCatalogue: () => void;
  onUpdated: () => Promise<void>;
}

function getStatusMeta(status: ReservationStatus) {
  switch (status) {
    case 'Disponible pour retrait':
      return {
        icon: BookmarkCheck,
        color: 'text-emerald-900',
        label: 'Disponible pour retrait',
      };
    case 'En attente':
      return {
        icon: Clock,
        color: 'text-amber-800',
        label: 'En attente',
      };
    case 'Retirée':
      return {
        icon: CheckCircle2,
        color: 'text-stone-700',
        label: 'Retirée',
      };
    case 'Annulée':
      return {
        icon: XCircle,
        color: 'text-stone-500',
        label: 'Annulée',
      };
    case 'Expirée':
      return {
        icon: AlertTriangle,
        color: 'text-red-700',
        label: 'Expirée',
      };
  }
}

export function ReservationsPage({
  user,
  onRequireAuth,
  onOpenBook,
  onBrowseCatalogue,
  onUpdated,
}: ReservationsPageProps) {
  const [reservations, setReservations] = useState<ReservationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const loadReservations = async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.getMyReservations();
      setReservations(res.reservations);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Impossible de charger vos réservations.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReservations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const handleCancel = async (id: string) => {
    setBusyId(id);
    setActionMsg(null);
    setError(null);
    try {
      await api.cancelReservation(id);
      setActionMsg(
        'Votre réservation a été annulée et la file d’attente a été recalculée.'
      );
      await Promise.all([loadReservations(), onUpdated()]);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Erreur lors de l’annulation.'
      );
    } finally {
      setBusyId(null);
    }
  };

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="font-editorial text-2xl font-semibold text-stone-950">
          Authentification requise
        </h1>
        <p className="mt-2 text-sm text-stone-600">
          Connectez-vous pour consulter votre file d’attente et vos exemplaires disponibles au retrait.
        </p>
        <button
          type="button"
          onClick={onRequireAuth}
          className="mt-5 rounded-lg bg-emerald-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 cursor-pointer"
        >
          Se connecter
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="border-b border-stone-200 pb-6">
        <p className="text-xs font-semibold text-emerald-900">
          File chronologique FIFO · Délai de retrait 3 jours
        </p>
        <h1 className="mt-1 font-editorial text-3xl font-semibold text-stone-950">
          Mes réservations
        </h1>
        <p className="mt-2 text-sm text-stone-600">
          Les demandes sont traitées strictement selon l’ordre chronologique (premier arrivé, premier servi). Lorsqu’un exemplaire vous est attribué, vous disposez de 3 jours pour le retirer à la banque d’accueil.
        </p>
      </div>

      {actionMsg && (
        <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
          {actionMsg}
        </div>
      )}

      {error && (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          {error}
        </div>
      )}

      {loading ? (
        <div className="mt-8 space-y-4">
          {[0, 1].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-stone-100" />
          ))}
        </div>
      ) : reservations.length === 0 ? (
        <div className="mt-8 rounded-xl border border-stone-200 bg-white p-12 text-center">
          <BookmarkCheck className="mx-auto h-10 w-10 text-stone-400" />
          <h2 className="mt-3 font-editorial text-xl font-semibold text-stone-900">
            Aucune réservation enregistrée
          </h2>
          <p className="mt-1 text-sm text-stone-600">
            Si tous les exemplaires d’un ouvrage sont empruntés, vous pouvez le réserver depuis sa fiche détaillée.
          </p>
          <button
            type="button"
            onClick={onBrowseCatalogue}
            className="mt-5 rounded-lg bg-emerald-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 cursor-pointer"
          >
            Parcourir le catalogue
          </button>
        </div>
      ) : (
        <div className="mt-8 space-y-4">
          {reservations.map((res) => {
            const meta = getStatusMeta(res.status);
            const Icon = meta.icon;
            const canCancel =
              res.status === 'En attente' || res.status === 'Disponible pour retrait';

            return (
              <div
                key={res.id}
                className="flex flex-col gap-4 rounded-xl border border-stone-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-start gap-4">
                  <div className="h-22 w-16 shrink-0 overflow-hidden rounded-md border border-stone-200">
                    <BookCover
                      src={res.bookCoverImage}
                      alt={res.bookTitle}
                      title={res.bookTitle}
                      className="h-full w-full"
                    />
                  </div>

                  <div>
                    <div className={`inline-flex items-center gap-1.5 text-xs font-semibold ${meta.color}`}>
                      <Icon className="h-4 w-4 shrink-0" />
                      {meta.label}
                    </div>

                    <h2 className="mt-1 font-editorial text-lg font-semibold text-stone-900">
                      <button
                        type="button"
                        onClick={() => onOpenBook(res.bookId)}
                        className="text-left hover:text-emerald-900 cursor-pointer"
                      >
                        {res.bookTitle}
                      </button>
                    </h2>
                    <p className="text-xs text-stone-600">{res.bookAuthors}</p>

                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500 tabular-nums">
                      <span>Demandée le {formatDateFr(res.requestedAt)}</span>
                      {res.status === 'En attente' && res.queuePosition !== null && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono font-semibold text-emerald-950">
                            Position dans la file : n° {res.queuePosition}
                          </span>
                        </>
                      )}
                      {res.status === 'Disponible pour retrait' && res.pickupDeadline && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-semibold text-emerald-900">
                            À retirer avant le {formatDateTimeFr(res.pickupDeadline)}
                          </span>
                        </>
                      )}
                      {res.assignedCopyBarcode && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono">Exemplaire {res.assignedCopyBarcode}</span>
                        </>
                      )}
                    </div>

                    {res.status === 'En attente' && (
                      <p className="mt-1.5 text-xs text-stone-500">
                        Aucune date de disponibilité n’est garantie. Vous serez notifié dès qu’un exemplaire réutilisable sera restitué.
                      </p>
                    )}
                  </div>
                </div>

                {canCancel && (
                  <div className="shrink-0">
                    <button
                      type="button"
                      disabled={busyId === res.id}
                      onClick={() => void handleCancel(res.id)}
                      className="whitespace-nowrap rounded-lg border border-stone-300 bg-white px-4 py-2 text-xs font-semibold text-stone-800 hover:border-red-700 hover:text-red-800 disabled:opacity-50 cursor-pointer"
                    >
                      {busyId === res.id ? 'Annulation…' : 'Annuler la réservation'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
