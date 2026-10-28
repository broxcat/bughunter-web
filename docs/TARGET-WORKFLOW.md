# Workflow Target / RECON / Codex — audit et validation

## Architecture constatée

L'interface appelle « Target » un `BountyProgram`. Un `Target` Prisma est un host
technique, relié à un `Scope` d'autorisation. `/scopes/[id]` affiche déjà le
programme et ses hosts ; la page technique existante est `/hosts/[id]`.

Next.js 16.4.2 / React 19, Auth.js, PostgreSQL / Prisma 6 et BullMQ / Redis sont
conservés. Les RECON utilisent `ScanRun`, l'outbox, les tentatives avec heartbeat,
l'annulation serveur et les logs SSE existants. Codex utilise les mêmes
`ResearchSession`, workspaces, tickets Ed25519, PTY/WebSocket et sessions tmux.
Le proxy Java PortSwigger existant relie la passerelle stdio au transport SSE
Burp sur `127.0.0.1:9876`. Aucun changement des chemins ou noms d'outils upstream.

## Utilisation

1. Créer ou éditer une target. Enregistrer les **Authorized scope rules**, par
   exemple `*.example.com`, les exclusions, les règles d'engagement et le
   User-Agent officiel. Les hosts initiaux restent facultatifs.
2. Ouvrir `/targets/[id]`. Les onglets sont Overview, Scopes / Hosts, RECON,
   Codex Console et Settings. Les anciens parcours par host restent disponibles.
3. Dans RECON, lancer l'énumération passive. Un RECON déjà actif est réutilisé.
   L'annulation et les logs utilisent le composant SSE existant. La navigation
   ne termine aucun processus serveur.
4. Ouvrir Codex Console pour le contexte programme, même sans host. L'analyse
   active ciblée reste dans la console d'un host explicitement autorisé.
5. Dans Settings, **Supprimer la target** affiche une confirmation irréversible.
   Après nettoyage confirmé, redirection vers `/targets` avec notification.

## Migration additive

`prisma/migrations/20261028120000_program_workflow/migration.sql` ajoute :

- `BountyProgram.scopeRules`, `rulesOfEngagement` et `deletingAt` ; les hosts
  actifs historiques sont repris comme règles explicites lors de la migration.
- `Target.contextOnly` et la provenance `discoverySource`, `discoveredAt`,
  `discoveredByScanRunId`.
- `HostDiscovery`, unique par `(scanRunId, host)`, supprimé avec son RECON.
- `ScanExecutionAttempt.cleanupConfirmedAt`, sans inventer de confirmation
  historique.
- Un index partiel garantissant un seul contexte interne par programme et des
  triggers interdisant de créer des hosts, RECON ou sessions Research pendant
  la suppression. La contrainte existante d'unicité des hosts actifs est gardée.

Un `Target` interne inactif porte les clés étrangères du programme pour
réutiliser les services existants. `program.invalid` est une identité interne,
jamais une destination réseau ni un host visible dans les scopes. Ce contexte
est créé à la demande, sans demander à l'utilisateur de créer un host.

Avant déploiement : générer le client Prisma, appliquer `prisma migrate deploy`,
reconstruire web/worker et research-console et recréer les services avec le
Compose mis à jour. Le réseau privé `research_terminal` permet au web d'envoyer
les demandes d'arrêt signées. Le serveur terminal ne reçoit toujours aucune
connexion à la base, variable d'authentification applicative ou socket Docker.
`RESEARCH_TERMINAL_CONTROL_URL` permet de préciser son adresse interne ; la
valeur par défaut est `http://research-console:7681`.

## Suppression complète et reprise

L'identité authentifiée doit posséder le programme. Un identifiant absent ou
étranger reçoit une réponse idempotente sans divulgation de propriété. Les
nouvelles mutations navigateur rejettent un Origin étranger.

La suppression commence par une transaction qui enregistre `deletingAt`.
Un verrou consultatif PostgreSQL sérialise ensuite le nettoyage entre réplicas.
Les annulations RECON sont durables et les exécutions en file sans tentative
sont terminées sans dépendre de Redis. Les tentatives en cours doivent confirmer
leur nettoyage ; **un heartbeat périmé n'est pas une preuve d'arrêt**.

Les workspaces reçoivent un marqueur `.deleting` avant l'arrêt. Le service PTY
vérifie une demande Ed25519 dédiée, détache les connexions concernées, attend
les créations tmux en cours, termine les processus du workspace et leurs enfants,
escalade vers SIGKILL si nécessaire et confirme leur disparition. Il utilise
ensuite la commande native `codex delete --force <UUID>` de Codex 0.165.0 pour
ses historiques, sans supprimer l'authentification ou la configuration globale.
L'index SQLite de la version installée est également consulté en lecture seule :
la liste interactive Codex masque les sessions qui n'ont pas encore de tour
utilisateur, alors qu'elles peuvent déjà contenir un historique local injecté.
Les reconnexions et les nouveaux outils sont refusés sur un workspace révoqué.

Après confirmation, les jobs Redis sont retirés, les workspaces et archives
ZIP exclusifs sont supprimés, puis la transaction nettoie les promotions
Research, sessions, hypothèses/révisions, hosts, identifiants chiffrés, RECON,
outbox, clés d'idempotence, tentatives, logs, découvertes et findings.
Les rapports exclusifs et les tokens OOB sans autre finding sont supprimés.
Les scopes encore partagés, rapports contenant d'autres targets, comptes,
configurations IA et serveur Burp partagé sont préservés. Les workspaces
déterministes orphelins d'une publication interrompue sont aussi recherchés.

Tout arrêt non confirmé, indisponibilité Redis/terminal ou échec fichier laisse
la target bloquée avec une erreur explicite. Relancer la suppression reprend
le nettoyage ; aucun succès n'est annoncé avec des processus non confirmés.
Si le propriétaire d'une ancienne tentative interrompue est définitivement
perdu, une vérification opérateur des processus reste nécessaire avant de
confirmer son nettoyage. Les traces opérationnelles minimales de l'événement
de suppression restent dans le journal applicatif, sans contenu de workspace.

## Découverte et autorisation

Le RECON programme réutilise le worker existant et son annulation. Les règles
exactes produisent des seeds ; les certificats publics sont ensuite énumérés
via une URL fixe `https://crt.sh/`, avec le User-Agent enregistré, sans redirection.
Le JSON est lu en flux et chaque host est persisté avant la fin de l'énumération.
Il n'y a aucun HTTP vers la target, résolution DNS, crawling ou scan de ports
automatique dans ce parcours. Le RECON actif historique par host est conservé.

Chaque host est normalisé, validé comme FQDN et classé `VALIDATED`, `EXCLUDED`
ou `OUT_OF_SCOPE`. Les wildcards couvrent seulement les sous-domaines, avec
frontière de label ; `evilexample.com` ne correspond pas à `*.example.com`.
Seuls les hosts validés sont ajoutés, sous verrou programme et contrainte SQL.
Les résultats existants sont préservés, les doublons d'un même run réutilisés,
et deux programmes peuvent posséder le même nom de host sans mélange.
Un host issu du RECON est aussi refusé pour une future exécution active si les
règles officielles ne le couvrent plus. Les exclusions restent prioritaires.

Limites explicites : 50 règles interrogées par run, 5 Mio par réponse fournisseur,
30 secondes par requête et 10 000 observations. Une couverture incomplète ou un
fournisseur indisponible produit `PARTIAL` et conserve les découvertes déjà
persistées. Les wildcards de certificat ne sont pas transformés en hosts.

## Synchronisation et instructions Codex

L'inventaire et les compteurs sont actualisés par requêtes légères toutes les
2 secondes dans target/scopes ; les logs passent par le SSE existant, sans
rechargement complet de page. Les 30 exécutions récentes sont consultables.

Le workspace programme possède un `scope.md` officiel en lecture seule.
`.codex/config.toml` charge de véritables `developer_instructions` et le prompt
initial demande explicitement de lire `scope.md` et les instructions générées.
La présence du seul nom de fichier n'est donc pas utilisée comme mécanisme
implicite. Les consoles host reçoivent aussi les règles du programme parent.

À chaque création/renouvellement de ticket, `recon/hosts.json` est publié
atomiquement : hosts avec provenance, 30 RECON récents et 1 000 observations
récentes, dans la limite de 10 000 hosts. Pendant une console connectée, ce
renouvellement a lieu toutes les 20 secondes. Codex peut relire ce fichier dans
la même session ; aucune observation ne réécrit les règles de `scope.md`.
Un changement de politique officielle invalide l'ancien snapshot et bloque les
nouveaux tickets selon le mécanisme de dérive déjà présent. Il nécessite le
rafraîchissement opérateur du workspace décrit dans [CODEX-RESEARCH.md](CODEX-RESEARCH.md) via `scripts/refresh-research-console-policy.mts` ; il n'est pas remplacé silencieusement.

## Burp MCP : résultats distincts

- **Configuration et intégration** : passerelle stdio, proxy officiel Java,
  SSE et transport SSH conservés. Console programme : `burp_status`,
  `burp_history`, `burp_save_observation`. L'historique exige un `host` concret
  couvert par les règles et non exclu. Les outils actifs sont refusés côté
  serveur, et Playwright n'est pas chargé dans ce contexte.
- **Validation automatisée réelle de Codex** : `thread/start` éphémère puis
  `mcpServerStatus/list` via l'app-server installé confirment la découverte
  des outils des deux workspaces. Une simple liste globale de l'app-server
  ne charge pas les serveurs du projet, d'où ce contrôle explicite.
- **Serveur simulé** : initialisation MCP, découverte et appels non destructifs,
  transport officiel complet, perte/reconnexion/redémarrage, restrictions,
  User-Agent HTTP/1 et HTTP/2, redaction et préservation du serveur partagé lors
  de la suppression sont testés. Playwright utilise un proxy et une target
  HTTP locale contrôlée, avec redirection étrangère bloquée.
- **Environnement Burp existant, contrôle du 28 octobre 2026** : le proxy
  initialisé répond à `tools/list` avec `tools: []`. La passerelle renvoie
  `INCOMPATIBLE`. **Burp réel n'est pas déclaré opérationnel** : aucune
  invocation réelle n'est possible tant que l'extension n'expose aucun outil.
  Refaire la découverte et un appel `burp_history` non destructif après remise
  à disposition des outils par Burp. Aucun réglage utilisateur n'a été modifié.

Les restrictions programme sont imposées par les passerelles et les instructions.
Comme dans l'architecture existante, le shell Codex avec `--yolo` n'est pas une
barrière réseau générale : un opérateur peut lancer ses propres commandes.
Les tests n'ont déclenché aucune inférence modèle ni scan sur un programme réel.
Le contrôle de suppression crée un véritable historique local avec
`thread/inject_items` et vérifie sa présence puis sa disparition dans l'index
natif, y compris lorsqu'il est masqué dans la liste interactive.

## Validation

Les bases, Redis, workspaces, clés et conteneurs de test sont jetables ; les
services en cours d'utilisation n'ont pas été redéployés. Les images de test
utilisent les dépendances/scanners déjà installés et les artefacts applicatifs
reconstruits. Une reconstruction Docker complète initiale a été interrompue
après contention disque ; les tests ont ensuite été relancés sans cette charge.

| Contrôle | Résultat |
| --- | --- |
| `npm run lint` | Réussi |
| `npx tsc --noEmit` | Réussi |
| `npm run build` | Réussi |
| `TEST_POSTGRES_TMPFS=1 TMPDIR=/dev/shm npm run test:queue` | 613 tests réussis ; 6 tests réseau réservés à la commande suivante |
| `npm run test:network` | 6 tests réussis sur des serveurs HTTP contrôlés |
| `npm run test:migration` via le harness queue | Migration additive et préservation de l'historique réussies |
| `npm run test:auth` sur l'infrastructure jetable | Parcours navigateur, isolation et indisponibilité Redis réussis |
| `tests/research/runInfrastructure.mjs` avec l'image test | Compatibilité SSH/Research historique, MCP passif et persistance réussies |
| `npm run test:research:console` avec les images test | PTY/tmux, Codex, MCP host/programme, suppression simultanée et redémarrage réussis |
| `npm run test:ui` lancé par ce même harness | Création, règles, hosts, doublons, exclusions, édition, RECON par host et navigation historique |

Les scénarios A–E, G et H sont couverts par les tests SQL et navigateur ; F est
validé contre le serveur simulé et la vraie découverte Codex, avec la limite
Burp réel décrite ci-dessus. Le smoke `test:research:final` qui cible directement
le stack configuré n'est pas exécuté sur les données utilisateur.

Les tests ajoutés sont `tests/unit/programWorkflow.test.ts` et
`tests/integration/programWorkflow.test.ts`. Le scénario navigateur utilise aussi
`tests/research/holdProgramRecon.mts` pour un vrai worker et un processus local
inerte, sans trafic vers la target. Le test de shutdown existant exige
maintenant `CLEANUP_UNCONFIRMED` si son cleanup simulé ne termine jamais : il ne
prétend plus confirmer l'arrêt sur la seule expiration du délai.

## Fichiers créés et modifiés

Créés :

- `prisma/migrations/20261028120000_program_workflow/migration.sql`
- `src/server/programDeletion.ts`, `programContext.ts`, `recon/program.ts`
- `src/server/research/terminalKey.ts`, `src/lib/requestOrigin.ts`
- `src/app/api/programs/[id]/context/route.ts`, `recon/route.ts`
- `src/components/ProgramWorkflow.tsx`
- `docker/research/console/stop.mjs`
- `tests/unit/programWorkflow.test.ts`, `tests/integration/programWorkflow.test.ts`
- `tests/research/holdProgramRecon.mts`
- `docs/TARGET-WORKFLOW.md`

Modifiés :

- `prisma/schema.prisma`, `docker-compose.yml`, `docker/research/Dockerfile`
- `src/app/(dashboard)/targets/page.tsx`, `targets/[id]/page.tsx`, `scopes/[id]/page.tsx`
- `src/app/api/programs/route.ts`, `programs/[id]/route.ts`, `programs/[id]/hosts/route.ts`, `targets/route.ts`
- `src/components/ProgramForm.tsx`, `ResearchTerminal.tsx`
- `src/lib/bountyProgram.ts`, `research/consolePolicy.ts`, `research/terminal.ts`
- `src/server/execution.ts`, `programHosts.ts`, `scanners/recon.ts`
- `src/server/queue/scanQueue.ts`, `scanRequest.ts`, `executionAttempts.ts`, `processScan.ts`
- `src/server/research/workspace.ts`, `sessions.ts`, `consoleRules.ts`, `consoleWorkspace.ts`, `terminalTicket.ts`
- `docker/research/console/server.mjs`
- `docker/research/validator/burp-active.mjs`, `burp-service.mjs`, `console-burp-main.mjs`, `console-files.mjs`, `playwright-launch.mjs`, `codex-rpc.mjs`
- `tests/fixtures/research.ts`, `tests/unit/scanWorker.test.ts`
- `tests/queue/runInfrastructure.mjs`, `tests/research/runConsole.mjs`, `runInfrastructure.mjs`
