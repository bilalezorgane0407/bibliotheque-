import {
  AlertTriangle,
  Bell,
  Check,
  CheckCircle2,
  LogOut,
  ShieldCheck,
} from 'lucide-react';
import type {
  EligibilityReport,
  GoogleAuthStatus,
  NotificationRecord,
  UserPublic,
} from '../../shared/types.ts';
import { api, formatDateFr, formatDateTimeFr } from '../lib/api.ts';

interface ProfileNotificationsPageProps {
  user: UserPublic | null;
  eligibility: EligibilityReport | null;
  googleAuth: GoogleAuthStatus | null;
  notifications: NotificationRecord[];
  onRequireAuth: () => void;
  onRefresh: () => Promise<void>;
  onLogout: () => Promise<void>;
}

export function ProfileNotificationsPage({
  user,
  eligibility,
  googleAuth,
  notifications,
  onRequireAuth,
  onRefresh,
  onLogout,
}: ProfileNotificationsPageProps) {
  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-14 text-center">
        <h1 className="font-editorial text-2xl font-semibold text-stone-950">
          Profil et notifications
        </h1>
        <p className="mt-2 text-sm text-stone-600">
          Connectez-vous avec votre compte USMBA pour consulter votre éligibilité et vos notifications.
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

  const unreadCount = notifications.filter((n) => !n.readAt).length;

  const handleMarkRead = async (id: string) => {
    await api.markNotificationRead(id);
    await onRefresh();
  };

  const handleMarkAllRead = async () => {
    await api.markAllNotificationsRead();
    await onRefresh();
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="flex flex-col gap-4 border-b border-stone-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-emerald-900">
            Compte institutionnel USMBA
          </p>
          <h1 className="mt-1 font-editorial text-2xl sm:text-3xl font-semibold text-stone-950">
            {user.fullName}
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-stone-600 font-mono break-all">
            {user.email}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void onLogout()}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 self-start rounded-lg border border-stone-300 bg-white px-4 py-2 text-xs font-semibold text-stone-800 hover:bg-stone-50 cursor-pointer"
        >
          <LogOut className="h-4 w-4" />
          Se déconnecter
        </button>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-12 items-start">
        {/* Dossier & Statut d'éligibilité */}
        <div className="lg:col-span-5 space-y-5">
          <div className="rounded-xl border border-stone-200 bg-white p-4 sm:p-6">
            <h2 className="font-editorial text-xl font-semibold text-stone-950">
              Vérification d’identité et d’éligibilité
            </h2>

            <dl className="mt-4 divide-y divide-stone-100 text-sm">
              <div className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:justify-between sm:gap-4">
                <dt className="text-stone-500">Rôle</dt>
                <dd className="font-semibold text-stone-900 sm:text-right">
                  {user.role === 'bibliothecaire'
                    ? user.isAdmin
                      ? 'Administrateur de la bibliothèque · Bibliothécaire'
                      : 'Bibliothécaire'
                    : 'Membre'}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:justify-between sm:gap-4">
                <dt className="text-stone-500">Établissement</dt>
                <dd className="font-medium text-stone-900 sm:text-right">{user.institution}</dd>
              </div>
              <div className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:justify-between sm:gap-4">
                <dt className="text-stone-500">Filière / Service</dt>
                <dd className="font-medium text-stone-900 sm:text-right">
                  {user.filiere || 'Non précisée'}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:justify-between sm:gap-4">
                <dt className="text-stone-500">CNE / Apogée</dt>
                <dd className="font-mono text-xs text-stone-900 sm:text-right">{user.cne || '—'}</dd>
              </div>
              <div className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:justify-between sm:gap-4">
                <dt className="text-stone-500">Mode d’authentification</dt>
                <dd className="text-xs font-medium text-stone-800 sm:text-right">
                  {user.authSource === 'google_oidc'
                    ? 'Google OIDC institutionnel'
                    : user.authSource === 'usmba_sso'
                      ? 'SSO USMBA vérifié'
                      : user.isDemo
                        ? 'Compte de démonstration (.example)'
                        : 'Compte académique local (OTP)'}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:justify-between sm:gap-4">
                <dt className="text-stone-500">Inscrit depuis</dt>
                <dd className="text-xs text-stone-700 tabular-nums sm:text-right">
                  {formatDateFr(user.createdAt)}
                </dd>
              </div>
            </dl>

            {eligibility && (
              <div className="mt-5 border-t border-stone-200 pt-4 space-y-2.5">
                <p className="text-xs font-semibold text-stone-700">
                  Contrôle serveur d’éligibilité aux prêts et réservations
                </p>

                <div className="flex items-center gap-2 text-xs">
                  <CheckCircle2 className="h-4 w-4 text-emerald-800 shrink-0" />
                  <span>1. Utilisateur authentifié</span>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  {eligibility.emailVerified ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-800 shrink-0" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0" />
                  )}
                  <span>
                    2. Adresse académique vérifiée ({eligibility.emailVerified ? 'oui' : 'en attente'})
                  </span>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  {eligibility.verifiedEstStudent ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-800 shrink-0" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0" />
                  )}
                  <span>
                    3. Statut EST Fès (
                    {user.studentStatus === 'verifie'
                      ? 'vérifié'
                      : user.studentStatus === 'en_attente'
                        ? 'en attente de validation'
                        : user.studentStatus}
                    )
                  </span>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  {eligibility.accountActive && eligibility.noOverdueLoans ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-800 shrink-0" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-red-700 shrink-0" />
                  )}
                  <span>
                    4. Compte {user.accountStatus} · Aucun retour en retard ({eligibility.overdueCount} en cours)
                  </span>
                </div>

                <div
                  className={`mt-3 rounded-lg border p-3 text-xs font-medium ${
                    eligibility.eligible
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
                      : 'border-amber-200 bg-amber-50 text-amber-950'
                  }`}
                >
                  {eligibility.reasonMessage}
                </div>
              </div>
            )}
          </div>

          {googleAuth && (
            <div className="rounded-xl border border-stone-200 bg-stone-50/70 p-4 sm:p-5 text-xs text-stone-600">
              <div className="flex items-center gap-2 font-semibold text-stone-900">
                <ShieldCheck className="h-4 w-4 text-emerald-900 shrink-0" />
                Fournisseur Google institutionnel
              </div>
              <p className="mt-1.5 leading-relaxed">{googleAuth.message}</p>
            </div>
          )}
        </div>

        {/* Notifications */}
        <div className="lg:col-span-7 rounded-xl border border-stone-200 bg-white p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 pb-4">
            <div className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-emerald-900 shrink-0" />
              <h2 className="font-editorial text-xl font-semibold text-stone-950">
                Notifications ({unreadCount} non lue{unreadCount > 1 ? 's' : ''})
              </h2>
            </div>

            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => void handleMarkAllRead()}
                className="inline-flex min-h-[40px] items-center gap-1.5 text-xs font-semibold text-emerald-900 hover:text-emerald-700 cursor-pointer"
              >
                <Check className="h-3.5 w-3.5" />
                Tout marquer comme lu
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <p className="py-10 text-center text-sm text-stone-500">
              Aucune notification reçue pour le moment.
            </p>
          ) : (
            <div className="mt-2 divide-y divide-stone-100">
              {notifications.map((n) => (
                <div
                  key={n.id}
                  className={`py-3.5 px-3 rounded-lg transition-colors ${
                    n.readAt ? 'opacity-75' : 'bg-emerald-50/40'
                  }`}
                >
                  <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-stone-900">{n.title}</h3>
                      <p className="mt-1 text-sm text-stone-700 leading-relaxed">
                        {n.message}
                      </p>
                      <p className="mt-1.5 text-xs font-mono text-stone-500 tabular-nums">
                        {formatDateTimeFr(n.createdAt)}
                      </p>
                    </div>
                    {!n.readAt && (
                      <button
                        type="button"
                        onClick={() => void handleMarkRead(n.id)}
                        className="shrink-0 self-start whitespace-nowrap min-h-[38px] rounded-md border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:border-emerald-800 cursor-pointer"
                      >
                        Marquer lu
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
