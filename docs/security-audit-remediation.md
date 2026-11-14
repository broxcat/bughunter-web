# Réexamen de la remédiation de sécurité

Branche : `security/audit-remediation`, reprise à `1fe73e9` (audit initial de
`ec29110`). Les qualifications globales « Validé » du précédent bilan sont
retirées. Une correction de code, un test simulé et une acceptation réelle ne
sont pas interchangeables. Aucune fusion sur `main`, aucun déploiement sur la
stack existante. Docker répondait déjà ; Desktop n’a pas été démarré.

## Tableau des 13 constats

Ce tableau a été remis en état « à vérifier » au début du réexamen, puis actualisé
après les corrections et les essais. Les limites ci-dessous font partie du bilan.

| ID | Priorité | Constat | Code corrigé | Validation statique / tests isolés | Validation réelle | Bloquée / limite restante |
|---|---|---|---|---|---|---|
| C1 | Critique | Egress, SSRF, rebinding | Garde épinglée conservée ; décompression ajoutée | Classes IP, DNS mixte/rebinding, annulation, redirections | HTTP de fixture ; Chromium sur cible autorisée et refus hors interception | Aucun test sur cible publique ; ne constitue pas un audit complet de tous les outils |
| H1 | Haute | Navigateur hostile et secrets | Service distinct sans réseau, sans code/données/secrets applicatifs ; sandbox obligatoire | Compose, images, absence de lancement local | Linux : namespaces + seccomp Chromium, réseau de contrôle inaccessible, auto-login, arrêt d’un moteur bloqué | Plateformes sans namespaces compatibles : refus ; aucune prise en charge locale Windows |
| H2 | Haute | Secrets et privilèges | Variables par service, UID non root, capacités retirées ; Chromium retiré de l’image applicative | Compose/Dockerfile, configuration Compose | Construction de l’image ; doctor strict sous UID 10001 | Stack existante jamais déployée ; validation ne couvre pas son état actuel |
| M1 | Moyenne | Politiques IA/lab | Quatre usages séparés ; aucun localhost implicite ; exceptions opérateur explicites | Lab seul refusé par le transport IA et par l’admission Settings ; épinglage et redirections | Fournisseurs HTTP simulés et persistance PostgreSQL de Settings | Aucun fournisseur IA externe joint ; opérateur responsable des origines privées explicitement autorisées |
| M2 | Moyenne | Approbation du scope | Schéma strict, justification et attestation conservés | Scope/admission ; refus avant mutation | Routes SQL et concurrence de suppression | Test User-Agent/politique historique encore en échec ; autorisation attestée par le propriétaire, noms non résolus recontrôlés à la connexion |
| M3 | Moyenne | Révocation des sessions | sessionVersion conservé ; trigger PostgreSQL sur changement de passwordHash | JWT, durée, origine et révocation | Upgrade avec utilisateur préexistant, connexion, révocation opérateur, nouveau mot de passe, suppression | Migration de la base existante volontairement non effectuée |
| M4 | Moyenne | Capacité PDF | Redis Lua partagé, propriétaire, expiration/quarantaine, arrêt confirmé ; cache borné | Quota, panne fermée, conservation du bail si arrêt non confirmé, deadline et cache | Deux processus Node, Redis authentifié/redémarré, Chromium bloqué, capacité rendue après arrêt | Nettoyage des baux orphelins manuel après arrêt prouvé ; Redis durable requis |
| B1 | Basse | CSRF et origines | Contrôle dans les mutations conservé | Tests d’origine et handlers | Auth.js avec PostgreSQL et routes de mutation | Pas d’acceptation d’un proxy de production |
| B2 | Basse | Contournement du proxy | Matcher API conservé ; défense supplémentaire aux handlers | Matrice du proxy et appels directs des handlers | Handlers SQL et auth | Auth.js conserve sa validation protocolaire propre |
| B3 | Basse | Inscription et abus | Contrôles antérieurs conservés | Tests inscription/quota/identité | Redis réel pour quotas et connexion | Suites queue/anti-abus nécessitant leur runner particulier ignorées, pas comptées comme réussies |
| B4 | Basse | Redis | Auth obligatoire ; AOF synchrone et noeviction pour la capacité PDF | Configuration, démarrage, panne fermée | NOAUTH sans credentials, PONG authentifié, BullMQ réel, réservation durable après arrêt forcé | Sans CONFIG GET ou durabilité requise : PDF indisponible (503) |
| B5 | Basse | Historique en lecture | Correction antérieure conservée | Tests lecture seule | Exports/historique sur PostgreSQL jetable | Échec de navigation Research distinct, décrit plus bas |
| B6 | Basse | Validation aux handlers | Zod partagé dans 90 exports / 62 modules ; IDs de corps communs renforcés | 63 routes inventoriées, appels directs invalides avant auth/métier | Routes SQL, ownership et mutations | Corps/enums propres aux opérations restent dans leurs schémas locaux ; aucune prétention de validation universelle de tout contenu |

## H1 : frontière d’exécution effective

`docker/browser/Dockerfile` contient uniquement Node, Playwright/Chromium et
`server.mjs`. Le service `browser` utilise `network_mode: none`, UID/GID
`10001`, racine en lecture seule, aucune capacité Linux, `no-new-privileges`,
profil seccomp dédié, mémoire/PID bornés et `/tmp` en tmpfs. Son unique volume
est celui des sockets Unix. Aucun montage de source, `.env`, données,
PostgreSQL, Redis ou socket Docker. L’image web/worker ne contient plus
l’exécutable Chromium ; son Dockerfile n’installe plus les dépendances Chromium.
Les deux images initialisent le répertoire de sockets avec le même UID ; le
runner teste aussi le cas où l’image applicative initialise le volume en premier.
Compose attend un broker joignable avant de démarrer web et worker.

`src/server/isolatedBrowser.ts` ne prend en charge qu’un socket Unix Linux.
Il ouvre un pont loopback côté client vers ce socket pour le protocole
Playwright ; le navigateur ne dispose d’aucune interface vers ce loopback du
worker. Il n’existe ni endpoint TCP distant configurable, ni repli local.
Le sandbox est obligatoire : `BROWSER_SANDBOX=disabled` et les valeurs ambiguës
sont refusés. Un lancement sandboxé raté répond en erreur et ne réessaie jamais
sans protection.

La garde de `execution.ts` reste côté worker : scope et méthode, authentification
temporaire autorisée, User-Agent, DNS épinglé, limites de corps, budgets,
annulation et contrôle du trafic. Les requêtes HTTP passent par cette garde
puis sont remises à Chromium. WebSocket est refusé ; les service workers sont
bloqués. Les arguments Chromium ne sont qu’une défense supplémentaire : la
preuve réseau est le namespace Docker `none`, testé indépendamment des flags.

La fermeture demande au broker de tuer le groupe de processus puis attend la
sortie du processus avant confirmation. Une déconnexion Playwright ne suffit
plus à valider le drainage. L’annulation arrête le navigateur avant d’attendre
le protocole d’un contexte potentiellement bloqué. Le broker borne les sessions
à quatre, avec watchdog 30 s (PDF) / 300 s (cible), et nettoie un démarrage
abandonné. Un transport de contrôle perdu laisse la terminaison non confirmée.

Preuves Linux : `chrome://sandbox` rapporte `Layer 1 Sandbox: Namespace`, PID
et network namespaces actifs, `Seccomp-BPF sandbox: Yes`. Les tentatives TCP du
conteneur vers les IP **des seules fixtures jetables** PostgreSQL, Redis et
runner échouent. Le code natif de vérification ne dépend pas des arguments
Chromium. Aucune vraie IP de métadonnées cloud n’est jointe. Les chaînes de
métadonnées dans les pages hostiles sont bloquées par la garde/le réseau.

## M1 et transport HTTP

`resolveEgressTarget` distingue `lab-target`, `ai-provider`, `admin-service` et
`public-provider`. Seul `lab-target` consulte `EGRESS_LAB_ALLOWLIST` (association
exacte host:port=IP). Le transport IA et l’admission Settings imposent
`ai-provider`. Les exceptions privées IA sont les origines exactes de
`OLLAMA_HOST` et `RESEARCH_EMBEDDING_URL`, explicitement configurées. Aucun
`http://localhost:11434` implicite ne subsiste. `guardedAdminFetch` exige sa
propre liste `EGRESS_ADMIN_ORIGINS` ; `guardedPublicProviderFetch` n’accorde aucune
exception privée. Ces politiques ne partagent pas l’exception des labs.

`node:http(s)` conserve Host/SNI, validation du certificat, résolution unique,
épinglage et refus des redirections. Les corps gzip, deflate et br sont
décodés en flux ; leurs Content-Encoding/Content-Length sont retirés pour
exposer une représentation cohérente aux collecteurs et à `route.fulfill`.
Les contrôles de taille s’appliquent au corps décodé. Les Set-Cookie distincts
sont conservés (et remis séparément à Chromium). HEAD/statuts sans corps sont
traités sans corps. Les tests vérifient texte UTF-8, en-têtes, deux cookies,
redirections observées/refusées et rendu réel des trois encodages dans Chromium.
Les fournisseurs fixes publics hors de ce transport conservent leur politique
préexistante ; ils ne sont pas présentés comme nouvellement audités.

## M4 : capacité, terminaison et cache

La variable locale a été remplacée par un hash Redis borné, commun à toutes les
instances (`capacity:pdf:v2`). Lua acquiert atomiquement une place, enregistre un
UUID propriétaire et une expiration à 90 s ; une configuration de capacité
incohérente entre instances ferme l’admission. La restitution compare le
propriétaire et la valeur exacte. Le quota utilisateur reste 6 exports/600 s,
après chargement des faits avec ownership et avant admission.

Redis absent, quota indisponible, CONFIG GET refusé, ou configuration non durable
=> **503**, sans rendu. Saturation/quota atteint => **429**. Le gate exige AOF
activé, appendfsync=always, maxmemory-policy=noeviction ; Compose fournit ces
réglages avec volume persistant. Un arrêt forcé/redémarrage réel de la fixture
Redis conserve la réservation. Aucun client BullMQ bloquant n’est utilisé pour
les commandes bornées du gate.

Le rendu possède une deadline indépendante ; son finally attend la terminaison
confirmée du navigateur. Si cette confirmation manque, le handler conserve le
bail. **L’expiration n’efface pas la réservation** : elle met un propriétaire
orphelin en quarantaine. Réattribuer automatiquement sur TTL pourrait lancer un
second moteur alors que le premier reste bloqué. Ce choix ferme le système en
cas de crash et réduit la disponibilité jusqu’à intervention opérateur.

Nettoyage maîtrisé, non exécuté sur la stack existante : arrêter les admissions
sur **toutes** les instances web, drainer les travaux, détruire/arrêter avec
confirmation **tous** les conteneurs navigateur associés, inspecter les
propriétaires/expirations du hash, puis retirer les champs des propriétaires
orphelins par HDEL. Conserver le champ `capacity`. Redémarrer ensuite les
services. Ne jamais supprimer un bail simplement parce que son horodatage est
passé, ni effacer le hash pendant que des instances admettent des travaux.
Il n’existe pas encore de reaper automatique attestant la mort d’un conteneur.

Cache local par instance : maximum 8 entrées, 16 Mio cumulés, TTL 60 s,
éviction LRU et refus d’une entrée supérieure à 16 Mio. Clé = utilisateur +
empreinte du modèle complet. Ownership et quota sont recontrôlés avant un hit.
Le cache n’est pas distribué et ne remplace pas la capacité Redis partagée.
PDF maximum : 25 Mio ; une entrée trop grande pour le cache peut être exportée.

## B6 : validation indépendante du proxy

`src/lib/apiBoundary.ts` et `routeIdSchema` valident les paramètres promis par
Next, les identifiants de requête, la pagination et les doublons de requête.
Les handlers réutilisent aussi le schéma d’identifiant pour les corps de
création scan/target/finding et de mutation de credentials/affectation legacy.
Les contrôles d’ownership restent dans le métier. Le proxy garde sa défense
supplémentaire. Auth.js est exclu du schéma d’ID opaque et traite son protocole.

La [matrice réelle](security-route-matrix.md) couvre 63 fichiers, dont 62 modules
avec 90 exports HTTP protégés. `handlerBoundaries.test.ts` charge leurs exports
réels, passe des valeurs invalides dans chaque segment et appelle les fonctions
sans proxy ; les espions auth/métier doivent rester inutilisés. Il teste aussi
les IDs invalides dans les corps avant DB/queue. Les schémas locaux continuent
de contrôler domaines, enums et contenu propres à chaque opération.

## Validation et limites d’acceptation

Les résultats exacts et empreintes sont consignés dans
[les preuves](security-evidence/validation.txt). Les logs bruts restent dans
`artifacts/security-audit/` (ignorés par Git et par le contexte Docker).

Résultats exécutés : TypeScript, lint, configuration Compose et build de
production OK. Linux ciblé : **137 réussites**. Suite Linux complète :
**1 271 réussites, 31 ignorés, 2 échecs**. Suite Windows : **1 100 réussites,
202 ignorés, 2 échecs**. Les deux échecs SQL de Linux sont également reproduits
sur `1fe73e9` (43 réussites et 2 échecs dans les deux suites concernées).

Le runner `tests/security/runIsolated.mjs` crée des noms aléatoires, un réseau
Docker **internal**, PostgreSQL/Redis/broker et volume de sockets jetables,
sans ports publiés, sans .env et sans montage du dépôt. Il supprime ces
ressources dans finally. Les dépendances de construction sont téléchargées ;
les essais ne contactent aucun fournisseur réel et n’exécutent aucun scan réel.
La stack existante n’est jamais démarrée, arrêtée, migrée ou déployée par ce runner.

Deux échecs SQL de la suite complète sont reproduits également sur l’archive
exacte de `1fe73e9`, dans cette infrastructure isolée :

- `apiRoutes.test.ts` : attente de refus sans User-Agent/politique historique.
- `programPagination.test.ts` : liens Research attendus absents du rendu.

Ils restent visibles ; les attentes n’ont pas été affaiblies pour verdir la
suite. Les deux tests de processus/SIGTERM échouant sous Windows sont rapportés
séparément ; leur passage sous Linux ne rend pas la suite Windows verte. Les
suites ignorées n’apportent aucune preuve d’acceptation. Les parcours testés
sont l’authentification Auth.js, l’auto-login de cible de fixture, l’egress,
les collecteurs HTTP et le PDF ; ce n’est pas une recette exhaustive de toute
l’interface produit. Aucun navigateur local de secours n’est accepté.

**Incident d’amorçage Windows.** Lors du premier essai du nouveau gate PDF, le
setup ne remplaçait pas encore DATABASE_URL/REDIS_URL. Prisma a pu charger la
configuration locale. L’admission PDF a échoué (503), mais une tentative de
connexion au Redis configuré a pu se produire ; les erreurs étaient volontairement
masquées par le gate. L’absence totale de contact, voire d’une commande Redis
ayant abouti avant l’erreur, ne peut donc pas être certifiée pour cet essai.
Aucune vérification supplémentaire contre le service existant n’a été lancée.
Le setup hermétique a été corrigé immédiatement pour les reprises : endpoints
fermés par défaut, TEST URLs jetables explicites pour l’intégration. Les
acceptations réelles rapportées ici proviennent exclusivement de ces reprises.
Aucune migration ni requête métier sur une base existante n’a été exécutée.

**La branche n’est pas déclarée prête à fusionner** : la suite complète conserve
ses échecs explicités, la quarantaine PDF nécessite une procédure opérateur,
et l’incident initial interdit de revendiquer une absence absolue de tentative
de contact avec la configuration existante. Les nouvelles frontières sont
validées dans les conteneurs jetables décrits, pas sur la stack en place.
