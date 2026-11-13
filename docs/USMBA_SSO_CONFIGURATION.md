# Configuration officielle de l’authentification Google pour BiblioEST

BiblioEST utilise un **mécanisme unique d’authentification institutionnelle** : **Google OAuth 2.0 / OpenID Connect** (`server/auth/googleAuthAdapter.ts`) pour les comptes académiques Google Workspace Éducation délivrés par l’USMBA / EST Fès, tout en séparant strictement la vérification d’identité Google de l’éligibilité aux prêts.

## 1. Principe de séparation identité / éligibilité

Les comptes académiques sont **fournis et administrés par l’école** :
- Aucune création autonome de compte ni d’adresse académique n’est autorisée (`POST /api/auth/register` renvoie HTTP 403).
- Aucun formulaire ne demande un mot de passe Google ; la récupération de mot de passe renvoie vers `https://accounts.google.com/signin/recovery`.
- L’application distingue trois niveaux côté serveur :
  1. **Identité Google vérifiée** : jeton OAuth 2.0 / OIDC vérifié côté serveur avec `email_verified === true`.
  2. **Étudiant EST Fès vérifié** : confirmé par la source institutionnelle (`EST_ELIGIBILITY_SOURCE_URL` ou `EST_ELIGIBILITY_EMAILS`) ou validé par un bibliothécaire. Un simple domaine Google ne confère **jamais** automatiquement le statut `verifie` (le compte est créé en `en_attente`).
  3. **Membre éligible** : étudiant EST Fès vérifié (`actif`) **sans aucun emprunt en retard**.

## 2. Variables d’environnement côté serveur

Déclarez dans Google Cloud Console les URI de redirection autorisées :
- `<APP_URL>/api/auth/google/callback`
- `<SHARED_APP_URL>/api/auth/google/callback` (si une URL partagée distincte est utilisée)

Variables utilisées par le serveur :

```env
GOOGLE_CLIENT_ID="<CLIENT_ID_GOOGLE>"
GOOGLE_CLIENT_SECRET="<CLIENT_SECRET_GOOGLE>"
GOOGLE_REDIRECT_URI="<APP_URL>/api/auth/google/callback"
GOOGLE_ALLOWED_HOSTED_DOMAIN="usmba.ac.ma"
GOOGLE_REQUIRE_PREPROVISIONED="false"
LIBRARIAN_EMAILS="bibliothecaire@est-usmba.ac.ma"
EST_ELIGIBILITY_SOURCE_URL=""
EST_ELIGIBILITY_EMAILS=""
SESSION_SECRET=""
DISABLE_DEMO_MODE="true"
```

## 3. Rôles (`membre` / `bibliothecaire`)

Le rôle `bibliothecaire` est attribué **uniquement** par la configuration serveur (`LIBRARIAN_EMAILS`) ou par la base de données d’administration — jamais par une saisie client.
