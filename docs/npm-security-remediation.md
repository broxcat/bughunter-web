# Remédiation npm — GHSA-ggr8-5vv4-36mx

Analyse et vérifications locales du 28 octobre 2026.

## 1. Diagnostic initial

L'audit complet initial signale **3 HIGH**, pour **une seule vulnérabilité** :

```text
prisma@6.19.3
└── @prisma/config@6.19.3
    └── deepmerge-ts@7.1.5 (<8.0.0)
```

Les deux autres alertes sont les conséquences transitives de celle de `deepmerge-ts`.
Les contraintes directes `prisma` et `@prisma/client` sont toutes deux `^6.19.3`.
`@prisma/config@6.19.3` impose exactement `deepmerge-ts@7.1.5`.
Le second lockfile, dans `docker/research/validator`, ne contient ni Prisma ni deepmerge-ts.

L'[avis officiel](https://github.com/advisories/GHSA-ggr8-5vv4-36mx)
décrit un épuisement de pile lors de fusions de graphes d'objets récursifs.
Du JSON seul ne représente pas les références circulaires nécessaires.
Le projet n'importe directement ni `deepmerge-ts`, ni `prisma/config` dans son application.
Le seul consommateur trouvé est le chargeur CLI `@prisma/config`, qui passe `deepmerge`
à c12. Aucun fichier `prisma.config.*` n'est présent : le projet utilise le schéma,
`DATABASE_URL`, `prisma-client-js` et le moteur PostgreSQL Prisma 6.
L'examen du code ne révèle donc pas de chemin HTTP permettant de fournir de tels
graphes au merger. Cela réduit l'exposition constatée, sans justifier de conserver
la dépendance vulnérable. Le CLI est aussi livré dans l'image de production.

## 2. Stratégies comparées et solution retenue

| Option | Constat vérifié | Décision |
|---|---|---|
| A — Version compatible Prisma 6 | Le registre npm ne publie aucune version stable 6 au-delà de 6.19.3 ; cette version dépend toujours de deepmerge-ts 7.1.5. | Aucun correctif disponible dans la majeure actuelle. |
| B — Override ciblé | deepmerge-ts 8.0.2 est corrigé et reste compatible avec les usages constatés du chargeur ; tests du chargeur réel avant/après. | Retenu : surface de changement minimale. |
| C — Prisma 7.10.1 | Correctif officiel publié, mais migration du client, de sa configuration et de la connexion. | Inutile pour cette correction ciblée. |

La [mise à jour Prisma en amont](https://github.com/prisma/orm/pull/30189)
adopte elle-même **deepmerge-ts 8.0.2**. Les [breaking changes de deepmerge-ts 8](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0)
concernent notamment les Maps, `deepmergeInto` et certains types de personnalisation.
Le chargeur installé appelle seulement `deepmerge` sur ses objets de configuration ;
il n'utilise pas ces API. Les exports CommonJS et ESM subsistent.
La version 8.0.2 requiert Node >=16.9 ; le projet utilise Node 22 en CI/Docker et
Node 24.21.0 sur le poste de validation.

Le [guide officiel Prisma 7](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7)
documente Node >=20.19, TypeScript >=5.4, ESM, la configuration explicite du CLI
et de l'environnement, la génération du client et les adapters obligatoires pour
les connexions directes. Avec PostgreSQL, migrer impliquerait notamment de revoir
le singleton, les constructeurs utilisés par les tests/scripts, le driver et ses
réglages de pool/SSL, ainsi que les commandes de migration. Cette surface dépasse
le besoin alors que l'override est vérifiable.

L'override est limité à `@prisma/config@6.19.3` et épingle `deepmerge-ts` à `8.0.2`.
Prisma, son client, les engines et l'adapter Auth.js restent inchangés.
À la prochaine mise à jour Prisma, réévaluer cet override et le retirer lorsque
la dépendance amont est corrigée ; son périmètre versionné évite de l'appliquer
silencieusement à une autre version du chargeur.

## 3. Matrice d'impact établie avant correction

| Composant | Chemins réellement présents | Contrôles retenus |
|---|---|---|
| Recon | Routes programmes/scan-runs, `recon/program.ts`, scanners, corpus, stream, annulation | Création, lancement, progression, découvertes incrémentales, résultats, annulation et consultation ; tests unitaires et PostgreSQL. |
| Hunt / Codex | Hunt historique en lecture seule ; sessions Research et console persistante par cible | Contrats historiques, contexte Recon, sessions, tickets, reconnexion, interruption, stockage et redémarrage local. Aucun ancien moteur Hunt à relancer. |
| API | `src/app/api`, auth, validation Zod et gestion des erreurs | Routes, statuts, accès propriétaire, origine, réponses et données persistées. |
| Base de données | Singleton `src/lib/prisma.ts`, transactions, relations et 22 migrations SQL | Schéma, génération, migrations sur bases neuves, upgrade avec données historiques, contraintes et transactions. |
| Pipelines | Outbox PostgreSQL, dispatcher et workers BullMQ | Livraison, idempotence, concurrence, rollback, pannes Redis, arrêt et récupération sans replay implicite. |
| Workflows | Programmes/hosts, états de scan et Research, hypothèses, Evidence Review, rapports | Transitions, reprises et conservation des identités/données ; tests SQL et navigateur. |
| Frontend | App Router, pages Recon/Research/Hunt et composants | Build et parcours Chromium sur application isolée. |
| CI/CD | `.github/workflows/ci.yml`, Dockerfile Node 22, génération avant build | Installation reproductible, génération, typecheck, lint, tests et build ; image locale de validation. Aucun déploiement. |

## 4. Fichiers modifiés

- `package.json` : seul ajout fonctionnel, l'override versionné.
- `package-lock.json` : seule entrée de paquet changée, deepmerge-ts 7.1.5 → 8.0.2
  (tarball, intégrité, engine Node et métadonnées de financement).
- `tests/unit/prismaConfig.test.ts` : sept tests du vrai chargeur Prisma/c12,
  sans mock, et du merger résolu depuis `@prisma/config` : defaults sans config,
  CommonJS/ESM/TypeScript, chemins et objets imbriqués, erreurs, absence de
  chargement implicite de `.env`, précédence/arrays/undefined/callbacks et absence
  de mutation des entrées. Les sept passent avant et après l'override.
- Ce rapport : justification, matrice, résultats et limites de validation.

Schéma, migrations, code applicatif, auth, scope, secrets et fichiers d'environnement
réels ne sont pas modifiés. L'état Git était propre au début de la mission.

## 5. Tests et résultats

| Commande / scénario | Baseline | Après correction |
|---|---|---|
| `npm audit --json` | FAIL attendu : 3 HIGH, une seule GHSA | PASS : 0 vulnérabilité, toutes sévérités confondues |
| `npm ls prisma @prisma/client @prisma/config deepmerge-ts` | PASS : Prisma/config/client 6.19.3, merger 7.1.5 | PASS : Prisma/config/client inchangés, merger 8.0.2, override reconnu |
| `npm outdated` | PASS diagnostic : Wanted Prisma/client 6.19.3 ; Latest client 7.10.1, Prisma 8.0.0-rc.28 | NON TESTÉ à nouveau : aucune autre dépendance n'a été mise à jour |
| `npx prisma --version` | PASS : CLI/client 6.19.3, Node 24.21.0, TS 5.9.3 | Versions CLI/client et engines conservées, vérifiées dans l'arbre et la génération |
| `npm ci` | NON TESTÉ avant correction | PASS : installation complète, lockfile cohérent, audit intégré à zéro |
| `npx prisma validate` | PASS | PASS |
| `npx prisma generate` | PASS | PASS : client 6.19.3 |
| `npm run lint` | PASS | PASS sur Node 24 et Node 22 |
| `npm run typecheck` | PASS | PASS sur Node 24 et Node 22 |
| `npm run build` | PASS | PASS sur Node 24 et dans l'image de validation Node 22 |
| `npm test` sans infrastructure | PASS : 542 tests, 145 ignorés | PASS : 549 tests, 145 ignorés |
| `npx vitest run tests/unit/prismaConfig.test.ts` | PASS : 7, ajoutés puis exécutés sur 7.1.5 avant l'override | PASS : mêmes 7 sur 8.0.2, Node 24 et Node 22 |
| `npm run test:queue` (PostgreSQL/Redis jetables) | PASS : 681 tests, 6 ignorés ; migration d'upgrade réussie | Voir exécution complète ci-dessous |
| `npm run test:queue -- --research-browser --auth-browser` | PASS : 688 tests (dont les 7 nouveaux avant override), 6 ignorés, migration et navigateurs | PASS après relance : 688 tests, 6 ignorés, migration et navigateurs |
| `npm run test:migration` appelé par le harnais queue | PASS : upgrade avec données historiques préservées | PASS : identités, relations, montants décimaux et historique Hunt/Research préservés |
| Navigateurs Research et auth appelés par le harnais queue | PASS | PASS : export/ZIP, hypothèses, contrôles, promotion humaine, rapports, Hunt historique, login/inscription, quotas et panne Redis |
| `npm run test:research:console` | PASS avec l'image applicative initiale (merger 7.1.5 vérifié) | PASS avec `RESEARCH_TEST_APP_IMAGE=bughunter-npm-remediation:validation` : vrai xterm/PTY/tmux/Codex, tickets, refresh, cibles distinctes, interruption, clipboard, contexte/inventaire, redémarrage et parcours Target/Recon ; services externes doublés localement |
| Build Docker local de validation | NON TESTÉ | PASS : dérivé de l'image locale existante, sources courantes recopiées, `npm ci --include=dev`, génération et build neufs sous Node 22.23.4 |
| `npm audit` final, sans exclusion | 3 HIGH confirmés par JSON | PASS : `found 0 vulnerabilities` |
| `git diff --check` et comparaison structurelle des lockfiles | Arbre propre au départ | PASS : une seule entrée de paquet changée, `node_modules/deepmerge-ts` |
| Six tests spécialisés `SCANNER_HTTP_TESTS` / `npm run test:network` | NON TESTÉ | NON TESTÉ : exécution des outils externes hors du chemin de configuration modifié |
| Inférence distante Codex et véritable Burp externe | NON TESTÉ | NON TESTÉ : services externes non sollicités ; doubles locaux explicitement identifiés |
| `test:research:final` sur la stack configurée, déploiement et CI GitHub distante | NON TESTÉ | NON TESTÉ : aucun accès aux données de la stack en service, aucun déploiement ; contrôles locaux de CI effectués |

Un essai intermédiaire de la suite SQL a échoué dans `programWorkflow.test.ts`
avec **P1002**, attente de 10 secondes dépassée sur `pg_advisory_lock(72707369)`,
pendant la construction parallèle de l'image. La même commande, sur de nouveaux
conteneurs jetables après cette construction, passe sans modifier le code ni
désactiver le verrouillage. Cet échec est conservé comme incident de validation,
pas présenté comme une réussite. La baseline n'avait pas d'échec de test.
Un premier lancement du harnais console pendant la réinstallation a également
échoué sur un module momentanément absent ; rejoué après installation, il passe.

Les harnais provisionnent et nettoient exclusivement leurs propres bases,
conteneurs et volumes temporaires. Aucune migration n'a été appliquée à la base
configurée de l'application. L'image de validation reste locale et ne remplace
pas les tags/services de production.

## 6. Risques résiduels et vulnérabilités restantes

Le changement de majeure de deepmerge-ts modifie les usages Maps et les API de
personnalisation citées plus haut. Ils ne figurent pas dans le chemin Prisma
examiné ; leur introduction future nécessite une nouvelle revue.
L'override déroge au pin déclaré par Prisma 6 : sa compatibilité repose sur
l'examen des API et les tests, pas sur une garantie de maintenance de Prisma 6.

Les tests de console utilisent le vrai navigateur, PTY/tmux et CLI Codex, avec
des données et services locaux contrôlés. Ils ne prouvent pas le fonctionnement
d'une inférence Codex distante ni d'une instance Burp officielle externe.
Les scanners externes et leurs dépendances Go ne sont pas couverts par npm audit.

L'audit npm complet final retourne **0 vulnérabilité** : info 0, low 0,
moderate 0, high 0, critical 0. Les trois alertes initiales et la GHSA ont disparu
du graphe résolu. Aucun filtre d'audit ni exclusion de dépendance n'a été ajouté.

## 7. Verdict

**PARTIELLEMENT VALIDÉ** : vulnérabilité corrigée, installation reproductible et
tous les contrôles locaux retenus réussis, dont SQL/migrations, navigateurs et
console persistante. La réserve porte sur les six tests de scanners externes,
l'inférence Codex distante et Burp externe, non testés. Aucune régression n'a été
observée dans les parcours exécutés ; l'absence de régression sur l'ensemble des
parcours distants ne peut pas être affirmée.
