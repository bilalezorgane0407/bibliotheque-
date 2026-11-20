import { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Info,
  KeyRound,
  Mail,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import {
  EST_DEPARTMENTS,
  type GoogleAuthStatus,
  type UserPublic,
} from '../../shared/types.ts';
import { api, ApiError } from '../lib/api.ts';
import { signInWithAcademicGoogle } from '../lib/firebaseAuth.ts';

interface AuthViewProps {
  googleAuth: GoogleAuthStatus | null;
  demoModeEnabled: boolean;
  demoProfiles?: UserPublic[];
  onAuthenticated: () => Promise<void>;
  onOpenDemoOutbox?: () => void;
}

const FALLBACK_DEMO_ACCOUNTS: Array<{
  id: string;
  label: string;
  email: string;
}> = [
  {
    id: 'usr-salma',
    label: 'Salma Idrissi (Démo) — Membre vérifié et éligible',
    email: 'salma.demo@usmba.example',
  },
  {
    id: 'usr-bilale',
    label: 'Amine El Fassi (Démo) — Membre vérifié et éligible',
    email: 'amine.demo@usmba.example',
  },
  {
    id: 'usr-youssef',
    label: 'Youssef Mansouri (Démo) — Membre avec emprunt en retard (bloqué)',
    email: 'youssef.demo@usmba.example',
  },
  {
    id: 'usr-karim',
    label: 'Karim Berrada (Démo) — E-mail vérifié, statut EST Fès en attente',
    email: 'karim.demo@usmba.example',
  },
  {
    id: 'usr-lib',
    label: 'Nadia Benali (Démo) — Bibliothécaire EST Fès',
    email: 'bibliothecaire.demo@est-usmba.example',
  },
  {
    id: 'usr-admin',
    label: 'Hassan Tazi (Admin Démo) — Administrateur de la bibliothèque',
    email: 'admin.demo@est-usmba.example',
  },
];

function GoogleMark() {
  return (
    <svg
      aria-hidden="true"
      className="h-4.5 w-4.5 shrink-0"
      viewBox="0 0 48 48"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

export function AuthView({
  googleAuth,
  demoModeEnabled,
  demoProfiles,
  onAuthenticated,
  onOpenDemoOutbox,
}: AuthViewProps) {
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login');
  const [academicHint, setAcademicHint] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [demoBusyId, setDemoBusyId] = useState<string | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleAuthUrl, setGoogleAuthUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [iframeCookieBlocked, setIframeCookieBlocked] = useState(false);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  // Inscription académique + code OTP (Diagramme 1)
  const [regForm, setRegForm] = useState({
    fullName: '',
    email: '',
    password: '',
    filiere: EST_DEPARTMENTS[0] as string,
    cne: '',
    demoMode: false,
  });
  const [pendingVerifyEmail, setPendingVerifyEmail] = useState<string | null>(null);
  const [pendingVerifyDemo, setPendingVerifyDemo] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [demoOtpHint, setDemoOtpHint] = useState<string | null>(null);

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
          if (err instanceof ApiError && err.code === 'IFRAME_COOKIE_BLOCKED') {
            setIframeCookieBlocked(true);
          }
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

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMsg(null);
    setSubmitting(true);
    try {
      const res = await api.registerAcademic({
        fullName: regForm.fullName,
        email: regForm.email,
        password: regForm.password,
        filiere: regForm.filiere,
        cne: regForm.cne || undefined,
        demoMode: demoModeEnabled && regForm.demoMode,
      });
      setPendingVerifyEmail(res.user.email);
      setPendingVerifyDemo(Boolean(demoModeEnabled && regForm.demoMode));
      setDemoOtpHint(res.demoVerificationCode || null);
      setInfoMsg(res.message);
    } catch (err) {
      setError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'Impossible d’enregistrer votre inscription.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingVerifyEmail) return;
    setError(null);
    setInfoMsg(null);
    setSubmitting(true);
    try {
      await api.verifyEmailCode({
        email: pendingVerifyEmail,
        code: otpCode,
        demoMode: pendingVerifyDemo,
      });
      await onAuthenticated();
    } catch (err) {
      setError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'Code de vérification invalide.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendOtp = async () => {
    if (!pendingVerifyEmail) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.resendVerificationCode({
        email: pendingVerifyEmail,
        demoMode: pendingVerifyDemo,
      });
      setDemoOtpHint(res.demoVerificationCode || null);
      setInfoMsg(`Un nouveau code à usage unique a été émis pour ${res.email}.`);
    } catch (err) {
      setError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'Impossible de renvoyer le code.'
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

  const handleAcademicGoogleLogin = async () => {
    setError(null);
    setIframeCookieBlocked(false);
    setInfoMsg(null);
    setGoogleBusy(true);

    try {
      if (googleAuth?.firebaseAuthConfigured !== false) {
        const { idToken, accessToken } = await signInWithAcademicGoogle(academicHint);
        await api.completeFirebaseGoogleLogin({ idToken, accessToken });
        await onAuthenticated();
        return;
      }

      const res = await api.getGoogleAuthUrl();
      setGoogleAuthUrl(res.authorizationUrl);
      const inIframe =
        typeof window !== 'undefined' && window.self !== window.top;
      if (!inIframe) {
        window.location.assign(res.authorizationUrl);
      } else {
        setInfoMsg(
          'Ouvrez le lien de connexion Google ci-dessous dans un nouvel onglet pour vous authentifier.'
        );
      }
    } catch (err) {
      const firebaseErr = err as { code?: string; message?: string };
      if (firebaseErr?.code === 'auth/popup-closed-by-user') {
        setInfoMsg('La fenêtre de connexion Google a été fermée avant la fin.');
      } else if (firebaseErr?.code === 'auth/popup-blocked') {
        setError(
          'Le navigateur a bloqué la fenêtre Google. Autorisez les fenêtres contextuelles pour ce site ou ouvrez l’application dans un nouvel onglet.'
        );
      } else {
        if (err instanceof ApiError && err.code === 'IFRAME_COOKIE_BLOCKED') {
          setIframeCookieBlocked(true);
        }
        setError(
          err instanceof ApiError || err instanceof Error
            ? err.message
            : googleAuth?.message ||
                'Impossible d’effectuer la connexion avec Gmail académique.'
        );
      }
    } finally {
      setGoogleBusy(false);
    }
  };

  const accountsToShow =
    demoProfiles && demoProfiles.length > 0
      ? demoProfiles.map((p) => ({
          id: p.id,
          label: p.isAdmin
            ? `${p.fullName} — Administrateur & Bibliothécaire`
            : p.role === 'bibliothecaire'
              ? `${p.fullName} — Bibliothécaire`
              : p.studentStatus === 'en_attente'
                ? `${p.fullName} — Statut EST en attente`
                : `${p.fullName} — Membre vérifié`,
          email: p.email,
        }))
      : FALLBACK_DEMO_ACCOUNTS;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
      <div className="grid gap-6 lg:gap-10 lg:grid-cols-12 items-start">
        {/* Colonne principale : Connexion Gmail académique, connexion locale ou inscription */}
        <div className="lg:col-span-7 rounded-xl border border-stone-200 bg-white p-5 sm:p-8">
          <div className="mb-5">
            <p className="text-xs font-medium text-emerald-900">
              Université Sidi Mohamed Ben Abdellah · EST Fès
            </p>
            <h1 className="mt-1 font-editorial text-2xl font-semibold text-stone-900">
              Accès membre à BiblioEST
            </h1>
            <p className="mt-1.5 text-sm text-stone-600">
              Authentifiez-vous avec votre compte académique fourni par l’établissement (
              <span className="font-mono text-xs text-stone-800">@usmba.ac.ma</span> ou{' '}
              <span className="font-mono text-xs text-stone-800">@est-usmba.ac.ma</span>) ou créez votre dossier membre à partir de cette adresse existante.
            </p>
          </div>

          <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl border border-stone-200 bg-stone-100 p-1">
            <button
              type="button"
              onClick={() => {
                setAuthTab('login');
                setError(null);
              }}
              className={`min-h-[40px] rounded-lg px-3 text-xs font-semibold transition-colors cursor-pointer ${
                authTab === 'login'
                  ? 'bg-white text-emerald-950 shadow-xs'
                  : 'text-stone-600 hover:text-stone-950'
              }`}
            >
              Se connecter
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthTab('register');
                setError(null);
              }}
              className={`min-h-[40px] rounded-lg px-3 text-xs font-semibold transition-colors cursor-pointer ${
                authTab === 'register'
                  ? 'bg-white text-emerald-950 shadow-xs'
                  : 'text-stone-600 hover:text-stone-950'
              }`}
            >
              Créer un compte membre
            </button>
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

          {authTab === 'login' ? (
            <>
              {/* Option principale : Connexion avec Gmail académique */}
              <div className="rounded-xl border border-emerald-900/20 bg-emerald-50/40 p-4 sm:p-5 space-y-4">
                <div className="flex items-start gap-2.5">
                  <Mail className="mt-0.5 h-5 w-5 shrink-0 text-emerald-900" />
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-stone-950">
                      Connexion avec Gmail académique
                    </h2>
                    <p className="mt-0.5 text-xs text-stone-600 leading-relaxed">
                      {googleAuth?.allowedDomain
                        ? `Domaine requis : @${googleAuth.allowedDomain}. Aucun mot de passe Google n’est saisi sur BiblioEST.`
                        : 'Utilisez votre adresse Google Workspace universitaire (@usmba.ac.ma, @est-usmba.ac.ma). Aucun mot de passe Google n’est saisi ici.'}
                    </p>
                  </div>
                </div>

                <div>
                  <label htmlFor="academic-gmail-hint" className="block text-xs font-medium text-stone-700">
                    Adresse Gmail académique (facultatif — pré-sélection du compte)
                  </label>
                  <input
                    id="academic-gmail-hint"
                    type="email"
                    value={academicHint}
                    onChange={(e) => setAcademicHint(e.target.value)}
                    placeholder="prenom.nom@usmba.ac.ma"
                    className="mt-1.5 w-full min-h-[44px] rounded-lg border border-stone-300 bg-white px-3.5 py-2.5 text-sm text-stone-900 focus:border-emerald-800"
                  />
                </div>

                <button
                  type="button"
                  disabled={googleBusy}
                  onClick={() => void handleAcademicGoogleLogin()}
                  className="inline-flex w-full min-h-[44px] items-center justify-center gap-3 rounded-lg border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-900 shadow-xs transition-colors hover:border-emerald-900 hover:bg-stone-50 disabled:opacity-60 cursor-pointer"
                >
                  <GoogleMark />
                  <span>
                    {googleBusy
                      ? 'Vérification du compte académique…'
                      : 'Se connecter avec Gmail académique'}
                  </span>
                </button>
              </div>

              {/* Formulaire de connexion locale (comptes inscrits par OTP ou comptes démo) */}
              <div className="mt-6 border-t border-stone-200 pt-5">
                <h2 className="text-sm font-semibold text-stone-900">
                  Connexion par identifiants BiblioEST
                </h2>
                <p className="mt-1 text-xs text-stone-500">
                  Pour un compte membre créé ci-contre par code OTP ou un profil de démonstration (ne saisissez jamais votre mot de passe Google ici).
                </p>

                <form onSubmit={handleLogin} className="mt-4 space-y-4">
                  <div>
                    <label htmlFor="login-email" className="block text-sm font-medium text-stone-800">
                      Adresse e-mail
                    </label>
                    <input
                      id="login-email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="prenom.nom@usmba.ac.ma"
                      className="mt-1.5 w-full min-h-[44px] rounded-lg border border-stone-300 bg-white px-3.5 py-2.5 text-sm text-stone-900 focus:border-emerald-800"
                    />
                  </div>

                  <div>
                    <label htmlFor="login-password" className="block text-sm font-medium text-stone-800">
                      Mot de passe BiblioEST
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
                    className="inline-flex w-full min-h-[44px] items-center justify-center gap-2 rounded-lg bg-emerald-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 disabled:opacity-60 cursor-pointer"
                  >
                    <KeyRound className="h-4 w-4" />
                    {submitting ? 'Vérification en cours…' : 'Se connecter'}
                  </button>
                </form>
              </div>
            </>
          ) : (
            <div className="space-y-5">
              <div className="rounded-lg border border-stone-200 bg-stone-50/80 p-3.5 text-xs text-stone-700 leading-relaxed">
                <strong>Rappel réglementaire (Diagramme 1) :</strong> BiblioEST ne crée pas votre boîte e-mail scolaire. Vous devez saisir une adresse académique déjà délivrée par l’établissement. Après validation du code reçu par e-mail, votre statut <strong>EST Fès</strong> reste{' '}
                <strong>en attente</strong> jusqu’à validation par un bibliothécaire.
              </div>

              {!pendingVerifyEmail ? (
                <form onSubmit={handleRegisterSubmit} className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label htmlFor="reg-name" className="block text-xs font-semibold text-stone-800">
                        Nom et prénom *
                      </label>
                      <input
                        id="reg-name"
                        type="text"
                        required
                        value={regForm.fullName}
                        onChange={(e) => setRegForm({ ...regForm, fullName: e.target.value })}
                        placeholder="Ex. Sara El Amrani"
                        className="mt-1 w-full min-h-[44px] rounded-lg border border-stone-300 bg-white px-3.5 text-sm"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label htmlFor="reg-email" className="block text-xs font-semibold text-stone-800">
                        Adresse académique existante *
                      </label>
                      <input
                        id="reg-email"
                        type="email"
                        required
                        value={regForm.email}
                        onChange={(e) => setRegForm({ ...regForm, email: e.target.value })}
                        placeholder={
                          regForm.demoMode
                            ? 'candidat.demo@usmba.example'
                            : 'prenom.nom@usmba.ac.ma'
                        }
                        className="mt-1 w-full min-h-[44px] rounded-lg border border-stone-300 bg-white px-3.5 text-sm font-mono"
                      />
                    </div>

                    <div>
                      <label htmlFor="reg-filiere" className="block text-xs font-semibold text-stone-800">
                        Filière / Département
                      </label>
                      <select
                        id="reg-filiere"
                        value={regForm.filiere}
                        onChange={(e) => setRegForm({ ...regForm, filiere: e.target.value })}
                        className="mt-1 w-full min-h-[44px] rounded-lg border border-stone-300 bg-white px-3 text-sm"
                      >
                        {EST_DEPARTMENTS.map((dep) => (
                          <option key={dep} value={dep}>
                            {dep}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label htmlFor="reg-cne" className="block text-xs font-semibold text-stone-800">
                        CNE / Code Apogée (optionnel)
                      </label>
                      <input
                        id="reg-cne"
                        type="text"
                        value={regForm.cne}
                        onChange={(e) => setRegForm({ ...regForm, cne: e.target.value })}
                        placeholder="N1340..."
                        className="mt-1 w-full min-h-[44px] rounded-lg border border-stone-300 bg-white px-3.5 text-sm font-mono"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label htmlFor="reg-password" className="block text-xs font-semibold text-stone-800">
                        Mot de passe BiblioEST (min. 8 caractères) *
                      </label>
                      <input
                        id="reg-password"
                        type="password"
                        required
                        minLength={8}
                        value={regForm.password}
                        onChange={(e) => setRegForm({ ...regForm, password: e.target.value })}
                        placeholder="••••••••••••"
                        className="mt-1 w-full min-h-[44px] rounded-lg border border-stone-300 bg-white px-3.5 text-sm"
                      />
                    </div>
                  </div>

                  {demoModeEnabled && (
                    <label className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-950 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={regForm.demoMode}
                        onChange={(e) =>
                          setRegForm({ ...regForm, demoMode: e.target.checked })
                        }
                        className="mt-0.5 h-4 w-4 rounded border-amber-400"
                      />
                      <span>
                        Tester dans le <strong>bac à sable Mode Démo</strong> (accepte le domaine fictif <span className="font-mono">.example</span> et dépose le code OTP dans le journal simulé).
                      </span>
                    </label>
                  )}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex w-full min-h-[44px] items-center justify-center gap-2 rounded-lg bg-emerald-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60 cursor-pointer"
                  >
                    <UserPlus className="h-4 w-4" />
                    {submitting
                      ? 'Enregistrement…'
                      : 'Créer mon compte membre et recevoir le code'}
                  </button>
                </form>
              ) : (
                <form
                  onSubmit={handleVerifyOtp}
                  className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 sm:p-5 space-y-4"
                >
                  <div className="flex items-start gap-2.5">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-800" />
                    <div>
                      <h2 className="text-sm font-semibold text-stone-950">
                        Valider le code reçu par e-mail
                      </h2>
                      <p className="mt-0.5 text-xs text-stone-700">
                        Saisissez le code à 6 chiffres associé à{' '}
                        <span className="font-mono font-semibold">{pendingVerifyEmail}</span>.
                      </p>
                    </div>
                  </div>

                  {demoOtpHint && pendingVerifyDemo && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                      Code déposé dans le journal simulé (Démo) :{' '}
                      <strong className="font-mono">{demoOtpHint}</strong>
                      {onOpenDemoOutbox && (
                        <button
                          type="button"
                          onClick={onOpenDemoOutbox}
                          className="ml-2 font-semibold underline cursor-pointer"
                        >
                          Ouvrir le journal simulé
                        </button>
                      )}
                    </div>
                  )}

                  <div>
                    <label htmlFor="otp-code" className="block text-xs font-semibold text-stone-800">
                      Code à usage unique (6 chiffres)
                    </label>
                    <input
                      id="otp-code"
                      type="text"
                      required
                      inputMode="numeric"
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value)}
                      placeholder="123456"
                      className="mt-1 w-full min-h-[44px] rounded-lg border border-stone-300 bg-white px-3.5 text-sm font-mono tracking-widest"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      type="submit"
                      disabled={submitting}
                      className="flex-1 min-h-[44px] rounded-lg bg-emerald-900 px-4 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60 cursor-pointer"
                    >
                      {submitting ? 'Validation…' : 'Confirmer le code'}
                    </button>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => void handleResendOtp()}
                      className="min-h-[44px] rounded-lg border border-stone-300 bg-white px-4 text-xs font-semibold text-stone-800 hover:bg-stone-50 cursor-pointer"
                    >
                      Renvoyer le code
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPendingVerifyEmail(null);
                        setOtpCode('');
                        setDemoOtpHint(null);
                      }}
                      className="min-h-[44px] px-2 text-xs text-stone-600 hover:underline cursor-pointer"
                    >
                      Modifier l’e-mail
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>

        {/* Colonne latérale : Règles d'éligibilité & Comptes de démonstration */}
        <div className="lg:col-span-5 space-y-5">
          <div className="rounded-xl border border-stone-200 bg-stone-50/70 p-5 sm:p-6">
            <div className="flex items-center gap-2 text-emerald-950">
              <ShieldCheck className="h-5 w-5 shrink-0" />
              <h2 className="font-editorial text-lg font-semibold">
                Contrôles d’éligibilité (Diagramme 1)
              </h2>
            </div>
            <ol className="mt-3.5 space-y-2.5 text-sm text-stone-700">
              <li>
                <span className="font-semibold text-stone-900">1. Adresse académique vérifiée :</span>{' '}
                via Google OIDC ou code à usage unique envoyé à une adresse déjà existante.
              </li>
              <li>
                <span className="font-semibold text-stone-900">2. Statut EST Fès validé :</span>{' '}
                adresse vérifiée ≠ statut EST vérifié ; un bibliothécaire valide votre dossier avant tout prêt.
              </li>
              <li>
                <span className="font-semibold text-stone-900">3. Compte actif & aucun retard :</span>{' '}
                tout emprunt en retard bloque temporairement les nouveaux emprunts et réservations.
              </li>
            </ol>
          </div>

          {demoModeEnabled && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-5 sm:p-6">
              <h3 className="text-sm font-semibold text-stone-950">
                Profils de démonstration (.example)
              </h3>
              <p className="mt-1 text-xs text-stone-600">
                Ces profils ouvrent une session dans la base de démonstration isolée (jamais en production ni sur les données réelles).
              </p>
              <div className="mt-3 space-y-2.5">
                {accountsToShow.map((acc) => (
                  <div
                    key={acc.id}
                    className="rounded-lg border border-stone-200 bg-white p-3 space-y-2"
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
                        {demoBusyId === acc.id ? 'Connexion…' : 'Activer (Démo)'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAuthTab('login');
                          setEmail(acc.email);
                          setPassword('DemoBiblioEST2026!');
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
