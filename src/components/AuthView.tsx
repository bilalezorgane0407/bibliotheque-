import { useState } from 'react';
import { AlertCircle, ExternalLink, Info, KeyRound, ShieldCheck, UserPlus } from 'lucide-react';
import { EST_DEPARTMENTS, type SsoAdapterStatus } from '../../shared/types.ts';
import { api, ApiError } from '../lib/api.ts';

interface AuthViewProps {
  sso: SsoAdapterStatus | null;
  onAuthenticated: () => Promise<void>;
}

const DEMO_ACCOUNTS = [
  {
    label: 'Salma Bennani — Étudiante EST Fès vérifiée et éligible',
    email: 'salma.demo@usmba.example',
    pass: 'EtudiantEST2026!',
  },
  {
    label: 'Bilale Zorgane — Étudiant EST Fès vérifié et éligible',
    email: 'bilale.demo@usmba.example',
    pass: 'EtudiantEST2026!',
  },
  {
    label: 'Youssef El Alaoui — Étudiant avec emprunt en retard (bloqué)',
    email: 'youssef.demo@usmba.example',
    pass: 'EtudiantEST2026!',
  },
  {
    label: 'Karim Tazi — Statut EST Fès non vérifié (bloqué)',
    email: 'karim.demo@usmba.example',
    pass: 'EtudiantEST2026!',
  },
  {
    label: 'Nadia Benjelloun — Bibliothécaire EST Fès (administration)',
    email: 'bibliothecaire.demo@est-usmba.example',
    pass: 'BiblioAdmin2026!',
  },
];

export function AuthView({ sso, onAuthenticated }: AuthViewProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [verificationPending, setVerificationPending] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [cne, setCne] = useState('');
  const [filiere, setFiliere] = useState<string>(EST_DEPARTMENTS[0]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [iframeCookieBlocked, setIframeCookieBlocked] = useState(false);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

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

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIframeCookieBlocked(false);
    setInfoMsg(null);
    setSubmitting(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      await api.register({ fullName, email: normalizedEmail, password, cne, filiere });
      setEmail(normalizedEmail);
      setVerificationPending(true);
      setVerificationCode('');
      setInfoMsg(`Un code à 6 chiffres a été envoyé à ${normalizedEmail}. Il est valable 10 minutes.`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'IFRAME_COOKIE_BLOCKED') {
        setIframeCookieBlocked(true);
      }
      setError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'Erreur lors de la création du compte.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyRegistration = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMsg(null);
    setSubmitting(true);
    try {
      await api.verifyRegistrationEmail(email, verificationCode);
      await onAuthenticated();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'IFRAME_COOKIE_BLOCKED') {
        setIframeCookieBlocked(true);
      }
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Code de vérification invalide.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendRegistrationCode = async () => {
    setError(null);
    setInfoMsg(null);
    setSubmitting(true);
    try {
      await api.resendRegistrationCode(email);
      setInfoMsg(`Un nouveau code a été envoyé à ${email.trim().toLowerCase()}.`);
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Impossible de renvoyer le code.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSsoClick = async () => {
    setError(null);
    setInfoMsg(null);
    try {
      const res = await fetch('/api/auth/sso/login', { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) {
        setInfoMsg(data.error || 'Le SSO USMBA n’est pas configuré.');
        return;
      }
      if (data.authorizationUrl) {
        window.location.assign(data.authorizationUrl);
      }
    } catch {
      setInfoMsg('Impossible de contacter le point d’entrée SSO USMBA.');
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="grid gap-10 lg:grid-cols-12 items-start">
        {/* Colonne principale : Connexion / Inscription */}
        <div className="lg:col-span-7 rounded-xl border border-stone-200 bg-white p-6 sm:p-8">
          <div className="mb-6">
            <p className="text-xs font-medium text-emerald-900">
              Université Sidi Mohamed Ben Abdellah · EST Fès
            </p>
            <h1 className="mt-1 font-editorial text-2xl font-semibold text-stone-900">
              {mode === 'login'
                ? 'Connexion à BiblioEST'
                : 'Créer un compte étudiant USMBA'}
            </h1>
            <p className="mt-2 text-sm text-stone-600">
              {mode === 'login'
                ? 'Accédez à vos emprunts, suivez vos réservations en file FIFO et gérez votre dossier lecteur.'
                : 'L’inscription vérifie votre adresse institutionnelle. Votre statut d’étudiant EST Fès devra ensuite être validé par le service de la bibliothèque pour autoriser les emprunts.'}
            </p>
          </div>

          <div className="mb-6 flex gap-1 rounded-lg bg-stone-100 p-1">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setVerificationPending(false);
                setError(null);
                setInfoMsg(null);
              }}
              className={`flex-1 rounded-md px-3 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                mode === 'login'
                  ? 'bg-white text-emerald-950 shadow-xs'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              Connexion
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setVerificationPending(false);
                setError(null);
                setInfoMsg(null);
              }}
              className={`flex-1 rounded-md px-3 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                mode === 'register'
                  ? 'bg-white text-emerald-950 shadow-xs'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              Nouveau compte USMBA
            </button>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-5 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
              <div className="space-y-2">
                <p>{error}</p>
                {iframeCookieBlocked && typeof window !== 'undefined' && (
                  <a
                    href={window.location.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-900 hover:bg-red-100/60"
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
              <span>{infoMsg}</span>
            </div>
          )}

          {mode === 'login' ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label htmlFor="login-email" className="block text-sm font-medium text-stone-800">
                  Adresse universitaire USMBA
                </label>
                <input
                  id="login-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="prenom.nom@usmba.ac.ma"
                  className="mt-1.5 w-full rounded-lg border border-stone-300 bg-white px-3.5 py-2.5 text-sm text-stone-900 focus:border-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-800/15"
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
                  className="mt-1.5 w-full rounded-lg border border-stone-300 bg-white px-3.5 py-2.5 text-sm text-stone-900 focus:border-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-800/15"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 disabled:opacity-60 cursor-pointer"
              >
                <KeyRound className="h-4 w-4" />
                {submitting ? 'Vérification en cours…' : 'Se connecter'}
              </button>
            </form>
          ) : verificationPending ? (
            <form onSubmit={handleVerifyRegistration} className="space-y-4">
              <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-4 text-sm text-stone-700">
                Consultez la boîte de réception de <span className="font-semibold">{email}</span> et saisissez le code reçu. Vérifiez aussi les courriers indésirables.
              </div>
              <div>
                <label htmlFor="verification-code" className="block text-sm font-medium text-stone-800">Code de vérification</label>
                <input
                  id="verification-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  className="mt-1.5 w-full rounded-lg border border-stone-300 px-3.5 py-2.5 text-center font-mono text-lg tracking-[0.35em] focus:border-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-800/15"
                />
                <p className="mt-1.5 text-xs text-stone-500">Le code expire après 10 minutes. Après validation, votre dossier EST Fès restera en attente de vérification par la bibliothèque.</p>
              </div>
              <button
                type="submit"
                disabled={submitting || verificationCode.length !== 6}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
              >
                <ShieldCheck className="h-4 w-4" />
                {submitting ? 'Vérification…' : 'Vérifier et créer mon compte'}
              </button>
              <div className="flex flex-wrap justify-between gap-3 text-xs">
                <button type="button" disabled={submitting} onClick={() => void handleResendRegistrationCode()} className="font-semibold text-emerald-900 hover:underline disabled:opacity-50">Renvoyer un code</button>
                <button type="button" onClick={() => { setVerificationPending(false); setVerificationCode(''); setError(null); setInfoMsg(null); }} className="text-stone-600 hover:underline">Modifier mes informations</button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <label htmlFor="reg-name" className="block text-sm font-medium text-stone-800">
                  Nom et prénom
                </label>
                <input
                  id="reg-name"
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Ex. Houda El Mansouri"
                  className="mt-1.5 w-full rounded-lg border border-stone-300 px-3.5 py-2.5 text-sm focus:border-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-800/15"
                />
              </div>

              <div>
                <label htmlFor="reg-email" className="block text-sm font-medium text-stone-800">
                  Adresse e-mail académique (fournie par l’établissement)
                </label>
                <input
                  id="reg-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="prenom.nom@usmba.ac.ma"
                  className="mt-1.5 w-full rounded-lg border border-stone-300 px-3.5 py-2.5 text-sm focus:border-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-800/15"
                />
                <p className="mt-1.5 text-xs text-stone-500">Utilisez votre adresse institutionnelle existante. L’inscription crée votre compte BiblioEST, pas une boîte e-mail.</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="reg-cne" className="block text-sm font-medium text-stone-800">
                    Code Massar / CNE
                  </label>
                  <input
                    id="reg-cne"
                    type="text"
                    value={cne}
                    onChange={(e) => setCne(e.target.value)}
                    placeholder="Ex. N138901234"
                    className="mt-1.5 w-full rounded-lg border border-stone-300 px-3.5 py-2.5 text-sm font-mono focus:border-emerald-800 focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="reg-filiere" className="block text-sm font-medium text-stone-800">
                    Filière EST Fès
                  </label>
                  <select
                    id="reg-filiere"
                    value={filiere}
                    onChange={(e) => setFiliere(e.target.value)}
                    className="mt-1.5 w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm focus:border-emerald-800 focus:outline-none"
                  >
                    {EST_DEPARTMENTS.map((dep) => (
                      <option key={dep} value={dep}>
                        {dep}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="reg-pass" className="block text-sm font-medium text-stone-800">
                  Mot de passe (8 caractères minimum)
                </label>
                <input
                  id="reg-pass"
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-stone-300 px-3.5 py-2.5 text-sm focus:border-emerald-800 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 disabled:opacity-60 cursor-pointer"
              >
                <UserPlus className="h-4 w-4" />
                {submitting ? 'Création en cours…' : 'Créer le compte'}
              </button>
            </form>
          )}

          {/* Bouton adaptateur SSO USMBA transparent */}
          <div className="mt-6 border-t border-stone-200 pt-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold text-stone-800">
                  Authentification fédérée USMBA (OIDC / CAS)
                </p>
                <p className="mt-0.5 text-xs text-stone-500">
                  {sso?.configured
                    ? 'Fournisseur SSO configuré.'
                    : 'Non configuré dans cet environnement (voir docs/USMBA_SSO_CONFIGURATION.md).'}
                </p>
              </div>
              <button
                type="button"
                onClick={handleSsoClick}
                className="shrink-0 whitespace-nowrap rounded-lg border border-stone-300 bg-stone-50 px-3.5 py-2 text-xs font-semibold text-stone-700 hover:bg-stone-100 cursor-pointer"
              >
                Connexion SSO USMBA
              </button>
            </div>
          </div>
        </div>

        {/* Colonne latérale : Règles d'éligibilité & Comptes persistés pour évaluation */}
        <div className="lg:col-span-5 space-y-6">
          <div className="rounded-xl border border-stone-200 bg-stone-50/70 p-6">
            <div className="flex items-center gap-2 text-emerald-950">
              <ShieldCheck className="h-5 w-5" />
              <h2 className="font-editorial text-lg font-semibold">
                Trois niveaux de vérification
              </h2>
            </div>
            <ol className="mt-4 space-y-3 text-sm text-stone-700">
              <li>
                <span className="font-semibold text-stone-900">1. Utilisateur authentifié :</span>{' '}
                session signée vérifiée par le serveur.
              </li>
              <li>
                <span className="font-semibold text-stone-900">2. Étudiant EST Fès vérifié :</span>{' '}
                une adresse <span className="font-mono text-xs">@usmba.ac.ma</span> seule ne suffit pas ;
                l’inscription à l’EST Fès doit être confirmée.
              </li>
              <li>
                <span className="font-semibold text-stone-900">3. Membre éligible :</span>{' '}
                aucun emprunt en retard ne doit figurer au dossier pour emprunter ou réserver.
              </li>
            </ol>
          </div>

          <div className="rounded-xl border border-stone-200 bg-white p-6">
            <h3 className="text-sm font-semibold text-stone-900">
              Comptes persistés en base (pré-remplissage du formulaire)
            </h3>
            <p className="mt-1 text-xs text-stone-500">
              Sélectionnez un compte pour remplir le formulaire et tester la validation réelle sur le serveur.
            </p>
            <div className="mt-3 space-y-2">
              {DEMO_ACCOUNTS.map((acc) => (
                <button
                  key={acc.email}
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setEmail(acc.email);
                    setPassword(acc.pass);
                    setError(null);
                  }}
                  className="w-full rounded-lg border border-stone-200 px-3 py-2 text-left transition-colors hover:border-emerald-800 hover:bg-emerald-50/40 cursor-pointer"
                >
                  <div className="text-xs font-semibold text-stone-900">{acc.label}</div>
                  <div className="mt-0.5 font-mono text-[11px] text-stone-500">{acc.email}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
