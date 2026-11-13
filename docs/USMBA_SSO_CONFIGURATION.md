# Configuration officielle du SSO USMBA pour BiblioEST

BiblioEST sépare strictement l’adaptateur d’authentification institutionnelle (`server/auth/usmbaSsoAdapter.ts`) de la gestion locale des sessions et de l’éligibilité.

## 1. Principe de séparation identité / éligibilité

L’application distingue trois niveaux distincts sur le serveur :
1. **Utilisateur authentifié** : session signée valide (via SSO USMBA ou authentification locale persistée).
2. **Étudiant EST Fès vérifié** : établissement égal à `EST Fès`, `studentStatus === 'verifie'` et `accountStatus === 'actif'`. Un simple domaine `@usmba.ac.ma` ne suffit pas à accorder le statut vérifié.
3. **Membre éligible** : étudiant EST Fès vérifié **sans aucun emprunt en retard**.

## 2. Variables d’environnement requises pour activer le SSO USMBA

Configurer ces variables auprès de la Direction des Systèmes d’Information (DSI) de l’USMBA :

```env
USMBA_SSO_ENABLED="true"
USMBA_SSO_ISSUER_URL="https://sso.usmba.ac.ma/oidc"
USMBA_SSO_CLIENT_ID="biblioest-estfes-client"
USMBA_SSO_CLIENT_SECRET="<SECRET_FOURNI_PAR_DSI_USMBA>"
USMBA_SSO_REDIRECT_URI="https://biblio.est-fes.usmba.ac.ma/api/auth/sso/callback"
```

## 3. Claims attendus du fournisseur d’identité USMBA

Lors de la validation du jeton OIDC / ticket CAS, l’adaptateur attend les attributs suivants :
- `sub` : identifiant immuable USMBA
- `email` : adresse institutionnelle (`@usmba.ac.ma`)
- `name` : nom complet de l’étudiant ou du personnel
- `institution` : établissement d’affectation (`EST Fès` requis pour les emprunts étudiants)
- `cne` / `apogee` : numéro Apogée ou CNE
- `student_verified` : booléen confirmant l’inscription administrative active pour l’année universitaire en cours
