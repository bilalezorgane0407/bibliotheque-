import { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Info,
  ShoppingBag,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  MAX_QUANTITY_PER_TITLE,
  type CartConfirmationItemResult,
  type CartItemRecord,
  type EligibilityReport,
  type UserPublic,
} from '../../shared/types.ts';
import { api, ApiError } from '../lib/api.ts';
import { BookCover } from './BookCover.tsx';

interface CartPageProps {
  user: UserPublic | null;
  eligibility: EligibilityReport | null;
  items: CartItemRecord[];
  borrowingDurationDays?: number;
  onRequireAuth: () => void;
  onOpenBook: (bookId: string) => void;
  onBrowseCatalogue: () => void;
  onCartChanged: () => Promise<void>;
  onGoToLoans: () => void;
  onGoToReservations: () => void;
}

export function CartPage({
  user,
  eligibility,
  items,
  borrowingDurationDays = 7,
  onRequireAuth,
  onOpenBook,
  onBrowseCatalogue,
  onCartChanged,
  onGoToLoans,
  onGoToReservations,
}: CartPageProps) {
  const [busyBookId, setBusyBookId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<CartConfirmationItemResult[] | null>(null);

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-14 text-center">
        <ShoppingBag className="mx-auto h-10 w-10 text-emerald-900" />
        <h1 className="mt-3 font-editorial text-2xl font-semibold text-stone-950">
          Panier de demandes
        </h1>
        <p className="mt-2 text-sm text-stone-600">
          Connectez-vous avec votre compte institutionnel fourni par l’école pour constituer et confirmer votre panier de demandes (retenue 24 h au comptoir ou réservation FIFO).
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

  const handleRemove = async (bookId: string) => {
    setBusyBookId(bookId);
    setError(null);
    try {
      await api.removeFromCart(bookId);
      await onCartChanged();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Impossible de retirer cet ouvrage du panier.'
      );
    } finally {
      setBusyBookId(null);
    }
  };

  const handleTestQuantityIncrement = async (bookId: string) => {
    setBusyBookId(bookId);
    setError(null);
    try {
      await api.updateCartItemQuantity(bookId, MAX_QUANTITY_PER_TITLE + 1);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Quantité limitée à 1 exemplaire par titre.'
      );
    } finally {
      setBusyBookId(null);
    }
  };

  const handleConfirm = async () => {
    setConfirming(true);
    setError(null);
    setResults(null);
    try {
      const response = await api.confirmCart();
      setResults(response.results);
      await onCartChanged();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'La confirmation du panier a été refusée par le serveur.'
      );
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="border-b border-stone-200 pb-5">
        <p className="text-xs font-semibold text-emerald-900">
          Règlement BiblioEST · Limite : {MAX_QUANTITY_PER_TITLE} exemplaire par titre
        </p>
        <h1 className="mt-1 font-editorial text-2xl sm:text-3xl font-semibold text-stone-950">
          Panier de demandes
        </h1>
        <p className="mt-2 text-sm text-stone-600 max-w-3xl">
          L’ajout d’un titre au panier constitue une préparation de demande et{' '}
          <strong className="font-semibold text-stone-900">
            ne réserve aucun exemplaire physique
          </strong>
          . Au clic sur « Confirmer mes demandes », le serveur vérifie votre éligibilité, puis affecte pour chaque titre disponible sans file prioritaire une{' '}
          <strong className="font-semibold text-stone-900">retenue de 24 h au comptoir</strong>{' '}
          (le prêt de {borrowingDurationDays} jours ne démarre qu’au retrait par scan), ou crée une{' '}
          <strong className="font-semibold text-stone-900">réservation FIFO</strong>{' '}
          si un retour physique est attendu.
        </p>
      </div>

      {/* Rappel d'éligibilité si le compte est bloqué */}
      {eligibility && !eligibility.eligible && (
        <div className="mt-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
          <div className="min-w-0">
            <p className="font-semibold">Confirmation actuellement bloquée par le règlement</p>
            <p className="mt-1 text-xs leading-relaxed">{eligibility.reasonMessage}</p>
          </div>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mt-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"
        >
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
          <span className="min-w-0">{error}</span>
        </div>
      )}

      {/* Résultats réels retournés par le serveur après confirmation */}
      {results && results.length > 0 && (
        <div className="mt-5 rounded-xl border border-stone-200 bg-white p-4 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 pb-3">
            <h2 className="font-editorial text-xl font-semibold text-stone-950">
              Résultat de la vérification serveur
            </h2>
            <div className="flex flex-wrap items-center gap-4 text-xs font-semibold">
              <button
                type="button"
                onClick={onGoToReservations}
                className="min-h-[36px] text-emerald-900 hover:underline cursor-pointer"
              >
                Voir Mes réservations & retenues
              </button>
              <button
                type="button"
                onClick={onGoToLoans}
                className="min-h-[36px] text-stone-700 hover:underline cursor-pointer"
              >
                Voir Mes emprunts
              </button>
            </div>
          </div>

          <div className="divide-y divide-stone-100">
            {results.map((r) => (
              <div key={`${r.bookId}-${r.outcome}`} className="py-3 flex items-start gap-3">
                {r.outcome === 'retenue_24h_creee' ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-800" />
                ) : r.outcome === 'reservation_enregistree' ? (
                  <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 text-sm font-semibold text-stone-900">
                    <span>{r.bookTitle}</span>
                    <span className="text-xs font-mono text-stone-500">
                      ·{' '}
                      {r.outcome === 'retenue_24h_creee'
                        ? 'Retenue 24 h (à retirer au comptoir)'
                        : r.outcome === 'reservation_enregistree'
                          ? 'Réservation FIFO enregistrée'
                          : 'Ligne refusée'}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-stone-700">{r.message}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Liste des articles du panier */}
      {items.length === 0 ? (
        <div className="mt-6 rounded-xl border border-stone-200 bg-white p-8 sm:p-12 text-center">
          <ShoppingBag className="mx-auto h-10 w-10 text-stone-400" />
          <h2 className="mt-3 font-editorial text-xl font-semibold text-stone-900">
            Votre panier de demandes est vide
          </h2>
          <p className="mt-1 text-sm text-stone-600">
            Parcourez le catalogue pour sélectionner les ouvrages à demander (retenue 24 h ou file FIFO).
          </p>
          <button
            type="button"
            onClick={onBrowseCatalogue}
            className="mt-5 inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-emerald-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 cursor-pointer"
          >
            Consulter le catalogue
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="mt-6 grid gap-6 lg:gap-8 lg:grid-cols-12 items-start">
          <div className="lg:col-span-8 space-y-3.5">
            {items.map((item) => {
              const available = item.book.availableCopies > 0;
              const circulating = item.book.circulatingCopies > 0;

              return (
                <article
                  key={item.id}
                  className="flex flex-col gap-4 rounded-xl border border-stone-200 bg-white p-4 sm:p-5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-start gap-3.5 min-w-0">
                    <div className="w-15 aspect-[3/4] shrink-0 overflow-hidden rounded-md border border-stone-200">
                      <BookCover
                        src={item.book.coverImage}
                        alt={item.book.title}
                        title={item.book.title}
                        className="h-full w-full"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 text-xs text-stone-500">
                        <span className="font-medium text-emerald-900">{item.book.category}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">{item.book.shelfLocation}</span>
                      </div>
                      <h2 className="mt-1 font-editorial text-base sm:text-lg font-semibold text-stone-900">
                        <button
                          type="button"
                          onClick={() => onOpenBook(item.bookId)}
                          className="text-left hover:text-emerald-900 cursor-pointer"
                        >
                          {item.book.title}
                        </button>
                      </h2>
                      <p className="text-xs text-stone-600">{item.book.authors}</p>

                      <div className="mt-2 space-y-1 text-xs tabular-nums">
                        {available ? (
                          <div className="font-semibold text-emerald-800">
                            Stock indicatif : {item.book.availableCopies} disponible(s)
                          </div>
                        ) : circulating ? (
                          <div className="font-semibold text-amber-800">
                            Stock indicatif : aucun exemplaire libre (file FIFO ouverte)
                          </div>
                        ) : (
                          <div className="font-semibold text-red-700">
                            Hors circulation : aucun exemplaire actif
                          </div>
                        )}

                        <div className="text-stone-700">
                          <span className="font-semibold text-stone-900">Traitement prévu : </span>
                          {eligibility && !eligibility.eligible ? (
                            <span className="text-red-700">
                              Refus global — {eligibility.reasonMessage}
                            </span>
                          ) : available ? (
                            <span className="text-emerald-900 font-medium">
                              Retenue 24 h au comptoir (si aucune file FIFO prioritaire)
                            </span>
                          ) : circulating ? (
                            <span className="text-amber-900 font-medium">
                              Réservation en file FIFO (aucune date promise)
                            </span>
                          ) : (
                            <span className="text-red-700 font-medium">
                              Refus prévisible — aucun exemplaire physique susceptible de revenir
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-3 sm:border-t-0 sm:pt-0 sm:justify-end shrink-0">
                    <div className="flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-2.5 min-h-[40px] text-xs">
                      <span className="text-stone-600">Qté :</span>
                      <span className="font-mono font-semibold text-stone-900 tabular-nums">
                        {item.quantity} / {MAX_QUANTITY_PER_TITLE}
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleTestQuantityIncrement(item.bookId)}
                        disabled={busyBookId === item.bookId}
                        title="Limite réglementaire : 1 exemplaire par titre"
                        aria-label="Tester la limite de quantité"
                        className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded border border-stone-300 bg-white text-xs font-semibold text-stone-600 hover:text-stone-900 cursor-pointer"
                      >
                        +
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleRemove(item.bookId)}
                      disabled={busyBookId === item.bookId}
                      className="inline-flex min-h-[40px] items-center gap-1.5 whitespace-nowrap rounded-lg border border-stone-300 bg-white px-3.5 py-2 text-xs font-semibold text-stone-700 hover:border-red-700 hover:text-red-800 disabled:opacity-50 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Retirer
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          {/* Récapitulatif et confirmation serveur */}
          <aside className="lg:col-span-4 rounded-xl border border-stone-200 bg-stone-50/70 p-4 sm:p-6 space-y-4 sm:space-y-5">
            <div>
              <h2 className="font-editorial text-xl font-semibold text-stone-950">
                Validation de la demande
              </h2>
              <p className="mt-1 text-xs text-stone-600 leading-relaxed">
                {items.length} titre{items.length > 1 ? 's' : ''} sélectionné
                {items.length > 1 ? 's' : ''}. Maximum {MAX_QUANTITY_PER_TITLE} exemplaire par titre.
              </p>
            </div>

            <div className="flex items-start gap-2.5 rounded-lg border border-stone-200 bg-white p-3.5 text-xs text-stone-700">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-emerald-900" />
              <span className="leading-relaxed">
                Au clic sur « Confirmer mes demandes », le serveur vérifie d’abord votre éligibilité, puis traite chaque ligne : retenue 24 h pour retrait au comptoir (scan carte membre + exemplaire), réservation FIFO, ou refus motivé conservant les autres lignes acceptées.
              </span>
            </div>

            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={confirming}
              className="w-full min-h-[44px] rounded-lg bg-emerald-900 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 disabled:opacity-60 cursor-pointer"
            >
              {confirming ? 'Vérification serveur en cours…' : 'Confirmer mes demandes'}
            </button>
          </aside>
        </div>
      )}
    </div>
  );
}
