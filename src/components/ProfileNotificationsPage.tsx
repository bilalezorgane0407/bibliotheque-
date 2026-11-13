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
  NotificationRecord,
  SsoAdapterStatus,
  UserPublic,
} from '../../shared/types.ts';
import { api, formatDateFr, formatDateTimeFr } from '../lib/api.ts';

interface ProfileNotificationsPageProps {
  user: UserPublic | null;
  eligibility: EligibilityReport | null;
  sso: SsoAdapterStatus | null;
  notifications: NotificationRecord[];
  onRequireAuth: () => void;
  onRefresh: () => Promise<void>;
  onLogout: () => Promise<void>;
}

export function ProfileNotificationsPage({
  user,
  eligibility,
  sso,
  notifications,
  onRequireAuth,
  onRefresh,
  onLogout,
}: ProfileNotificationsPageProps) {
  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="font-editorial text-2xl font-semibold text-stone-950">
          Profil et notifications
        </h1>
        <p className="mt-2 text-sm text-stone-600">
          Connectez-vous avec votre compte USMBA pour consulter votre éligibilité et vos notifications.
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
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 border-b border-stone-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-emerald-900">
            Compte institutionnel USMBA
          </p>
          <h1 className="mt-1 font-editorial text-3xl font-semibold text-stone-950">
            {user.fullName}
          </h1>
          <p className="mt-1 text-sm text-stone-600 font-mono">{user.email}</p>
        </div>
        <button
          type="button"
          onClick={() => void onLogout()}
          className="inline-flex items-center gap-2 self-start rounded-lg border border-stone-300 bg-white px-4 py-2 text-xs font-semibold text-stone-800 hover:bg-stone-50 cursor-pointer"
        >
          <LogOut className="h-4 w-4" />
          Se déconnecter
        </button>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-12 items-start">
        {/* Dossier & Statut d'éligibilité */}
        <div className="lg:col-span-5 space-y-6">
          <div className="rounded-xl border border-stone-200 bg-white p-6">
            <h2 className="font-editorial text-xl font-semibold text-stone-950">
              Vérification d’identité et d’éligibilité
            </h2>

            <dl className="mt-5 divide-y divide-stone-100 text-sm">
              <div className="flex justify-between py-2.5">
                <dt className="text-stone-500">Rôle</dt>
                <dd className="font-semibold text-stone-900">
                  {user.role === 'bibliothecaire' ? 'Bibliothécaire' : 'Membre (Étudiant)'}
                </dd>
              </div>
              <div className="flex justify-between py-2.5">
                <dt className="text-stone-500">Établissement</dt>
                <dd className="font-medium text-stone-900">{user.institution}</dd>
              </div>
              <div className="flex justify-between py-2.5">
                <dt className="text-stone-500">Filière / Service</dt>
                <dd className="font-medium text-stone-900">{user.filiere || 'Non précisée'}</dd>
              </div>
              <div className="flex justify-between py-2.5">
                <dt className="text-stone-500">CNE / Apogée</dt>
                <dd className="font-mono text-xs text-stone-900">{user.cne || '—'}</dd>
              </div>
              <div className="flex justify-between py-2.5">
                <dt className="text-stone-500">Mode d’authentification</dt>
                <dd className="text-xs font-medium text-stone-800">
                  {user.authSource === 'usmba_sso'
                    ? 'SSO USMBA vérifié'
                    : 'Base locale (SSO USMBA non configuré)'}
                </dd>
              </div>
              <div className="flex justify-between py-2.5">
                <dt className="text-stone-500">Inscrit depuis</dt>
                <dd className="text-xs text-stone-700 tabular-nums">
                  {formatDateFr(user.createdAt)}
                </dd>
              </div>
            </dl>

            {/* Trois conditions d'éligibilité */}
            {eligibility && (
              <div className="mt-5 border-t border-stone-200 pt-5 space-y-2.5">
                <p className="text-xs font-semibold text-stone-700">
                  Contrôle serveur d’éligibilité aux prêts et réservations
                </p>

                <div className="flex items-center gap-2 text-xs">
                  <CheckCircle2 className="h-4 w-4 text-emerald-800 shrink-0" />
                  <span>1. Utilisateur authentifié</span>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  {eligibility.verifiedEstStudent ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-800 shrink-0" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0" />
                  )}
                  <span>
                    2. Étudiant EST Fès vérifié ({user.studentStatus === 'verifie' ? 'confirmé' : 'en attente / non vérifié'})
                  </span>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  {eligibility.noOverdueLoans ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-800 shrink-0" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-red-700 shrink-0" />
                  )}
                  <span>
                    3. Aucun retour en retard ({eligibility.overdueCount} en cours)
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

          {sso && (
            <div className="rounded-xl border border-stone-200 bg-stone-50/70 p-5 text-xs text-stone-600">
              <div className="flex items-center gap-2 font-semibold text-stone-900">
                <ShieldCheck className="h-4 w-4 text-emerald-900" />
                Adaptateur SSO USMBA
              </div>
              <p className="mt-1.5 leading-relaxed">{sso.message}</p>
            </div>
          )}
        </div>

        {/* Notifications */}
        <div className="lg:col-span-7 rounded-xl border border-stone-200 bg-white p-6">
          <div className="flex items-center justify-between gap-4 border-b border-stone-200 pb-4">
            <div className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-emerald-900" />
              <h2 className="font-editorial text-xl font-semibold text-stone-950">
                Notifications ({unreadCount} non lue{unreadCount > 1 ? 's' : ''})
              </h2>
            </div>

            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => void handleMarkAllRead()}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-900 hover:text-emerald-700 cursor-pointer"
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
            <div className="divide-y divide-stone-100">
              {notifications.map((n) => (
                <div
                  key={n.id}
                  className={`py-4 ${n.readAt ? 'opacity-75' : 'bg-emerald-50/30 -mx-6 px-6'}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
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
                        className="shrink-0 whitespace-nowrap rounded-md border border-stone-200 bg-white px-2.5 py-1 text-xs font-medium text-stone-700 hover:border-emerald-800 cursor-pointer"
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
