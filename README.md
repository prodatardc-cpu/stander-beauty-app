# Stander Beauty

Application de gestion de salon : `salon-app-backend` (API Express + Sequelize + PostgreSQL) et
`salon-app-web` (React + Vite, déployable sur Vercel).

## Démarrage local

Prérequis : Node.js ≥ 20.19 (≥ 22.18 pour `npm test` côté web ; testé avec 24.19), PostgreSQL ≥ 13.

```bash
# API
cd salon-app-backend
cp .env.example .env      # puis remplir les valeurs
npm install
npm run dev               # applique les migrations en attente, puis écoute sur http://localhost:3000

# Application web (autre terminal)
cd salon-app-web
npm install
npm run dev               # http://localhost:5173, appelle http://localhost:3000/api par défaut
```

Au premier démarrage, l'API crée le compte administrateur à partir de `INITIAL_ADMIN_EMAIL` et
`INITIAL_ADMIN_PASSWORD` ; retirez ensuite ces deux variables. Mot de passe administrateur perdu :
`npm run admin:reset-password` (dans un terminal interactif).

## Variables d'environnement

Backend (`salon-app-backend/.env`, voir `.env.example`) :

| Variable | Obligatoire | Rôle |
| --- | --- | --- |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | oui | Connexion PostgreSQL |
| `JWT_SECRET` | oui | Signature des jetons ; ≥ 32 caractères aléatoires en production |
| `NODE_ENV` | en production | `production` active les contrôles stricts au démarrage |
| `CORS_ORIGIN` | en production | Origine(s) exacte(s) du site web, séparées par des virgules, en https |
| `TRUST_PROXY` | derrière un proxy | Nombre de proxys (souvent `1`) : sans lui, la limitation des connexions voit l'adresse du proxy |
| `JWT_EXPIRE` | non (`12h`) | Durée de vie d'un jeton |
| `SESSION_MAX_DAYS` | non (`7`) | Reconnexion obligatoire au-delà, même si le jeton a été renouvelé |
| `DB_AUTO_MIGRATE` | non | `true` par défaut hors production, `false` en production |
| `PORT` | non (`3000`) | Port d'écoute |
| `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD` | premier démarrage | Création du compte administrateur |
| `TEST_DB_NAME` | non | Base des tests (défaut `<DB_NAME>_test`) |

Web (`salon-app-web/.env` en local, variables du projet sur Vercel) :

| Variable | Obligatoire | Rôle |
| --- | --- | --- |
| `VITE_API_URL` | pour tout build | URL publique de l'API, en https (ou chemin `/api` si l'hébergeur la relaie). Figée au build : redéployer après modification. Le build échoue si elle manque, n'est pas en https ou désigne localhost. |
| `VITE_ALLOW_LOCAL_API` | non | `true` uniquement pour prévisualiser un build sur ce poste avec l'API locale |

## Base de données et migrations

Le schéma est géré par des migrations versionnées (`salon-app-backend/src/db/migrations.ts`),
appliquées une seule fois chacune, dans une transaction, sous verrou PostgreSQL, et enregistrées
dans la table `schema_migrations`. L'API ne modifie plus le schéma implicitement.

- `npm run db:migrate` : applique les migrations en attente (code compilé, après `npm run build`).
- `npm run db:migrate:dev` : idem depuis les sources ; `-- --status` liste celles en attente.
- En production, l'API refuse de démarrer s'il reste des migrations (sauf `DB_AUTO_MIGRATE=true`).

Toute évolution du schéma passe par une nouvelle migration ajoutée en fin de liste ; ne jamais
modifier une migration déjà appliquée.

Disponibilité : `GET /api/health` répond tant que le processus tourne (sonde de vie) ;
`GET /api/health/ready` vérifie que la base répond réellement (503 sinon).

## Tests et contrôles

```bash
cd salon-app-backend
npm run typecheck && npm test && npm run build && npm audit --omit=dev

cd ../salon-app-web
npm test && npm run lint && npm audit --omit=dev
VITE_API_URL=https://api.example.com/api npm run build
# PowerShell : $env:VITE_API_URL='https://api.example.com/api'; npm run build
```

Les tests backend utilisent une base PostgreSQL dédiée (`<DB_NAME>_test`, créée si besoin avec les
identifiants du `.env`) et refusent toute base dont le nom ne finit pas par `_test`.

## Rôles et permissions

Appliquées par l'API (`salon-app-backend/src/config/permissions.ts`) ; l'interface masque seulement
les actions non autorisées.

| Action | Administrateur | Caisse | Équipe |
| --- | :---: | :---: | :---: |
| Encaisser, dépenses (saisie), clients et rendez-vous | ✓ | ✓ | ✓ |
| Consulter catalogue, équipe, ventes, rapports | ✓ | ✓ | ✓ |
| Enregistrer les présences | ✓ | ✓ | lecture |
| Clôturer la journée | ✓ | ✓ | — |
| Commissions et rapport d'un membre | tous | sa fiche liée | sa fiche liée |
| Payer les commissions | ✓ | — | — |
| Archiver/restaurer un client, modifier ses points fidélité | ✓ | — | — |
| Catalogue, équipe, comptes, annulations de vente, suppression de dépenses, clôture d'exercice | ✓ | — | — |

Un accès « Caisse » ou « Équipe » voit ses propres commissions une fois relié à sa fiche de
l'équipe (Paramètres → Comptes utilisateurs → Fiche équipe).

## Données financières

- Un client ou un membre de l'équipe qui a un historique (ventes, commissions, présences,
  rendez-vous) est archivé, jamais supprimé ; la suppression définitive n'a lieu que sans aucun
  historique, dans une transaction. La base refuse aussi ces suppressions (`ON DELETE RESTRICT`).
- Le paiement des commissions est transactionnel, verrouillé par membre et idempotent (en-tête
  `Idempotency-Key`) ; chaque règlement est tracé dans `commission_payments`.

## Limites connues

- Le jeton de session est conservé dans le `localStorage` : une faille XSS permettrait de le lire.
  Atténuations : durée de vie courte, plafond de session, révocation (`authVersion`), CSP stricte
  sur Vercel. Passer à un cookie `HttpOnly` suppose que l'API et le site partagent un domaine.
- La limitation des tentatives de connexion est en mémoire : propre à chaque instance de l'API,
  remise à zéro au redémarrage.
- Les totaux de commissions additionnent les montants USD et CDF sans conversion.
