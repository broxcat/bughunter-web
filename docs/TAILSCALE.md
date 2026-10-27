# BugHunter : identité Tailscale dédiée

Segmentation validée le 26 octobre 2026 depuis le serveur connecté au tailnet,
avec curl, TLS vérifié, sondes TCP bornées et Chromium/Playwright réel.

```text
TAILNET → 100.87.169.83 → bughunter-web.tailc6d37b.ts.net:443
        → tailscale-bughunter → tailscale_frontend → web:3000
Recon/Hunt → Policy Engine → Execution Gateway → cible autorisée
```

`AUTH_URL` local est `https://bughunter-web.tailc6d37b.ts.net`.
Le port 3000 de web est exclusivement interne Docker. Le frontend contient
uniquement web et le sidecar. Web conserve le réseau default et sa priorité
de passerelle ; les réseaux et routes du worker/gateway/runner sont conservés.
Le sidecar userspace ne monte ni TUN, ni socket Docker, ni state Tailscale hôte ;
capabilities supprimées, no-new-privileges, aucune route annoncée/acceptée,
aucun exit node ou proxy sortant. SSH Tailscale et Funnel sont désactivés.

## Résultats réels

| Vérification | Résultat |
| --- | --- |
| `tailscale status`, `tailscale ip` dans le sidecar | Running/Online, version 1.104.2 ; `100.87.169.83` ; hostname `bughunter-web` ; tag `tag:bughunter` |
| DNS de la machine | `bughunter-web.tailc6d37b.ts.net` |
| `tailscale serve status --json` | Uniquement HTTPS TCP 443 et handler `/` vers `http://web:3000` ; aucune entrée Funnel |
| Certificat | Chaîne et hostname vérifiés sans contournement TLS ; expiration 24 janvier 2027, 17:27:32 UTC |
| Accès HTTPS FQDN | HTTP 200 ; `/api/health` : status ok, DB et Redis up |
| Accès via IP dédiée | HTTPS valide en se connectant à `100.87.169.83:443` avec SNI/Host du FQDN (curl `--resolve`) |
| Page login | Chargée dans Chromium via HTTPS |
| Auth.js réel | Login, session authentifiée, logout, session null, page protégée refusée, reconnexion puis logout : réussis après bascule et après fermeture du port hôte |
| Cookies | Secure, HttpOnly, SameSite=Lax et domaine du FQDN vérifiés sans afficher leurs valeurs |
| Persistance | Même device ID, IP, DNS, hostname et tag après recréation du seul sidecar ; clé de provisioning locale vidée |
| Publication hôte | Aucun binding Docker pour web, aucun listener TCP hôte sur 3000, IPv4/IPv6 |
| Ancienne IP hôte | `100.121.43.68:3000` inaccessible |
| LAN et loopback | `192.168.0.120:3000`, `127.0.0.1:3000` et `[::1]:3000` inaccessibles |
| IP dédiée : ports autorisés | 443 ouvert |
| IP dédiée : ports refusés | 22, 80, 3000, 5432, 6379, 2375, 2376, 8080, 8089, 9000, 9002, 11434 fermés/filtrés |
| Services internes | Aucun mapping Serve vers DB, Redis, worker, Ollama, runtime, gateway, runner ou socket Docker ; sidecar uniquement sur frontend |
| Hôte Tailscale | Même device ID, hostname `b550-gaming-x-v2`, DNS, IP `100.121.43.68`, Running/Online avant/après ; daemon non modifié |
| Autres projets/services | 28 autres conteneurs : mêmes IDs, heures de démarrage et configurations réseau avant/après ; Ollama non modifié |

Le premier test navigateur après recréation de web a expiré après le login.
Les cycles complets suivants ont réussi, dont celui après la dernière recréation
du sidecar. Aucun contournement Auth.js n'a été ajouté. Les comptes de
vérification jetables ont été supprimés ; aucun scan Recon/Hunt n'a été lancé.

Un contrôle a détecté l'accès tailnet au listener de healthcheck HTTP 9002,
malgré son bind loopback dans le sidecar userspace. Les paramètres activant ce
listener ont été retirés. Le healthcheck utilise désormais la CLI via socket
Unix et le backend web. Le port 9002 a été revérifié inaccessible après
recréation. Les sondes portent sur les ports listés, pas sur un balayage exhaustif.
Les essais ont utilisé le nœud hôte comme client tailnet ; une seconde identité
cliente et les restrictions de Grants par utilisateur n'ont pas été testées.

## Exploitation

```sh
docker compose config --quiet
docker compose --profile tailscale config --quiet
python3 scripts/verify-tailscale-config.py
docker compose --profile tailscale up -d --no-deps tailscale-bughunter
docker compose exec -T tailscale-bughunter tailscale status
docker compose exec -T tailscale-bughunter tailscale ip
docker compose exec -T tailscale-bughunter tailscale serve status
curl --fail --show-error --max-time 15 \
  --resolve bughunter-web.tailc6d37b.ts.net:443:100.87.169.83 \
  https://bughunter-web.tailc6d37b.ts.net/api/health
npx vitest run tests/integration/authOrigin.test.ts
git diff --check
```

Une URL HTTPS avec l'IP littérale ne correspond pas au certificat DNS : utiliser
le FQDN, ou `--resolve` pour joindre explicitement l'IP avec le SNI correct.
Ne pas réexposer 3000 pour permettre cet accès.

Conserver le volume `tailscale-bughunter-state` : il contient l'identité et des
secrets. Ne jamais le committer, le supprimer ni utiliser `down -v`,
`--remove-orphans` ou `tailscale logout`. Le profil `tailscale` doit être
explicitement activé pour gérer ce service ; ne pas faire de `up` global.
Les services execution-gateway et secure-runner existants sont préservés même
s'ils ne figurent pas dans le Compose actuel. OOB garde sa publication hôte
historique 8089, distincte de l'identité dédiée.

Le secret de provisioning a été retiré de `.env`, sans affichage. Sa révocation
éventuelle dans la console reste une opération d'administration distincte.
Les applications masquent cette variable dans leur environnement Compose.
Ne jamais afficher `docker compose config` résolu sans filtrage : il contient
d'autres secrets applicatifs. `.env` ne doit pas être suivi par Git.

Pour provisionner une nouvelle installation, autoriser `tag:bughunter` dans
`tagOwners`, accorder TCP 443 aux seuls utilisateurs souhaités et utiliser une
clé dédiée non éphémère à usage unique, fournie localement puis retirée après
enrôlement. Les Grants sont additifs : une autorisation globale existante peut
accorder davantage d'accès ; ce déploiement ne modifie pas la policy du tailnet.

En cas d'incident, corriger d'abord le backend ou Serve par opérations ciblées.
Un retour arrière d'urgence peut rétablir la publication web `3000:3000` et
l'ancienne origine Auth.js avec recréation de web seulement ; cela rouvre
l'accès hôte et doit être une décision explicite de l'opérateur. Remettre alors
`TRUST_PROXY_HEADERS=false` avant de recréer web.

## Confiance des headers pour les quotas

La configuration fournie ne publie pas le port web sur l'hôte. Serve 1.104.2
[remplace X-Forwarded-For par l'adresse source de la connexion](https://github.com/tailscale/tailscale/blob/v1.104.2/ipn/ipnlocal/serve.go#L1014-L1021),
et non par une valeur déclarée par le client. Ce chemin à un proxy est compatible
avec `TRUST_PROXY_HEADERS=true` et `TRUSTED_PROXY_HOPS=1`. Ces paramètres ne sont
jamais activés automatiquement par AUTH_URL ni par le profil Tailscale.

Avant de les activer, garantir que **tous** les accès non fiables passent par
Serve : absence de publication hôte, aucun proxy alternatif ni accès direct à
web:3000. Le réseau Docker `default` relie aussi web aux services internes :
ces conteneurs et les administrateurs Docker appartiennent à la frontière de
confiance. Le réseau frontend seul ne garantit donc pas l'exclusivité de Serve.
Après changement de topologie/version, revérifier la réécriture et le nombre de
proxies. Par défaut, `TRUST_PROXY_HEADERS=false` ignore XFF/X-Real-IP et applique
un quota IP partagé `unknown`, sans possibilité de le fragmenter avec ces headers.
En mode trusted, une chaîne absente/invalide refuse login et inscription (503),
sans ouvrir un second quota `unknown`. Les headers d'identité Tailscale ne remplacent pas l'authentification BugHunter.
