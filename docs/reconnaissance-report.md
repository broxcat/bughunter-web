# Rapport de reconnaissance

La vue d’un `TargetReconRun` présente un **Rapport de reconnaissance** déterministe avant les détails d’exécution. La Target expose un lien vers le dernier run disponible. Le rapport décrit un seul run identifié; il ne prétend pas consolider silencieusement plusieurs runs.

## Modèle commun

L’interface, le Markdown et le PDF utilisent `ReconReportModel` et sa section versionnée `recon-report/5`. L’organisation est `Target → hôtes → services/origines → observations → preuves`. Les lectures et exports utilisent uniquement les données persistées: aucun scan, appel cible, publication de Finding, notification ou appel IA n’est déclenché. Une ancienne synthèse IA enregistrée peut rester consultable séparément, mais elle n’est pas nécessaire à l’export professionnel.

Les hôtes sont regroupés par nom exact. Les services sont séparés par transport et port; les origines HTTP conservent schéma, hôte et port effectif. Une IP partagée, un certificat, une redirection ou un CNAME ne fusionne pas les inventaires et n’étend jamais l’autorisation.

## États et compteurs

- Découvert: présent dans les preuves du run.
- Autorisé: correspond au périmètre capturé du run.
- Exclu: exclusion capturée ou preuve hors scope.
- Testé: au moins une phase possède un état terminal consigné pour l’hôte.
- Répondant: une réponse HTTP avec code a été observée.
- URL répertoriée: URL observée ou extraite; ce n’est pas nécessairement une réponse HTTP.

Les catégories se recouvrent et ne s’additionnent pas. Un inventaire borné rend les compteurs partiels et les présente comme bornes basses. Une donnée absente devient « non disponible », jamais zéro inventé. Les états de couverture distinguent résultat, non-exécution, non-applicabilité, exclusion, interruption, échec, budget épuisé et indisponibilité.

## Scope historique et actuel

Le rapport utilise les limites capturées au moment du run. Il ne réécrit pas l’histoire à partir du scope actuel. L’admissibilité actuelle doit être vérifiée avant une nouvelle action; les pistes sur un hôte exclu ou non autorisé restent documentaires.

## Preuves, rédaction et priorités

Les faits affichent les identifiants persistés de `ReconArtifact`, `ReconSurfaceObservation` ou `ReconPipelineStep` lorsqu’ils existent. Les tokens, cookies, en-têtes d’autorisation et paramètres sensibles passent par la politique d’expurgation partagée. Les correspondances Nuclei restent des signaux à valider, jamais des vulnérabilités confirmées. Les priorités sont des ordres de travail explicables, pas des sévérités CVSS.

## Exports

- `Exporter Markdown` produit un document autonome, structuré par hôte et origine.
- `Exporter PDF` produit un A4 paginé, rouge et blanc, avec texte noir, sommaire et liens internes.

Les noms de fichiers contiennent une Target normalisée, la date du run et un préfixe d’identifiant. Les filtres de l’interface ne modifient jamais silencieusement les exports: ceux-ci portent toujours sur le run complet sélectionné. Le moteur PDF utilise le Chromium déjà présent dans l’image Docker, bloque toutes les requêtes réseau et n’importe aucune ressource distante.

## Volumes et compatibilité

Le chargement est limité à 400 artefacts par exécution d’hôte. Le rapport signale chaque troncature; les artefacts conservés en base ne sont pas supprimés. Les anciens runs sans détail de phase, type DNS, preuve TLS ou baseline restent consultables avec des formulations explicites. Aucune migration de données n’est nécessaire.

## Validation

Les fixtures synthétiques couvrent notamment plusieurs hôtes, plusieurs ports/origines, CNAME hors scope, IP partagée, URL extraite, route CDN, budget épuisé, historique incomplet, absence de baseline, doublons, données contradictoires, valeurs hostiles, secrets, gros inventaires, autorisation négative et absence de trafic pendant lecture/export. Les PDF de validation sont générés à partir de fixtures locales et rendus en images avant inspection.
