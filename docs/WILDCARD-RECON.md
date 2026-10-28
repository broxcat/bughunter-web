# Correction RECON wildcard

## Causes constatées

Le refus ne venait pas du matcher DNS : il respectait déjà les frontières de
labels et excluait l'apex d'une wildcard. Quatre problèmes se cumulaient :

1. Le lien **Start Recon** de la target menait au sélecteur historique de hosts,
   qui excluait les wildcards. `scanRejection` employait le même refus de host
   concret pour une reconnaissance et pour une interaction active.
2. L'éditeur `/scopes` ajoutait une wildcard dans `Target`/`Scope`, sans l'ajouter
   à `BountyProgram.scopeRules`, lu par le RECON programme.
3. Sous Zod 4, les defaults imbriqués dans `programUpdateSchema.partial()`
   s'appliquaient même aux champs absents. Un PATCH des seules exclusions
   réinitialisait donc `scopeRules` à `[]`. Ce défaut est reproduit puis testé.
4. `subfinder` était installé mais non appelé : le pipeline host le déclarait
   désactivé à cause du User-Agent, et le service programme utilisait seulement
   les certificats. Le trafic fournisseur d'une énumération passive doit être
   distingué des requêtes HTTP envoyées à la target.

## Fonctionnement corrigé

La page target ouvre maintenant ses propres onglets RECON et Codex. Le parcours
historique `/recon` propose aussi le scope programme sans host préalable et
conserve le choix d'un FQDN concret. Un scope technique wildcard peut démarrer
un RECON passif ; sa page n'affiche plus « History — unavailable » simplement
parce qu'il s'agit d'une règle. Sa console est celle du programme parent.

`reconSeeds` normalise les règles et retire uniquement le préfixe initial `*.` :

| Règle officielle | Seed technique |
| --- | --- |
| `*.example.com` | `example.com` |
| `*.api.example.com` | `api.example.com` |
| `api.other.com` | `api.other.com` |
| `*.services.company.net` | `services.company.net` |

Les seeds sont dédupliquées. `example.com` et `*.example.com` produisent un seul
lancement pour cette seed. Les règles originales ne sont jamais remplacées.

Aucun nouveau moteur n'est créé : `runRecon` → `runProgramRecon` utilise les
mêmes `ScanRun`, worker BullMQ, outbox, tentatives, annulation, SSE et persistance.
L'étape ajoutée dans ce service appelle **le wrapper existant `runCommand`** :

```text
subfinder -d example.com -silent -duc -timeout 15 -max-time 1 -rl 5
```

`enforcedToolArgs` reconstruit ces arguments côté serveur et refuse une seed
non déclarée, une wildcard littérale ou des flags supplémentaires. Aucun shell
n'intervient. Aucune résolution active `-active/-nW` n'est activée. Le timeout
du wrapper est 75 secondes ; il supervise le groupe Unix et ses descendants.
Les commandes actives sont refusées dans ce contexte programme.

L'étape de certificats et son parseur existants restent après subfinder, avec
le User-Agent configuré et leurs limites précédentes. Le pipeline concret
discovery HTTP → DNS → httpx → nmap → katana reste disponible pour un FQDN
autorisé. Il n'est pas lancé automatiquement sur les nouveaux hosts.

Le callback `onStdoutLine` traite chaque ligne stdout immédiatement. Une file
séquentielle avec contre-pression évite les écritures concurrentes désordonnées.
Le dernier fragment sans retour à la ligne est aussi traité. Un échec de
persistance arrête le processus et remonte l'erreur ; il n'est pas annoncé comme
un succès. Après annulation ou timeout, les lignes tamponnées ne démarrent plus
d'écriture. Le nettoyage attend l'écriture déjà en cours.

Chaque nom passe par `normalizeFqdn`, le matcher existant, puis les exclusions
prioritaires. `*.example.com` couvre `a.example.com` et `a.b.example.com`, mais
ni `example.com`, ni `notexample.com`, ni `example.com.attacker.net`. Une règle
imbriquée garde sa racine exacte. Les états `VALIDATED`, `EXCLUDED` et
`OUT_OF_SCOPE`, la source `SUBFINDER`, la première découverte et les observations
par run sont conservés dans les modèles existants. « Validated » signifie ici
syntaxe/périmètre validés, pas disponibilité réseau ou vulnérabilité confirmée.

Le verrou programme et les contraintes uniques existantes empêchent les doublons
par programme/host actif et par run/host. La persistance recontrôle aussi le
statut courant du RECON, l'annulation, l'approbation et le propriétaire du scope.
La suppression récupérable bloque toute écriture tardive et arrête les mêmes
processus supervisés. Aucun host n'est recréé après suppression.

L'inventaire `/scopes` continue d'être actualisé sans rechargement complet ; les
logs sont diffusés par SSE. `scope.md` conserve les wildcards, tandis que
`recon/hosts.json` présente les découvertes séparément dans la console existante.

## Migration

`20261028140000_reconcile_wildcard_scope_rules` est une migration **de données**,
sans nouveau modèle, colonne ou index. Elle complète `scopeRules` seulement
depuis des wildcards manuelles actives, approuvées, appartenant au propriétaire
et correspondant exactement à leur Scope. Les découvertes automatiques et
scopes révoqués sont exclus. Elle est idempotente et ne modifie pas les exclusions.

Les ajouts/éditions/retraits ultérieurs de wildcards dans `/scopes` mettent à
jour `scopeRules` dans la même transaction. Les PATCH ne touchent plus les
champs omis. Une règle historiquement effacée sans scope manuel encore présent
ne peut pas être devinée : elle doit être réenregistrée depuis la politique
officielle. Une dérive de snapshot Codex est traitée selon la procédure opérateur
existante de [CODEX-RESEARCH.md](CODEX-RESEARCH.md).

Appliquer les migrations avec `npx prisma migrate deploy`, puis reconstruire et
recréer web/worker pour utiliser la correction. Le stack utilisateur n'a pas été
redéployé pendant les tests.

## Validation

| Commande / contrôle | Résultat |
| --- | --- |
| `npm test` | Tests unitaires réussis ; les suites d'infrastructure restent conditionnelles |
| `TEST_POSTGRES_TMPFS=1 TMPDIR=/dev/shm npm run test:queue` | 645 tests réussis ; PostgreSQL, Redis, worker, migration et tests de régression |
| `npm run test:network` | 6 tests réussis sur HTTP local contrôlé |
| `npm run lint`, `npx tsc --noEmit`, `npm run build` | Réussis |
| `TEST_POSTGRES_TMPFS=1 TMPDIR=/dev/shm npm run test:auth` | Parcours d'authentification et panne Redis réussis |
| `RESEARCH_TEST_APP_IMAGE=bughunter-web:wildcard-test RESEARCH_TEST_RUNNER_IMAGE=bughunter-research:workflow-test npm run test:research:console` | Bouton wildcard sans host, lancement navigateur, persistance, Codex, suppression simultanée et MCP simulé réussis ; exécute aussi `targetWorkflow.mjs` |
| `RESEARCH_TEST_RUNNER_IMAGE=bughunter-research:workflow-test node tests/research/runInfrastructure.mjs` | Compatibilité Research/SSH/MCP historique vérifiée |
| `RESEARCH_TEST_APP_IMAGE=bughunter-web:wildcard-test node tests/recon/runRealTools.mjs` | Vrais outils, vraie queue/DB/Redis, annulation du vrai subfinder et suppression vérifiés |

Les images de validation reprennent les dépendances et binaires installés et
les artefacts applicatifs reconstruits. Les infrastructures et volumes sont
jetables. Les mocks restent limités aux tests automatisés déterministes ; le
harness `tests/recon` n'utilise aucun mock de scanner ou de fournisseur.

Exécutables réels vérifiés : **subfinder 2.17.0, nmap 7.93, httpx 1.12.0 et
katana 1.8.0**. La vraie énumération de `*.example.com` utilise `example.com` et
persiste les résultats pendant `RUNNING`, sans lancer de scan actif sur ces
découvertes. La limite de 10 000 observations est atteinte : le résultat reste
explicitement **PARTIAL**, avec 9 997 hosts autorisés lors du dernier contrôle relevé.
Ce n'est pas une couverture exhaustive. Les résultats d'un fournisseur public
peuvent varier entre exécutions.

Sur `fixture.recon.test`, strictement local au réseau Docker jetable, les étapes
**httpx, nmap et katana se terminent toutes**. Les cinq requêtes HTTP observées
portent `laziza`. Le résultat global est **PARTIAL** parce que la résolution DNS
ANY de cette fixture échoue ; cette limite d'environnement est conservée dans
les résultats et n'est pas masquée. Les autres binaires installés mais absents
du pipeline RECON ne sont pas utilisés arbitrairement pour des scans.

La découverte des outils MCP par Codex et les appels via le proxy officiel sont
vérifiés sur le serveur Burp simulé, depuis les contextes host/programme. Le
contrôle réel du proxy Burp existant retourne toujours **zéro outil** le 28 octobre
2026 : état **INCOMPATIBLE**, aucune prétention de réparation de Burp dans cette
mission et aucune invocation réelle possible dans cet état. Aucune inférence
modèle ni exploitation distante n'a été lancée.

Les tests couvrent A–J : wildcard seule, résultats subfinder, doublons/casse/point
final, hors scope, exclusions, wildcard imbriquée, scopes mixtes et seeds uniques,
arrivée incrémentale, annulation/suppression avec arrivée tardive, et FQDN concret.
Ils vérifient aussi le PATCH sans effacement des règles et la migration répétée.

## Fichiers

Créés :

- `prisma/migrations/20261028140000_reconcile_wildcard_scope_rules/migration.sql`
- `tests/unit/wildcardRecon.test.ts`
- `tests/recon/realTools.mts`, `tests/recon/runRealTools.mjs`
- `docs/WILDCARD-RECON.md`

Modifiés :

- `src/lib/bountyProgram.ts` ; `src/server/execution.ts`, `programHosts.ts`
- `src/server/recon/program.ts`, `src/server/scanners/recon.ts`, `runCommand.ts`, `toolPolicy.ts`
- `src/server/queue/processScan.ts`
- `src/app/api/scan-runs/route.ts`, `scan-hosts/route.ts`, `targets/[id]/route.ts`, `programs/[id]/recon/route.ts`
- `src/components/ScanStart.tsx`, `ProgramWorkflow.tsx`
- `src/app/(dashboard)/targets/[id]/page.tsx`, `hosts/[id]/page.tsx`
- `tests/unit/bountyProgram.test.ts`, `execution.test.ts`, `recon.test.ts`, `runCommand.test.ts`, `scanWorker.test.ts`
- `tests/integration/apiRoutes.test.ts`, `programWorkflow.test.ts`
- `tests/e2e/targetWorkflow.mjs`, `tests/research/runConsole.mjs`
- `docs/TARGET-WORKFLOW.md`
