import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Edit3,
  History,
  Layers,
  Mail,
  Plus,
  RefreshCw,
  ScanLine,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import {
  BOOK_LANGUAGES,
  EST_DEPARTMENTS,
  type AccountStatus,
  type BookWithStats,
  type Copy,
  type CopyStateLogRecord,
  type CopyStatus,
  type CounterMemberDossier,
  type DashboardStats,
  type LibrarySettings,
  type LoanRecord,
  type OverdueNotificationResult,
  type PhysicalCondition,
  type ReservationRecord,
  type ReturnInspectionOutcome,
  type StudentStatus,
  type UserPublic,
  type UserRole,
} from '../../shared/types.ts';
import { api, ApiError, formatDateFr, formatDateTimeFr } from '../lib/api.ts';
import {
  ensureGoogleAccessToken,
  getCachedGoogleAccessToken,
} from '../lib/firebaseAuth.ts';

type AdminTab =
  | 'overview'
  | 'counter'
  | 'loans'
  | 'reservations'
  | 'catalogue'
  | 'copies'
  | 'history'
  | 'members'
  | 'settings';

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
  isDemoSession?: boolean;
  onDataMutated: () => Promise<void>;
}

export function LibrarianDashboard({
  user,
  isDemoSession = false,
  onDataMutated,
}: LibrarianDashboardProps) {
  const [tab, setTab] = useState<AdminTab>('overview');
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [books, setBooks] = useState<BookWithStats[]>([]);
  const [copies, setCopies] = useState<Array<Copy & { bookTitle: string; bookCategory: string }>>([]);
  const [loans, setLoans] = useState<LoanRecord[]>([]);
  const [reservations, setReservations] = useState<ReservationRecord[]>([]);
  const [members, setMembers] = useState<UserPublic[]>([]);
  const [copyStateLogs, setCopyStateLogs] = useState<CopyStateLogRecord[]>([]);
  const [settings, setSettings] = useState<LibrarySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [loanFilter, setLoanFilter] = useState<'all' | 'overdue'>('all');
  const [notifyingOverdue, setNotifyingOverdue] = useState(false);
  const [sendingTestEmail, setSendingTestEmail] = useState(false);
  const [togglingLoanId, setTogglingLoanId] = useState<string | null>(null);
  const [showNotifyModal, setShowNotifyModal] = useState(false);
  const [overdueNotifyResult, setOverdueNotifyResult] =
    useState<OverdueNotificationResult | null>(null);

  // Comptoir / Circulation (scan carte membre + scan code-barres)
  const [memberScanQuery, setMemberScanQuery] = useState('');
  const [memberCandidates, setMemberCandidates] = useState<UserPublic[]>([]);
  const [counterDossier, setCounterDossier] = useState<CounterMemberDossier | null>(null);
  const [counterBusy, setCounterBusy] = useState(false);
  const [counterCheckoutBarcode, setCounterCheckoutBarcode] = useState('');
  const [counterReturnBarcode, setCounterReturnBarcode] = useState('');
  const [counterFeedback, setCounterFeedback] = useState<{
    kind: 'success' | 'error';
    message: string;
  } | null>(null);

  // Filtres et ajout en lot des exemplaires
  const [copySearch, setCopySearch] = useState('');
  const [copyStatusFilter, setCopyStatusFilter] = useState<'Tous' | CopyStatus>('Tous');
  const [showBatchCopyForm, setShowBatchCopyForm] = useState(false);
  const [batchForm, setBatchForm] = useState({
    bookId: '',
    barcodesText: '',
    physicalCondition: 'Neuf' as PhysicalCondition,
    location: '',
  });
  const [retiringCopy, setRetiringCopy] = useState<(Copy & { bookTitle: string }) | null>(null);

  // Confirmation annulation réservation
  const [cancelingReservation, setCancelingReservation] = useState<ReservationRecord | null>(null);

  // Recherche membres
  const [memberSearch, setMemberSearch] = useState('');

  // Paramètres administrateur
  const [settingsForm, setSettingsForm] = useState<LibrarySettings>({
    borrowingDurationDays: 7,
    pickupWindowDays: 3,
    maxQuantityPerTitle: 1,
    realEmailsEnabled: true,
    testEmailRecipient: isDemoSession ? 'test.demo@usmba.example' : 'bilale.zorgane@usmba.ac.ma',
  });
  const [savingSettings, setSavingSettings] = useState(false);

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
      const [sRes, bRes, cRes, lRes, rRes, mRes, cfgRes, logsRes] = await Promise.all([
        api.adminGetStats(),
        api.adminGetBooks(),
        api.adminGetCopies(),
        api.adminGetLoans(),
        api.adminGetReservations(),
        api.adminGetMembers(),
        api.adminGetSettings(),
        api.adminGetCopyStateLogs(120),
      ]);
      setStats(sRes.stats);
      setBooks(bRes.books);
      setCopies(cRes.copies);
      setLoans(lRes.loans);
      setReservations(rRes.reservations);
      setMembers(mRes.members);
      setSettings(cfgRes.settings);
      setSettingsForm(cfgRes.settings);
      setCopyStateLogs(logsRes.logs);
      if (counterDossier) {
        try {
          const refreshedDossier = await api.adminLookupCounterMember(counterDossier.member.id);
          setCounterDossier(refreshedDossier.dossier);
        } catch {
          // ignore if member record changed
        }
      }
      const firstActive = bRes.books.find((b) => !b.archived) || bRes.books[0];
      if (!copyForm.bookId && firstActive) {
        setCopyForm((prev) => ({
          ...prev,
          bookId: firstActive.id,
          location: `Rayon · ${firstActive.shelfLocation}`,
        }));
      }
      if (!batchForm.bookId && firstActive) {
        setBatchForm((prev) => ({
          ...prev,
          bookId: firstActive.id,
          location: `Rayon · ${firstActive.shelfLocation}`,
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

  useEffect(() => {
    if (!returningLoan && !inspectingCopy && !showNotifyModal && !retiringCopy && !cancelingReservation) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setReturningLoan(null);
        setInspectingCopy(null);
        setShowNotifyModal(false);
        setRetiringCopy(null);
        setCancelingReservation(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [returningLoan, inspectingCopy, showNotifyModal, retiringCopy, cancelingReservation]);

  if (!user || user.role !== 'bibliothecaire') {
    return (
      <div className="mx-auto max-w-2xl px-4 py-14 text-center">
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

  const handleRegisterCopiesBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBanner(null);
    const targetBookId = batchForm.bookId || copyForm.bookId;
    if (!targetBookId) {
      setError('Veuillez sélectionner un ouvrage pour l’ajout en lot.');
      return;
    }
    try {
      const res = await api.adminRegisterCopiesBatch(targetBookId, {
        barcodes: batchForm.barcodesText,
        physicalCondition: batchForm.physicalCondition,
        location: batchForm.location,
      });
      const details: string[] = [
        `${res.created.length} exemplaire(s) ajouté(s)`,
      ];
      if (res.assignedReservationsCount > 0) {
        details.push(`${res.assignedReservationsCount} attribué(s) en file FIFO`);
      }
      if (res.skippedBarcodes.length > 0) {
        details.push(`${res.skippedBarcodes.length} ignoré(s) : ${res.skippedBarcodes.join(', ')}`);
      }
      setBanner(details.join(' · '));
      setBatchForm((prev) => ({ ...prev, barcodesText: '' }));
      setShowBatchCopyForm(false);
      await Promise.all([loadAll(), onDataMutated()]);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Erreur lors de l’ajout en lot des exemplaires.'
      );
    }
  };

  const handleConfirmRetireCopy = async () => {
    if (!retiringCopy) return;
    setError(null);
    setBanner(null);
    try {
      await api.adminUpdateCopyStatus(retiringCopy.id, {
        status: 'Retiré définitivement',
        physicalCondition: 'Hors service',
        location: 'Archives Réforme',
      });
      setBanner(`Exemplaire ${retiringCopy.barcode} retiré définitivement de l’inventaire.`);
      setRetiringCopy(null);
      await Promise.all([loadAll(), onDataMutated()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de retirer cet exemplaire.');
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

  const handleConfirmReservationAvailability = async (reservationId: string) => {
    setError(null);
    setBanner(null);
    try {
      await api.adminConfirmReservationAvailability(reservationId);
      setBanner('Disponibilité confirmée : le délai de retrait de 3 jours a démarré et le membre a été notifié.');
      await Promise.all([loadAll(), onDataMutated()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur lors de la confirmation.');
    }
  };

  const handlePickup = async (reservationId: string) => {
    setError(null);
    setBanner(null);
    try {
      await api.adminPickupReservation(reservationId);
      setBanner(
        `Retrait validé : un emprunt de ${settings?.borrowingDurationDays ?? 7} jours a été créé.`
      );
      await Promise.all([loadAll(), onDataMutated()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur lors du retrait.');
    }
  };

  const handleConfirmCancelReservation = async () => {
    if (!cancelingReservation) return;
    setError(null);
    setBanner(null);
    try {
      await api.adminCancelReservation(cancelingReservation.id);
      setBanner('Réservation annulée et file d’attente mise à jour.');
      setCancelingReservation(null);
      await Promise.all([loadAll(), onDataMutated()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur.');
    }
  };

  const handleToggleLoanOverdueTest = async (loanId: string) => {
    setError(null);
    setBanner(null);
    setTogglingLoanId(loanId);
    try {
      const res = await api.adminToggleLoanOverdueTest(loanId);
      setBanner(
        res.loan.status === 'En retard'
          ? `Emprunt « ${res.loan.bookTitle} » basculé en retard pour test.`
          : `Emprunt « ${res.loan.bookTitle} » remis en cours (à l’heure).`
      );
      await Promise.all([loadAll(), onDataMutated()]);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Impossible de modifier l’état de test de cet emprunt.'
      );
    } finally {
      setTogglingLoanId(null);
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

  const handleUpdateMemberRole = async (
    memberId: string,
    role: UserRole,
    isAdmin: boolean
  ) => {
    setError(null);
    setBanner(null);
    try {
      await api.adminUpdateMemberRole(memberId, role, isAdmin);
      setBanner('Rôle et permissions mis à jour.');
      await Promise.all([loadAll(), onDataMutated()]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de modifier le rôle.');
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setError(null);
    setBanner(null);
    try {
      const res = await api.adminUpdateSettings(settingsForm);
      setSettings(res.settings);
      setSettingsForm(res.settings);
      setBanner('Paramètres de la bibliothèque enregistrés.');
      await onDataMutated();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Impossible d’enregistrer les paramètres.'
      );
    } finally {
      setSavingSettings(false);
    }
  };

  const handleNotifyOverdueMembers = async () => {
    setError(null);
    setBanner(null);
    setNotifyingOverdue(true);
    try {
      let token: string | undefined;
      if (!isDemoSession) {
        token = getCachedGoogleAccessToken() || undefined;
        if (!token) {
          token = await ensureGoogleAccessToken();
        }
      }
      const result = await api.adminNotifyOverdueMembers({ googleAccessToken: token });
      setOverdueNotifyResult(result);
      setBanner(result.summaryMessage);
      setShowNotifyModal(false);
      await Promise.all([loadAll(), onDataMutated()]);
    } catch (err) {
      const firebaseErr = err as { code?: string; message?: string };
      if (firebaseErr?.code === 'auth/popup-closed-by-user') {
        setError('La fenêtre de validation Google a été fermée avant l’autorisation.');
      } else if (firebaseErr?.code === 'auth/popup-blocked') {
        setError(
          'Le navigateur a bloqué la fenêtre Google. Autorisez les fenêtres pop-up pour envoyer avec Gmail.'
        );
      } else {
        setError(
          err instanceof ApiError || err instanceof Error
            ? err.message
            : 'Impossible d’envoyer les notifications aux membres en retard.'
        );
      }
    } finally {
      setNotifyingOverdue(false);
    }
  };

  const handleSendTestEmail = async () => {
    setError(null);
    setBanner(null);
    setSendingTestEmail(true);
    try {
      let token: string | undefined;
      if (!isDemoSession) {
        token = getCachedGoogleAccessToken() || undefined;
        if (!token) {
          token = await ensureGoogleAccessToken();
        }
      }
      const res = await api.adminSendTestEmail({ googleAccessToken: token });
      setBanner(res.message);
      await onDataMutated();
    } catch (err) {
      const firebaseErr = err as { code?: string; message?: string };
      if (firebaseErr?.code === 'auth/popup-closed-by-user') {
        setError('La fenêtre de validation Google a été fermée avant l’autorisation.');
      } else {
        setError(
          err instanceof ApiError || err instanceof Error
            ? err.message
            : 'Impossible d’envoyer l’e-mail de test.'
        );
      }
    } finally {
      setSendingTestEmail(false);
    }
  };

  const handleLookupCounterMember = async (queryOverride?: string) => {
    const q = (queryOverride ?? memberScanQuery).trim();
    if (!q) {
      setCounterFeedback({
        kind: 'error',
        message: 'Scannez ou saisissez le CNE, l’adresse e-mail ou le nom du membre.',
      });
      return;
    }
    setCounterBusy(true);
    setCounterFeedback(null);
    setMemberCandidates([]);
    try {
      const res = await api.adminLookupCounterMember(q);
      setCounterDossier(res.dossier);
      setMemberScanQuery(res.dossier.member.cne || res.dossier.member.email);
      setCounterCheckoutBarcode('');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'AMBIGUOUS_MEMBER_QUERY') {
        try {
          const searchRes = await api.adminSearchCounterMembers(q);
          setMemberCandidates(searchRes.members);
        } catch {
          setMemberCandidates([]);
        }
      }
      setCounterFeedback({
        kind: 'error',
        message: err instanceof ApiError ? err.message : 'Recherche du membre impossible.',
      });
    } finally {
      setCounterBusy(false);
    }
  };

  const handleCounterSearchChange = async (value: string) => {
    setMemberScanQuery(value);
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      setMemberCandidates([]);
      return;
    }
    try {
      const res = await api.adminSearchCounterMembers(trimmed);
      setMemberCandidates(res.members);
    } catch {
      setMemberCandidates([]);
    }
  };

  const handleCounterCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!counterDossier) return;
    setCounterBusy(true);
    setCounterFeedback(null);
    try {
      const res = await api.adminCounterCheckout(
        counterDossier.member.id,
        counterCheckoutBarcode
      );
      setCounterDossier(res.dossier);
      setCounterCheckoutBarcode('');
      setCounterFeedback({
        kind: 'success',
        message: `Retrait validé pour ${counterDossier.member.fullName} : « ${res.loan.bookTitle} » (${res.loan.copyBarcode}) — Emprunt créé jusqu’au ${formatDateTimeFr(res.loan.dueAt)}.`,
      });
      await Promise.all([loadAll(), onDataMutated()]);
    } catch (err) {
      setCounterFeedback({
        kind: 'error',
        message:
          err instanceof ApiError
            ? err.message
            : 'Le retrait au comptoir a été refusé. Aucun état n’a été modifié.',
      });
    } finally {
      setCounterBusy(false);
    }
  };

  const handleCounterScanReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    setCounterBusy(true);
    setCounterFeedback(null);
    try {
      const lookup = await api.adminCounterScanReturn(counterReturnBarcode);
      if (!lookup.activeLoan) {
        setCounterFeedback({
          kind: 'error',
          message: `L’exemplaire ${lookup.copy.barcode} (« ${lookup.copy.bookTitle} ») n’a aucun emprunt actif à retourner (statut actuel : ${lookup.copy.status}).`,
        });
        return;
      }
      setCounterReturnBarcode('');
      setReturningLoan(lookup.activeLoan);
      setReturnOutcome('reutilisable');
      setReturnCondition('Bon état');
      setReturnNotes('');
    } catch (err) {
      setCounterFeedback({
        kind: 'error',
        message:
          err instanceof ApiError
            ? err.message
            : 'Impossible d’identifier cet exemplaire pour le retour.',
      });
    } finally {
      setCounterBusy(false);
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

  const tabs: Array<{ id: AdminTab; label: string }> = [
    { id: 'overview', label: 'Vue d’ensemble' },
    { id: 'counter', label: 'Comptoir / Circulation' },
    { id: 'loans', label: 'Emprunts & retours' },
    { id: 'reservations', label: 'Retenues & FIFO' },
    { id: 'catalogue', label: 'Catalogue' },
    { id: 'copies', label: 'Exemplaires' },
    { id: 'history', label: 'Journal exemplaires' },
    { id: 'members', label: 'Membres' },
    ...(user.isAdmin ? [{ id: 'settings' as const, label: 'Paramètres' }] : []),
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="flex flex-col gap-3 border-b border-stone-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-emerald-900">
            Administration Bibliothèque · EST Fès (USMBA)
          </p>
          <h1 className="mt-1 font-editorial text-2xl sm:text-3xl font-semibold text-stone-950">
            Tableau de bord bibliothécaire
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setTab('counter')}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-emerald-900 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 cursor-pointer"
          >
            <ScanLine className="h-3.5 w-3.5" />
            Ouvrir le comptoir
          </button>
          <button
            type="button"
            onClick={() => void loadAll()}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 self-start rounded-lg border border-stone-300 bg-white px-4 py-2 text-xs font-semibold text-stone-800 hover:bg-stone-50 cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Actualiser les données
          </button>
        </div>
      </div>

      {/* 4 indicateurs prioritaires en tête (les 4 indicateurs d'inventaire secondaires sont dans Vue d'ensemble) */}
      {stats && (
        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <button
            type="button"
            onClick={() => {
              setLoanFilter('all');
              setTab('loans');
            }}
            className="rounded-xl border border-stone-200 bg-white p-3.5 sm:p-4 text-left hover:border-emerald-800/50 transition-colors cursor-pointer"
          >
            <div className="font-mono text-xl sm:text-2xl font-semibold text-stone-950 tabular-nums">
              {stats.borrowedCopies}
            </div>
            <div className="mt-0.5 text-xs text-stone-600">Emprunts en cours</div>
          </button>

          <button
            type="button"
            onClick={() => {
              setLoanFilter('overdue');
              setOverdueNotifyResult(null);
              setTab('loans');
            }}
            className={`rounded-xl border p-3.5 sm:p-4 text-left transition-colors cursor-pointer ${
              stats.overdueLoans > 0
                ? 'border-red-200 bg-red-50/40 hover:border-red-400'
                : 'border-stone-200 bg-white hover:border-emerald-800/50'
            }`}
          >
            <div className="font-mono text-xl sm:text-2xl font-semibold text-red-700 tabular-nums">
              {stats.overdueLoans}
            </div>
            <div className="mt-0.5 text-xs text-stone-700">Emprunts en retard</div>
          </button>

          <button
            type="button"
            onClick={() => setTab('counter')}
            className="rounded-xl border border-stone-200 bg-white p-3.5 sm:p-4 text-left hover:border-emerald-800/50 transition-colors cursor-pointer"
          >
            <div className="font-mono text-xl sm:text-2xl font-semibold text-emerald-800 tabular-nums">
              {stats.awaitingPickupReservations}
            </div>
            <div className="mt-0.5 text-xs text-stone-600">
              Retraits comptoir ({stats.held24hCopies} en 24 h)
            </div>
          </button>

          <button
            type="button"
            onClick={() => setTab('copies')}
            className="rounded-xl border border-stone-200 bg-white p-3.5 sm:p-4 text-left hover:border-emerald-800/50 transition-colors cursor-pointer"
          >
            <div className="font-mono text-xl sm:text-2xl font-semibold text-emerald-900 tabular-nums">
              {stats.availableCopies}
            </div>
            <div className="mt-0.5 text-xs text-stone-600">Exemplaires disponibles</div>
          </button>
        </div>
      )}

      {/* Navigation des sections : grille 2 colonnes sans scroll horizontal sur téléphone, barre horizontale sur >= sm */}
      <nav
        aria-label="Sections d'administration"
        className="mt-5 grid grid-cols-2 gap-1.5 rounded-xl border border-stone-200 bg-stone-100 p-1.5 sm:flex sm:flex-wrap sm:gap-1"
      >
        {tabs.map((item) => {
          const active = tab === item.id;
          return (
              <button
              key={item.id}
              type="button"
              onClick={() => {
                if (item.id === 'loans') {
                  setLoanFilter('all');
                }
                setTab(item.id);
              }}
              aria-current={active ? 'page' : undefined}
              className={`min-h-[42px] sm:min-h-[38px] rounded-lg px-3 py-2 text-xs font-semibold transition-colors cursor-pointer text-center ${
                active
                  ? 'bg-white text-emerald-950 shadow-xs'
                  : 'text-stone-700 hover:text-stone-950'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      {banner && (
        <div role="status" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
          {banner}
        </div>
      )}

      {error && (
        <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </div>
      )}

      {loading ? (
        <div className="mt-6 h-64 animate-pulse rounded-xl bg-stone-100" />
      ) : (
        <div className="mt-6">
          {/* 1. VUE D'ENSEMBLE & INDICATEURS SECONDAIRES */}
          {tab === 'overview' && (
            <div className="space-y-6">
              <div className="grid gap-6 lg:grid-cols-12 items-start">
                {/* Alertes opérationnelles en premier sur mobile */}
                <div className="lg:col-span-5 lg:order-2 rounded-xl border border-stone-200 bg-white p-4 sm:p-6">
                  <h2 className="font-editorial text-xl font-semibold text-stone-950">
                    Alertes opérationnelles
                  </h2>
                  <div className="mt-4 space-y-3 text-sm">
                    <div className="flex items-center justify-between gap-3 border-b border-stone-100 pb-3">
                      <span className="inline-flex items-center gap-2 text-red-800 font-medium">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        Emprunts en retard
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setLoanFilter('overdue');
                          setOverdueNotifyResult(null);
                          setTab('loans');
                        }}
                        className="min-h-[36px] font-mono text-xs font-semibold text-emerald-900 underline cursor-pointer tabular-nums shrink-0"
                      >
                        {stats?.overdueLoans || 0} dossier(s)
                      </button>
                    </div>
                    <div className="flex items-center justify-between gap-3 border-b border-stone-100 pb-3">
                      <span className="inline-flex items-center gap-2 text-emerald-900 font-medium">
                        <Clock className="h-4 w-4 shrink-0" />
                        Réservations à retirer (3 j)
                      </span>
                      <button
                        type="button"
                        onClick={() => setTab('reservations')}
                        className="min-h-[36px] font-mono text-xs font-semibold text-emerald-900 underline cursor-pointer tabular-nums shrink-0"
                      >
                        {stats?.awaitingPickupReservations || 0} exemplaire(s)
                      </button>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-2 text-stone-800 font-medium">
                        <Wrench className="h-4 w-4 shrink-0" />
                        En réparation / à inspecter
                      </span>
                      <button
                        type="button"
                        onClick={() => setTab('copies')}
                        className="min-h-[36px] font-mono text-xs font-semibold text-emerald-900 underline cursor-pointer tabular-nums shrink-0"
                      >
                        {stats?.repairCopies || 0} exemplaire(s)
                      </button>
                    </div>
                  </div>
                </div>

                {/* Répartition du fonds par département */}
                <div className="lg:col-span-7 lg:order-1 rounded-xl border border-stone-200 bg-white p-4 sm:p-6">
                  <h2 className="font-editorial text-xl font-semibold text-stone-950">
                    Répartition du fonds par département
                  </h2>

                  {/* Cartes mobiles */}
                  <div className="mt-4 space-y-2.5 md:hidden">
                    {deptStats.map((d) => (
                      <div
                        key={d.department}
                        className="rounded-lg border border-stone-200 p-3 space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-sm text-stone-900">
                            {d.department}
                          </span>
                          <span className="font-mono text-xs font-semibold text-emerald-800 tabular-nums">
                            {d.available} dispo{d.available > 1 ? 's' : ''}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-stone-600 font-mono tabular-nums">
                          <span>{d.titles} titres</span>
                          <span aria-hidden="true">·</span>
                          <span>{d.total} ex.</span>
                          <span aria-hidden="true">·</span>
                          <span>{d.borrowed} empruntés</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Tableau desktop */}
                  <div className="mt-4 hidden md:block">
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
              </div>

              {/* Section secondaire : autres indicateurs d'inventaire */}
              {stats && (
                <div className="rounded-xl border border-stone-200 bg-stone-50/60 p-4 sm:p-5">
                  <h2 className="text-sm font-semibold text-stone-800">
                    Indicateurs complémentaires d’inventaire
                  </h2>
                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="rounded-lg border border-stone-200 bg-white p-3">
                      <div className="font-mono text-lg font-semibold text-stone-950 tabular-nums">
                        {stats.totalTitles}
                      </div>
                      <div className="text-xs text-stone-600">Titres actifs</div>
                    </div>
                    <div className="rounded-lg border border-stone-200 bg-white p-3">
                      <div className="font-mono text-lg font-semibold text-stone-950 tabular-nums">
                        {stats.totalPhysicalCopies}
                      </div>
                      <div className="text-xs text-stone-600">Exemplaires actifs</div>
                    </div>
                    <div className="rounded-lg border border-stone-200 bg-white p-3">
                      <div className="font-mono text-lg font-semibold text-amber-800 tabular-nums">
                        {stats.pendingReservations}
                      </div>
                      <div className="text-xs text-stone-600">En file d’attente FIFO</div>
                    </div>
                    <div className="rounded-lg border border-stone-200 bg-white p-3">
                      <div className="font-mono text-lg font-semibold text-stone-800 tabular-nums">
                        {stats.repairCopies}
                      </div>
                      <div className="text-xs text-stone-600">En réparation</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 1B. COMPTOIR / CIRCULATION (SCAN CARTE MEMBRE + SCAN CODE-BARRES EXEMPLAIRE) */}
          {tab === 'counter' && (
            <div className="space-y-6">
              <div className="rounded-xl border border-stone-200 bg-stone-50/70 p-4 sm:p-6 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-xs font-semibold text-emerald-900">
                      <ScanLine className="h-4 w-4" />
                      <span>Parcours comptoir · Scan carte membre + exemplaire physique</span>
                    </div>
                    <h2 className="mt-1 font-editorial text-xl font-semibold text-stone-950">
                      Retrait et restitution au comptoir
                    </h2>
                    <p className="mt-1 text-xs text-stone-600">
                      1) Scannez la carte du membre (CNE, e-mail ou identifiant) pour contrôler son dossier et ses retenues 24 h / FIFO prêtes. 2) Scannez ensuite le code-barres de l’exemplaire physique pour démarrer l’emprunt de {settings?.borrowingDurationDays ?? 7} jours.
                    </p>
                  </div>
                </div>

                {counterFeedback && (
                  <div
                    role={counterFeedback.kind === 'error' ? 'alert' : 'status'}
                    className={`rounded-xl border px-4 py-3 text-sm font-medium ${
                      counterFeedback.kind === 'success'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
                        : 'border-red-200 bg-red-50 text-red-900'
                    }`}
                  >
                    {counterFeedback.message}
                  </div>
                )}

                <div className="grid gap-4 lg:grid-cols-12 items-start">
                  {/* Étape 1 : Scan carte membre */}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleLookupCounterMember();
                    }}
                    className="lg:col-span-7 rounded-xl border border-stone-200 bg-white p-4 space-y-3"
                  >
                    <label
                      htmlFor="counter-member-scan"
                      className="block text-xs font-semibold text-stone-800"
                    >
                      1. Scanner la carte membre (CNE, e-mail académique ou ID)
                    </label>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        id="counter-member-scan"
                        type="text"
                        value={memberScanQuery}
                        onChange={(e) => void handleCounterSearchChange(e.target.value)}
                        placeholder={
                          isDemoSession
                            ? 'Ex. D138000001 ou amine.demo@usmba.example'
                            : 'Scannez ou saisissez CNE, e-mail ou nom…'
                        }
                        className="flex-1 min-h-[44px] rounded-lg border border-stone-300 px-3 py-2 text-sm font-mono"
                      />
                      <button
                        type="submit"
                        disabled={counterBusy}
                        className="min-h-[44px] rounded-lg bg-emerald-900 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60 cursor-pointer shrink-0"
                      >
                        {counterBusy ? 'Recherche…' : 'Charger le dossier'}
                      </button>
                    </div>

                    {memberCandidates.length > 0 && (
                      <div className="rounded-lg border border-stone-200 bg-stone-50 divide-y divide-stone-200">
                        {memberCandidates.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => void handleLookupCounterMember(m.id)}
                            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-emerald-50 cursor-pointer"
                          >
                            <span className="font-semibold text-stone-900">
                              {m.fullName}{' '}
                              <span className="font-mono font-normal text-stone-500">
                                ({m.cne || m.email})
                              </span>
                            </span>
                            <span className="text-emerald-900 font-semibold">Sélectionner</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </form>

                  {/* Scan retour rapide au comptoir */}
                  <form
                    onSubmit={handleCounterScanReturn}
                    className="lg:col-span-5 rounded-xl border border-stone-200 bg-white p-4 space-y-3"
                  >
                    <label
                      htmlFor="counter-return-scan"
                      className="block text-xs font-semibold text-stone-800"
                    >
                      Retour rapide : scanner le code-barres de l’exemplaire
                    </label>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        id="counter-return-scan"
                        type="text"
                        value={counterReturnBarcode}
                        onChange={(e) => setCounterReturnBarcode(e.target.value)}
                        placeholder="Ex. EST-INF-0301"
                        className="flex-1 min-h-[44px] rounded-lg border border-stone-300 px-3 py-2 text-sm font-mono"
                      />
                      <button
                        type="submit"
                        disabled={counterBusy}
                        className="min-h-[44px] rounded-lg border border-stone-300 bg-white px-4 py-2 text-xs font-semibold text-stone-800 hover:border-emerald-900 cursor-pointer shrink-0"
                      >
                        Inspecter retour
                      </button>
                    </div>
                  </form>
                </div>
              </div>

              {/* Dossier du membre scanné + Étape 2 : Scan de l'exemplaire pour retrait */}
              {counterDossier && (
                <div className="grid gap-6 lg:grid-cols-12 items-start">
                  {/* Dossier membre */}
                  <div className="lg:col-span-7 space-y-4">
                    <div className="rounded-xl border border-stone-200 bg-white p-4 sm:p-5 space-y-4">
                      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-100 pb-3">
                        <div>
                          <p className="text-xs font-semibold text-emerald-900">
                            Dossier membre identifié
                          </p>
                          <h3 className="font-editorial text-xl font-semibold text-stone-950">
                            {counterDossier.member.fullName}
                          </h3>
                          <p className="font-mono text-xs text-stone-600">
                            {counterDossier.member.email}
                            {counterDossier.member.cne ? ` · CNE : ${counterDossier.member.cne}` : ''}
                            {counterDossier.member.filiere ? ` · ${counterDossier.member.filiere}` : ''}
                          </p>
                        </div>

                        <span
                          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold ${
                            counterDossier.eligibility.eligible
                              ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                              : 'bg-red-50 text-red-900 border border-red-200'
                          }`}
                        >
                          {counterDossier.eligibility.eligible ? (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          ) : (
                            <AlertTriangle className="h-3.5 w-3.5" />
                          )}
                          {counterDossier.eligibility.eligible ? 'Membre éligible' : 'Compte bloqué'}
                        </span>
                      </div>

                      {!counterDossier.eligibility.eligible && (
                        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900">
                          <strong>Motif du blocage :</strong> {counterDossier.eligibility.reasonMessage}
                        </div>
                      )}

                      {/* Retenues 24 h */}
                      <div className="space-y-2">
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-stone-600">
                          Retenues 24 h à retirer ({counterDossier.holds24h.length})
                        </h4>
                        {counterDossier.holds24h.length === 0 ? (
                          <p className="text-xs text-stone-500">Aucune retenue 24 h active.</p>
                        ) : (
                          <div className="space-y-2">
                            {counterDossier.holds24h.map((h) => (
                              <div
                                key={h.id}
                                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-200 bg-sky-50/50 p-3 text-xs"
                              >
                                <div>
                                  <div className="font-semibold text-stone-950">{h.bookTitle}</div>
                                  <div className="font-mono text-sky-900">
                                    Exemplaire affecté : {h.assignedCopyBarcode || '—'} · Limite :{' '}
                                    {formatDateTimeFr(h.pickupDeadline)}
                                  </div>
                                </div>
                                {h.assignedCopyBarcode && (
                                  <button
                                    type="button"
                                    onClick={() => setCounterCheckoutBarcode(h.assignedCopyBarcode || '')}
                                    className="rounded-lg border border-sky-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-sky-950 hover:bg-sky-100 cursor-pointer"
                                  >
                                    Pré-remplir code-barres
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Réservations FIFO prêtes (3 j) */}
                      <div className="space-y-2">
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-stone-600">
                          Réservations FIFO prêtes — 3 jours ({counterDossier.fifoReadyPickups.length})
                        </h4>
                        {counterDossier.fifoReadyPickups.length === 0 ? (
                          <p className="text-xs text-stone-500">Aucune réservation FIFO prête au retrait.</p>
                        ) : (
                          <div className="space-y-2">
                            {counterDossier.fifoReadyPickups.map((r) => (
                              <div
                                key={r.id}
                                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-xs"
                              >
                                <div>
                                  <div className="font-semibold text-stone-950">{r.bookTitle}</div>
                                  <div className="font-mono text-emerald-900">
                                    Exemplaire attribué : {r.assignedCopyBarcode || '—'} · Limite :{' '}
                                    {formatDateTimeFr(r.pickupDeadline)}
                                  </div>
                                </div>
                                {r.assignedCopyBarcode && (
                                  <button
                                    type="button"
                                    onClick={() => setCounterCheckoutBarcode(r.assignedCopyBarcode || '')}
                                    className="rounded-lg border border-emerald-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-emerald-950 hover:bg-emerald-100 cursor-pointer"
                                  >
                                    Pré-remplir code-barres
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* File FIFO en attente */}
                      {counterDossier.fifoWaiting.length > 0 && (
                        <div className="space-y-2">
                          <h4 className="text-xs font-semibold uppercase tracking-wide text-stone-600">
                            File d’attente FIFO ({counterDossier.fifoWaiting.length})
                          </h4>
                          <div className="space-y-1.5">
                            {counterDossier.fifoWaiting.map((w) => (
                              <div
                                key={w.id}
                                className="flex items-center justify-between rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs"
                              >
                                <span className="font-medium text-stone-900">{w.bookTitle}</span>
                                <span className="font-mono font-semibold text-amber-800">
                                  Rang #{w.queuePosition}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Emprunts en cours / en retard */}
                      <div className="space-y-2">
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-stone-600">
                          Emprunts actifs ({counterDossier.activeLoans.length})
                        </h4>
                        {counterDossier.activeLoans.length === 0 ? (
                          <p className="text-xs text-stone-500">Aucun emprunt actif.</p>
                        ) : (
                          <div className="space-y-2">
                            {counterDossier.activeLoans.map((l) => (
                              <div
                                key={l.id}
                                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 bg-white p-3 text-xs"
                              >
                                <div>
                                  <div className="font-semibold text-stone-900">
                                    {l.bookTitle}{' '}
                                    <span
                                      className={
                                        l.status === 'En retard'
                                          ? 'text-red-700'
                                          : 'text-emerald-800'
                                      }
                                    >
                                      ({l.status})
                                    </span>
                                  </div>
                                  <div className="font-mono text-stone-500">
                                    {l.copyBarcode} · Échéance : {formatDateFr(l.dueAt)}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setReturningLoan(l);
                                    setReturnOutcome('reutilisable');
                                    setReturnCondition('Bon état');
                                    setReturnNotes('');
                                  }}
                                  className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-semibold text-stone-800 hover:border-emerald-900 cursor-pointer"
                                >
                                  Enregistrer retour
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Étape 2 : Scan code-barres exemplaire pour valider le prêt */}
                  <div className="lg:col-span-5 space-y-4">
                    <form
                      onSubmit={handleCounterCheckout}
                      className="rounded-xl border border-emerald-900/30 bg-white p-4 sm:p-5 space-y-4"
                    >
                      <div className="flex items-center gap-2 text-sm font-semibold text-emerald-950">
                        <ScanLine className="h-4 w-4 text-emerald-900" />
                        <span>2. Valider le retrait par scan d’exemplaire</span>
                      </div>
                      <p className="text-xs text-stone-600 leading-relaxed">
                        Scannez le code-barres physique de l’exemplaire récupéré en rayon. Le serveur vérifie que l’exemplaire correspond exactement à la retenue 24 h ou à la réservation FIFO du membre avant de créer l’emprunt de {settings?.borrowingDurationDays ?? 7} jours.
                      </p>

                      <div>
                        <label
                          htmlFor="counter-copy-barcode"
                          className="block text-xs font-semibold text-stone-700"
                        >
                          Code-barres de l’exemplaire *
                        </label>
                        <input
                          id="counter-copy-barcode"
                          type="text"
                          required
                          value={counterCheckoutBarcode}
                          onChange={(e) => setCounterCheckoutBarcode(e.target.value)}
                          placeholder="Ex. EST-MGT-0302"
                          className="mt-1 w-full min-h-[44px] rounded-lg border border-stone-300 px-3 py-2 text-sm font-mono"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={counterBusy}
                        className="w-full min-h-[44px] rounded-lg bg-emerald-900 px-5 py-2.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60 cursor-pointer"
                      >
                        {counterBusy
                          ? 'Vérification en cours…'
                          : `Valider le prêt (${settings?.borrowingDurationDays ?? 7} jours)`}
                      </button>
                    </form>

                    {counterDossier.pastLoans.length > 0 && (
                      <div className="rounded-xl border border-stone-200 bg-stone-50/70 p-4 space-y-2">
                        <h4 className="text-xs font-semibold text-stone-700">
                          Derniers emprunts restitués ({counterDossier.pastLoans.length})
                        </h4>
                        <div className="space-y-1.5 text-xs">
                          {counterDossier.pastLoans.slice(0, 5).map((l) => (
                            <div key={l.id} className="flex justify-between gap-2 text-stone-600">
                              <span className="truncate">{l.bookTitle}</span>
                              <span className="font-mono shrink-0">{formatDateFr(l.returnedAt)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 2. GESTION DU CATALOGUE */}
          {tab === 'catalogue' && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
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
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-emerald-900 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                  Ajouter un ouvrage
                </button>
              </div>

              {showBookForm && (
                <form
                  onSubmit={handleSaveBook}
                  className="rounded-xl border border-stone-200 bg-stone-50/70 p-4 sm:p-6 space-y-4"
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
                        className="mt-1 w-full min-h-[42px] rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-stone-700">Auteur(s) *</label>
                      <input
                        type="text"
                        required
                        value={bookForm.authors}
                        onChange={(e) => setBookForm({ ...bookForm, authors: e.target.value })}
                        className="mt-1 w-full min-h-[42px] rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-stone-700">ISBN</label>
                      <input
                        type="text"
                        value={bookForm.isbn}
                        onChange={(e) => setBookForm({ ...bookForm, isbn: e.target.value })}
                        className="mt-1 w-full min-h-[42px] rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-stone-700">Département *</label>
                      <select
                        value={bookForm.category}
                        onChange={(e) => setBookForm({ ...bookForm, category: e.target.value })}
                        className="mt-1 w-full min-h-[42px] rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
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
                        className="mt-1 w-full min-h-[42px] rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
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
                        className="mt-1 w-full min-h-[42px] rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-mono"
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
                        className="mt-1 w-full min-h-[42px] rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-stone-700">Édition</label>
                      <input
                        type="text"
                        value={bookForm.edition}
                        onChange={(e) => setBookForm({ ...bookForm, edition: e.target.value })}
                        className="mt-1 w-full min-h-[42px] rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-stone-700">Langue</label>
                      <select
                        value={bookForm.language}
                        onChange={(e) => setBookForm({ ...bookForm, language: e.target.value })}
                        className="mt-1 w-full min-h-[42px] rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
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
                        className="mt-1 w-full min-h-[42px] rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                      >
                        {COVER_PRESETS.map((c) => (
                          <option key={c.label} value={c.url}>{c.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-end pb-2">
                      <label className="inline-flex min-h-[40px] items-center gap-2 text-sm font-medium text-stone-800 cursor-pointer">
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

                  <div className="flex flex-wrap gap-3">
                    <button
                      type="submit"
                      className="min-h-[42px] rounded-lg bg-emerald-900 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-800 cursor-pointer"
                    >
                      Enregistrer
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowBookForm(false)}
                      className="min-h-[42px] rounded-lg border border-stone-300 bg-white px-4 py-2 text-xs font-semibold text-stone-700 cursor-pointer"
                    >
                      Annuler
                    </button>
                  </div>
                </form>
              )}

              {/* Cartes mobiles */}
              <div className="space-y-3 md:hidden">
                {books.map((b) => (
                  <article
                    key={b.id}
                    className={`rounded-xl border border-stone-200 p-4 space-y-2.5 ${
                      b.archived ? 'bg-stone-50 opacity-80' : 'bg-white'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-medium text-emerald-900">{b.category}</span>
                      <span className="font-mono font-semibold text-stone-800 tabular-nums">
                        {b.availableCopies} / {b.totalCopies} dispo · {b.archived ? 'Archivé' : 'Actif'}
                      </span>
                    </div>
                    <div>
                      <h3 className="font-editorial text-base font-semibold text-stone-900">
                        {b.title}
                      </h3>
                      <p className="text-xs text-stone-600">{b.authors}</p>
                      <p className="mt-1 font-mono text-xs text-stone-500">Cote : {b.shelfLocation}</p>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
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
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 text-xs font-semibold text-emerald-900 cursor-pointer"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        Modifier
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleToggleArchive(b)}
                        className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 text-xs font-semibold text-stone-700 hover:text-red-800 cursor-pointer"
                      >
                        <Archive className="h-3.5 w-3.5" />
                        {b.archived ? 'Restaurer' : 'Archiver'}
                      </button>
                    </div>
                  </article>
                ))}
              </div>

              {/* Tableau desktop */}
              <div className="hidden md:block rounded-xl border border-stone-200 bg-white overflow-x-auto">
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

          {/* 3. EXEMPLAIRES PHYSIQUES, AJOUT EN LOT & RÉPARATIONS */}
          {tab === 'copies' && (() => {
            const q = copySearch.trim().toLowerCase();
            const filteredCopies = copies.filter((c) => {
              if (copyStatusFilter !== 'Tous' && c.status !== copyStatusFilter) {
                return false;
              }
              if (!q) return true;
              return (
                c.barcode.toLowerCase().includes(q) ||
                c.bookTitle.toLowerCase().includes(q) ||
                c.location.toLowerCase().includes(q)
              );
            });

            return (
              <div className="space-y-5">
                <div className="rounded-xl border border-stone-200 bg-stone-50/70 p-4 sm:p-5 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="font-editorial text-lg font-semibold text-stone-950">
                      Enregistrer des exemplaires physiques
                    </h2>
                    <button
                      type="button"
                      onClick={() => setShowBatchCopyForm((v) => !v)}
                      className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-emerald-900 hover:border-emerald-900 cursor-pointer"
                    >
                      <Layers className="h-3.5 w-3.5" />
                      {showBatchCopyForm ? 'Fermer l’ajout en lot' : 'Ajout en lot (codes-barres)'}
                    </button>
                  </div>

                  {/* Ajout unitaire rapide */}
                  <form
                    onSubmit={handleRegisterCopy}
                    className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end"
                  >
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
                        className="mt-1 w-full min-h-[42px] rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
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
                        className="mt-1 w-full min-h-[42px] rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-mono"
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
                        className="mt-1 w-full min-h-[42px] rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
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
                        className="w-full min-h-[42px] rounded-lg bg-emerald-900 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 cursor-pointer"
                      >
                        Ajouter l’exemplaire
                      </button>
                    </div>
                  </form>

                  {/* Ajout en lot par collage de codes-barres */}
                  {showBatchCopyForm && (
                    <form
                      onSubmit={handleRegisterCopiesBatch}
                      className="border-t border-stone-200 pt-4 space-y-3"
                    >
                      <p className="text-xs text-stone-600">
                        Collez plusieurs codes-barres (un par ligne, ou séparés par des virgules / points-virgules) avec un emplacement et un état physique par défaut pour les enregistrer en une validation.
                      </p>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div>
                          <label className="block text-xs font-semibold text-stone-700">Ouvrage</label>
                          <select
                            value={batchForm.bookId}
                            onChange={(e) => {
                              const selected = books.find((b) => b.id === e.target.value);
                              setBatchForm({
                                ...batchForm,
                                bookId: e.target.value,
                                location: selected ? `Rayon · ${selected.shelfLocation}` : prevLocationFallback(batchForm.location),
                              });
                            }}
                            className="mt-1 w-full min-h-[42px] rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
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
                          <label className="block text-xs font-semibold text-stone-700">État par défaut</label>
                          <select
                            value={batchForm.physicalCondition}
                            onChange={(e) =>
                              setBatchForm({
                                ...batchForm,
                                physicalCondition: e.target.value as PhysicalCondition,
                              })
                            }
                            className="mt-1 w-full min-h-[42px] rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                          >
                            <option value="Neuf">Neuf</option>
                            <option value="Bon état">Bon état</option>
                            <option value="Usure légère">Usure légère</option>
                            <option value="Endommagé">Endommagé</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-stone-700">Emplacement par défaut *</label>
                          <input
                            type="text"
                            required
                            value={batchForm.location}
                            onChange={(e) => setBatchForm({ ...batchForm, location: e.target.value })}
                            placeholder="Rayon · INF-01-A"
                            className="mt-1 w-full min-h-[42px] rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-stone-700">
                          Codes-barres à importer *
                        </label>
                        <textarea
                          rows={3}
                          required
                          value={batchForm.barcodesText}
                          onChange={(e) => setBatchForm({ ...batchForm, barcodesText: e.target.value })}
                          placeholder={'EST-LOT-101\nEST-LOT-102\nEST-LOT-103'}
                          className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-mono"
                        />
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="submit"
                          className="min-h-[42px] rounded-lg bg-emerald-900 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-800 cursor-pointer"
                        >
                          Valider le lot
                        </button>
                      </div>
                    </form>
                  )}
                </div>

                {/* Barre de recherche et filtres rapides sur les exemplaires */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="relative flex-1 max-w-md">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                    <input
                      type="search"
                      value={copySearch}
                      onChange={(e) => setCopySearch(e.target.value)}
                      placeholder="Rechercher par code-barres, ouvrage ou rayon…"
                      aria-label="Rechercher un exemplaire"
                      className="w-full min-h-[42px] rounded-lg border border-stone-300 bg-white pl-9 pr-3 py-2 text-sm"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label htmlFor="copy-status-filter" className="text-xs font-semibold text-stone-600">
                      Statut :
                    </label>
                    <select
                      id="copy-status-filter"
                      value={copyStatusFilter}
                      onChange={(e) => setCopyStatusFilter(e.target.value as 'Tous' | CopyStatus)}
                      className="min-h-[40px] rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-800"
                    >
                      <option value="Tous">Tous ({copies.length})</option>
                      <option value="Disponible">Disponible</option>
                      <option value="Retenu 24h">Retenu 24 h</option>
                      <option value="Emprunté">Emprunté</option>
                      <option value="Réservé">Réservé</option>
                      <option value="En réparation">En réparation</option>
                      <option value="Retiré définitivement">Retiré définitivement</option>
                    </select>
                  </div>
                </div>

                {/* Cartes mobiles */}
                <div className="space-y-3 md:hidden">
                  {filteredCopies.map((c) => (
                    <article
                      key={c.id}
                      className="rounded-xl border border-stone-200 bg-white p-4 space-y-2.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono text-xs font-semibold text-stone-900">
                          {c.barcode}
                        </span>
                        <span className="text-xs font-semibold text-stone-800">
                          {c.status}
                          {c.needsInspection && c.status === 'En réparation' && (
                            <span className="ml-1 text-amber-800">(inspection requise)</span>
                          )}
                        </span>
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-stone-900">{c.bookTitle}</div>
                        <div className="mt-1 text-xs text-stone-600">
                          État : {c.physicalCondition} · {c.location}
                        </div>
                      </div>
                      {(c.status === 'En réparation' || c.status === 'Disponible') && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {c.status === 'En réparation' && c.physicalCondition === 'Endommagé' && (
                            <button
                              type="button"
                              onClick={() => void handleCompleteRepair(c.id)}
                              className="min-h-[40px] flex-1 rounded-lg border border-stone-300 bg-white px-3 text-xs font-semibold text-emerald-900 cursor-pointer"
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
                              className="min-h-[40px] flex-1 rounded-lg bg-amber-800 px-3 text-xs font-semibold text-white cursor-pointer"
                            >
                              Inspecter après réparation
                            </button>
                          )}
                          {c.status === 'Disponible' && (
                            <button
                              type="button"
                              onClick={() => setRetiringCopy(c)}
                              className="min-h-[40px] rounded-lg border border-stone-300 bg-white px-3 text-xs font-semibold text-red-700 cursor-pointer"
                            >
                              Retirer définitivement
                            </button>
                          )}
                        </div>
                      )}
                    </article>
                  ))}
                </div>

                {/* Tableau desktop */}
                <div className="hidden md:block rounded-xl border border-stone-200 bg-white overflow-x-auto">
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
                      {filteredCopies.map((c) => (
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
                                onClick={() => setRetiringCopy(c)}
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
            );
          })()}

          {/* 4. EMPRUNTS & RETOURS AVEC INSPECTION */}
          {tab === 'loans' && (() => {
            const overdueLoans = loans.filter((l) => l.status === 'En retard');
            const displayedLoans = loanFilter === 'overdue' ? overdueLoans : loans;
            const overdueMemberEmails = Array.from(
              new Set(
                overdueLoans
                  .map((l) => (l.memberEmail || '').trim())
                  .filter(Boolean)
              )
            );
            const mailtoHref =
              overdueMemberEmails.length > 0
                ? `mailto:${overdueMemberEmails.map(encodeURIComponent).join(',')}?subject=${encodeURIComponent('BiblioEST — Rappel : emprunt(s) en retard à restituer')}&body=${encodeURIComponent('Bonjour,\n\nLe délai de prêt d’un ou plusieurs ouvrages de la bibliothèque BiblioEST est dépassé. Merci de les restituer dans les plus brefs délais.\n\nCordialement,\nLa Bibliothèque BiblioEST · EST Fès (USMBA)')}`
                : null;

            return (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-editorial text-xl font-semibold text-stone-950">
                    {loanFilter === 'overdue'
                      ? `Suivi des emprunts en retard (${displayedLoans.length})`
                      : `Suivi des emprunts et enregistrement des retours (${displayedLoans.length})`}
                  </h2>

                  <div className="inline-flex rounded-lg border border-stone-200 bg-stone-100 p-1">
                    <button
                      type="button"
                      onClick={() => setLoanFilter('all')}
                      className={`min-h-[36px] rounded-md px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                        loanFilter === 'all'
                          ? 'bg-white text-stone-950 shadow-xs'
                          : 'text-stone-600 hover:text-stone-900'
                      }`}
                    >
                      Tous ({loans.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setLoanFilter('overdue')}
                      className={`min-h-[36px] rounded-md px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                        loanFilter === 'overdue'
                          ? 'bg-white text-red-800 shadow-xs'
                          : 'text-stone-600 hover:text-red-800'
                      }`}
                    >
                      En retard ({overdueLoans.length})
                    </button>
                  </div>
                </div>

                {displayedLoans.length === 0 ? (
                  <div className="rounded-xl border border-stone-200 bg-white p-8 text-center text-sm text-stone-600">
                    Aucun emprunt en retard enregistré actuellement.
                  </div>
                ) : (
                  <>
                    {/* Cartes mobiles */}
                    <div className="space-y-3 md:hidden">
                      {displayedLoans.map((l) => (
                        <article
                          key={l.id}
                          className="rounded-xl border border-stone-200 bg-white p-4 space-y-2.5"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 pb-2">
                            <span
                              className={`text-xs font-semibold ${
                                l.status === 'En retard'
                                  ? 'text-red-700'
                                  : l.status === 'En cours'
                                    ? 'text-emerald-800'
                                    : 'text-stone-500'
                              }`}
                            >
                              {l.status}
                            </span>
                            <span className="text-xs text-stone-600 tabular-nums">
                              Échéance : {formatDateFr(l.dueAt)}
                            </span>
                          </div>

                          <div>
                            <div className="font-editorial text-base font-semibold text-stone-900">
                              {l.bookTitle}
                            </div>
                            <div className="font-mono text-xs text-stone-500">{l.copyBarcode}</div>
                          </div>

                          <div className="text-xs text-stone-700">
                            <span className="font-medium text-stone-900">{l.memberName}</span>
                            <div className="font-mono text-[11px] text-stone-500 break-all">
                              {l.memberEmail} {l.memberCne ? `· ${l.memberCne}` : ''}
                            </div>
                          </div>

                          {l.status !== 'Retourné' ? (
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setReturningLoan(l);
                                  setReturnOutcome('reutilisable');
                                  setReturnCondition('Bon état');
                                  setReturnNotes('');
                                }}
                                className="flex-1 min-h-[42px] inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-900 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 cursor-pointer"
                              >
                                <ClipboardCheck className="h-3.5 w-3.5" />
                                Enregistrer retour
                              </button>
                              <button
                                type="button"
                                disabled={togglingLoanId === l.id}
                                onClick={() => void handleToggleLoanOverdueTest(l.id)}
                                className="min-h-[42px] rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-stone-700 hover:border-amber-700 hover:text-amber-900 disabled:opacity-50 cursor-pointer"
                              >
                                {l.status === 'En retard' ? 'Remettre à l’heure' : 'Simuler retard (test)'}
                              </button>
                            </div>
                          ) : (
                            <p className="text-xs text-stone-500 tabular-nums">
                              Restitué le {formatDateFr(l.returnedAt)}
                            </p>
                          )}
                        </article>
                      ))}
                    </div>

                    {/* Tableau desktop */}
                    <div className="hidden md:block rounded-xl border border-stone-200 bg-white overflow-x-auto">
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
                              <td className="px-4 py-3 text-right whitespace-nowrap space-x-2">
                                {l.status !== 'Retourné' ? (
                                  <>
                                    <button
                                      type="button"
                                      disabled={togglingLoanId === l.id}
                                      onClick={() => void handleToggleLoanOverdueTest(l.id)}
                                      className="inline-flex items-center rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-stone-700 hover:border-amber-700 hover:text-amber-900 disabled:opacity-50 cursor-pointer"
                                    >
                                      {l.status === 'En retard' ? 'Remettre à l’heure' : 'Simuler retard'}
                                    </button>
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
                                  </>
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

                    {loanFilter === 'overdue' && (
                      <div className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50/40 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="text-xs text-stone-700 space-y-1">
                          <p className="font-semibold text-stone-900">
                            Rappel aux membres en retard ({overdueMemberEmails.length} membre
                            {overdueMemberEmails.length > 1 ? 's' : ''})
                          </p>
                          <p>
                            {isDemoSession
                              ? 'Mode Démo : enregistre un rappel interne et un e-mail simulé par membre dans le journal de démonstration (aucun vrai e-mail envoyé).'
                              : 'Enregistre une notification de rappel dans le dossier de chaque membre concerné et envoie un récapitulatif par e-mail.'}
                          </p>
                          {settings?.testEmailRecipient && (
                            <p className="text-[11px] text-stone-600">
                              Adresse configurée pour les tests d’e-mail :{' '}
                              <span className="font-mono font-semibold">{settings.testEmailRecipient}</span>
                            </p>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                          <button
                            type="button"
                            disabled={notifyingOverdue}
                            onClick={() => setShowNotifyModal(true)}
                            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-red-700 px-4 py-2 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-60 cursor-pointer"
                          >
                            <Mail className="h-4 w-4" />
                            {notifyingOverdue
                              ? 'Notification en cours…'
                              : 'Notifier les membres par e-mail'}
                          </button>

                          <button
                            type="button"
                            disabled={sendingTestEmail}
                            onClick={() => void handleSendTestEmail()}
                            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-4 py-2 text-xs font-semibold text-stone-800 hover:bg-stone-50 disabled:opacity-60 cursor-pointer"
                          >
                            <Mail className="h-3.5 w-3.5 text-emerald-900" />
                            {sendingTestEmail ? 'Test en cours…' : 'Envoyer un e-mail de test'}
                          </button>

                          {overdueNotifyResult &&
                            !overdueNotifyResult.demoSimulated &&
                            !overdueNotifyResult.smtpConfigured &&
                            mailtoHref && (
                              <a
                                href={mailtoHref}
                                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-4 py-2 text-xs font-semibold text-stone-900 hover:bg-stone-50"
                              >
                                <Mail className="h-4 w-4 text-emerald-900" />
                                Ouvrir dans ma messagerie
                              </a>
                            )}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })()}

          {/* 5. RETENUES 24 H, RÉSERVATIONS & FILE CHRONOLOGIQUE FIFO */}
          {tab === 'reservations' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-editorial text-xl font-semibold text-stone-950">
                  Retenues 24 h, file chronologique FIFO & retraits ({reservations.length})
                </h2>
                <button
                  type="button"
                  onClick={() => void handleProcessDeadlines()}
                  className="min-h-[42px] rounded-lg border border-stone-300 bg-white px-4 py-2 text-xs font-semibold text-stone-800 hover:bg-stone-50 cursor-pointer"
                >
                  Libérer les délais expirés (24 h / 3 j)
                </button>
              </div>

              {/* Cartes mobiles */}
              <div className="space-y-3 md:hidden">
                {reservations.map((r) => (
                  <article
                    key={r.id}
                    className="rounded-xl border border-stone-200 bg-white p-4 space-y-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 pb-2">
                      <span className="text-xs font-semibold text-stone-900">
                        {r.status}
                        {r.requestType === 'retenue_24h' ? ' · 24 h' : ' · FIFO'}
                      </span>
                      <span className="font-mono text-xs text-emerald-950 tabular-nums">
                        {r.queuePosition ? `Rang #${r.queuePosition}` : formatDateTimeFr(r.requestedAt)}
                      </span>
                    </div>

                    <div>
                      <div className="font-editorial text-base font-semibold text-stone-900">
                        {r.bookTitle}
                      </div>
                      {r.assignedCopyBarcode && (
                        <div className="font-mono text-xs text-emerald-900">
                          Exemplaire attribué : {r.assignedCopyBarcode}
                        </div>
                      )}
                    </div>

                    <div className="text-xs text-stone-700">
                      <div className="font-medium text-stone-900">{r.memberName}</div>
                      <div className="font-mono text-[11px] text-stone-500 break-all">{r.memberEmail}</div>
                      <div className="mt-1 text-stone-500 tabular-nums">
                        Demandée : {formatDateTimeFr(r.requestedAt)}
                      </div>
                      {r.pickupDeadline &&
                        (r.status === 'Retenu 24h' || r.status === 'Disponible pour retrait') && (
                          <div className="mt-0.5 font-semibold text-emerald-900 tabular-nums">
                            Limite retrait : {formatDateTimeFr(r.pickupDeadline)}
                          </div>
                        )}
                    </div>

                    {(r.status === 'Retenu 24h' ||
                      r.status === 'Disponible pour retrait' ||
                      r.status === 'Exemplaire attribué' ||
                      r.status === 'En attente') && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {r.status === 'Exemplaire attribué' && (
                          <button
                            type="button"
                            onClick={() => void handleConfirmReservationAvailability(r.id)}
                            className="min-h-[42px] flex-1 rounded-lg bg-emerald-900 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 cursor-pointer"
                          >
                            Confirmer disponibilité (3 j)
                          </button>
                        )}
                        {(r.status === 'Retenu 24h' || r.status === 'Disponible pour retrait') && (
                          <button
                            type="button"
                            onClick={() => void handlePickup(r.id)}
                            className="min-h-[42px] flex-1 rounded-lg bg-emerald-900 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 cursor-pointer"
                          >
                            Confirmer retrait (emprunt {settings?.borrowingDurationDays ?? 7}j)
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setCancelingReservation(r)}
                          className="min-h-[42px] rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-stone-700 hover:border-red-700 hover:text-red-800 cursor-pointer"
                        >
                          Annuler
                        </button>
                      </div>
                    )}
                  </article>
                ))}
              </div>

              {/* Tableau desktop */}
              <div className="hidden md:block rounded-xl border border-stone-200 bg-white overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-stone-200 bg-stone-50 text-xs font-semibold text-stone-700">
                    <tr>
                      <th className="px-4 py-3">Type / Rang</th>
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
                          <div>
                            {r.requestType === 'retenue_24h'
                              ? 'Retenue 24 h'
                              : r.queuePosition
                                ? `FIFO #${r.queuePosition}`
                                : 'FIFO'}
                          </div>
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
                          {r.pickupDeadline &&
                            (r.status === 'Retenu 24h' || r.status === 'Disponible pour retrait') && (
                              <div className="text-stone-600 tabular-nums">
                                Limite : {formatDateTimeFr(r.pickupDeadline)}
                              </div>
                            )}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap space-x-2">
                          {r.status === 'Exemplaire attribué' && (
                            <button
                              type="button"
                              onClick={() => void handleConfirmReservationAvailability(r.id)}
                              className="rounded-lg bg-emerald-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 cursor-pointer"
                            >
                              Confirmer disponibilité ({settings?.pickupWindowDays ?? 3} j)
                            </button>
                          )}
                          {(r.status === 'Retenu 24h' || r.status === 'Disponible pour retrait') && (
                            <button
                              type="button"
                              onClick={() => void handlePickup(r.id)}
                              className="rounded-lg bg-emerald-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 cursor-pointer"
                            >
                              Confirmer retrait (emprunt {settings?.borrowingDurationDays ?? 7}j)
                            </button>
                          )}
                          {(r.status === 'Retenu 24h' ||
                            r.status === 'En attente' ||
                            r.status === 'Exemplaire attribué' ||
                            r.status === 'Disponible pour retrait') && (
                            <button
                              type="button"
                              onClick={() => setCancelingReservation(r)}
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

          {/* 5B. JOURNAL DES ÉTATS D'EXEMPLAIRES */}
          {tab === 'history' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <History className="h-5 w-5 text-emerald-900 shrink-0" />
                <div>
                  <h2 className="font-editorial text-xl font-semibold text-stone-950">
                    Journal des transitions d’état des exemplaires ({copyStateLogs.length})
                  </h2>
                  <p className="text-xs text-stone-600">
                    Traçabilité chronologique de chaque exemplaire : mise en rayon, retenue 24 h, attribution FIFO 3 j, prêt 7 j, retour, réparation, retrait définitif et expirations.
                  </p>
                </div>
              </div>

              {copyStateLogs.length === 0 ? (
                <div className="rounded-xl border border-stone-200 bg-white p-8 text-center text-sm text-stone-600">
                  Aucune transition d’état enregistrée pour le moment.
                </div>
              ) : (
                <>
                  <div className="space-y-3 md:hidden">
                    {copyStateLogs.map((log) => (
                      <article
                        key={log.id}
                        className="rounded-xl border border-stone-200 bg-white p-4 space-y-1.5 text-xs"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 pb-1.5">
                          <span className="font-mono font-semibold text-emerald-950">
                            {log.copyBarcode}
                          </span>
                          <span className="font-mono text-stone-500 tabular-nums">
                            {formatDateTimeFr(log.createdAt)}
                          </span>
                        </div>
                        <div className="font-semibold text-stone-900">
                          {log.oldStatus ? `${log.oldStatus} → ` : ''}
                          {log.newStatus}
                        </div>
                        <div className="text-stone-700">{log.bookTitle}</div>
                        <div className="text-stone-600">{log.summary}</div>
                        <div className="text-[11px] text-stone-500">
                          Agent : {log.agentName || 'Système'}
                          {log.memberName ? ` · Membre : ${log.memberName}` : ''}
                        </div>
                      </article>
                    ))}
                  </div>

                  <div className="hidden md:block rounded-xl border border-stone-200 bg-white overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-stone-200 bg-stone-50 text-xs font-semibold text-stone-700">
                        <tr>
                          <th className="px-4 py-3">Date</th>
                          <th className="px-4 py-3">Exemplaire</th>
                          <th className="px-4 py-3">Transition</th>
                          <th className="px-4 py-3">Membre / Agent</th>
                          <th className="px-4 py-3">Détail</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100 text-xs">
                        {copyStateLogs.map((log) => (
                          <tr key={log.id}>
                            <td className="px-4 py-3 font-mono text-stone-600 whitespace-nowrap tabular-nums">
                              {formatDateTimeFr(log.createdAt)}
                            </td>
                            <td className="px-4 py-3">
                              <div className="font-mono font-semibold text-stone-950">
                                {log.copyBarcode}
                              </div>
                              <div className="text-stone-600">{log.bookTitle}</div>
                            </td>
                            <td className="px-4 py-3 font-semibold text-emerald-950 whitespace-nowrap">
                              {log.oldStatus ? `${log.oldStatus} → ` : ''}
                              {log.newStatus}
                            </td>
                            <td className="px-4 py-3 text-stone-700">
                              <div>{log.agentName || 'Système'}</div>
                              {log.memberName && (
                                <div className="text-stone-500">Membre : {log.memberName}</div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-stone-600">{log.summary}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          {/* 6. GESTION DES MEMBRES & VALIDATION EST FÈS */}
          {tab === 'members' && (() => {
            const mq = memberSearch.trim().toLowerCase();
            const filteredMembers = members.filter((m) => {
              if (!mq) return true;
              return (
                m.fullName.toLowerCase().includes(mq) ||
                m.email.toLowerCase().includes(mq) ||
                (m.cne || '').toLowerCase().includes(mq)
              );
            });

            return (
              <div className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="h-5 w-5 text-emerald-900 shrink-0" />
                    <h2 className="font-editorial text-xl font-semibold text-stone-950">
                      Comptes membres, validation EST Fès & rôles ({filteredMembers.length})
                    </h2>
                  </div>
                  <div className="relative w-full sm:max-w-xs">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                    <input
                      type="search"
                      value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)}
                      placeholder="Nom, e-mail ou CNE…"
                      aria-label="Rechercher un membre"
                      className="w-full min-h-[40px] rounded-lg border border-stone-300 bg-white pl-9 pr-3 py-1.5 text-sm"
                    />
                  </div>
                </div>

                {/* Cartes mobiles */}
                <div className="space-y-3 md:hidden">
                  {filteredMembers.map((m) => (
                    <article
                      key={m.id}
                      className="rounded-xl border border-stone-200 bg-white p-4 space-y-2.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 pb-2">
                        {m.accountStatus === 'actif' ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-800">
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                            Compte actif
                          </span>
                        ) : (
                          <span className="text-xs font-semibold text-red-700">Compte suspendu</span>
                        )}
                        <span className="text-xs font-medium text-stone-600">
                          {m.isAdmin
                            ? 'Administrateur'
                            : m.role === 'bibliothecaire'
                              ? 'Bibliothécaire'
                              : 'Membre'}
                        </span>
                      </div>

                      <div>
                        <div className="text-sm font-semibold text-stone-900">{m.fullName}</div>
                        <div className="font-mono text-xs text-stone-500 break-all">{m.email}</div>
                        <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-stone-600">
                          <span>{m.emailVerified ? 'E-mail vérifié' : 'E-mail en attente'}</span>
                          <span aria-hidden="true">·</span>
                          <span
                            className={
                              m.studentStatus === 'verifie'
                                ? 'font-semibold text-emerald-800'
                                : 'font-semibold text-amber-800'
                            }
                          >
                            {m.studentStatus === 'verifie'
                              ? 'Statut EST Fès vérifié'
                              : m.studentStatus === 'en_attente'
                                ? 'Statut EST Fès en attente'
                                : 'Hors EST Fès'}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 pt-1">
                        {m.studentStatus !== 'verifie' ? (
                          <button
                            type="button"
                            onClick={() => void handleUpdateMember(m.id, 'verifie', m.accountStatus)}
                            className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1 rounded-lg bg-emerald-900 px-3 text-xs font-semibold text-white hover:bg-emerald-800 cursor-pointer"
                          >
                            <UserCheck className="h-3.5 w-3.5" />
                            Valider statut EST Fès
                          </button>
                        ) : (
                          m.role === 'membre' && (
                            <button
                              type="button"
                              onClick={() =>
                                void handleUpdateMember(m.id, 'en_attente', m.accountStatus)
                              }
                              className="min-h-[40px] rounded-lg border border-stone-300 bg-white px-3 text-xs font-semibold text-stone-700 cursor-pointer"
                            >
                              Mettre en attente EST
                            </button>
                          )
                        )}

                        {m.role === 'membre' &&
                          (m.accountStatus === 'actif' ? (
                            <button
                              type="button"
                              onClick={() =>
                                void handleUpdateMember(m.id, m.studentStatus, 'suspendu')
                              }
                              className="min-h-[40px] rounded-lg border border-stone-300 bg-white px-3 text-xs font-semibold text-red-700 hover:bg-red-50 cursor-pointer"
                            >
                              Suspendre
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void handleUpdateMember(m.id, m.studentStatus, 'actif')}
                              className="min-h-[40px] rounded-lg border border-stone-300 bg-white px-3 text-xs font-semibold text-emerald-900 cursor-pointer"
                            >
                              Réactiver
                            </button>
                          ))}

                        {user.isAdmin && m.id !== user.id && (
                          <>
                            {m.role === 'membre' ? (
                              <button
                                type="button"
                                onClick={() =>
                                  void handleUpdateMemberRole(m.id, 'bibliothecaire', false)
                                }
                                className="inline-flex min-h-[40px] items-center gap-1 rounded-lg border border-stone-300 bg-white px-3 text-xs font-semibold text-emerald-950 cursor-pointer"
                              >
                                <ShieldCheck className="h-3.5 w-3.5" />
                                Nommer bibliothécaire
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleUpdateMemberRole(m.id, 'bibliothecaire', !m.isAdmin)
                                  }
                                  className="min-h-[40px] rounded-lg border border-stone-300 bg-white px-3 text-xs font-semibold text-stone-800 cursor-pointer"
                                >
                                  {m.isAdmin ? 'Retirer admin' : 'Nommer admin'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleUpdateMemberRole(m.id, 'membre', false)}
                                  className="min-h-[40px] rounded-lg border border-stone-300 bg-white px-3 text-xs font-semibold text-red-700 cursor-pointer"
                                >
                                  Révoquer personnel
                                </button>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    </article>
                  ))}
                </div>

                {/* Tableau desktop */}
                <div className="hidden md:block rounded-xl border border-stone-200 bg-white overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-stone-200 bg-stone-50 text-xs font-semibold text-stone-700">
                      <tr>
                        <th className="px-4 py-3">Nom & E-mail</th>
                        <th className="px-4 py-3">Rôle / Filière</th>
                        <th className="px-4 py-3">E-mail & Statut EST Fès</th>
                        <th className="px-4 py-3">Compte</th>
                        <th className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {filteredMembers.map((m) => (
                        <tr key={m.id}>
                          <td className="px-4 py-3">
                            <div className="font-medium text-stone-900">{m.fullName}</div>
                            <div className="font-mono text-xs text-stone-500">{m.email}</div>
                          </td>
                          <td className="px-4 py-3 text-xs text-stone-700">
                            <div className="font-semibold text-stone-900">
                              {m.isAdmin
                                ? 'Administrateur bibliothèque'
                                : m.role === 'bibliothecaire'
                                  ? 'Bibliothécaire'
                                  : 'Membre'}
                            </div>
                            <div className="text-stone-500">{m.filiere || m.institution}</div>
                          </td>
                          <td className="px-4 py-3 text-xs">
                            <div className="text-stone-600">
                              {m.emailVerified ? 'Adresse vérifiée' : 'Adresse non vérifiée'}
                            </div>
                            <div
                              className={
                                m.studentStatus === 'verifie'
                                  ? 'font-semibold text-emerald-800'
                                  : 'font-semibold text-amber-800'
                              }
                            >
                              {m.studentStatus === 'verifie'
                                ? 'EST Fès vérifié'
                                : m.studentStatus === 'en_attente'
                                  ? 'EST Fès en attente'
                                  : 'Hors EST Fès'}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs font-semibold">
                            {m.accountStatus === 'actif' ? (
                              <span className="inline-flex items-center gap-1 text-emerald-800">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Actif
                              </span>
                            ) : (
                              <span className="text-red-700">Suspendu</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap space-x-2">
                            {m.studentStatus !== 'verifie' && (
                              <button
                                type="button"
                                onClick={() =>
                                  void handleUpdateMember(m.id, 'verifie', m.accountStatus)
                                }
                                className="rounded-lg bg-emerald-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 cursor-pointer"
                              >
                                Valider EST Fès
                              </button>
                            )}
                            {m.studentStatus === 'verifie' && m.role === 'membre' && (
                              <button
                                type="button"
                                onClick={() =>
                                  void handleUpdateMember(m.id, 'en_attente', m.accountStatus)
                                }
                                className="rounded-lg border border-stone-300 px-2.5 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-50 cursor-pointer"
                              >
                                Mettre en attente
                              </button>
                            )}
                            {m.role === 'membre' && m.accountStatus === 'actif' && (
                              <button
                                type="button"
                                onClick={() =>
                                  void handleUpdateMember(m.id, m.studentStatus, 'suspendu')
                                }
                                className="rounded-lg border border-stone-300 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 cursor-pointer"
                              >
                                Suspendre
                              </button>
                            )}
                            {m.role === 'membre' && m.accountStatus === 'suspendu' && (
                              <button
                                type="button"
                                onClick={() => void handleUpdateMember(m.id, m.studentStatus, 'actif')}
                                className="rounded-lg border border-stone-300 px-2.5 py-1.5 text-xs font-semibold text-emerald-900 cursor-pointer"
                              >
                                Réactiver
                              </button>
                            )}
                            {user.isAdmin && m.id !== user.id && (
                              <>
                                {m.role === 'membre' ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleUpdateMemberRole(m.id, 'bibliothecaire', false)
                                    }
                                    className="rounded-lg border border-emerald-900/40 px-2.5 py-1.5 text-xs font-semibold text-emerald-950 hover:bg-emerald-50 cursor-pointer"
                                  >
                                    Nommer bibliothécaire
                                  </button>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void handleUpdateMemberRole(
                                          m.id,
                                          'bibliothecaire',
                                          !m.isAdmin
                                        )
                                      }
                                      className="rounded-lg border border-stone-300 px-2.5 py-1.5 text-xs font-semibold text-stone-800 hover:bg-stone-50 cursor-pointer"
                                    >
                                      {m.isAdmin ? 'Retirer admin' : 'Nommer admin'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void handleUpdateMemberRole(m.id, 'membre', false)
                                      }
                                      className="rounded-lg border border-stone-300 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 cursor-pointer"
                                    >
                                      Révoquer
                                    </button>
                                  </>
                                )}
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })()}

          {/* 7. PARAMÈTRES BIBLIOTHÈQUE (ADMINISTRATEUR UNIQUEMENT) */}
          {tab === 'settings' && user.isAdmin && (
            <form
              onSubmit={handleSaveSettings}
              className="max-w-2xl rounded-xl border border-stone-200 bg-white p-5 sm:p-6 space-y-5"
            >
              <div className="flex items-center gap-2 border-b border-stone-200 pb-3">
                <Settings className="h-5 w-5 text-emerald-900" />
                <div>
                  <h2 className="font-editorial text-xl font-semibold text-stone-950">
                    Paramètres de la bibliothèque
                  </h2>
                  <p className="text-xs text-stone-600">
                    Configuration réservée à l’administrateur de la bibliothèque BiblioEST.
                  </p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-stone-700">
                    Durée standard de prêt (jours)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    required
                    value={settingsForm.borrowingDurationDays}
                    onChange={(e) =>
                      setSettingsForm({
                        ...settingsForm,
                        borrowingDurationDays: Number(e.target.value),
                      })
                    }
                    className="mt-1 w-full min-h-[42px] rounded-lg border border-stone-300 px-3 py-2 text-sm font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-stone-700">
                    Délai de retrait FIFO (jours)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={14}
                    required
                    value={settingsForm.pickupWindowDays}
                    onChange={(e) =>
                      setSettingsForm({
                        ...settingsForm,
                        pickupWindowDays: Number(e.target.value),
                      })
                    }
                    className="mt-1 w-full min-h-[42px] rounded-lg border border-stone-300 px-3 py-2 text-sm font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700">
                  Adresse autorisée pour l’e-mail de test
                </label>
                <input
                  type="email"
                  required
                  value={settingsForm.testEmailRecipient}
                  onChange={(e) =>
                    setSettingsForm({
                      ...settingsForm,
                      testEmailRecipient: e.target.value,
                    })
                  }
                  className="mt-1 w-full min-h-[42px] rounded-lg border border-stone-300 px-3 py-2 text-sm font-mono"
                />
                <p className="mt-1 text-xs text-stone-500">
                  Le bouton d’e-mail de test n’envoie jamais ailleurs que vers cette adresse.
                </p>
              </div>

              <label className="flex items-start gap-2.5 text-sm text-stone-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settingsForm.realEmailsEnabled}
                  disabled={isDemoSession}
                  onChange={(e) =>
                    setSettingsForm({
                      ...settingsForm,
                      realEmailsEnabled: e.target.checked,
                    })
                  }
                  className="mt-1 h-4 w-4 rounded border-stone-300"
                />
                <span>
                  <span className="font-semibold">Autoriser l’envoi réel d’e-mails</span>
                  <span className="block text-xs text-stone-500">
                    {isDemoSession
                      ? 'Toujours désactivé dans le bac à sable Mode Démo : les e-mails sont simulés.'
                      : 'Active l’envoi effectif via Gmail API / SMTP pour les relances et notifications de disponibilité.'}
                  </span>
                </span>
              </label>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={savingSettings}
                  className="min-h-[44px] rounded-lg bg-emerald-900 px-5 py-2.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60 cursor-pointer"
                >
                  {savingSettings ? 'Enregistrement…' : 'Enregistrer les paramètres'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* Modale compacte d'enregistrement de retour et inspection physique */}
      {returningLoan && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="return-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/50 p-4"
        >
          <form
            onSubmit={handleReturnSubmit}
            className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-xl border border-stone-200 bg-white p-5 sm:p-6 space-y-4"
          >
            <div className="flex items-start justify-between gap-3">
              <h3 id="return-modal-title" className="font-editorial text-xl font-semibold text-stone-950">
                Retour et inspection physique
              </h3>
              <button
                type="button"
                onClick={() => setReturningLoan(null)}
                aria-label="Fermer la fenêtre"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
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
                className="mt-1 w-full min-h-[42px] rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
              >
                <option value="reutilisable">
                  Réutilisable (file FIFO ou Disponible)
                </option>
                <option value="endommage">
                  Endommagé (envoyer en réparation)
                </option>
                <option value="retire_definitivement">
                  Irrécupérable (retirer définitivement)
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
                className="mt-1 w-full min-h-[42px] rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
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

            <div className="flex flex-wrap justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setReturningLoan(null)}
                className="min-h-[42px] rounded-lg border border-stone-300 px-4 py-2 text-xs font-semibold text-stone-700 cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="submit"
                className="min-h-[42px] rounded-lg bg-emerald-900 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-800 cursor-pointer"
              >
                Valider le retour
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modale compacte d'inspection post-réparation */}
      {inspectingCopy && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="inspect-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/50 p-4"
        >
          <form
            onSubmit={handleInspectRepairedSubmit}
            className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-xl border border-stone-200 bg-white p-5 sm:p-6 space-y-4"
          >
            <div className="flex items-start justify-between gap-3">
              <h3 id="inspect-modal-title" className="font-editorial text-xl font-semibold text-stone-950">
                Inspection après réparation
              </h3>
              <button
                type="button"
                onClick={() => setInspectingCopy(null)}
                aria-label="Fermer la fenêtre"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
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
                className="mt-1 w-full min-h-[42px] rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
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

            <div className="flex flex-wrap justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setInspectingCopy(null)}
                className="min-h-[42px] rounded-lg border border-stone-300 px-4 py-2 text-xs font-semibold text-stone-700 cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="submit"
                className="min-h-[42px] rounded-lg bg-emerald-900 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-800 cursor-pointer"
              >
                Confirmer l’inspection
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modale de confirmation de retrait définitif d'un exemplaire (action irréversible) */}
      {retiringCopy && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="retire-copy-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/50 p-4"
        >
          <div className="w-full max-w-md rounded-xl border border-stone-200 bg-white p-5 sm:p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <h3 id="retire-copy-modal-title" className="font-editorial text-xl font-semibold text-stone-950">
                Retirer définitivement cet exemplaire ?
              </h3>
              <button
                type="button"
                onClick={() => setRetiringCopy(null)}
                aria-label="Fermer la fenêtre"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-stone-600 leading-relaxed">
              L’exemplaire <span className="font-mono font-semibold">{retiringCopy.barcode}</span> ({retiringCopy.bookTitle}) sera retiré définitivement de la circulation et ne pourra plus être emprunté ni réservé.
            </p>
            <div className="flex flex-wrap justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setRetiringCopy(null)}
                className="min-h-[42px] rounded-lg border border-stone-300 px-4 py-2 text-xs font-semibold text-stone-700 cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmRetireCopy()}
                className="min-h-[42px] rounded-lg bg-red-700 px-4 py-2 text-xs font-semibold text-white hover:bg-red-800 cursor-pointer"
              >
                Confirmer le retrait définitif
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modale de confirmation d'annulation de réservation par le personnel */}
      {cancelingReservation && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-res-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/50 p-4"
        >
          <div className="w-full max-w-md rounded-xl border border-stone-200 bg-white p-5 sm:p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <h3 id="cancel-res-modal-title" className="font-editorial text-xl font-semibold text-stone-950">
                Annuler cette réservation ?
              </h3>
              <button
                type="button"
                onClick={() => setCancelingReservation(null)}
                aria-label="Fermer la fenêtre"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-xs text-stone-600 leading-relaxed">
              La réservation de <strong>{cancelingReservation.memberName}</strong> pour « {cancelingReservation.bookTitle} » sera annulée et la file FIFO sera recalculée immédiatement.
            </p>
            <div className="flex flex-wrap justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setCancelingReservation(null)}
                className="min-h-[42px] rounded-lg border border-stone-300 px-4 py-2 text-xs font-semibold text-stone-700 cursor-pointer"
              >
                Conserver
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmCancelReservation()}
                className="min-h-[42px] rounded-lg bg-red-700 px-4 py-2 text-xs font-semibold text-white hover:bg-red-800 cursor-pointer"
              >
                Confirmer l’annulation
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modale de confirmation d'envoi d'e-mail de rappel */}
      {showNotifyModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="notify-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/50 p-4"
        >
          <div className="w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-xl border border-stone-200 bg-white p-5 sm:p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 text-stone-950">
                <Mail className="h-5 w-5 text-red-700" />
                <h3 id="notify-modal-title" className="font-editorial text-xl font-semibold">
                  {isDemoSession
                    ? 'Simuler la notification des retards (Mode Démo)'
                    : 'Confirmer l’envoi de rappel par e-mail'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowNotifyModal(false)}
                aria-label="Fermer la fenêtre"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-xs text-stone-600 leading-relaxed">
              {isDemoSession
                ? 'En Mode Démo, aucun e-mail réel n’est expédié : un récapitulatif par membre est enregistré dans le journal des notifications simulées.'
                : 'Vous vous apprêtez à envoyer un e-mail récapitulatif de relance par membre dont le délai de prêt est dépassé.'}
            </p>

            {/* Liste des destinataires */}
            <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 space-y-2">
              <p className="text-xs font-semibold text-stone-900">
                Membres concernés ({loans.filter((l) => l.status === 'En retard').length} emprunt(s) en retard) :
              </p>
              <div className="max-h-40 overflow-y-auto divide-y divide-stone-200 text-xs">
                {Array.from(
                  new Map(
                    loans
                      .filter((l) => l.status === 'En retard')
                      .map((l) => [l.memberId, l])
                  ).values()
                ).map((l) => (
                  <div key={l.id} className="py-2 space-y-0.5">
                    <div className="font-semibold text-stone-900">
                      {l.memberName}{' '}
                      <span className="font-mono font-normal text-stone-600">({l.memberEmail})</span>
                    </div>
                    <div className="text-stone-600">
                      Ouvrage : <em>« {l.bookTitle} »</em> · Échéance : {formatDateFr(l.dueAt)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-stone-200 bg-white p-3 text-xs space-y-1">
              <div className="text-stone-500">Objet de l’e-mail :</div>
              <div className="font-semibold text-stone-900">
                BiblioEST — Rappel : emprunt(s) en retard à restituer
              </div>
            </div>

            {/* Statut d'envoi */}
            <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-3 text-xs text-emerald-950 flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-800 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">
                  {isDemoSession
                    ? 'Simulation isolée (aucun e-mail réel)'
                    : settings?.realEmailsEnabled === false
                      ? 'Envoi réel désactivé dans les paramètres'
                      : 'Envoi direct via Gmail API / SMTP'}
                </p>
                <p className="mt-0.5 text-emerald-900">
                  {isDemoSession
                    ? 'Consultez ensuite le panneau « Scénarios & Profils Démo » pour lire les e-mails simulés.'
                    : 'Un récapitulatif regroupant les ouvrages en retard sera transmis à chaque membre concerné.'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={notifyingOverdue}
                onClick={() => setShowNotifyModal(false)}
                className="min-h-[42px] rounded-lg border border-stone-300 px-4 py-2 text-xs font-semibold text-stone-700 cursor-pointer hover:bg-stone-50"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={notifyingOverdue}
                onClick={() => void handleNotifyOverdueMembers()}
                className="min-h-[42px] inline-flex items-center justify-center gap-2 rounded-lg bg-red-700 px-5 py-2 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-60 cursor-pointer"
              >
                <Mail className="h-4 w-4" />
                {notifyingOverdue
                  ? 'Traitement en cours…'
                  : isDemoSession
                    ? 'Simuler la notification'
                    : 'Confirmer et envoyer les e-mails'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function prevLocationFallback(current: string): string {
  return current || 'Rayon général';
}
