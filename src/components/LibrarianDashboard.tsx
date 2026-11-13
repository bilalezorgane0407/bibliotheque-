import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Edit3,
  Mail,
  Plus,
  RefreshCw,
  ShieldAlert,
  Users,
  Wrench,
} from 'lucide-react';
import {
  BOOK_LANGUAGES,
  EST_DEPARTMENTS,
  type AccountStatus,
  type BookWithStats,
  type Copy,
  type DashboardStats,
  type LoanRecord,
  type PhysicalCondition,
  type ReservationRecord,
  type ReturnInspectionOutcome,
  type StudentStatus,
  type UserPublic,
} from '../../shared/types.ts';
import { api, ApiError, formatDateFr, formatDateTimeFr } from '../lib/api.ts';

type AdminTab =
  | 'overview'
  | 'catalogue'
  | 'copies'
  | 'loans'
  | 'reservations'
  | 'members';

const COVER_PRESETS = [
  {
    label: 'Génie Informatique',
    url: '/src/assets/images/cover_informatique_1794527753411.jpg',
  },
  {
    label: 'Génie Électrique',
    url: '/src/assets/images/cover_genie_electrique_1794527754591.jpg',
  },
  {
    label: 'Techniques de Management',
    url: '/src/assets/images/cover_gestion_economie_1794527755509.jpg',
  },
  {
    label: 'Génie Mécanique',
    url: '/src/assets/images/cover_genie_mecanique_1794527754806.jpg',
  },
  {
    label: 'Mathématiques & Procédés',
    url: '/src/assets/images/cover_mathematiques_1794527754705.jpg',
  },
];

interface LibrarianDashboardProps {
  user: UserPublic | null;
  onDataMutated: () => Promise<void>;
}

export function LibrarianDashboard({ user, onDataMutated }: LibrarianDashboardProps) {
  const [tab, setTab] = useState<AdminTab>('overview');
  const [showOnlyOverdue, setShowOnlyOverdue] = useState(false);
  const [sendingOverdueReminders, setSendingOverdueReminders] = useState(false);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [books, setBooks] = useState<BookWithStats[]>([]);
  const [copies, setCopies] = useState<Array<Copy & { bookTitle: string; bookCategory: string }>>([]);
  const [loans, setLoans] = useState<LoanRecord[]>([]);
  const [reservations, setReservations] = useState<ReservationRecord[]>([]);
  const [members, setMembers] = useState<UserPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  // Formulaire ajout/édition livre
  const [showBookForm, setShowBookForm] = useState(false);
  const [editingBookId, setEditingBookId] = useState<string | null>(null);
  const [bookForm, setBookForm] = useState({
    title: '',
    authors: '',
    isbn: '',
    category: EST_DEPARTMENTS[0] as string,
    description: '',
    publisher: 'Dunod',
    publicationYear: 2025,
    edition: '1re édition',
    language: 'Français',
    coverImage: COVER_PRESETS[0].url,
    shelfLocation: '',
    featured: false,
  });

  // Formulaire nouvel exemplaire
  const [copyForm, setCopyForm] = useState({
    bookId: '',
    barcode: '',
    physicalCondition: 'Neuf' as PhysicalCondition,
    location: '',
  });

  // Modale inspection de retour
  const [returningLoan, setReturningLoan] = useState<LoanRecord | null>(null);
  const [returnOutcome, setReturnOutcome] = useState<ReturnInspectionOutcome>('reutilisable');
  const [returnCondition, setReturnCondition] = useState<PhysicalCondition>('Bon état');
  const [returnNotes, setReturnNotes] = useState('');

  // Modale inspection post-réparation
  const [inspectingCopy, setInspectingCopy] = useState<(Copy & { bookTitle: string }) | null>(null);
  const [inspectOutcome, setInspectOutcome] = useState<ReturnInspectionOutcome>('reutilisable');
  const [inspectCondition, setInspectCondition] = useState<PhysicalCondition>('Bon état');

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [sRes, bRes, cRes, lRes, rRes, mRes] = await Promise.all([
        api.adminGetStats(),
        api.adminGetBooks(),
        api.adminGetCopies(),
        api.adminGetLoans(),
        api.adminGetReservations(),
        api.adminGetMembers(),
      ]);
      setStats(sRes.stats);
      setBooks(bRes.books);
      setCopies(cRes.copies);
      setLoans(lRes.loans);
      setReservations(rRes.reservations);
      setMembers(mRes.members);
      if (!copyForm.bookId && bRes.books.length > 0) {
        setCopyForm((prev) => ({
          ...prev,
          bookId: bRes.books[0].id,
          location: `Rayon · ${bRes.books[0].shelfLocation}`,
        }));
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Impossible de charger les données d’administration.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user?.role === 'bibliothecaire') {
      void loadAll();
    } else {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.role]);

  if (!user || user.role !== 'bibliothecaire') {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <ShieldAlert className="mx-auto h-10 w-10 text-red-700" />
        <h1 className="mt-3 font-editorial text-2xl font-semibold text-stone-950">
          Accès strictement réservé aux bibliothécaires
        </h1>
        <p className="mt-2 text-sm text-stone-600">
          Les opérations d’administration, de retour et de gestion du fonds sont protégées côté serveur et interdites aux comptes étudiants.
        </p>
      </div>
    );
  }

  const handleSaveBook = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBanner(null);
    try {
      if (editingBookId) {
        await api.adminUpdateBook(editingBookId, bookForm);
        setBanner('Fiche ouvrage mise à jour.');
      } else {
        await api.adminCreateBook(bookForm);
        setBanner('Nouvel ouvrage ajouté au catalogue.');
      }
      setShowBookForm(false);
      setEditingBookId(null);
      await Promise.all([loadAll(), onDataMutated()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur lors de la sauvegarde.');
    }
  };

  const handleToggleArchive = async (book: BookWithStats) => {
    setError(null);
    setBanner(null);
    try {
      await api.adminUpdateBook(book.id, { archived: !book.archived });
      setBanner(
        book.archived
          ? `« ${book.title} » restauré dans le catalogue.`
          : `« ${book.title} » archivé.`
      );
      await Promise.all([loadAll(), onDataMutated()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Action impossible.');
    }
  };

  const handleRegisterCopy = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBanner(null);
    try {
      const res = await api.adminRegisterCopy(copyForm.bookId, {
        barcode: copyForm.barcode,
        physicalCondition: copyForm.physicalCondition,
        location: copyForm.location,
      });
      setBanner(
        res.assignedReservationId
          ? `Exemplaire ${res.copy.barcode} enregistré et immédiatement attribué à la première réservation en attente.`
          : `Exemplaire ${res.copy.barcode} enregistré.`
      );
      setCopyForm((prev) => ({ ...prev, barcode: '' }));
      await Promise.all([loadAll(), onDataMutated()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur lors de l’ajout de l’exemplaire.');
    }
  };

  const handleReturnSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!returningLoan) return;
    setError(null);
    setBanner(null);
    try {
      const res = await api.adminReturnLoan(returningLoan.id, {
        outcome: returnOutcome,
        physicalCondition: returnCondition,
        notes: returnNotes,
      });
      setBanner(
        res.assignedReservationId
          ? 'Retour enregistré. L’exemplaire réutilisable a été attribué au plus ancien membre de la file FIFO (fenêtre de retrait 3 jours).'
          : 'Retour et inspection physique enregistrés.'
      );
      setReturningLoan(null);
      setReturnNotes('');
      await Promise.all([loadAll(), onDataMutated()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur lors de l’enregistrement du retour.');
    }
  };

  const handleCompleteRepair = async (copyId: string) => {
    setError(null);
    setBanner(null);
    try {
      await api.adminCompleteRepair(copyId);
      setBanner(
        'Réparation terminée. L’exemplaire reste bloqué jusqu’à validation de l’inspection finale.'
      );
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur.');
    }
  };

  const handleInspectRepairedSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inspectingCopy) return;
    setError(null);
    setBanner(null);
    try {
      const res = await api.adminInspectRepairedCopy(inspectingCopy.id, {
        outcome: inspectOutcome,
        physicalCondition: inspectCondition,
      });
      setBanner(
        res.assignedReservationId
          ? 'Inspection validée : exemplaire attribué à la file d’attente FIFO.'
          : 'Inspection post-réparation enregistrée.'
      );
      setInspectingCopy(null);
      await Promise.all([loadAll(), onDataMutated()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur lors de l’inspection.');
    }
  };

  const handlePickup = async (reservationId: string) => {
    setError(null);
    setBanner(null);
    try {
      await api.adminPickupReservation(reservationId);
      setBanner('Retrait validé : un emprunt de 7 jours a été créé.');
      await Promise.all([loadAll(), onDataMutated()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur lors du retrait.');
    }
  };

  const handleAdminCancelReservation = async (reservationId: string) => {
    setError(null);
    setBanner(null);
    try {
      await api.adminCancelReservation(reservationId);
      setBanner('Réservation annulée et file d’attente mise à jour.');
      await Promise.all([loadAll(), onDataMutated()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur.');
    }
  };

  const handleProcessDeadlines = async () => {
    setError(null);
    setBanner(null);
    try {
      const res = await api.adminProcessDeadlines();
      setBanner(
        `${res.expiredCount} réservation(s) expirée(s) traitée(s) et réattribuée(s) le cas échéant.`
      );
      await Promise.all([loadAll(), onDataMutated()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur.');
    }
  };

  const openOverdueLoans = () => {
    setShowOnlyOverdue(true);
    setTab('loans');
  };

  const handleSendOverdueReminders = async () => {
    const overdue = loans.filter((loan) => loan.status === 'En retard');
    const recipientCount = new Set(
      overdue.filter((loan) => Boolean(loan.memberEmail?.trim())).map((loan) => loan.memberId)
    ).size;

    if (recipientCount === 0) {
      setBanner('Aucun membre avec une adresse e-mail valide à notifier.');
      setError(null);
      return;
    }

    const confirmed = window.confirm(
      `Envoyer un e-mail de rappel à ${recipientCount} membre(s), avec le récapitulatif de leurs emprunts en retard ?`
    );
    if (!confirmed) return;

    setSendingOverdueReminders(true);
    setError(null);
    setBanner(null);
    try {
      const result = await api.adminSendOverdueReminders();
      const summary = [`${result.acceptedCount} message(s) accepté(s) pour envoi`];
      if (result.failedCount > 0) summary.push(`${result.failedCount} échec(s)`);
      if (result.skippedCount > 0) summary.push(`${result.skippedCount} adresse(s) ignorée(s)`);
      setBanner(`${summary.join(' · ')}.`);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Impossible d’envoyer les rappels par e-mail.'
      );
    } finally {
      setSendingOverdueReminders(false);
    }
  };

  const handleUpdateMember = async (
    memberId: string,
    studentStatus: StudentStatus,
    accountStatus: AccountStatus
  ) => {
    setError(null);
    setBanner(null);
    try {
      await api.adminUpdateMemberVerification(memberId, studentStatus, accountStatus);
      setBanner('Statut membre mis à jour.');
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur.');
    }
  };

  const deptStats = EST_DEPARTMENTS.map((dep) => {
    const depBooks = books.filter((b) => !b.archived && b.category === dep);
    return {
      department: dep,
      titles: depBooks.length,
      available: depBooks.reduce((s, b) => s + b.availableCopies, 0),
      borrowed: depBooks.reduce((s, b) => s + b.borrowedCopies, 0),
      total: depBooks.reduce((s, b) => s + b.totalCopies, 0),
    };
  });
  const displayedLoans = showOnlyOverdue
    ? loans.filter((loan) => loan.status === 'En retard')
    : loans;
  const overdueRecipientCount = new Set(
    loans
      .filter((loan) => loan.status === 'En retard')
      .filter((loan) => Boolean(loan.memberEmail?.trim()))
      .map((loan) => loan.memberId)
  ).size;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 border-b border-stone-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-emerald-900">
            Administration Bibliothèque · EST Fès (USMBA)
          </p>
          <h1 className="mt-1 font-editorial text-3xl font-semibold text-stone-950">
            Tableau de bord bibliothécaire
          </h1>
        </div>
        <button
          type="button"
          onClick={() => void loadAll()}
          className="inline-flex items-center gap-2 self-start rounded-lg border border-stone-300 bg-white px-4 py-2 text-xs font-semibold text-stone-800 hover:bg-stone-50 cursor-pointer"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Actualiser les données
        </button>
      </div>

      {/* Indicateurs réels issus de SQLite */}
      {stats && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          <div className="rounded-xl border border-stone-200 bg-white p-3.5">
            <div className="font-mono text-xl font-semibold text-stone-950 tabular-nums">
              {stats.totalTitles}
            </div>
            <div className="mt-0.5 text-[11px] text-stone-600">Titres actifs</div>
          </div>
          <div className="rounded-xl border border-stone-200 bg-white p-3.5">
            <div className="font-mono text-xl font-semibold text-stone-950 tabular-nums">
              {stats.totalPhysicalCopies}
            </div>
            <div className="mt-0.5 text-[11px] text-stone-600">Exemplaires actifs</div>
          </div>
          <div className="rounded-xl border border-stone-200 bg-white p-3.5">
            <div className="font-mono text-xl font-semibold text-emerald-900 tabular-nums">
              {stats.availableCopies}
            </div>
            <div className="mt-0.5 text-[11px] text-stone-600">Disponibles</div>
          </div>
          <div className="rounded-xl border border-stone-200 bg-white p-3.5">
            <div className="font-mono text-xl font-semibold text-stone-950 tabular-nums">
              {stats.borrowedCopies}
            </div>
            <div className="mt-0.5 text-[11px] text-stone-600">Empruntés</div>
          </div>
          <div className="rounded-xl border border-stone-200 bg-white p-3.5">
            <div className="font-mono text-xl font-semibold text-amber-800 tabular-nums">
              {stats.pendingReservations}
            </div>
            <div className="mt-0.5 text-[11px] text-stone-600">File FIFO</div>
          </div>
          <div className="rounded-xl border border-stone-200 bg-white p-3.5">
            <div className="font-mono text-xl font-semibold text-emerald-800 tabular-nums">
              {stats.awaitingPickupReservations}
            </div>
            <div className="mt-0.5 text-[11px] text-stone-600">Prêts à retirer</div>
          </div>
          <button
            type="button"
            onClick={openOverdueLoans}
            aria-label={`Afficher les ${stats.overdueLoans} emprunts en retard`}
            className="rounded-xl border border-red-200 bg-white p-3.5 text-left transition-colors hover:border-red-400 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700"
          >
            <div className="font-mono text-xl font-semibold text-red-700 tabular-nums">
              {stats.overdueLoans}
            </div>
            <div className="mt-0.5 text-[11px] text-stone-600">Emprunts en retard</div>
          </button>
          <div className="rounded-xl border border-stone-200 bg-white p-3.5">
            <div className="font-mono text-xl font-semibold text-stone-800 tabular-nums">
              {stats.repairCopies}
            </div>
            <div className="mt-0.5 text-[11px] text-stone-600">En réparation</div>
          </div>
        </div>
      )}

      {/* Navigation des sections */}
      <div className="mt-6 flex flex-wrap gap-1 rounded-xl border border-stone-200 bg-stone-100 p-1">
        {[
          { id: 'overview', label: 'Inventaire & Statistiques' },
          { id: 'catalogue', label: 'Catalogue' },
          { id: 'copies', label: 'Exemplaires physiques' },
          { id: 'loans', label: 'Emprunts & Retours' },
          { id: 'reservations', label: 'Réservations & File FIFO' },
          { id: 'members', label: 'Membres EST Fès' },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id as AdminTab)}
            className={`whitespace-nowrap shrink-0 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors cursor-pointer ${
              tab === item.id
                ? 'bg-white text-emerald-950 shadow-xs'
                : 'text-stone-600 hover:text-stone-900'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {banner && (
        <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
          {banner}
        </div>
      )}

      {error && (
        <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </div>
      )}

      {loading ? (
        <div className="mt-8 h-64 animate-pulse rounded-xl bg-stone-100" />
      ) : (
        <div className="mt-8">
          {/* 1. VUE D'ENSEMBLE & STATISTIQUES */}
          {tab === 'overview' && (
            <div className="grid gap-8 lg:grid-cols-12">
              <div className="lg:col-span-7 rounded-xl border border-stone-200 bg-white p-6">
                <h2 className="font-editorial text-xl font-semibold text-stone-950">
                  Répartition du fonds par département
                </h2>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-stone-200 text-xs font-semibold text-stone-600">
                      <tr>
                        <th className="py-2.5 pr-4">Département</th>
                        <th className="py-2.5 px-3 text-right">Titres</th>
                        <th className="py-2.5 px-3 text-right">Exemplaires</th>
                        <th className="py-2.5 px-3 text-right">Disponibles</th>
                        <th className="py-2.5 pl-3 text-right">Empruntés</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100 tabular-nums">
                      {deptStats.map((d) => (
                        <tr key={d.department}>
                          <td className="py-3 pr-4 font-medium text-stone-900">
                            {d.department}
                          </td>
                          <td className="py-3 px-3 text-right font-mono text-xs">{d.titles}</td>
                          <td className="py-3 px-3 text-right font-mono text-xs">{d.total}</td>
                          <td className="py-3 px-3 text-right font-mono text-xs text-emerald-800 font-semibold">
                            {d.available}
                          </td>
                          <td className="py-3 pl-3 text-right font-mono text-xs">{d.borrowed}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="lg:col-span-5 space-y-6">
                <div className="rounded-xl border border-stone-200 bg-white p-6">
                  <h2 className="font-editorial text-xl font-semibold text-stone-950">
                    Alertes opérationnelles
                  </h2>
                  <div className="mt-4 space-y-3 text-sm">
                    <div className="flex items-center justify-between border-b border-stone-100 pb-3">
                      <span className="inline-flex items-center gap-2 text-red-800 font-medium">
                        <AlertTriangle className="h-4 w-4" />
                        Emprunts en retard
                      </span>
                      <button
                        type="button"
                        onClick={openOverdueLoans}
                        className="font-mono text-xs font-semibold text-emerald-900 underline cursor-pointer tabular-nums"
                      >
                        {stats?.overdueLoans || 0} dossier(s)
                      </button>
                    </div>
                    <div className="flex items-center justify-between border-b border-stone-100 pb-3">
                      <span className="inline-flex items-center gap-2 text-emerald-900 font-medium">
                        <Clock className="h-4 w-4" />
                        Réservations à retirer (fenêtre 3 j)
                      </span>
                      <button
                        type="button"
                        onClick={() => setTab('reservations')}
                        className="font-mono text-xs font-semibold text-emerald-900 underline cursor-pointer tabular-nums"
                      >
                        {stats?.awaitingPickupReservations || 0} exemplaire(s)
                      </button>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-2 text-stone-800 font-medium">
                        <Wrench className="h-4 w-4" />
                        Exemplaires en réparation / à inspecter
                      </span>
                      <button
                        type="button"
                        onClick={() => setTab('copies')}
                        className="font-mono text-xs font-semibold text-emerald-900 underline cursor-pointer tabular-nums"
                      >
                        {stats?.repairCopies || 0} exemplaire(s)
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 2. GESTION DU CATALOGUE */}
          {tab === 'catalogue' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="font-editorial text-xl font-semibold text-stone-950">
                  Catalogue complet ({books.length} titres)
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    setEditingBookId(null);
                    setBookForm({
                      title: '',
                      authors: '',
                      isbn: '',
                      category: EST_DEPARTMENTS[0],
                      description: '',
                      publisher: 'Dunod',
                      publicationYear: 2025,
                      edition: '1re édition',
                      language: 'Français',
                      coverImage: COVER_PRESETS[0].url,
                      shelfLocation: '',
                      featured: false,
                    });
                    setShowBookForm((v) => !v);
                  }}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-900 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                  Ajouter un ouvrage
                </button>
              </div>

              {showBookForm && (
                <form
                  onSubmit={handleSaveBook}
                  className="rounded-xl border border-stone-200 bg-stone-50/70 p-6 space-y-4"
                >
                  <h3 className="font-editorial text-lg font-semibold text-stone-950">
                    {editingBookId ? 'Modifier la notice bibliographique' : 'Nouvel ouvrage'}
                  </h3>

                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <div>
                      <label className="block text-xs font-semibold text-stone-700">Titre *</label>
                      <input
                        type="text"
                        required
                        value={bookForm.title}
                        onChange={(e) => setBookForm({ ...bookForm, title: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-stone-700">Auteur(s) *</label>
                      <input
                        type="text"
                        required
                        value={bookForm.authors}
                        onChange={(e) => setBookForm({ ...bookForm, authors: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-stone-700">ISBN</label>
                      <input
                        type="text"
                        value={bookForm.isbn}
                        onChange={(e) => setBookForm({ ...bookForm, isbn: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-stone-700">Département *</label>
                      <select
                        value={bookForm.category}
                        onChange={(e) => setBookForm({ ...bookForm, category: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                      >
                        {EST_DEPARTMENTS.map((d) => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-stone-700">Éditeur</label>
                      <input
                        type="text"
                        value={bookForm.publisher}
                        onChange={(e) => setBookForm({ ...bookForm, publisher: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-stone-700">Cote rayonnage *</label>
                      <input
                        type="text"
                        required
                        placeholder="Ex. INF-04-B"
                        value={bookForm.shelfLocation}
                        onChange={(e) =>
                          setBookForm({ ...bookForm, shelfLocation: e.target.value })
                        }
                        className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-stone-700">Année</label>
                      <input
                        type="number"
                        value={bookForm.publicationYear}
                        onChange={(e) =>
                          setBookForm({ ...bookForm, publicationYear: Number(e.target.value) })
                        }
                        className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-stone-700">Édition</label>
                      <input
                        type="text"
                        value={bookForm.edition}
                        onChange={(e) => setBookForm({ ...bookForm, edition: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-stone-700">Langue</label>
                      <select
                        value={bookForm.language}
                        onChange={(e) => setBookForm({ ...bookForm, language: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                      >
                        {BOOK_LANGUAGES.map((l) => (
                          <option key={l} value={l}>{l}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-semibold text-stone-700">Couverture</label>
                      <select
                        value={bookForm.coverImage}
                        onChange={(e) => setBookForm({ ...bookForm, coverImage: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                      >
                        {COVER_PRESETS.map((c) => (
                          <option key={c.label} value={c.url}>{c.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-end pb-2">
                      <label className="inline-flex items-center gap-2 text-sm font-medium text-stone-800 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={bookForm.featured}
                          onChange={(e) => setBookForm({ ...bookForm, featured: e.target.checked })}
                          className="h-4 w-4 rounded border-stone-300"
                        />
                        Mettre en avant sur la page d’accueil
                      </label>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-stone-700">Description</label>
                    <textarea
                      rows={3}
                      value={bookForm.description}
                      onChange={(e) => setBookForm({ ...bookForm, description: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                    />
                  </div>

                  <div className="flex gap-3">
                    <button
                      type="submit"
                      className="rounded-lg bg-emerald-900 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-800 cursor-pointer"
                    >
                      Enregistrer
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowBookForm(false)}
                      className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-xs font-semibold text-stone-700 cursor-pointer"
                    >
                      Annuler
                    </button>
                  </div>
                </form>
              )}

              <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-stone-200 bg-stone-50 text-xs font-semibold text-stone-700">
                    <tr>
                      <th className="px-4 py-3">Titre & Auteurs</th>
                      <th className="px-4 py-3">Département</th>
                      <th className="px-4 py-3">Cote</th>
                      <th className="px-4 py-3 text-right">Dispo / Actifs</th>
                      <th className="px-4 py-3">Statut</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {books.map((b) => (
                      <tr key={b.id} className={b.archived ? 'bg-stone-50 opacity-70' : ''}>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-stone-900">{b.title}</div>
                          <div className="text-xs text-stone-500">{b.authors}</div>
                        </td>
                        <td className="px-4 py-3 text-xs text-stone-700">{b.category}</td>
                        <td className="px-4 py-3 font-mono text-xs text-stone-800">{b.shelfLocation}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                          {b.availableCopies} / {b.totalCopies}
                        </td>
                        <td className="px-4 py-3 text-xs font-medium">
                          {b.archived ? 'Archivé' : 'Actif'}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingBookId(b.id);
                              setBookForm({
                                title: b.title,
                                authors: b.authors,
                                isbn: b.isbn || '',
                                category: b.category,
                                description: b.description,
                                publisher: b.publisher,
                                publicationYear: b.publicationYear,
                                edition: b.edition,
                                language: b.language,
                                coverImage: b.coverImage,
                                shelfLocation: b.shelfLocation,
                                featured: b.featured,
                              });
                              setShowBookForm(true);
                            }}
                            className="mr-3 inline-flex items-center gap-1 text-xs font-semibold text-emerald-900 hover:underline cursor-pointer"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                            Modifier
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleToggleArchive(b)}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-stone-700 hover:text-red-800 cursor-pointer"
                          >
                            <Archive className="h-3.5 w-3.5" />
                            {b.archived ? 'Restaurer' : 'Archiver'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 3. EXEMPLAIRES PHYSIQUES & RÉPARATIONS */}
          {tab === 'copies' && (
            <div className="space-y-6">
              <form
                onSubmit={handleRegisterCopy}
                className="rounded-xl border border-stone-200 bg-stone-50/70 p-5"
              >
                <h2 className="font-editorial text-lg font-semibold text-stone-950">
                  Enregistrer un nouvel exemplaire physique
                </h2>
                <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5 items-end">
                  <div className="lg:col-span-2">
                    <label className="block text-xs font-semibold text-stone-700">Ouvrage</label>
                    <select
                      value={copyForm.bookId}
                      onChange={(e) => {
                        const selected = books.find((b) => b.id === e.target.value);
                        setCopyForm({
                          ...copyForm,
                          bookId: e.target.value,
                          location: selected ? `Rayon · ${selected.shelfLocation}` : '',
                        });
                      }}
                      className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                    >
                      {books
                        .filter((b) => !b.archived)
                        .map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.title}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-stone-700">Code-barres *</label>
                    <input
                      type="text"
                      required
                      placeholder="EST-INF-0099"
                      value={copyForm.barcode}
                      onChange={(e) => setCopyForm({ ...copyForm, barcode: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-stone-700">État initial</label>
                    <select
                      value={copyForm.physicalCondition}
                      onChange={(e) =>
                        setCopyForm({
                          ...copyForm,
                          physicalCondition: e.target.value as PhysicalCondition,
                        })
                      }
                      className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                    >
                      <option value="Neuf">Neuf</option>
                      <option value="Bon état">Bon état</option>
                      <option value="Usure légère">Usure légère</option>
                      <option value="Endommagé">Endommagé</option>
                    </select>
                  </div>
                  <div>
                    <button
                      type="submit"
                      className="w-full rounded-lg bg-emerald-900 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 cursor-pointer"
                    >
                      Ajouter l’exemplaire
                    </button>
                  </div>
                </div>
              </form>

              <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-stone-200 bg-stone-50 text-xs font-semibold text-stone-700">
                    <tr>
                      <th className="px-4 py-3">Code-barres</th>
                      <th className="px-4 py-3">Ouvrage</th>
                      <th className="px-4 py-3">Statut</th>
                      <th className="px-4 py-3">État physique</th>
                      <th className="px-4 py-3">Emplacement</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {copies.map((c) => (
                      <tr key={c.id}>
                        <td className="px-4 py-3 font-mono text-xs font-semibold text-stone-900">
                          {c.barcode}
                        </td>
                        <td className="px-4 py-3 text-xs font-medium text-stone-900">
                          {c.bookTitle}
                        </td>
                        <td className="px-4 py-3 text-xs font-semibold text-stone-800">
                          {c.status}
                          {c.needsInspection && c.status === 'En réparation' && (
                            <span className="ml-1.5 text-amber-800">(inspection requise)</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-stone-700">{c.physicalCondition}</td>
                        <td className="px-4 py-3 text-xs text-stone-600">{c.location}</td>
                        <td className="px-4 py-3 text-right whitespace-nowrap space-x-3">
                          {c.status === 'En réparation' && c.physicalCondition === 'Endommagé' && (
                            <button
                              type="button"
                              onClick={() => void handleCompleteRepair(c.id)}
                              className="text-xs font-semibold text-emerald-900 hover:underline cursor-pointer"
                            >
                              Terminer réparation
                            </button>
                          )}
                          {c.status === 'En réparation' && (
                            <button
                              type="button"
                              onClick={() => {
                                setInspectingCopy(c);
                                setInspectOutcome('reutilisable');
                                setInspectCondition('Bon état');
                              }}
                              className="text-xs font-semibold text-amber-800 hover:underline cursor-pointer"
                            >
                              Inspecter après réparation
                            </button>
                          )}
                          {c.status === 'Disponible' && (
                            <button
                              type="button"
                              onClick={() =>
                                void api
                                  .adminUpdateCopyStatus(c.id, {
                                    status: 'Retiré définitivement',
                                    physicalCondition: 'Hors service',
                                    location: 'Archives Réforme',
                                  })
                                  .then(() => Promise.all([loadAll(), onDataMutated()]))
                              }
                              className="text-xs font-semibold text-red-700 hover:underline cursor-pointer"
                            >
                              Retirer définitivement
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 4. EMPRUNTS & RETOURS AVEC INSPECTION */}
          {tab === 'loans' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-editorial text-xl font-semibold text-stone-950">
                  {showOnlyOverdue
                    ? 'Emprunts en retard'
                    : 'Suivi des emprunts et enregistrement des retours'}{' '}
                  ({displayedLoans.length})
                </h2>
                {showOnlyOverdue && (
                  <button
                    type="button"
                    onClick={() => setShowOnlyOverdue(false)}
                    className="text-xs font-semibold text-emerald-900 underline cursor-pointer"
                  >
                    Afficher tous les emprunts
                  </button>
                )}
              </div>
              {displayedLoans.length === 0 ? (
                <div className="rounded-xl border border-stone-200 bg-white px-5 py-10 text-center text-sm text-stone-600">
                  {showOnlyOverdue ? 'Aucun emprunt en retard.' : 'Aucun emprunt à afficher.'}
                </div>
              ) : (
                <>
                  {showOnlyOverdue && (
                    <div className="space-y-3 md:hidden">
                      {displayedLoans.map((loan) => (
                        <article
                          key={loan.id}
                          className="rounded-xl border border-red-200 bg-white p-4 shadow-xs"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <h3 className="font-semibold text-stone-950">{loan.memberName}</h3>
                              <p className="break-all text-xs text-stone-600">{loan.memberEmail}</p>
                            </div>
                            <span className="shrink-0 rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-800">
                              En retard
                            </span>
                          </div>
                          <p className="mt-3 text-sm font-medium text-stone-900">{loan.bookTitle}</p>
                          <p className="mt-1 font-mono text-xs text-stone-500">{loan.copyBarcode}</p>
                          <div className="mt-3 flex items-center justify-between gap-3 border-t border-stone-100 pt-3">
                            <span className="text-xs text-stone-600">
                              Échéance : {formatDateFr(loan.dueAt)}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setReturningLoan(loan);
                                setReturnOutcome('reutilisable');
                                setReturnCondition('Bon état');
                                setReturnNotes('');
                              }}
                              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-900 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
                            >
                              <ClipboardCheck className="h-3.5 w-3.5" />
                              Enregistrer retour
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                  <div
                    className={`${showOnlyOverdue ? 'hidden md:block' : ''} overflow-x-auto rounded-xl border border-stone-200 bg-white`}
                  >
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-stone-200 bg-stone-50 text-xs font-semibold text-stone-700">
                    <tr>
                      <th className="px-4 py-3">Membre</th>
                      <th className="px-4 py-3">Ouvrage & Code-barres</th>
                      <th className="px-4 py-3">Échéance</th>
                      <th className="px-4 py-3">Statut</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {displayedLoans.map((l) => (
                      <tr key={l.id}>
                        <td className="px-4 py-3">
                          <div className="font-medium text-stone-900">{l.memberName}</div>
                          <div className="font-mono text-[11px] text-stone-500">
                            {l.memberEmail} {l.memberCne ? `· ${l.memberCne}` : ''}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-stone-900">{l.bookTitle}</div>
                          <div className="font-mono text-xs text-stone-500">{l.copyBarcode}</div>
                        </td>
                        <td className="px-4 py-3 text-xs tabular-nums text-stone-700">
                          {formatDateFr(l.dueAt)}
                        </td>
                        <td className="px-4 py-3 text-xs font-semibold">
                          <span
                            className={
                              l.status === 'En retard'
                                ? 'text-red-700'
                                : l.status === 'En cours'
                                  ? 'text-emerald-800'
                                  : 'text-stone-500'
                            }
                          >
                            {l.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {l.status !== 'Retourné' ? (
                            <button
                              type="button"
                              onClick={() => {
                                setReturningLoan(l);
                                setReturnOutcome('reutilisable');
                                setReturnCondition('Bon état');
                                setReturnNotes('');
                              }}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 cursor-pointer"
                            >
                              <ClipboardCheck className="h-3.5 w-3.5" />
                              Enregistrer retour
                            </button>
                          ) : (
                            <span className="text-xs text-stone-500">
                              Restitué le {formatDateFr(l.returnedAt)}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                  </div>
                </>
              )}
              {showOnlyOverdue && displayedLoans.length > 0 && (
                <div className="flex flex-col gap-3 rounded-xl border border-red-100 bg-red-50/60 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-stone-700">
                    Un message récapitulatif sera envoyé à chaque membre concerné, une seule fois par membre.
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleSendOverdueReminders()}
                    disabled={sendingOverdueReminders || overdueRecipientCount === 0}
                    className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-emerald-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Mail className="h-4 w-4" />
                    {sendingOverdueReminders
                      ? 'Envoi en cours…'
                      : `Notifier les membres par e-mail (${overdueRecipientCount})`}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 5. RÉSERVATIONS & FILE CHRONOLOGIQUE FIFO */}
          {tab === 'reservations' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <h2 className="font-editorial text-xl font-semibold text-stone-950">
                  File d’attente chronologique FIFO et retraits ({reservations.length})
                </h2>
                <button
                  type="button"
                  onClick={() => void handleProcessDeadlines()}
                  className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-xs font-semibold text-stone-800 hover:bg-stone-50 cursor-pointer"
                >
                  Vérifier et libérer les délais de 3 jours expirés
                </button>
              </div>

              <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-stone-200 bg-stone-50 text-xs font-semibold text-stone-700">
                    <tr>
                      <th className="px-4 py-3">Rang / Date demande</th>
                      <th className="px-4 py-3">Membre</th>
                      <th className="px-4 py-3">Ouvrage</th>
                      <th className="px-4 py-3">Statut / Délai retrait</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {reservations.map((r) => (
                      <tr key={r.id}>
                        <td className="px-4 py-3 font-mono text-xs tabular-nums">
                          {r.queuePosition ? `Rang #${r.queuePosition}` : '—'}
                          <div className="text-[11px] text-stone-500">
                            {formatDateTimeFr(r.requestedAt)}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-stone-900">{r.memberName}</div>
                          <div className="font-mono text-[11px] text-stone-500">{r.memberEmail}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-stone-900">{r.bookTitle}</div>
                          {r.assignedCopyBarcode && (
                            <div className="font-mono text-xs text-emerald-900">
                              Exemplaire attribué : {r.assignedCopyBarcode}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <div className="font-semibold text-stone-900">{r.status}</div>
                          {r.pickupDeadline && r.status === 'Disponible pour retrait' && (
                            <div className="text-stone-600 tabular-nums">
                              Limite : {formatDateTimeFr(r.pickupDeadline)}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap space-x-2">
                          {r.status === 'Disponible pour retrait' && (
                            <button
                              type="button"
                              onClick={() => void handlePickup(r.id)}
                              className="rounded-lg bg-emerald-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 cursor-pointer"
                            >
                              Confirmer retrait (emprunt 7j)
                            </button>
                          )}
                          {(r.status === 'En attente' || r.status === 'Disponible pour retrait') && (
                            <button
                              type="button"
                              onClick={() => void handleAdminCancelReservation(r.id)}
                              className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-semibold text-stone-700 hover:border-red-700 hover:text-red-800 cursor-pointer"
                            >
                              Annuler
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 6. VÉRIFICATION DES MEMBRES EST FÈS */}
          {tab === 'members' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-emerald-900" />
                <h2 className="font-editorial text-xl font-semibold text-stone-950">
                  Validation des comptes étudiants EST Fès ({members.length})
                </h2>
              </div>
              <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-stone-200 bg-stone-50 text-xs font-semibold text-stone-700">
                    <tr>
                      <th className="px-4 py-3">Nom & E-mail</th>
                      <th className="px-4 py-3">Rôle / Filière</th>
                      <th className="px-4 py-3">Statut EST Fès</th>
                      <th className="px-4 py-3">Compte</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {members.map((m) => (
                      <tr key={m.id}>
                        <td className="px-4 py-3">
                          <div className="font-medium text-stone-900">{m.fullName}</div>
                          <div className="font-mono text-xs text-stone-500">{m.email}</div>
                        </td>
                        <td className="px-4 py-3 text-xs text-stone-700">
                          <div>{m.role === 'bibliothecaire' ? 'Bibliothécaire' : 'Étudiant'}</div>
                          <div className="text-stone-500">{m.filiere || m.institution}</div>
                        </td>
                        <td className="px-4 py-3 text-xs font-semibold">
                          {m.studentStatus === 'verifie' ? (
                            <span className="inline-flex items-center gap-1 text-emerald-800">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Vérifié EST Fès
                            </span>
                          ) : (
                            <span className="text-amber-800">{m.studentStatus}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs font-medium">{m.accountStatus}</td>
                        <td className="px-4 py-3 text-right whitespace-nowrap space-x-2">
                          {m.role === 'membre' && m.studentStatus !== 'verifie' && (
                            <button
                              type="button"
                              onClick={() => void handleUpdateMember(m.id, 'verifie', 'actif')}
                              className="rounded-lg bg-emerald-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 cursor-pointer"
                            >
                              Vérifier EST Fès
                            </button>
                          )}
                          {m.role === 'membre' && m.accountStatus === 'actif' && (
                            <button
                              type="button"
                              onClick={() =>
                                void handleUpdateMember(m.id, m.studentStatus, 'suspendu')
                              }
                              className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 cursor-pointer"
                            >
                              Suspendre
                            </button>
                          )}
                          {m.role === 'membre' && m.accountStatus === 'suspendu' && (
                            <button
                              type="button"
                              onClick={() => void handleUpdateMember(m.id, m.studentStatus, 'actif')}
                              className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-semibold text-emerald-900 cursor-pointer"
                            >
                              Réactiver
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modale d'enregistrement de retour et inspection physique */}
      {returningLoan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/50 p-4">
          <form
            onSubmit={handleReturnSubmit}
            className="w-full max-w-lg rounded-xl border border-stone-200 bg-white p-6 space-y-4"
          >
            <h3 className="font-editorial text-xl font-semibold text-stone-950">
              Retour et inspection physique
            </h3>
            <p className="text-xs text-stone-600">
              Ouvrage : <strong>{returningLoan.bookTitle}</strong> (
              <span className="font-mono">{returningLoan.copyBarcode}</span>)
            </p>

            <div>
              <label className="block text-xs font-semibold text-stone-700">
                Décision d’inspection
              </label>
              <select
                value={returnOutcome}
                onChange={(e) => {
                  const val = e.target.value as ReturnInspectionOutcome;
                  setReturnOutcome(val);
                  if (val === 'endommage') setReturnCondition('Endommagé');
                  else if (val === 'retire_definitivement') setReturnCondition('Hors service');
                  else setReturnCondition('Bon état');
                }}
                className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
              >
                <option value="reutilisable">
                  Réutilisable (attribuer à la file FIFO ou remettre disponible)
                </option>
                <option value="endommage">
                  Endommagé (envoyer en réparation — bloquer emprunts/réservations)
                </option>
                <option value="retire_definitivement">
                  Irrécupérable (retirer définitivement de l’inventaire)
                </option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700">
                État physique constaté
              </label>
              <select
                value={returnCondition}
                onChange={(e) => setReturnCondition(e.target.value as PhysicalCondition)}
                className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
              >
                <option value="Neuf">Neuf</option>
                <option value="Bon état">Bon état</option>
                <option value="Usure légère">Usure légère</option>
                <option value="Endommagé">Endommagé</option>
                <option value="Hors service">Hors service</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700">
                Observations (optionnel)
              </label>
              <textarea
                rows={2}
                value={returnNotes}
                onChange={(e) => setReturnNotes(e.target.value)}
                placeholder="Ex. Couverture intacte, pages complètes…"
                className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setReturningLoan(null)}
                className="rounded-lg border border-stone-300 px-4 py-2 text-xs font-semibold text-stone-700 cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="submit"
                className="rounded-lg bg-emerald-900 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-800 cursor-pointer"
              >
                Valider le retour
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modale d'inspection post-réparation */}
      {inspectingCopy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/50 p-4">
          <form
            onSubmit={handleInspectRepairedSubmit}
            className="w-full max-w-lg rounded-xl border border-stone-200 bg-white p-6 space-y-4"
          >
            <h3 className="font-editorial text-xl font-semibold text-stone-950">
              Inspection obligatoire après réparation
            </h3>
            <p className="text-xs text-stone-600">
              Exemplaire <span className="font-mono font-semibold">{inspectingCopy.barcode}</span> —{' '}
              {inspectingCopy.bookTitle}
            </p>

            <div>
              <label className="block text-xs font-semibold text-stone-700">
                Verdict de l’inspection
              </label>
              <select
                value={inspectOutcome}
                onChange={(e) => {
                  const val = e.target.value as ReturnInspectionOutcome;
                  setInspectOutcome(val);
                  if (val === 'reutilisable') setInspectCondition('Bon état');
                  else if (val === 'endommage') setInspectCondition('Endommagé');
                  else setInspectCondition('Hors service');
                }}
                className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
              >
                <option value="reutilisable">
                  Conforme — remettre en circulation (FIFO / Disponible)
                </option>
                <option value="endommage">
                  Non conforme — maintenir en réparation
                </option>
                <option value="retire_definitivement">
                  Irrécupérable — retirer définitivement
                </option>
              </select>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setInspectingCopy(null)}
                className="rounded-lg border border-stone-300 px-4 py-2 text-xs font-semibold text-stone-700 cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="submit"
                className="rounded-lg bg-emerald-900 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-800 cursor-pointer"
              >
                Confirmer l’inspection
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
