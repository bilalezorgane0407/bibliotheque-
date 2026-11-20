import { useEffect, useState } from 'react';
import { AlertCircle, BookOpen, CheckCircle2, Clock, FileText, QrCode, X } from 'lucide-react';
import QRCode from 'qrcode';
import type { LoanRecord, UserPublic } from '../../shared/types.ts';
import { api, ApiError, daysRemainingFromNow, formatDateFr } from '../lib/api.ts';
import { BookCover } from './BookCover.tsx';
import { generateLoanReceiptPdf } from '../lib/receiptPdf.ts';

interface LoansPageProps {
  user: UserPublic | null;
  simulatedNow?: string | null;
  onRequireAuth: () => void;
  onOpenBook: (bookId: string) => void;
  onBrowseCatalogue: () => void;
}

export function LoansPage({
  user,
  simulatedNow,
  onRequireAuth,
  onOpenBook,
  onBrowseCatalogue,
}: LoansPageProps) {
  const [loans, setLoans] = useState<LoanRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedQrLoan, setSelectedQrLoan] = useState<LoanRecord | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const handleOpenQr = async (loan: LoanRecord) => {
    setSelectedQrLoan(loan);
    const payload = JSON.stringify({
      type: 'BIBLIOEST_COPY',
      loanId: loan.id,
      bookTitle: loan.bookTitle,
      copyBarcode: loan.copyBarcode,
      shelfLocation: loan.shelfLocation,
      memberName: user?.fullName,
      memberEmail: user?.email,
      dueAt: loan.dueAt,
    });
    try {
      const url = await QRCode.toDataURL(payload, {
        width: 300,
        margin: 1,
        color: { dark: '#144628', light: '#ffffff' },
      });
      setQrDataUrl(url);
    } catch {
      setQrDataUrl(null);
    }
  };

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
  }, [user?.id, simulatedNow]);

  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-14 text-center">
        <h1 className="font-editorial text-2xl font-semibold text-stone-950">
          Authentification requise
        </h1>
        <p className="mt-2 text-sm text-stone-600">
          Connectez-vous avec votre compte USMBA pour consulter vos emprunts en cours et votre historique.
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

  const activeLoans = loans.filter((l) => l.status !== 'Retourné');
  const pastLoans = loans.filter((l) => l.status === 'Retourné');

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="border-b border-stone-200 pb-5">
        <p className="text-xs font-semibold text-emerald-900">Dossier membre BiblioEST</p>
        <h1 className="mt-1 font-editorial text-2xl sm:text-3xl font-semibold text-stone-950">
          Mes emprunts
        </h1>
        <p className="mt-1.5 text-sm text-stone-600">
          Durée réglementaire de prêt : 7 jours. Tout retard bloque temporairement les nouveaux emprunts et réservations.
        </p>
      </div>

      {error && (
        <div role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => void loadLoans()}
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
      ) : !error && loans.length === 0 ? (
        <div className="mt-6 rounded-xl border border-stone-200 bg-white p-8 sm:p-12 text-center">
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
            className="mt-5 min-h-[44px] rounded-lg bg-emerald-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 cursor-pointer"
          >
            Explorer le catalogue
          </button>
        </div>
      ) : !error ? (
        <div className="mt-6 space-y-8">
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
                  const daysLeft = daysRemainingFromNow(loan.dueAt, simulatedNow);
                  const isOverdue =
                    loan.status === 'En retard' || (daysLeft !== null && daysLeft < 0);
                  return (
                    <article
                      key={loan.id}
                      className="rounded-xl border border-stone-200 bg-white p-4 space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 pb-2.5">
                        {isOverdue ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700">
                            <AlertCircle className="h-4 w-4 shrink-0" />
                            En retard · Échéance {formatDateFr(loan.dueAt)}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800">
                            <Clock className="h-4 w-4 shrink-0" />
                            En cours · À rendre le {formatDateFr(loan.dueAt)}
                          </span>
                        )}
                        <span className="text-xs text-stone-500 tabular-nums">
                          {isOverdue
                            ? 'Restitution immédiate requise'
                            : daysLeft === 0
                              ? 'Échéance aujourd’hui'
                              : `${daysLeft} jour${daysLeft && daysLeft > 1 ? 's' : ''} restant${daysLeft && daysLeft > 1 ? 's' : ''}`}
                        </span>
                      </div>

                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3.5 min-w-0">
                          <div className="h-20 w-15 shrink-0 overflow-hidden rounded-md border border-stone-200">
                            <BookCover
                              src={loan.bookCoverImage}
                              alt={loan.bookTitle}
                              title={loan.bookTitle}
                              className="h-full w-full"
                            />
                          </div>
                          <div className="min-w-0">
                            <button
                              type="button"
                              onClick={() => onOpenBook(loan.bookId)}
                              className="text-left font-editorial text-base sm:text-lg font-semibold text-stone-900 hover:text-emerald-900 cursor-pointer"
                            >
                              {loan.bookTitle}
                            </button>
                            <p className="text-xs text-stone-600">{loan.bookAuthors}</p>
                            <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-stone-500 font-mono tabular-nums">
                              <span>{loan.copyBarcode}</span>
                              <span aria-hidden="true">·</span>
                              <span className="font-sans">
                                Emprunté le {formatDateFr(loan.borrowedAt)}
                              </span>
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => onOpenBook(loan.bookId)}
                          className="hidden sm:inline-flex min-h-[38px] shrink-0 items-center rounded-lg border border-stone-200 px-3 text-xs font-semibold text-stone-800 hover:border-emerald-800 cursor-pointer"
                        >
                          Voir la fiche
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-stone-100">
                        <button
                          type="button"
                          onClick={() => void generateLoanReceiptPdf(loan, user)}
                          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-emerald-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 cursor-pointer"
                        >
                          <FileText className="h-3.5 w-3.5" />
                          Télécharger reçu PDF
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleOpenQr(loan)}
                          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-stone-800 hover:border-emerald-900 cursor-pointer"
                        >
                          <QrCode className="h-3.5 w-3.5 text-emerald-900" />
                          Afficher QR Code
                        </button>
                      </div>
                    </article>
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

              {/* Cartes lisibles sur téléphone (zéro scroll horizontal) */}
              <div className="mt-4 space-y-3 md:hidden">
                {pastLoans.map((loan) => (
                  <article
                    key={loan.id}
                    className="rounded-xl border border-stone-200 bg-white p-4 space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 tabular-nums">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                        Restitué le {formatDateFr(loan.returnedAt)}
                      </span>
                      <span className="font-mono text-xs text-stone-500">
                        {loan.copyBarcode}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => onOpenBook(loan.bookId)}
                      className="text-left font-editorial text-base font-semibold text-stone-900 hover:text-emerald-900 cursor-pointer"
                    >
                      {loan.bookTitle}
                    </button>

                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-stone-600 tabular-nums">
                      <span>Emprunté le {formatDateFr(loan.borrowedAt)}</span>
                      <span aria-hidden="true">·</span>
                      <span>État au retour : {loan.returnCondition || 'Bon état'}</span>
                    </div>
                  </article>
                ))}
              </div>

              {/* Tableau structuré sur >= md */}
              <div className="mt-4 hidden md:block rounded-xl border border-stone-200 overflow-x-auto">
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
      ) : null}

      {/* Modale d'affichage du QR Code de l'exemplaire */}
      {selectedQrLoan && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="qr-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/50 p-4"
        >
          <div className="w-full max-w-md rounded-xl border border-stone-200 bg-white p-5 sm:p-6 space-y-4 text-center">
            <div className="flex items-start justify-between gap-3">
              <h3 id="qr-modal-title" className="font-editorial text-xl font-semibold text-stone-950 text-left">
                QR Code de l’exemplaire
              </h3>
              <button
                type="button"
                onClick={() => {
                  setSelectedQrLoan(null);
                  setQrDataUrl(null);
                }}
                aria-label="Fermer"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="text-left space-y-1 text-xs text-stone-600">
              <p className="font-semibold text-stone-900">{selectedQrLoan.bookTitle}</p>
              <p className="font-mono text-emerald-900">Code-barres : {selectedQrLoan.copyBarcode}</p>
              <p>Emprunteur : {user.fullName} ({user.email})</p>
              <p>Échéance : {formatDateFr(selectedQrLoan.dueAt)}</p>
            </div>

            <div className="flex justify-center p-3 bg-stone-50 rounded-lg border border-stone-200">
              {qrDataUrl ? (
                <img src={qrDataUrl} alt="QR Code exemplaire" className="h-48 w-48 object-contain" />
              ) : (
                <div className="h-48 w-48 flex items-center justify-center text-xs text-stone-400 animate-pulse">
                  Génération du QR Code…
                </div>
              )}
            </div>

            <p className="text-[11px] text-stone-500 leading-relaxed">
              Scannez ce QR Code avec un appareil photo ou un lecteur de QR code pour afficher instantanément les informations de l’exemplaire.
            </p>

            <div className="flex flex-wrap justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => void generateLoanReceiptPdf(selectedQrLoan, user)}
                className="w-full min-h-[42px] inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-900 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 cursor-pointer"
              >
                <FileText className="h-4 w-4" />
                Télécharger le reçu PDF officiel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
