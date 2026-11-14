# Remédiation de l'audit de sécurité (src/ et prisma/)

Base auditée : `main` @ `ec29110`. Ce document suit les 13 constats de l'audit
jusqu'à leur correction. Les numéros de ligne correspondent au code après
correction. Aucune stack n'a été déployée et Docker n'a pas été lancé pendant
cette remédiation.

## Synthèse

| ID | Priorité | Problème | État | Preuve principale |
|---|---|---|---|---|
| C1 | Critique | Egress, SSRF et DNS rebinding | Validé | `egressGuard.test.ts` 12/12, `browserEgress.test.ts` 3/3 (Chromium réel, mutation détectée), suite réseau 16/16 |
| H1 | Haute | Navigateur hostile et secrets du worker | Corrigé, validation conteneur en attente | `browserPolicy.test.ts` 3/3, Chromium sandboxé réel (Windows) ; sandbox dans le conteneur non validé (Docker hors périmètre) |
| H2 | Haute | Secrets et privilèges des services | Validé (statique) | `deploymentHardening.test.ts` (parse le compose et le Dockerfile) |
| M1 | Moyenne | SSRF des fournisseurs IA | Validé | `egressGuard.test.ts` (M1), `brainStructuredProviders.test.ts` 23/23 |
| M2 | Moyenne | Approbation du scope | Validé | `scopeAdmission.test.ts` 8/8 |
| M3 | Moyenne | Révocation des sessions | Validé | `sessionRevocation.test.ts` 5/5, `authOrigin.test.ts` |
| M4 | Moyenne | Saturation des exports PDF | Validé | `pdfExportGate.test.ts` 6/6, `reportPdfReal.test.ts` (rendu réel) |
| B1 | Basse | Contrôle CSRF et origines | Validé | `requestOrigin.test.ts` 8/8, tests des routes de mutation |
| B2 | Basse | Contournements du proxy | Validé | `proxyBoundary.test.ts`, `authProxy.test.ts` |
| B3 | Basse | Inscription sans limite | Validé | `registerAbuse.test.ts` 4/4, `antiAbuse.test.ts` |
| B4 | Basse | Redis sans authentification | Validé (statique et démarrage) | `deploymentHardening.test.ts` (B4) |
| B5 | Basse | Lecture d'historique avec écritures métier | Validé | `reconHistoryReadOnly.test.ts` 2/2 |
| B6 | Basse | Paramètres de route non validés | Validé | `proxyBoundary.test.ts` (63 routes réelles), `authProxy.test.ts`, `scopeAdmission.test.ts` |

État des tests : 1028 tests OK, 191 ignorés (base de données ou réseau non
disponibles). Les 2 échecs restants sont préexistants et propres à Windows
(`runCommand` SIGTERM et `scanWorkerLifecycle`, groupes de processus POSIX).
Avant la remédiation, la suite comptait 968 tests OK et 6 échecs.

---

## C1 : egress, SSRF et DNS rebinding (Critique)

**Constat initial.** L'autorisation ne comparait que des noms d'hôte
(`authorizeExecution`). Un FQDN autorisé résolvant vers loopback, Docker, le
LAN, le tailnet (100.64/10) ou un service de métadonnées était joint par le
probe HTTP, le relais Recon, le TCP natif, le TLS natif, Chromium
(`route.fetch` résout lui-même), nmap et les outils HTTP en exécution directe.

**Confirmation.** Confirmé dans le code : aucun appel `BlockList`/`lookup` en
dehors des exclusions de scope. Cartographie des sorties réseau :

| Sortie | Destination influençable ? | Traitement |
|---|---|---|
| `scanners/http.ts` (`probe`), utilisé aussi par le relais Recon et la connexion des identifiants | Oui (cible) | `guardedFetch` |
| `recon/tcp.ts` (ports) | Oui | `guardedConnect` |
| `recon/assetPipeline.ts` (TLS natif) | Oui | `guardedTlsConnect` |
| Chromium (`execution.ts`, auto-login, cartographie authentifiée) | Oui | Interception, puis `guardedFetch` ; résolveur et proxy Chromium bloqués |
| nmap | Oui | Désactivé (il résout lui-même) ; collecteur `guarded-tcp` |
| httpx/katana/nuclei/dalfox/ffuf/gobuster | Oui | Uniquement via le relais loopback, dont l'amont passe par la garde |
| Fournisseurs IA, introspection Ollama, embeddings | Oui (Settings) | `guardedProviderFetch` (voir M1) |
| subfinder/amass/assetfinder/gau, crt.sh, imports de plateforme, page publique YesWeHack | Non : fournisseurs fixes et publics, sans redirection | Inchangé (egress technique) |
| Relais DNS gobuster (`dnsRelay.ts`) | Requêtes DNS uniquement, pas de connexion vers les réponses | Inchangé ; les connexions ultérieures passent par la garde |
| PostgreSQL, Redis, contrôle loopback du toolchain | Non (infrastructure) | Inchangé |

**Correction.**
- `src/server/egress/addressPolicy.ts:83` `classifyAddress`. Côté IPv4, refus des
  registres IANA à usage spécial : 0/8, 10/8, 100.64/10, 127/8, 169.254/16,
  172.16/12, 192.0.0/24, documentation, 6to4 relay, 192.168/16, 198.18/15,
  multicast, 240/4, plus 168.63.129.16. Côté IPv6, règle positive `2000::/3`
  puis refus des plages spéciales qu'elle contient (Teredo, 6to4,
  documentation, NAT64 local). Les formats IPv4-mapped, translated, compatible
  et NAT64 sont jugés sur l'adresse IPv4 embarquée. Les zones IPv6 sont
  refusées. Sont aussi refusés les noms locaux ou d'infrastructure
  (`localhost`, `*.internal`, `*.local`, `metadata.google.internal`,
  `kubernetes.default.svc`…).
- `src/server/egress/resolve.ts:55` `resolveEgressTarget` : une seule résolution
  DNS, bornée (3 s) et annulable. Toutes les adresses retournées sont
  validées ; **une réponse mixte public/privé est refusée**. Le comportement est
  fermé en cas de timeout, de réponse vide ou d'erreur.
  `resolve.ts:85` `pinnedLookup` renvoie exclusivement l'adresse épinglée.
- `src/server/egress/fetch.ts:42` `guardedFetch` : `node:http(s)` avec
  `lookup` épinglé. Il n'y a donc pas de seconde résolution. `host` garde le
  nom, ce qui préserve Host, SNI et la vérification du certificat. Le pair
  connecté est revérifié. Les redirections ne sont **jamais** suivies.
  `fetch.ts:83/88` : `guardedConnect` et `guardedTlsConnect`.
- Branchements : `scanners/http.ts:72`, `recon/tcp.ts:11`,
  `recon/assetPipeline.ts:306`, `execution.ts:235` (Chromium,
  `route.fulfill` avec la réponse gardée, 8 Mo maximum).
- Outils externes : `scanners/toolPolicy.ts:19`. nmap est refusé ; les outils
  HTTP sans `reconRelayOrigin` sont refusés, même sans politique de programme.
  Le chemin legacy nmap de `recon/toolArguments.ts` est supprimé.
- Chromium (`server/browserPolicy.ts`) : `--host-resolver-rules=MAP * ~NOTFOUND`,
  proxy sur un port loopback fermé, WebRTC limité à l'UDP proxifié,
  prédiction et DNS-over-HTTPS désactivés. Ces protections ne peuvent pas être
  retirées par l'appelant.
- Labs privés : `EGRESS_LAB_ALLOWLIST="hôte:port=ip"`. Association exacte, sans
  joker ni plage, avec connexion épinglée sur l'IP déclarée et aucune
  résolution DNS (`resolve.ts:26`).

**Preuves et tests.**
- `tests/unit/egressGuard.test.ts` (12) : classes IPv4 et IPv6, formats de
  transition, représentations décimales, octales et hexadécimales, noms
  d'infrastructure, réponse mixte, timeout, **une seule résolution et adresse
  épinglée (rebinding)**, lab exact, Host préservé sans DNS, redirection
  observée mais non suivie, schémas refusés, annulation.
- `tests/network/browserEgress.test.ts` (3, Chromium réel) :
  - images, iframe, `fetch`, formulaire, WebSocket, Worker et beacon vers
    d'autres destinations n'atteignent jamais le réseau ;
  - un hôte de lab non résolvable par DNS est servi uniquement par l'épinglage ;
  - une requête hors interception échoue.
  **Test de mutation :** sans les arguments egress de Chromium, ce dernier test
  échoue.
- `tests/network/*` (16, `SCANNER_HTTP_TESTS=1`) : relais Recon, User-Agent,
  redirections et auto-login passent par la garde.
- Les fixtures locales sont déclarées comme exceptions de lab exactes
  (`tests/helpers/egressLab.ts`) ; la garde n'est pas affaiblie.

**Limites restantes.**
- Chromium exécute du JavaScript hostile. L'interception HTTP et les arguments
  egress ne constituent pas une isolation réseau complète pour d'éventuels
  canaux non HTTP. La frontière finale reste l'isolation réseau du conteneur
  worker, par exemple un pare-feu egress (voir H1).
- Les sous-domaines d'un wildcard sont validés à chaque connexion, pas à
  l'admission.

## H1 : navigateur hostile et secrets du worker (Haute)

**Constat initial.** Chromium tournait avec `--no-sandbox` dans le worker, qui
détient `CREDENTIALS_ENCRYPTION_KEY`, `DATABASE_URL` et `AUTH_SECRET`, avec
`NET_RAW` et `NET_ADMIN`.

**Confirmation et nuance.** Confirmé, et plus large que l'audit :
- Playwright désactive le sandbox **par défaut** (`chromiumSandbox: false`)
  pour tous les lancements, y compris la cartographie authentifiée ;
- Playwright transmet **tout `process.env`** aux processus Chromium ;
- l'image tournait en root, et Chromium refuse son sandbox en root.

**Correction.**
- `src/server/browserPolicy.ts:32` `hardenedBrowserLaunch` est utilisé par
  `execution.ts:168` et `recon/reportPdf.ts`. Il impose :
  - `chromiumSandbox: true` ;
  - un environnement réduit à `scannerEnvironment()` (PATH, HOME, locale, CA) ;
  - le retrait des arguments `--no-sandbox`, `--single-process`, `--proxy-*`
    et `--host-resolver-rules` fournis par l'appelant ;
  - les arguments egress de C1.
- `BROWSER_SANDBOX=disabled` est une acceptation de risque explicite et n'est
  jamais la valeur par défaut. Toute valeur ambiguë fait échouer le lancement.
- Le worker ne reçoit plus `AUTH_SECRET`, les secrets OAuth ni les réglages
  d'inscription (H2). Ainsi, une compromission du renderer ne permet plus de
  forger des sessions.
- `Dockerfile:191,206` : utilisateur `app` (uid 10001) et `USER app` avant le
  doctor et le `CMD`. Les templates nuclei sont déplacés sous `/home/app`.
- `docker-compose.yml` : `cap_drop: [ALL]` et `no-new-privileges` (voir H2).

**Tests.** `tests/unit/browserPolicy.test.ts` (3) couvre le sandbox imposé,
l'environnement sans secret et l'opt-out explicite. Chromium sandboxé a été
lancé réellement par `browserEgress`, `scannerHttp` et `reportPdfReal` (sous
Windows).

**Limites restantes (bloquant pour passer en « Validé »).**
- Le sandbox Chromium **n'a pas été validé dans le conteneur Linux**, car
  Docker était hors périmètre de cette tâche. Il requiert des user namespaces
  non privilégiés. Le profil seccomp par défaut de Docker peut les refuser ;
  dans ce cas, les étapes navigateur échouent explicitement (comportement
  fermé). Au déploiement, il faudra soit autoriser les user namespaces (profil
  seccomp dédié), soit accepter le risque avec `BROWSER_SANDBOX=disabled`.
- L'image n'a pas été reconstruite. Les modifications du Dockerfile
  (utilisateur, chemins nuclei, doctor sous `app`) sont à valider par
  `docker compose build`.
- Le worker garde `CREDENTIALS_ENCRYPTION_KEY` et `DATABASE_URL`, dont il a
  besoin. Une séparation en conteneur « scanner » sans secret reste une
  évolution possible.

## H2 : secrets et privilèges des services (Haute)

**Constat initial.** `env_file: .env` complet pour `web`, `worker` et
`oob-catcher`. `oob-catcher` est exposé et parse des entrées non fiables.
`NET_RAW` et `NET_ADMIN` étaient accordés à `web` et `worker`.

**Correction.** `docker-compose.yml` :
- plus aucun `env_file` ; Compose lit `.env` uniquement pour l'interpolation ;
- `x-shared-runtime-env` (`:18`) contient les variables communes à web et
  worker ;
- `web` ajoute `AUTH_*`, OAuth, inscription et proxys de confiance ;
- `worker` (`:131`) n'a pas `AUTH_SECRET` ni OAuth ;
- `oob-catcher` (`:162`) ne reçoit que `DATABASE_URL` et `LOG_LEVEL` ;
- `x-hardened-service` : `cap_drop: [ALL]` et `no-new-privileges:true` pour
  les trois services applicatifs. nmap et les sockets bruts sont désactivés
  (C1), donc aucune capacité n'est requise.

**Tests.** `tests/unit/deploymentHardening.test.ts` parse le compose
(`js-yaml`) et le Dockerfile : absence d'`env_file`, capacités retirées, secrets
par service, utilisateur non root.

**Limites.** Validation statique uniquement ; `docker compose config` et le
démarrage réel sont à exécuter au déploiement. L'inventaire des variables est
issu du code (`process.env.*`).

## M1 : SSRF des fournisseurs IA (Moyenne)

**Constat initial.** Base URL du fournisseur libre (http/https). `/api/tags`
suivait les redirections, et le statut HTTP fuyait dans les résumés.

**Correction.**
- `fetch.ts:108` `guardedProviderFetch` : épinglage, `redirect: 'error'`,
  destination publique uniquement. Exception : les origines **exactes**
  `OLLAMA_HOST` (par défaut `http://localhost:11434`) et
  `RESEARCH_EMBEDDING_URL`, définies par l'opérateur (`fetch.ts:99`).
- Branchements : `brain/client.ts:173,330`, `recon/ollamaReport.ts`,
  `research/semanticMemory.ts:25`.
- Refus dès l'enregistrement : `app/api/ai-providers/route.ts:97`
  (`assertProviderEndpoint`).

**Tests.** `egressGuard.test.ts` (bloc M1) et `brainStructuredProviders.test.ts`
(23, fournisseurs simulés en exceptions de lab).

**Limites.** Une URL utilisateur égale à l'origine Ollama de l'opérateur est
admise par conception.

## M2 : approbation du scope (Moyenne)

**Constat initial.** `APPROVED` était déclaratif. L'approbation se faisait sans
corps, et les hôtes, assets et programmes étaient auto-approuvés quelle que
soit leur résolution DNS.

**Confirmation.** Confirmé. Aucune UI n'appelle `/api/scopes/[id]/approve` ;
les vrais chemins d'admission sont la création et le PATCH de programme, les
assets et les hôtes.

**Correction.**
- `src/server/scopeAdmission.ts:17` `assertPublicScopeValues` refuse toute
  entrée exécutable dont la résolution est non publique. Pour les wildcards,
  c'est le domaine de base qui est vérifié ; les exceptions de lab exactes
  sont admises. Le contrôle est câblé sur :
  - `programs` (POST) et `programs/[id]` (PATCH) ;
  - `assets` (POST) et `assets/[assetId]` (POST, remplacement) ;
  - `hosts` (POST) et `hosts/[hostId]` (PATCH) ;
  - `scopes/[id]/approve`.
- `scopes/[id]/approve` : schéma strict avec `justification` (20 à 2000
  caractères) et `attestation: true`, justification enregistrée, événement
  d'audit `scope.approved` qui ne journalise pas le texte de la justification.

**Tests.** `tests/unit/scopeAdmission.test.ts` (8) : refus pour privé,
métadonnées, tailnet, loopback et réponses mixtes ; admission des hôtes publics
ou non résolus ; lab ; approbation sans corps, avec justification courte ou
champ supplémentaire ; audit ; refus avant toute mutation dans les routes
d'hôtes et d'assets.

**Limites.** L'autorisation reste attestée par le propriétaire (outil de bug
bounty). Les noms non résolus à l'admission sont admis ; la garde egress
revalide chaque connexion. Le journal d'audit passe par le logger structuré et
non par une table dédiée.

## M3 : révocation des sessions (Moyenne)

**Constat initial.** JWT de 30 jours sans vérification serveur.

**Correction.**
- `prisma/schema.prisma` : `User.sessionVersion`. Migration additive
  `prisma/migrations/20261114120000_user_session_version`.
- `src/lib/auth.ts` :
  - `jwtCallback` (`:20`) stampe la version à la connexion ;
  - `sessionStillValid` (`:13`) revérifie l'existence de l'utilisateur et sa
    version à chaque lecture ; `null` déconnecte ;
  - `maxAge` vaut 12 h, configurable de 1 h à 7 j via `SESSION_MAX_AGE_HOURS`
    (`:96`).
- `scripts/revoke-sessions.mjs` (`npm run user:revoke-sessions -- email`)
  incrémente la version.

**Tests.** `tests/unit/sessionRevocation.test.ts` (5) couvre le callback,
l'utilisateur supprimé, l'incrément de version, les jetons antérieurs à la
migration et les bornes de durée. `authOrigin.test.ts` couvre le parcours
complet login → session → logout.

**Limites.**
- Une requête indexée par lecture de session.
- Aucun flux de changement de mot de passe n'existe dans l'application ; le
  script sert à la révocation.
- La migration n'a pas été appliquée sur une base de test (pas de Postgres
  disponible).

## M4 : saturation des exports PDF (Moyenne)

**Constat initial.** Chaque GET lançait Chromium dans `web`, sans limite.

**Correction.**
- `src/server/recon/pdfExportGate.ts:16` : sémaphore global non bloquant
  (`PDF_EXPORT_MAX_CONCURRENCY`, 1 par défaut, de 1 à 4), qui renvoie 429 avec
  `Retry-After`, plus un quota de 6 exports par 10 minutes et par utilisateur.
- Si le limiteur partagé est indisponible, le sémaphore reste la borne dure.
- `recon/reportPdf.ts:7` : délai maximal de 30 s, au-delà duquel Chromium est
  fermé, et lancement durci.
- Route : identifiant validé et ownership vérifié **avant** de réserver de la
  capacité ; la capacité est libérée même en cas d'échec.

**Tests.** `tests/unit/pdfExportGate.test.ts` (6), `reconReportPdfRoute.test.ts`,
`tests/network/reportPdfReal.test.ts` (rendu réel sandboxé).

**Limites.** Sémaphore par processus web ; avec plusieurs instances web, la
borne est multipliée par le nombre d'instances.

## B1 : contrôle CSRF et origines (Basse)

**Constat initial.** `Origin` absent accepté ; toute origine dérivée de l'en-tête
`Host` admise.

**Correction.** `src/lib/requestOrigin.ts:32` :
- seule l'origine `AUTH_URL` est admise quand elle est configurée (c'est
  requis par le compose) ;
- sans `AUTH_URL`, seule l'origine adressée est admise ;
- `Origin` absent ou `null` est refusé, de même que
  `Sec-Fetch-Site ≠ same-origin`.

**Tests.** `tests/unit/requestOrigin.test.ts` (8) et les routes de mutation
(scan, annulation, résumé, rapports, blackbox, enregistrement). Les helpers de
test envoient désormais un `Origin`, comme un navigateur.
`tests/setup/hermeticEnv.ts` neutralise `AUTH_URL`, que Prisma chargeait
depuis le `.env` local, ce qui rendait la suite dépendante du poste.

**Limites.** Les clients scriptés doivent envoyer `Origin: <AUTH_URL>`. Les
tests d'intégration avec base ont été adaptés mais ne sont pas exécutés ici.

## B2 : contournements du proxy (Basse)

**Constat initial.** Le matcher excluait les chemins finissant en
`.json|.js|.txt|.xml|.map|.css`, et `/api/internal/*` restait public.

**Confirmation.** Les routes `/api/internal/*` ont été supprimées dans
`3b01050`, mais des dossiers vides non suivis subsistaient et l'exception
publique restait active.

**Correction.** `src/proxy.ts:56` : `/api/:path*` est toujours couvert.
L'exception `/api/internal` est supprimée et `isPublic` est exporté.

**Tests.** `tests/unit/proxyBoundary.test.ts` (matcher évalué avec le
`path-to-regexp` embarqué par Next) et `tests/unit/authProxy.test.ts`
(`/api/internal/*` et `/api/findings/abc.json` renvoient maintenant 401).

## B3 : inscription sans limite (Basse)

**Correction.** `src/app/api/register/route.ts:23` :
- quota par client (5 par heure) et global (30 par heure) **avant** bcrypt ;
- 503 si le limiteur est indisponible ;
- `foreignOrigin`, corps limité à 4 Ko, schéma strict.
Politique définie dans `lib/abusePolicy.ts`.

**Tests.** `tests/unit/registerAbuse.test.ts` (4) ; l'assertion
« Registration is not rate limited » de `antiAbuse.test.ts` a été remplacée.

**Limites.** Sans `TRUST_PROXY_HEADERS`, tous les clients partagent l'identité
« unknown » (comportement existant), et c'est le quota global qui borne.

## B4 : Redis sans authentification (Basse)

**Correction.**
- `docker-compose.yml:91` : `redis-server --requirepass`, et `REDISCLI_AUTH`
  pour le healthcheck. `REDIS_URL` est construit avec le mot de passe
  (`REDIS_PASSWORD` est requis).
- `src/lib/env.ts:58` `redisAuthErrors` : en production, web et worker
  (`queue/worker.ts:29`) refusent de démarrer avec une URL Redis sans mot de
  passe.

**Tests.** `tests/unit/deploymentHardening.test.ts` (compose et démarrage).

**Limites.** À la mise à jour, il faut définir `REDIS_PASSWORD` ; le volume
Redis existant reste compatible.

## B5 : lecture d'historique avec écritures métier (Basse)

**Constat initial.** `GET /api/scope-assets/[id]/history` publiait l'historique
de jusqu'à 50 runs, y compris le passage de la couverture en `NEEDS_RETEST`.

**Correction.** `src/server/recon/history.ts:69` : le chemin de lecture
n'écrit plus. La publication reste faite par `processScan` en fin de run et
par `maintainReconHistory` (maintenance). La réponse expose
`pendingPublication`.

**Tests.** `tests/unit/reconHistoryReadOnly.test.ts` (2) : aucune transaction,
aucun create, update, upsert ni SQL brut.

## B6 : paramètres de route non validés (Basse)

**Correction.**
- `src/proxy.ts:20` `apiPathRejected` : tout segment `/api` doit être un
  identifiant opaque ou un nom fixe (`[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}`).
  Les segments encodés, composés uniquement de points, vides ou non ASCII
  reçoivent un 404 **avant l'authentification**.
- `src/lib/routeParams.ts` sert de défense en profondeur dans les routes
  d'approbation et PDF.

**Tests.** `tests/unit/proxyBoundary.test.ts` énumère les 63 routes réelles :
identifiants valides admis, 10 valeurs malformées refusées pour chaque segment
dynamique. `tests/unit/authProxy.test.ts` vérifie le 404 avant le 401.

**Note.** `%2e%2e` est normalisé en `..` par le parseur d'URL puis résolu ; le
traversal est donc neutralisé en amont.

---

## Protections préservées

- SQLi : aucune requête brute ajoutée ; uniquement des `$queryRaw` taggés.
- Injection de commandes : `spawn` en `shell:false`, reconstruction des
  arguments par outil et environnement nettoyé, tous inchangés (nmap retiré).
- XSS : aucun nouveau puits HTML ; le rendu PDF échappe toujours le contenu
  (testé avec une charge `<script>`).
- IDOR : les contrôles d'ownership existants sont inchangés ; les nouveaux
  contrôles (PDF, approbation) s'exécutent avant toute réservation de
  ressource.

## Actions de déploiement (non effectuées ici)

1. Définir `REDIS_PASSWORD` (`openssl rand -hex 32`) et, si nécessaire,
   `EGRESS_LAB_ALLOWLIST` pour les cibles de lab privées.
2. `docker compose build`, puis vérifier le doctor sous l'utilisateur `app`.
3. Appliquer la migration `20261114120000_user_session_version`.
4. Vérifier le sandbox Chromium du worker (auto-login, cartographie) et du web
   (PDF). En cas de refus des user namespaces, fournir un profil seccomp
   adapté ou accepter explicitement le risque (`BROWSER_SANDBOX=disabled`).
5. Clients scriptés : envoyer `Origin: <AUTH_URL>` sur les mutations.
