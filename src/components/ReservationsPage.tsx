import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BookmarkCheck,
  CheckCircle2,
  Clock,
  XCircle,
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
    case 'Retenu 24h':
      return {
        icon: BookmarkCheck,
        color: 'text-sky-900',
        label: 'Retenu 24 h — À retirer au comptoir',
      };
    case 'Disponible pour retrait':
      return {
        icon: BookmarkCheck,
        color: 'text-emerald-900',
        label: 'FIFO prêt — À retirer sous 3 jours',
      };
    case 'En attente':
      return {
        icon: Clock,
        color: 'text-amber-800',
        label: 'En attente (file FIFO)',
      };
    case 'Exemplaire attribué':
      return {
        icon: Clock,
        color: 'text-emerald-800',
        label: 'Exemplaire attribué (confirmation en cours)',
      };
    case 'Retirée':
      return {
        icon: CheckCircle2,
        color: 'text-stone-700',
        label: 'Retirée (emprunt remis)',
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
          : 'Impossible de charger vos demandes et réservations.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadReservations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const handleCancel = async (id: string, is24hHold: boolean) => {
    setBusyId(id);
    setActionMsg(null);
    setError(null);
    try {
      await api.cancelReservation(id);
      setActionMsg(
        is24hHold
          ? 'Votre retenue de 24 h a été annulée et l’exemplaire a été libéré.'
          : 'Votre réservation a été annulée et la file d’attente a été recalculée.'
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
      <div className="mx-auto max-w-3xl px-4 py-14 text-center">
        <h1 className="font-editorial text-2xl font-semibold text-stone-950">
          Authentification requise
        </h1>
        <p className="mt-2 text-sm text-stone-600">
          Connectez-vous pour consulter vos retenues de 24 h et votre file d’attente FIFO.
        </p>
        <button
          type="button"
          onClick={onRequireAuth}
          className="mt-5 min-h-[44px] rounded-lg bg-emerald-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 cursor-pointer"
        >
          Se connecter
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="border-b border-stone-200 pb-5">
        <p className="text-xs font-semibold text-emerald-900">
          Retenues 24 h au comptoir · File chronologique FIFO (retrait 3 jours)
        </p>
        <h1 className="mt-1 font-editorial text-2xl sm:text-3xl font-semibold text-stone-950">
          Mes retenues & réservations
        </h1>
        <p className="mt-1.5 text-sm text-stone-600">
          Présentez votre carte membre au comptoir pour valider le retrait de vos retenues (24 h) ou réservations FIFO prêtes (3 jours). Le prêt de 7 jours démarre lors du scan au comptoir.
        </p>
      </div>

      {actionMsg && (
        <div role="status" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
          {actionMsg}
        </div>
      )}

      {error && (
        <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => void loadReservations()}
            className="mt-3 min-h-[40px] rounded-lg bg-red-900 px-4 py-2 text-xs font-semibold text-white cursor-pointer"
          >
            Réessayer
          </button>
        </div>
      )}

      {loading ? (
        <div className="mt-6 space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-stone-100" />
          ))}
        </div>
      ) : !error && reservations.length === 0 ? (
        <div className="mt-6 rounded-xl border border-stone-200 bg-white p-8 sm:p-12 text-center">
          <BookmarkCheck className="mx-auto h-10 w-10 text-stone-400" />
          <h2 className="mt-3 font-editorial text-xl font-semibold text-stone-900">
            Aucune retenue ni réservation enregistrée
          </h2>
          <p className="mt-1 text-sm text-stone-600">
            Ajoutez un ouvrage à votre panier puis cliquez sur « Confirmer mes demandes » pour obtenir une retenue de 24 h ou rejoindre la file FIFO.
          </p>
          <button
            type="button"
            onClick={onBrowseCatalogue}
            className="mt-5 min-h-[44px] rounded-lg bg-emerald-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 cursor-pointer"
          >
            Parcourir le catalogue
          </button>
        </div>
      ) : !error ? (
        <div className="mt-6 space-y-3.5">
          {reservations.map((res) => {
            const meta = getStatusMeta(res.status);
            const Icon = meta.icon;
            const is24hHold = res.status === 'Retenu 24h' || res.requestType === 'retenue_24h';
            const canCancel =
              res.status === 'Retenu 24h' ||
              res.status === 'En attente' ||
              res.status === 'Disponible pour retrait';

            return (
              <article
                key={res.id}
                className="rounded-xl border border-stone-200 bg-white p-4 sm:p-5 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 pb-2.5">
                  <div className={`inline-flex items-center gap-1.5 text-xs font-semibold ${meta.color}`}>
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{meta.label}</span>
                  </div>

                  {res.status === 'En attente' && res.queuePosition !== null && (
                    <span className="font-mono text-xs font-semibold text-emerald-950 tabular-nums">
                      Position FIFO : n° {res.queuePosition}
                    </span>
                  )}
                  {(res.status === 'Retenu 24h' || res.status === 'Disponible pour retrait') &&
                    res.pickupDeadline && (
                      <span className="text-xs font-semibold text-emerald-900 tabular-nums">
                        À retirer avant le {formatDateTimeFr(res.pickupDeadline)}
                      </span>
                    )}
                </div>

                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3.5 min-w-0">
                    <div className="h-20 w-15 shrink-0 overflow-hidden rounded-md border border-stone-200">
                      <BookCover
                        src={res.bookCoverImage}
                        alt={res.bookTitle}
                        title={res.bookTitle}
                        className="h-full w-full"
                      />
                    </div>

                    <div className="min-w-0">
                      <h2 className="font-editorial text-base sm:text-lg font-semibold text-stone-900">
                        <button
                          type="button"
                          onClick={() => onOpenBook(res.bookId)}
                          className="text-left hover:text-emerald-900 cursor-pointer"
                        >
                          {res.bookTitle}
                        </button>
                      </h2>
                      <p className="text-xs text-stone-600">{res.bookAuthors}</p>

                      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-stone-500 tabular-nums">
                        <span>Demandée le {formatDateFr(res.requestedAt)}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">Rayon {res.shelfLocation}</span>
                      </div>

                      {res.status === 'Retenu 24h' && (
                        <p className="mt-1.5 text-xs text-sky-900 leading-relaxed">
                          Un exemplaire physique est retenu à votre nom au comptoir. Présentez votre carte membre avant l’expiration de 24 h pour démarrer votre emprunt de 7 jours.
                        </p>
                      )}
                      {res.status === 'Disponible pour retrait' && (
                        <p className="mt-1.5 text-xs text-emerald-900 leading-relaxed">
                          Votre tour en file FIFO est arrivé. Présentez votre carte membre au comptoir avant la limite de 3 jours pour retirer votre exemplaire.
                        </p>
                      )}
                      {res.status === 'En attente' && (
                        <p className="mt-1.5 text-xs text-stone-500 leading-relaxed">
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
                        onClick={() => void handleCancel(res.id, is24hHold)}
                        className="w-full sm:w-auto min-h-[44px] whitespace-nowrap rounded-lg border border-stone-300 bg-white px-4 py-2 text-xs font-semibold text-stone-800 hover:border-red-700 hover:text-red-800 disabled:opacity-50 cursor-pointer"
                      >
                        {busyId === res.id
                          ? 'Annulation…'
                          : res.status === 'Retenu 24h'
                            ? 'Annuler la retenue 24 h'
                            : 'Annuler la réservation'}
                      </button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
