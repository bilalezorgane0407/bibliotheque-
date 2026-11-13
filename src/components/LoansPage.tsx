import { useEffect, useState } from 'react';
import { AlertCircle, BookOpen, CheckCircle2, Clock } from 'lucide-react';
import type { LoanRecord, UserPublic } from '../../shared/types.ts';
import { api, ApiError, daysRemainingFromNow, formatDateFr } from '../lib/api.ts';
import { BookCover } from './BookCover.tsx';

interface LoansPageProps {
  user: UserPublic | null;
  onRequireAuth: () => void;
  onOpenBook: (bookId: string) => void;
  onBrowseCatalogue: () => void;
}

export function LoansPage({
  user,
  onRequireAuth,
  onOpenBook,
  onBrowseCatalogue,
}: LoansPageProps) {
  const [loans, setLoans] = useState<LoanRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadLoans = async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.getMyLoans();
      setLoans(res.loans);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Impossible de charger vos emprunts.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadLoans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="font-editorial text-2xl font-semibold text-stone-950">
          Authentification requise
        </h1>
        <p className="mt-2 text-sm text-stone-600">
          Connectez-vous avec votre compte USMBA pour consulter vos emprunts en cours et votre historique.
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

  const activeLoans = loans.filter((l) => l.status !== 'Retourné');
  const pastLoans = loans.filter((l) => l.status === 'Retourné');

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="border-b border-stone-200 pb-6">
        <p className="text-xs font-semibold text-emerald-900">Dossier lecteur EST Fès</p>
        <h1 className="mt-1 font-editorial text-3xl font-semibold text-stone-950">
          Mes emprunts
        </h1>
        <p className="mt-2 text-sm text-stone-600">
          Durée réglementaire de prêt : 7 jours. Tout retard bloque temporairement les nouveaux emprunts et réservations.
        </p>
      </div>

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
      ) : loans.length === 0 ? (
        <div className="mt-8 rounded-xl border border-stone-200 bg-white p-12 text-center">
          <BookOpen className="mx-auto h-10 w-10 text-stone-400" />
          <h2 className="mt-3 font-editorial text-xl font-semibold text-stone-900">
            Aucun emprunt enregistré
          </h2>
          <p className="mt-1 text-sm text-stone-600">
            Parcourez le catalogue pour emprunter un ouvrage disponible.
          </p>
          <button
            type="button"
            onClick={onBrowseCatalogue}
            className="mt-5 rounded-lg bg-emerald-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 cursor-pointer"
          >
            Explorer le catalogue
          </button>
        </div>
      ) : (
        <div className="mt-8 space-y-10">
          <section>
            <h2 className="font-editorial text-xl font-semibold text-stone-950">
              Emprunts en cours ({activeLoans.length})
            </h2>

            {activeLoans.length === 0 ? (
              <p className="mt-3 text-sm text-stone-600">
                Vous n’avez actuellement aucun ouvrage en cours d’emprunt.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {activeLoans.map((loan) => {
                  const daysLeft = daysRemainingFromNow(loan.dueAt);
                  const isOverdue = loan.status === 'En retard' || (daysLeft !== null && daysLeft < 0);
                  return (
                    <div
                      key={loan.id}
                      className="flex flex-col gap-4 rounded-xl border border-stone-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-start gap-4">
                        <div className="h-20 w-15 shrink-0 overflow-hidden rounded-md border border-stone-200">
                          <BookCover
                            src={loan.bookCoverImage}
                            alt={loan.bookTitle}
                            title={loan.bookTitle}
                            className="h-full w-full"
                          />
                        </div>
                        <div>
                          <button
                            type="button"
                            onClick={() => onOpenBook(loan.bookId)}
                            className="text-left font-editorial text-lg font-semibold text-stone-900 hover:text-emerald-900 cursor-pointer"
                          >
                            {loan.bookTitle}
                          </button>
                          <p className="text-xs text-stone-600">{loan.bookAuthors}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500 font-mono tabular-nums">
                            <span>Exemplaire {loan.copyBarcode}</span>
                            <span aria-hidden="true">·</span>
                            <span>Emprunté le {formatDateFr(loan.borrowedAt)}</span>
                          </div>
                        </div>
                      </div>

                      <div className="sm:text-right">
                        {isOverdue ? (
                          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700">
                            <AlertCircle className="h-4 w-4 shrink-0" />
                            En retard (échéance {formatDateFr(loan.dueAt)})
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
                            <Clock className="h-4 w-4 shrink-0" />
                            À rendre le {formatDateFr(loan.dueAt)}
                          </div>
                        )}
                        <p className="mt-1 text-xs text-stone-500 tabular-nums">
                          {isOverdue
                            ? 'Restitution attendue immédiatement à la banque d’accueil'
                            : daysLeft === 0
                              ? 'Échéance aujourd’hui'
                              : `${daysLeft} jour${daysLeft && daysLeft > 1 ? 's' : ''} restant${daysLeft && daysLeft > 1 ? 's' : ''}`}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {pastLoans.length > 0 && (
            <section>
              <h2 className="font-editorial text-xl font-semibold text-stone-950">
                Historique des emprunts restitués ({pastLoans.length})
              </h2>
              <div className="mt-4 overflow-x-auto rounded-xl border border-stone-200">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-stone-200 bg-stone-50 text-xs font-semibold text-stone-700">
                    <tr>
                      <th className="px-4 py-3">Ouvrage</th>
                      <th className="px-4 py-3">Code-barres</th>
                      <th className="px-4 py-3">Emprunté le</th>
                      <th className="px-4 py-3">Restitué le</th>
                      <th className="px-4 py-3">État au retour</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100 bg-white">
                    {pastLoans.map((loan) => (
                      <tr key={loan.id}>
                        <td className="px-4 py-3 font-medium text-stone-900">
                          <button
                            type="button"
                            onClick={() => onOpenBook(loan.bookId)}
                            className="text-left hover:text-emerald-900 hover:underline cursor-pointer"
                          >
                            {loan.bookTitle}
                          </button>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-stone-600">
                          {loan.copyBarcode}
                        </td>
                        <td className="px-4 py-3 text-xs text-stone-600 tabular-nums">
                          {formatDateFr(loan.borrowedAt)}
                        </td>
                        <td className="px-4 py-3 text-xs text-stone-600 tabular-nums">
                          <span className="inline-flex items-center gap-1 text-emerald-800 font-medium">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {formatDateFr(loan.returnedAt)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-stone-600">
                          {loan.returnCondition || 'Bon état'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
