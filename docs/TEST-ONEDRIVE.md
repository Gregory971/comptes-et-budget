# Tester la sauvegarde OneDrive avec votre compte

> **À lire d'abord.** À ce jour, l'écriture réelle dans OneDrive **n'a jamais été
> vérifiée**. Ce qui l'a été, c'est le code, contre un *faux* serveur Microsoft
> tenu en mémoire (tests automatiques). Un faux serveur ne prouve pas que le vrai
> se comporte pareil : **seul un essai avec votre compte le prouvera**, et ce guide
> est fait pour le mener. Vous vous connectez vous-même, dans la fenêtre de
> Microsoft ; **personne n'a besoin de votre mot de passe, et rien dans ce guide
> ne vous demande de le communiquer.**

Durée : environ 30 minutes (une heure si vous voulez aussi vérifier le
rafraîchissement du jeton après expiration).

---

## 0. Ce qui est vérifié automatiquement, et ce qui ne l'est pas

Les tests `src/onedrive/onedrive-e2e.test.ts` et `src/services/onedrive-e2e.test.ts`
jouent la passerelle et le service contre un faux Microsoft qui applique les règles
d'OAuth et de Graph (code à usage unique, vérificateur PKCE recalculé, jetons qui
expirent et tournent, portée limitée au dossier d'application, téléchargement par
redirection, politique de sécurité réelle de la passerelle).

| Vérifié par les tests (faux serveur) | **Non vérifié** (à tester avec votre compte) |
|---|---|
| Connexion PKCE, échange du code, état et vérificateur | Que Microsoft accepte réellement cette inscription d'application |
| Envoi, copie datée, rotation à 10 copies | Que le dossier d'application se crée au premier envoi |
| Liste (pages, sous-dossiers), restauration | Le nom exact du dossier dans votre OneDrive |
| Rafraîchissement du jeton, reprise sur 401 | Que votre compte autorise l'écriture par l'API (voir §5, cas du compte de test) |
| 429 avec `Retry-After`, 503, perte réseau | Le comportement réel de la limitation par Microsoft |
| Déconnexion locale | La durée de vie réelle du jeton de rafraîchissement (24 h annoncées) |

---

## 1. Prérequis

### 1.1 Côté application

- Une version **servie en ligne** (GitHub Pages, ou `npm run build` puis
  `npm run preview`). Le **fichier autonome** (`file://`) **ne peut pas** servir :
  Microsoft exige une adresse web déclarée à l'avance.
- Un navigateur de bureau récent (Chrome, Edge, Firefox). **Pas de navigation
  privée** : la connexion garde des informations temporaires dans le stockage du
  navigateur, que ce mode peut vider.
- Les **fenêtres surgissantes autorisées** pour le site : la connexion s'ouvre
  dans une petite fenêtre.

### 1.2 Côté Microsoft (inscription de l'application)

L'application est livrée avec un identifiant client public déjà inscrit
(`d7f0e348-6055-4bd2-b1a1-607972607ba3`, inscrit le 22/08/2026 dans votre annuaire
personnel). **Si vous utilisez cette inscription, vérifiez simplement ces points**
dans le portail Microsoft Entra (portail Azure → *Inscriptions d'applications*) :

1. **Types de comptes pris en charge** : « Comptes dans un annuaire
   organisationnel **et** comptes Microsoft personnels » (le code utilise
   l'autorité `common`).
2. **Authentification → Ajouter une plateforme → Application monopage (SPA)**, avec
   l'URI de redirection **exacte** de la passerelle :
   `https://VOTRE-COMPTE.github.io/comptes-et-budget/onedrive.html`
   (pour un essai local : `http://localhost:4173/onedrive.html`).
   - Le type doit être **SPA**, pas « Web » ni « Client public » : sinon l'échange du
     jeton échoue (erreur `AADSTS9002326`, voir §5).
   - L'URI doit correspondre **au caractère près** (majuscules, barre finale…).
3. **Autorisations d'API** (déléguées) : `Files.ReadWrite.AppFolder`,
   `offline_access`, `openid`, `profile`. Aucune autre : surtout pas
   `Files.ReadWrite` (accès à tout le OneDrive).
4. Aucun secret client n'est créé ni nécessaire (application monopage).

Pour une **copie personnelle** de l'application : créez votre propre inscription
avec ces mêmes réglages, puis collez son identifiant dans *Préférences → Sauvegarde
vers OneDrive → Identifiant d'application* (ne le faites que dans ce cas).

> Limite connue de Microsoft pour les applications monopage : le jeton de
> rafraîchissement **expire au bout de 24 heures**, sans renouvellement possible.
> Il faudra donc vous **reconnecter une fois par jour** (un clic, sans ressaisie
> de mot de passe en général). Ce n'est pas un défaut de l'application.

---

## 2. Déroulé pas à pas

Cochez chaque étape et notez le résultat réel. En cas d’écart, passez au §4 et au §5.

### Étape 1 — La fonction est éteinte par défaut

1. Ouvrez l'application → **Préférences**, section **Sauvegarde vers OneDrive
   (compte Microsoft)**.
2. **Attendu** : un texte explicatif et un seul bouton **Activer OneDrive**. Aucun
   compte affiché. (Ouvrez les outils de développement → onglet *Réseau* : aucune
   requête vers Microsoft tant que vous n'avez pas activé.)

### Étape 2 — Activer

1. Cliquez **Activer OneDrive**.
2. **Attendu** : message « OneDrive activé : connectez maintenant votre compte
   Microsoft. » ; une ligne *Compte Microsoft : aucun — connexion requise* ; un
   bouton **Connecter mon compte Microsoft**.

### Étape 3 — Connexion

1. Cliquez **Connecter mon compte Microsoft**.
2. **Attendu** : une petite fenêtre s'ouvre sur la page de Microsoft. Si rien ne
   s'ouvre : message « Fenêtre de connexion bloquée… » → autorisez les fenêtres
   surgissantes et recommencez.
3. Choisissez/saisissez **vous-même** votre compte dans cette fenêtre.
4. Microsoft affiche l'écran de consentement. **Vérifiez** qu'il ne demande qu'un
   accès au **dossier de l'application** (formulation du type « Accéder aux fichiers
   et dossiers de l'application… »), et **pas** « tous vos fichiers ». Si vous voyez
   « tous vos fichiers » : **refusez** et signalez-le (la portée serait trop large).
5. Acceptez.
6. **Attendu** : la fenêtre affiche « Compte Microsoft connecté. Cette fenêtre peut
   être fermée. » puis se ferme d'elle-même (~1 s) ; dans l'application : « Compte
   *vous@…* connecté. », et la ligne *Compte Microsoft* affiche votre adresse.
   Boutons visibles : **Envoyer maintenant**, **Restaurer depuis OneDrive**,
   **Déconnecter**.
7. Refus volontaire (à essayer une fois) : relancez la connexion et cliquez
   *Refuser*. **Attendu** : la fenêtre reste ouverte avec « Connexion impossible :
   access_denied — … », l'application affiche la même erreur ; rien n'est retenu.

### Étape 4 — Première sauvegarde

1. Cliquez **Envoyer maintenant**.
2. **Attendu** : « ✓ Sauvegarde envoyée : *NomDeLaBase_AAAA-MM-JJ.cbjson*. » et la
   ligne *Dernier envoi* se renseigne.
3. Vérifiez **dans OneDrive** (onedrive.live.com ou l'application OneDrive) :
   dossier **Applications** (ou *Apps*) → dossier au nom de l'inscription
   (« Comptes et Budget ») → le fichier est là.
   - Ouvrez-le dans un éditeur de texte : un JSON lisible commençant par
     `{"format":"comptes-budget"…`.
   - La taille doit être non nulle et cohérente avec votre base.
4. **Contrôle de la portée** : aucun fichier n'a dû apparaître ni changer ailleurs
   dans votre OneDrive.

### Étape 5 — Deuxième envoi le même jour

1. Faites une petite modification dans l'application (une opération), puis
   **Envoyer maintenant** à nouveau.
2. **Attendu** : le *même* fichier est remplacé (heure de modification mise à jour) ;
   **pas** de deuxième fichier.

### Étape 6 — Rotation des copies (10 conservées)

On ne va pas attendre 11 jours : on fabrique des copies anciennes à la main.

1. Dans OneDrive (web), dossier de l'application : **chargez** 11 copies du fichier
   de l'étape 4 renommées en `NomDeLaBase_2026-01-01.cbjson` … `NomDeLaBase_2026-01-11.cbjson`
   (même *base* que le fichier réel : espaces remplacés par `_`).
2. Ajoutez aussi un fichier étranger, `notes.txt`, et un fichier `Autre_2025-01-01.cbjson`.
3. Dans l'application : **Envoyer maintenant**.
4. **Attendu** : message « … (2 ancienne(s) copie(s) supprimée(s) pour n’en garder
   que 10) ». Dans OneDrive : **10** copies datées de votre base (les plus récentes —
   celle du jour comprise ; `2026-01-01` et `2026-01-02` ont disparu) ;
   `notes.txt` et `Autre_2025-01-01.cbjson` **intacts**. Les fichiers supprimés devraient être
   dans la **corbeille OneDrive** (à vérifier).
5. S'il y a un message « le ménage des anciennes copies a échoué (…) » : la
   sauvegarde du jour est quand même partie ; notez le texte d'erreur.

### Étape 7 — Liste et restauration

1. **Avant**, faites une modification locale reconnaissable (ex. supprimer une
   opération de test ou renommer un compte). Idéalement sur une **base de test**.
2. Cliquez **Restaurer depuis OneDrive**.
3. **Attendu** : fenêtre « Sauvegardes présentes dans OneDrive » : les fichiers, du
   plus récent au plus ancien, avec date et taille ; aucun sous-dossier.
4. Cliquez **Restaurer** sur le fichier du jour.
5. **Attendu** : fenêtre « Restaurer depuis OneDrive » avec le nom du fichier, la
   base, la date d'export, le nombre d'opérations/comptes. Choisissez **Fusionner**,
   validez. Une copie de sécurité de l'état actuel est **téléchargée** avant
   l'opération. Résultat : « Sauvegarde fusionnée. »
6. Refaites avec **Remplacer** : l'état local doit redevenir exactement celui du
   fichier (votre modification locale disparaît).
7. Une sauvegarde **chiffrée** doit être refusée ici avec un message qui renvoie vers
   « Importer une sauvegarde ».

### Étape 8 — Rafraîchissement du jeton (optionnel, +1 heure)

1. Une heure après la connexion, sans vous reconnecter, cliquez **Envoyer
   maintenant**.
2. **Attendu** : succès, sans fenêtre ni question. (Le jeton d'accès dure ~1 h ; la
   passerelle en obtient un nouveau seule.)
3. Plus de 24 h après la connexion : **Attendu** : message « La connexion Microsoft
   a expiré (24 h au plus pour une application web) : reconnectez-vous. », et
   l'écran repasse à *Compte : aucun — connexion requise*. Cliquez *Connecter* : ça
   repart.

### Étape 9 — Perte de réseau

1. Outils de développement → *Réseau* → **Hors connexion** (ou coupez le Wi-Fi).
2. Cliquez **Envoyer maintenant**.
3. **Attendu** : message immédiat « Vous êtes hors connexion : la sauvegarde OneDrive
   reprendra au retour du réseau. » (ou « Impossible de joindre Microsoft… » si le
   navigateur se croyait en ligne). *Dernière erreur* renseignée.
4. Rétablissez le réseau, cliquez de nouveau : **succès sans reconnexion**, et la
   ligne *Dernière erreur* disparaît.

### Étape 10 — Limitation (429)

Non reproductible à la main (Microsoft ne limite qu'en cas d'abus). Vérifié
uniquement par les tests automatiques : si cela vous arrive un jour, l'application
attend le délai demandé (jusqu'à 30 s, trois fois) puis réessaie ; au-delà, elle
affiche « OneDrive demande d'attendre N s… ». Notez le message exact si vous le voyez.

### Étape 11 — Déconnexion

1. Cliquez **Déconnecter**.
2. **Attendu** : « Compte Microsoft déconnecté. », *Compte : aucun*, bouton
   **Connecter** de retour ; *Dernier envoi* effacé.
3. Rechargez la page, rouvrez *Préférences* : toujours déconnecté (aucun envoi
   possible sans nouvelle connexion).
4. **Important** : *Déconnecter* efface les jetons de **l'application**. Cela ne retire
   pas l'autorisation côté Microsoft. Pour la retirer complètement : compte
   Microsoft → *Confidentialité* → *Applications et services* (ou
   myapps.microsoft.com / account.live.com/consent/Manage) → retirer l'application.
5. Les fichiers déjà envoyés restent dans OneDrive : c'est voulu.

### Étape 12 — Désactiver

Cliquez **Désactiver OneDrive**. **Attendu** : plus aucun bouton d'envoi ; plus aucune
requête vers Microsoft.

---

## 3. Contrôles de sécurité à faire une fois

- **Application principale** : outils de développement → *Console* → après avoir
  rechargé la page, aucune erreur de politique de sécurité de la forme « Refused to
  connect… » ne doit apparaître en usage courant ; et en onglet *Réseau*, **toutes** les
  requêtes vers Microsoft ont pour origine la page `onedrive.html` (iframe ou
  fenêtre), jamais la page principale.
- **Ne jamais** assouplir la politique de sécurité pour « faire passer » une requête
  bloquée : si le journal montre « Refused to connect to *un hôte inconnu* », notez
  l'hôte et signalez-le au lieu de contourner.
- Ne collez dans aucun message une adresse contenant `code=` (retour de connexion),
  un jeton, ni un mot de passe.

---

## 4. Où regarder quand ça ne marche pas

1. **Le message affiché** dans l'application (« Dernière erreur » ou bandeau rouge) :
   il est en français et dit en général quoi faire (voir le §5).
2. **La fenêtre de connexion** : si la connexion échoue, elle **reste ouverte** avec
   « Connexion impossible : … » ; ne la fermez pas avant d'avoir noté le texte.
3. **La console** (F12 → *Console*) : les messages de la passerelle sont émis par
   l'iframe `onedrive.html`. Dans la liste déroulante *Contexte JavaScript* en haut de
   la console, choisissez `onedrive.html` pour voir ses erreurs.
4. **L'onglet Réseau** (F12 → *Réseau*, cocher *Conserver le journal*) : filtrez sur
   `microsoft` pour voir :
   - `login.microsoftonline.com/common/oauth2/v2.0/token` — échange et rafraîchissement
     des jetons (statut 200 attendu ; le corps de la réponse d'erreur contient un code
     `AADSTS…`) ;
   - `graph.microsoft.com/v1.0/me/drive/special/approot…` — **toutes** les requêtes
     Graph doivent viser ce chemin et aucun autre ;
   - le téléchargement (restauration) passe par une redirection vers `*.files.1drv.com`
     ou `*.sharepoint.com`.
5. **Stockage** (F12 → *Application* → *Stockage local*, origine du site) : clés
   `cb-onedrive-refresh` (jeton de rafraîchissement : **ne le copiez jamais**) et
   `cb-onedrive-account`. Un jeton d'accès n'est jamais écrit sur le disque.

## 5. Correspondance symptôme → cause probable

| Ce que vous voyez | Cause probable | Que faire |
|---|---|---|
| « Fenêtre de connexion bloquée par le navigateur » | Bloqueur de fenêtres | Autoriser les fenêtres surgissantes pour le site |
| Fenêtre Microsoft : `AADSTS50011` | URI de redirection différente de celle déclarée | Déclarer **exactement** `…/onedrive.html` dans l'inscription |
| « Connexion impossible : … `AADSTS9002326` / cross-origin token redemption… » | URI de redirection déclarée en type « Web » | La redéclarer en type **Application monopage (SPA)** |
| `AADSTS700016` | Identifiant client inconnu de l'annuaire / type de comptes trop restrictif | Vérifier l'identifiant ; autoriser comptes personnels + organisationnels |
| `AADSTS65001` / consentement requis | Consentement refusé ou admin requis (compte professionnel) | Accepter ; pour un compte pro, demander à l'administrateur |
| « Réponse de Microsoft inattendue (état invalide) » | Le stockage de session a été vidé pendant la connexion (navigation privée, autre onglet) | Relancer la connexion, hors navigation privée, sans ouvrir de deuxième onglet |
| « Vérificateur PKCE introuvable » | Même cause | Idem |
| La fenêtre dit « connecté » mais l'application ne change pas | Lien avec la fenêtre d'origine coupé par le navigateur | Fermer la fenêtre, recharger la page : l'état est relu. Notez navigateur et version |
| « Passerelle OneDrive : chargement trop long » | Page `onedrive.html` non servie (ancien service worker, hébergement) | Rechargement forcé (Ctrl+Maj+R) ; sinon désinscrire le service worker (F12 → Application → Service Workers) ; vérifier que `…/onedrive.html` s'ouvre seule |
| « La passerelle OneDrive n'a pas répondu » | Ordre sans réponse pendant plus de 30 s (150 s pour envoi/liste) | Réessayer ; noter l'étape |
| « Impossible de joindre Microsoft… » | Hors ligne, bloqueur de contenu, pare-feu, ou politique de sécurité | Vérifier le réseau, désactiver les extensions de blocage pour le site, lire la console |
| « Connexion Microsoft expirée : reconnectez-vous » | Jeton révoqué ou expiré | *Déconnecter* puis *Connecter* |
| « La connexion Microsoft a expiré (24 h…) » | Règle Microsoft des applications monopage | Se reconnecter (une fois par jour) |
| « Accès refusé par OneDrive pour ce dossier » (403) | Portée non accordée, ou compte sans OneDrive | Revoir le consentement ; vérifier que le compte a un OneDrive |
| « OneDrive refuse toute écriture pour ce compte (service en lecture seule…) » | 403 `serviceReadOnly` : l'API est verrouillée côté Microsoft pour ce compte | Sans lien avec l'application : tester avec **un autre compte** Microsoft (c'était le cas du compte de test des premiers essais) |
| « Espace insuffisant sur OneDrive » (507) | Quota plein | Libérer de la place |
| « Conflit… » (409) ou « verrouillé » (423) | Fichier en cours de synchronisation | Réessayer quelques secondes plus tard |
| « OneDrive limite temporairement les requêtes » (429) | Trop de requêtes | Attendre quelques minutes |
| « OneDrive est momentanément indisponible (code 5xx) » | Panne passagère Microsoft | Réessayer plus tard |
| « Sauvegarde trop volumineuse… (limite 250 Mo) » | Envoi simple limité à 250 Mo | Le fractionnement n'est pas implémenté (voir §6) |
| Rien dans le dossier alors que « envoyée » | Mauvais dossier regardé | Chercher dans *Applications* (ou *Apps*) → nom de l'inscription |

## 6. Limites connues

- **Reconnexion quotidienne** (jeton de rafraîchissement de 24 h pour une
  application monopage, règle de Microsoft).
- **Envoi simple uniquement** (un seul PUT, jusqu'à 250 Mo selon la documentation de
  Graph). L'envoi fractionné par session n'est pas implémenté : son adresse d'envoi
  pointe vers un hôte que la politique de sécurité de la passerelle n'autorise pas,
  et on ne l'élargit pas sans raison démontrée.
- **Non vérifié en conditions réelles** : tout ce qui dépend du comportement réel de
  Microsoft (voir le tableau du §0).
- La **rotation** ne supprime que les fichiers `NomDeLaBase_AAAA-MM-JJ.cbjson` de la
  *même* base ; elle n'efface rien d'autre.

## 7. Que me renvoyer à l'issue de l'essai

Pour chaque étape : **réussie / échouée / non testée**, et pour chaque échec :

- le **texte exact** du message affiché ;
- l'étape, l'heure, le navigateur et sa version ;
- éventuellement la ligne `AADSTS…` ou le code HTTP vu dans l'onglet *Réseau*
  (statut + chemin de la requête).

**Ne communiquez jamais** de mot de passe, de jeton, ni d'adresse contenant `code=`.

## 8. Tableau de suivi

| Étape | Résultat | Remarques |
|---|---|---|
| 1. Éteint par défaut | ☐ | |
| 2. Activation | ☐ | |
| 3. Connexion (+ refus) | ☐ | |
| 4. Première sauvegarde (fichier présent, portée) | ☐ | |
| 5. Deuxième envoi le même jour | ☐ | |
| 6. Rotation à 10 | ☐ | |
| 7. Liste et restauration (fusion, remplacement) | ☐ | |
| 8. Rafraîchissement du jeton | ☐ | |
| 9. Perte de réseau | ☐ | |
| 10. Limitation 429 | non testable à la main | |
| 11. Déconnexion | ☐ | |
| 12. Désactivation | ☐ | |
