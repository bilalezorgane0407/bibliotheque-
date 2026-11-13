import { useEffect, useState } from 'react';
import {
  AlertCircle,
  ExternalLink,
  Info,
  KeyRound,
  LogIn,
  ShieldCheck,
} from 'lucide-react';
import type { GoogleAuthStatus } from '../../shared/types.ts';
import { api, ApiError } from '../lib/api.ts';

interface AuthViewProps {
  googleAuth: GoogleAuthStatus | null;
  demoModeEnabled: boolean;
  onAuthenticated: () => Promise<void>;
}

const DEMO_ACCOUNTS = [
  {
    id: 'usr-salma',
    label: 'Salma Idrissi (Démo) — Étudiante EST Fès vérifiée et éligible',
    email: 'salma.demo@usmba.example',
    pass: 'DemoBiblioEST2026!',
  },
  {
    id: 'usr-bilale',
    label: 'Amine El Fassi (Démo) — Étudiant EST Fès vérifié et éligible',
    email: 'amine.demo@usmba.example',
    pass: 'DemoBiblioEST2026!',
  },
  {
    id: 'usr-youssef',
    label: 'Youssef Mansouri (Démo) — Étudiant avec emprunt en retard (bloqué)',
    email: 'youssef.demo@usmba.example',
    pass: 'DemoBiblioEST2026!',
  },
  {
    id: 'usr-karim',
    label: 'Karim Berrada (Démo) — Statut EST Fès en attente (bloqué)',
    email: 'karim.demo@usmba.example',
    pass: 'DemoBiblioEST2026!',
  },
  {
    id: 'usr-lib',
    label: 'Nadia Benali (Démo) — Bibliothécaire EST Fès (administration)',
    email: 'bibliothecaire.demo@est-usmba.example',
    pass: 'DemoBiblioEST2026!',
  },
];

export function AuthView({
  googleAuth,
  demoModeEnabled,
  onAuthenticated,
}: AuthViewProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [demoBusyId, setDemoBusyId] = useState<string | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleAuthUrl, setGoogleAuthUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [iframeCookieBlocked, setIframeCookieBlocked] = useState(false);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (!event.data || typeof event.data !== 'object') return;
      const payload = event.data as {
        type?: string;
        handoffToken?: string;
        error?: string;
      };
      if (payload.type === 'OAUTH_AUTH_SUCCESS' && payload.handoffToken) {
        setGoogleBusy(true);
        setError(null);
        try {
          await api.completeGoogleHandoff(payload.handoffToken);
          await onAuthenticated();
        } catch (err) {
          setError(
            err instanceof ApiError || err instanceof Error
              ? err.message
              : 'Impossible de finaliser la session Google.'
          );
        } finally {
          setGoogleBusy(false);
        }
      } else if (payload.type === 'OAUTH_AUTH_ERROR' && payload.error) {
        setGoogleBusy(false);
        setError(payload.error);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onAuthenticated]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIframeCookieBlocked(false);
    setInfoMsg(null);
    setSubmitting(true);
    try {
      await api.login(email, password);
      await onAuthenticated();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'IFRAME_COOKIE_BLOCKED') {
        setIframeCookieBlocked(true);
      }
      setError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'Impossible de vérifier vos identifiants.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleDemoQuickLogin = async (userId: string) => {
    setError(null);
    setIframeCookieBlocked(false);
    setInfoMsg(null);
    setDemoBusyId(userId);
    try {
      await api.demoLogin(userId);
      await onAuthenticated();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'IFRAME_COOKIE_BLOCKED') {
        setIframeCookieBlocked(true);
      }
      setError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'Connexion de démonstration impossible.'
      );
    } finally {
      setDemoBusyId(null);
    }
  };

  const handleGoogleLogin = async () => {
    setError(null);
    setInfoMsg(null);
    setGoogleBusy(true);
    try {
      const res = await api.getGoogleAuthUrl();
      setGoogleAuthUrl(res.authorizationUrl);
      const inIframe =
        typeof window !== 'undefined' && window.self !== window.top;
      if (!inIframe) {
        window.location.assign(res.authorizationUrl);
      } else {
        setInfoMsg(
          'Pour respecter les règles de sécurité Google dans cet aperçu intégré, ouvrez le lien de connexion Google ci-dessous dans un nouvel onglet.'
        );
      }
    } catch (err) {
      setInfoMsg(
        err instanceof ApiError
          ? err.message
          : googleAuth?.message ||
              'L’authentification Google institutionnelle n’est pas encore configurée dans cet environnement.'
      );
    } finally {
      setGoogleBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
      <div className="grid gap-6 lg:gap-10 lg:grid-cols-12 items-start">
        {/* Colonne principale : Authentification institutionnelle & connexion locale d'évaluation */}
        <div className="lg:col-span-7 rounded-xl border border-stone-200 bg-white p-5 sm:p-8">
          <div className="mb-5">
            <p className="text-xs font-medium text-emerald-900">
              Université Sidi Mohamed Ben Abdellah · EST Fès
            </p>
            <h1 className="mt-1 font-editorial text-2xl font-semibold text-stone-900">
              Connexion à BiblioEST
            </h1>
            <p className="mt-1.5 text-sm text-stone-600">
              Les comptes institutionnels sont administrés par l’école. Authentifiez-vous avec votre compte Google USMBA ou utilisez un compte d’évaluation si le mode démonstration est activé.
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-5 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
              <div className="space-y-2 min-w-0">
                <p>{error}</p>
                {iframeCookieBlocked && typeof window !== 'undefined' && (
                  <a
                    href={window.location.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-900 hover:bg-red-100/60"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Ouvrir BiblioEST dans un nouvel onglet
                  </a>
                )}
              </div>
            </div>
          )}

          {infoMsg && (
            <div className="mb-5 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <div className="space-y-2 min-w-0">
                <p>{infoMsg}</p>
                {googleAuthUrl && (
                  <a
                    href={googleAuthUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-950 hover:bg-amber-100/60"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Continuer avec Google dans un nouvel onglet
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Authentification Google OIDC institutionnelle */}
          <div className="rounded-xl border border-stone-200 bg-stone-50/70 p-4 sm:p-5 space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-stone-900">
                  Compte Google institutionnel (USMBA / EST Fès)
                </p>
                <p className="mt-0.5 text-xs text-stone-600 leading-relaxed">
                  {googleAuth?.configured
                    ? `Domaine autorisé : ${googleAuth.allowedDomain || 'selon configuration serveur'}.`
                    : googleAuth?.message ||
                      'L’authentification Google OAuth nécessite une configuration serveur active.'}
                </p>
              </div>
              <button
                type="button"
                disabled={googleBusy}
                onClick={() => void handleGoogleLogin()}
                className="inline-flex shrink-0 min-h-[44px] items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-emerald-900 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60 cursor-pointer"
              >
                <LogIn className="h-4 w-4" />
                {googleBusy ? 'Ouverture…' : 'Se connecter avec Google'}
              </button>
            </div>
          </div>

          {/* Formulaire de connexion de démonstration */}
          <div className="mt-6 border-t border-stone-200 pt-5">
            <h2 className="text-sm font-semibold text-stone-900">
              Connexion par identifiants de démonstration
            </h2>
            <p className="mt-1 text-xs text-stone-500">
              Réservée aux comptes d’évaluation persistés en base locale (aucun mot de passe Google ne doit être saisi ici).
            </p>

            <form onSubmit={handleLogin} className="mt-4 space-y-4">
              <div>
                <label htmlFor="login-email" className="block text-sm font-medium text-stone-800">
                  Adresse e-mail d’évaluation
                </label>
                <input
                  id="login-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="salma.demo@usmba.example"
                  className="mt-1.5 w-full min-h-[44px] rounded-lg border border-stone-300 bg-white px-3.5 py-2.5 text-sm text-stone-900 focus:border-emerald-800"
                />
              </div>

              <div>
                <label htmlFor="login-password" className="block text-sm font-medium text-stone-800">
                  Mot de passe
                </label>
                <input
                  id="login-password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="mt-1.5 w-full min-h-[44px] rounded-lg border border-stone-300 bg-white px-3.5 py-2.5 text-sm text-stone-900 focus:border-emerald-800"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="inline-flex w-full min-h-[44px] items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-5 py-2.5 text-sm font-semibold text-stone-900 transition-colors hover:border-emerald-800 hover:bg-emerald-50/40 disabled:opacity-60 cursor-pointer"
              >
                <KeyRound className="h-4 w-4" />
                {submitting ? 'Vérification en cours…' : 'Se connecter avec ces identifiants'}
              </button>
            </form>
          </div>
        </div>

        {/* Colonne latérale : Règles d'éligibilité & Comptes persistés pour évaluation */}
        <div className="lg:col-span-5 space-y-5">
          <div className="rounded-xl border border-stone-200 bg-stone-50/70 p-5 sm:p-6">
            <div className="flex items-center gap-2 text-emerald-950">
              <ShieldCheck className="h-5 w-5 shrink-0" />
              <h2 className="font-editorial text-lg font-semibold">
                Trois niveaux de vérification
              </h2>
            </div>
            <ol className="mt-3.5 space-y-2.5 text-sm text-stone-700">
              <li>
                <span className="font-semibold text-stone-900">1. Utilisateur authentifié :</span>{' '}
                session signée vérifiée par le serveur.
              </li>
              <li>
                <span className="font-semibold text-stone-900">2. Étudiant EST Fès vérifié :</span>{' '}
                une adresse Google institutionnelle seule ne suffit pas ;
                l’inscription à l’EST Fès doit être confirmée.
              </li>
              <li>
                <span className="font-semibold text-stone-900">3. Membre éligible :</span>{' '}
                aucun emprunt en retard ne doit figurer au dossier pour emprunter ou réserver.
              </li>
            </ol>
          </div>

          {demoModeEnabled && (
            <div className="rounded-xl border border-stone-200 bg-white p-5 sm:p-6">
              <h3 className="text-sm font-semibold text-stone-900">
                Comptes d’évaluation persistés en base
              </h3>
              <p className="mt-1 text-xs text-stone-500">
                Sélectionnez un profil pour pré-remplir le formulaire ou ouvrir directement une session serveur de test.
              </p>
              <div className="mt-3 space-y-2.5">
                {DEMO_ACCOUNTS.map((acc) => (
                  <div
                    key={acc.id}
                    className="rounded-lg border border-stone-200 p-3 space-y-2"
                  >
                    <div>
                      <div className="text-xs font-semibold text-stone-900">{acc.label}</div>
                      <div className="mt-0.5 font-mono text-[11px] text-stone-500 break-all">
                        {acc.email}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={demoBusyId === acc.id}
                        onClick={() => void handleDemoQuickLogin(acc.id)}
                        className="min-h-[38px] flex-1 rounded-md bg-emerald-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50 cursor-pointer"
                      >
                        {demoBusyId === acc.id ? 'Connexion…' : 'Connexion directe'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEmail(acc.email);
                          setPassword(acc.pass);
                          setError(null);
                        }}
                        className="min-h-[38px] rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-50 cursor-pointer"
                      >
                        Pré-remplir
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
