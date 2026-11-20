import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  FlaskConical,
  ListChecks,
  Mail,
  RotateCcw,
  UserCheck,
  X,
} from 'lucide-react';
import type {
  DemoScenarioStatus,
  DemoState,
  UserPublic,
} from '../../shared/types.ts';
import { api, ApiError, formatDateTimeFr } from '../lib/api.ts';
import type { AppPage } from './Navbar.tsx';

interface DemoScenarioDef {
  id: string;
  number: number;
  title: string;
  actor: string;
  suggestedUserId: string;
  targetPage: AppPage;
  steps: string;
  expected: string;
}

const DEMO_SCENARIOS: DemoScenarioDef[] = [
  {
    id: 'sc-1',
    number: 1,
    title: 'Inscription académique + code OTP + statut EST en attente',
    actor: 'Candidat puis Bibliothécaire',
    suggestedUserId: 'usr-karim',
    targetPage: 'auth',
    steps:
      'Créer un compte avec une adresse académique (ou .example), copier le code OTP dans le journal simulé ci-contre, valider l’adresse, puis tenter de confirmer un panier avant validation EST Fès.',
    expected:
      'L’adresse devient vérifiée, mais le statut EST Fès reste « en_attente » et bloque la confirmation du panier jusqu’à validation par un bibliothécaire.',
  },
  {
    id: 'sc-2',
    number: 2,
    title: 'Refus global du panier sur emprunt en retard',
    actor: 'Youssef Mansouri (Démo)',
    suggestedUserId: 'usr-youssef',
    targetPage: 'catalogue',
    steps:
      'Activer le profil Youssef (qui détient un emprunt en retard), ajouter un ouvrage via « Ajouter au panier », ouvrir le panier puis cliquer sur « Confirmer mes demandes ».',
    expected:
      'Le serveur refuse l’ensemble du panier (403) sans créer ni retenue 24 h ni réservation FIFO et affiche le motif exact du retard en cours.',
  },
  {
    id: 'sc-3',
    number: 3,
    title: 'Panier mixte (retenue 24 h + FIFO + refus isolé) & confidentialité codes-barres',
    actor: 'Salma Idrissi (Démo)',
    suggestedUserId: 'usr-salma',
    targetPage: 'catalogue',
    steps:
      'Ouvrir la fiche d’un ouvrage (un seul bouton « Ajouter au panier », aucun code-barres affiché), ajouter un titre disponible, un titre sans copie libre et un titre hors circulation au panier, puis cliquer sur « Confirmer mes demandes ».',
    expected:
      'Le serveur affecte une retenue 24 h au comptoir pour le titre disponible (sans démarrer de prêt 7 j), crée une réservation FIFO pour l’autre, et refuse uniquement la ligne hors circulation.',
  },
  {
    id: 'sc-4',
    number: 4,
    title: 'Retrait au comptoir : contrôle erreur (mauvais exemplaire) sans mutation',
    actor: 'Nadia Benali (Bibliothécaire Démo)',
    suggestedUserId: 'usr-lib',
    targetPage: 'admin',
    steps:
      'Ouvrir Administration → Comptoir / Circulation, scanner la carte d’Amine (CNE D138000001 ou amine.demo@usmba.example), puis scanner un mauvais code-barres (ex. EST-INF-0101 ou celui d’un autre exemplaire).',
    expected:
      'Le serveur refuse le retrait sans modifier l’état de la retenue 24 h ni de l’exemplaire, et affiche la raison exacte pour permettre au bibliothécaire de rescanner.',
  },
  {
    id: 'sc-5',
    number: 5,
    title: 'Retrait au comptoir valide : scan carte + copie -> emprunt 7 jours + journal d’état',
    actor: 'Nadia Benali (Bibliothécaire Démo)',
    suggestedUserId: 'usr-lib',
    targetPage: 'admin',
    steps:
      'Dans Comptoir / Circulation avec le dossier d’Amine affiché (retenue 24 h active sur EST-MGT-0302), scanner le code-barres attendu (EST-MGT-0302).',
    expected:
      'La retenue 24 h passe à « Retirée », l’exemplaire passe à « Emprunté », l’emprunt de 7 jours est créé avec sa date d’échéance et journalisé dans « Journal exemplaires ».',
  },
  {
    id: 'sc-6',
    number: 6,
    title: 'Expiration automatique d’une retenue 24 h (+25 h) et bascule vers FIFO / Disponible',
    actor: 'Membre + Horloge simulée (+25 h)',
    suggestedUserId: 'usr-bilale',
    targetPage: 'reservations',
    steps:
      'Avec une retenue 24 h active (ex. Amine sur Comptabilité Analytique ou Salma après validation panier), avancer l’horloge simulée de « +25 heures ».',
    expected:
      'La retenue passe à « Expirée » et l’exemplaire est réattribué au premier membre FIFO éligible (sinon remis « Disponible »), avec trace dans le journal des états.',
  },
  {
    id: 'sc-7',
    number: 7,
    title: 'File FIFO multi-membres, retour réutilisable & expiration délai 3 jours (+4 j)',
    actor: 'Bibliothécaire + Horloge (+4 jours)',
    suggestedUserId: 'usr-lib',
    targetPage: 'admin',
    steps:
      'Enregistrer le retour réutilisable de « Architecture des Systèmes Distribués » (attribution auto à Salma pour 3 j), puis avancer l’horloge de « +4 jours » si un autre membre attend en file FIFO.',
    expected:
      'L’exemplaire passe en « Réservé » (3 j) pour le n° 1 FIFO ; après +4 jours sans retrait, la demande expire et l’exemplaire passe au membre suivant.',
  },
  {
    id: 'sc-8',
    number: 8,
    title: 'Retour endommagé -> réparation -> inspection finale -> remise en circulation',
    actor: 'Nadia Benali (Bibliothécaire Démo)',
    suggestedUserId: 'usr-lib',
    targetPage: 'admin',
    steps:
      'Enregistrer un retour via scan rapide comptoir (ou Emprunts & retours) avec décision « Endommagé », puis dans Exemplaires cliquer sur « Terminer réparation » et « Inspecter après réparation ».',
    expected:
      'L’exemplaire reste bloqué tant que l’inspection favorable n’est pas confirmée, puis retourne en « Disponible » ou « Réservé » selon la file FIFO.',
  },
  {
    id: 'sc-9',
    number: 9,
    title: 'Retards (+8 jours), carte cliquable & relances simulées',
    actor: 'Nadia Benali (Bibliothécaire Démo)',
    suggestedUserId: 'usr-lib',
    targetPage: 'admin',
    steps:
      'Avancer l’horloge de « +8 jours », cliquer sur la carte KPI « Emprunts en retard », tester « Simuler retard », puis cliquer sur « Notifier les membres par e-mail ».',
    expected:
      'Les prêts échus basculent en « En retard » et les e-mails de relance sont enregistrés dans le journal simulé ci-contre (aucun envoi réel en mode Démo).',
  },
  {
    id: 'sc-10',
    number: 10,
    title: 'Administration : rôles du personnel, paramètres & ajout d’exemplaires en lot',
    actor: 'Hassan Tazi (Admin Démo)',
    suggestedUserId: 'usr-admin',
    targetPage: 'admin',
    steps:
      'Activer Hassan (Admin), gérer les rôles du personnel dans Membres, ajuster les paramètres de la bibliothèque, et tester l’ajout en lot dans Exemplaires.',
    expected:
      'Seul l’administrateur peut modifier les rôles et paramètres ; les codes-barres complets restent réservés aux vues personnel.',
  },
];

const STORAGE_KEY = 'biblioest_demo_scenarios_v2';

interface DemoPanelProps {
  open: boolean;
  demoState: DemoState | null;
  currentUser: UserPublic | null;
  onClose: () => void;
  onSwitchProfile: (userId: string, navigateTo?: AppPage) => Promise<void>;
  onResetDemo: () => Promise<void>;
  onAdvanceClock: (payload: { addHours?: number; addDays?: number } | null) => Promise<void>;
  onRefreshState: () => Promise<void>;
}

export function DemoPanel({
  open,
  demoState,
  currentUser,
  onClose,
  onSwitchProfile,
  onResetDemo,
  onAdvanceClock,
  onRefreshState,
}: DemoPanelProps) {
  const [activeTab, setActiveTab] = useState<'controls' | 'scenarios' | 'outbox'>('controls');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, DemoScenarioStatus>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Record<string, DemoScenarioStatus>) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    if (!open) return;
    void onRefreshState();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open || !demoState) return null;

  const updateScenarioStatus = (id: string, next: DemoScenarioStatus) => {
    const updated = { ...statuses, [id]: next };
    setStatuses(updated);
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // ignore storage quota errors
    }
  };

  const handleClock = async (
    payload: { addHours?: number; addDays?: number } | null,
    label: string
  ) => {
    setBusyAction(payload === null ? 'clock-reset' : `clock-${label}`);
    setError(null);
    setFeedback(null);
    try {
      await onAdvanceClock(payload);
      setFeedback(
        payload === null
          ? 'Horloge simulée ramenée à la date réelle (J+0).'
          : `Horloge simulée avancée de ${label} et échéances recalculées (retenues 24 h, retraits 3 j et retards).`
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Impossible de modifier l’horloge démo.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleReset = async () => {
    setBusyAction('reset');
    setError(null);
    setFeedback(null);
    try {
      await onResetDemo();
      setFeedback('Base de démonstration (.example) réinitialisée à son état initial.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur lors de la réinitialisation.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleProfileClick = async (userId: string, navigateTo?: AppPage) => {
    setBusyAction(`profile-${userId}`);
    setError(null);
    setFeedback(null);
    try {
      await onSwitchProfile(userId, navigateTo);
      if (navigateTo) onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Changement de profil impossible.');
    } finally {
      setBusyAction(null);
    }
  };

  const passedCount = DEMO_SCENARIOS.filter((s) => statuses[s.id] === 'reussi').length;
  const totalOffsetHours = demoState.clockOffsetHours ?? demoState.clockOffsetDays * 24;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="demo-panel-title"
      className="fixed inset-0 z-50 flex justify-end bg-stone-950/50 backdrop-blur-[1px]"
    >
      <div className="flex h-full w-full max-w-2xl flex-col border-l border-stone-200 bg-white shadow-2xl">
        {/* En-tête Mode Démo */}
        <div className="flex items-start justify-between gap-3 border-b border-amber-200 bg-amber-50/70 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold text-amber-950">
              <FlaskConical className="h-4 w-4 shrink-0 text-amber-800" />
              <span>Bac à sable isolé · Comptes fictifs .example · Aucun e-mail réel</span>
            </div>
            <h2 id="demo-panel-title" className="mt-1 font-editorial text-xl font-semibold text-stone-950">
              Mode Démo & Scénarios de test
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer le panneau Mode Démo"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-amber-200 bg-white text-stone-700 hover:bg-stone-50 cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation interne du panneau Démo */}
        <div className="grid grid-cols-3 gap-1 border-b border-stone-200 bg-stone-50 p-1.5 px-4 sm:px-6">
          <button
            type="button"
            onClick={() => setActiveTab('controls')}
            className={`min-h-[40px] rounded-lg px-2 text-xs font-semibold transition-colors cursor-pointer ${
              activeTab === 'controls'
                ? 'bg-white text-emerald-950 shadow-xs'
                : 'text-stone-600 hover:text-stone-950'
            }`}
          >
            Profils & Horloge
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('scenarios')}
            className={`min-h-[40px] rounded-lg px-2 text-xs font-semibold transition-colors cursor-pointer tabular-nums ${
              activeTab === 'scenarios'
                ? 'bg-white text-emerald-950 shadow-xs'
                : 'text-stone-600 hover:text-stone-950'
            }`}
          >
            Scénarios ({passedCount}/{DEMO_SCENARIOS.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('outbox')}
            className={`min-h-[40px] rounded-lg px-2 text-xs font-semibold transition-colors cursor-pointer tabular-nums ${
              activeTab === 'outbox'
                ? 'bg-white text-emerald-950 shadow-xs'
                : 'text-stone-600 hover:text-stone-950'
            }`}
          >
            Journal simulé ({demoState.outbox.length})
          </button>
        </div>

        {/* Contenu scrollable */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {feedback && (
            <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-medium text-emerald-950">
              {feedback}
            </div>
          )}
          {error && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-900">
              {error}
            </div>
          )}

          {activeTab === 'controls' && (
            <div className="space-y-6">
              {/* Horloge simulée & Réinitialisation */}
              <section className="rounded-xl border border-stone-200 bg-stone-50/70 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm font-semibold text-stone-900">
                    <Clock className="h-4 w-4 text-emerald-900" />
                    <span>Horloge simulée du bac à sable</span>
                  </div>
                  <span className="font-mono text-xs font-semibold text-emerald-900 tabular-nums">
                    Décalage : {totalOffsetHours >= 0 ? `+${totalOffsetHours}` : totalOffsetHours} h ({demoState.clockOffsetDays >= 0 ? `+${demoState.clockOffsetDays}` : demoState.clockOffsetDays} j)
                  </span>
                </div>

                <p className="text-xs text-stone-600 tabular-nums">
                  Date simulée active :{' '}
                  <strong className="font-mono text-stone-900">
                    {formatDateTimeFr(demoState.simulatedNow)}
                  </strong>
                </p>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => void handleClock({ addHours: 12 }, '+12 heures')}
                    className="min-h-[40px] rounded-lg border border-stone-300 bg-white px-2.5 text-xs font-semibold text-stone-800 hover:border-emerald-900 cursor-pointer disabled:opacity-50"
                  >
                    +12 heures
                  </button>
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => void handleClock({ addHours: 25 }, '+25 heures')}
                    className="min-h-[40px] rounded-lg border border-stone-300 bg-white px-2.5 text-xs font-semibold text-stone-800 hover:border-emerald-900 cursor-pointer disabled:opacity-50"
                  >
                    +25 heures
                  </button>
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => void handleClock({ addDays: 3 }, '+3 jours')}
                    className="min-h-[40px] rounded-lg border border-stone-300 bg-white px-2.5 text-xs font-semibold text-stone-800 hover:border-emerald-900 cursor-pointer disabled:opacity-50"
                  >
                    +3 jours
                  </button>
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => void handleClock({ addDays: 4 }, '+4 jours')}
                    className="min-h-[40px] rounded-lg border border-stone-300 bg-white px-2.5 text-xs font-semibold text-stone-800 hover:border-emerald-900 cursor-pointer disabled:opacity-50"
                  >
                    +4 jours
                  </button>
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => void handleClock({ addDays: 8 }, '+8 jours')}
                    className="min-h-[40px] rounded-lg border border-stone-300 bg-white px-2.5 text-xs font-semibold text-stone-800 hover:border-emerald-900 cursor-pointer disabled:opacity-50"
                  >
                    +8 jours
                  </button>
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    disabled={busyAction !== null || totalOffsetHours === 0}
                    onClick={() => void handleClock(null, 'J+0')}
                    className="min-h-[40px] rounded-lg border border-stone-300 bg-white px-3.5 text-xs font-semibold text-stone-700 hover:bg-stone-100 cursor-pointer disabled:opacity-50"
                  >
                    Revenir à J+0
                  </button>
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() => void handleReset()}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-amber-800 px-4 text-xs font-semibold text-white hover:bg-amber-900 cursor-pointer disabled:opacity-50"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    {busyAction === 'reset' ? 'Réinitialisation…' : 'Réinitialiser la démo'}
                  </button>
                </div>
              </section>

              {/* Sélecteur de profils .example */}
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <UserCheck className="h-4 w-4 text-emerald-900" />
                  <h3 className="text-sm font-semibold text-stone-950">
                    Profils de démonstration (.example)
                  </h3>
                </div>
                <p className="text-xs text-stone-600">
                  Ce sélecteur ouvre une session isolée sur la base de démonstration uniquement (jamais sur les comptes réels).
                </p>

                <div className="space-y-2.5">
                  {demoState.profiles.map((p) => {
                    const isCurrent = demoState.isDemoSession && currentUser?.id === p.id;
                    const roleLabel = p.isAdmin
                      ? 'Administrateur · Bibliothécaire'
                      : p.role === 'bibliothecaire'
                        ? 'Bibliothécaire'
                        : p.studentStatus === 'en_attente'
                          ? 'Membre · Statut EST en attente'
                          : 'Membre vérifié';

                    return (
                      <div
                        key={p.id}
                        className={`flex flex-col gap-3 rounded-xl border p-3.5 sm:flex-row sm:items-center sm:justify-between ${
                          isCurrent
                            ? 'border-emerald-800 bg-emerald-50/50'
                            : 'border-stone-200 bg-white'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-x-2 text-xs font-semibold text-stone-950">
                            <span>{p.fullName}</span>
                            <span className="text-stone-400">·</span>
                            <span className="text-emerald-900">{roleLabel}</span>
                          </div>
                          <div className="mt-0.5 font-mono text-[11px] text-stone-600 break-all">
                            {p.email}
                            {p.cne ? ` · Carte/CNE : ${p.cne}` : ''}
                          </div>
                        </div>

                        <button
                          type="button"
                          disabled={busyAction !== null}
                          onClick={() => void handleProfileClick(p.id)}
                          className={`min-h-[40px] shrink-0 whitespace-nowrap rounded-lg px-3.5 text-xs font-semibold cursor-pointer ${
                            isCurrent
                              ? 'border border-emerald-800 bg-white text-emerald-950'
                              : 'bg-emerald-900 text-white hover:bg-emerald-800'
                          }`}
                        >
                          {busyAction === `profile-${p.id}`
                            ? 'Activation…'
                            : isCurrent
                              ? 'Profil actif'
                              : 'Activer ce profil'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
          )}

          {activeTab === 'scenarios' && (
            <div className="space-y-3.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-stone-900">
                  <ListChecks className="h-4 w-4 text-emerald-900" />
                  <span>Cahier de recette manuel (10 parcours métier)</span>
                </div>
                <span className="font-mono text-xs text-stone-600 tabular-nums">
                  {passedCount}/{DEMO_SCENARIOS.length} validés
                </span>
              </div>

              {DEMO_SCENARIOS.map((sc) => {
                const status = statuses[sc.id] || 'a_verifier';
                return (
                  <article
                    key={sc.id}
                    className="rounded-xl border border-stone-200 bg-white p-4 space-y-2.5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-mono text-[11px] font-semibold text-emerald-900">
                          Scénario {sc.number} · {sc.actor}
                        </p>
                        <h3 className="text-sm font-semibold text-stone-950">{sc.title}</h3>
                      </div>

                      <select
                        aria-label={`Statut du scénario ${sc.number}`}
                        value={status}
                        onChange={(e) =>
                          updateScenarioStatus(sc.id, e.target.value as DemoScenarioStatus)
                        }
                        className={`min-h-[36px] rounded-lg border px-2.5 text-xs font-semibold ${
                          status === 'reussi'
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-950'
                            : status === 'echoue'
                              ? 'border-red-300 bg-red-50 text-red-900'
                              : 'border-stone-300 bg-stone-50 text-stone-700'
                        }`}
                      >
                        <option value="a_verifier">À vérifier</option>
                        <option value="reussi">Réussi</option>
                        <option value="echoue">Échoué</option>
                      </select>
                    </div>

                    <p className="text-xs text-stone-700 leading-relaxed">
                      <strong className="text-stone-900">Étapes :</strong> {sc.steps}
                    </p>
                    <p className="text-xs text-stone-600 leading-relaxed">
                      <strong className="text-stone-900">Attendu :</strong> {sc.expected}
                    </p>

                    <div className="pt-1">
                      <button
                        type="button"
                        disabled={busyAction !== null}
                        onClick={() => void handleProfileClick(sc.suggestedUserId, sc.targetPage)}
                        className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 text-xs font-semibold text-emerald-950 hover:border-emerald-900 cursor-pointer"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-900" />
                        Lancer avec le profil adapté
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {activeTab === 'outbox' && (
            <div className="space-y-3.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-stone-900">
                  <Mail className="h-4 w-4 text-emerald-900" />
                  <span>Journal des notifications & e-mails simulés</span>
                </div>
                <button
                  type="button"
                  onClick={() => void onRefreshState()}
                  className="min-h-[36px] rounded-lg border border-stone-300 px-3 text-xs font-semibold text-stone-700 hover:bg-stone-50 cursor-pointer"
                >
                  Actualiser
                </button>
              </div>

              <p className="text-xs text-stone-600">
                Aucun vrai e-mail n’est envoyé depuis le mode Démo. Les codes OTP d’inscription, avis de retrait (3 j), relances de retard et tests apparaissent ici.
              </p>

              {demoState.outbox.length === 0 ? (
                <div className="rounded-xl border border-stone-200 bg-stone-50 p-6 text-center text-xs text-stone-600">
                  Aucun message simulé enregistré pour le moment. Déclenchez une inscription, un retour pour réservation ou une notification de retard.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {demoState.outbox.map((item) => (
                    <article
                      key={item.id}
                      className="rounded-xl border border-stone-200 bg-white p-3.5 space-y-1.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                        <span className="font-mono font-semibold text-emerald-900">
                          {item.category} · {item.recipientEmail}
                        </span>
                        <span className="font-mono text-stone-500 tabular-nums">
                          {formatDateTimeFr(item.createdAt)}
                        </span>
                      </div>
                      <div className="text-xs font-semibold text-stone-950">{item.subject}</div>
                      <pre className="whitespace-pre-wrap font-sans text-xs text-stone-700 leading-relaxed bg-stone-50 rounded-lg p-2.5 border border-stone-100">
                        {item.body}
                      </pre>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
