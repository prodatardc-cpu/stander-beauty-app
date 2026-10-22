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
npm run dev               # applique les migrations en attente, puis écoute sur http://localhost:3000 (redémarre à chaque modification)

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

| Action | Administrateur | Caisse | Équipe | Observateur |
| --- | :---: | :---: | :---: | :---: |
| Encaisser, encaisser une dette, dépenses (saisie), clients et rendez-vous | ✓ | ✓ | ✓ | lecture |
| Consulter catalogue, équipe, ventes, reçus, rapports des ventes et des dettes | ✓ | ✓ | ✓ | ✓ |
| Enregistrer les présences | ✓ | ✓ | lecture | lecture |
| Historique journalier, rapport de caisse, entrées/sorties et comptage de caisse | ✓ | ✓ | — | lecture |
| Clôturer la journée | ✓ | ✓ | — | — |
| Fiche de rémunération d'un membre (prestations, commissions, versements) | tous | sa fiche liée | sa fiche liée | tous (lecture) |
| Rapport de l'équipe, payer une rémunération ou une avance | ✓ | — | — | rapport (lecture) |
| Mouvements de stock d'un produit | ✓ | — | — | lecture |
| Archiver/restaurer un client, modifier ses points fidélité | ✓ | — | — | — |
| Catalogue, équipe, comptes, annulations de vente et de dépense, clôture d'exercice | ✓ | — | — | — |
| Devise de base, taux USD/CDF, coordonnées de l'établissement, période de rémunération | ✓ | lecture | lecture | lecture |

Un accès « Caisse » ou « Équipe » voit sa propre fiche de rémunération une fois relié à sa fiche de
l'équipe (Paramètres → Comptes utilisateurs → Fiche équipe).

Un accès « Observateur » (rôle `viewer`) lit tout ce que lit l'administrateur et n'écrit rien : l'API
refuse avec 403 « Read-only account » toute requête autre que GET/HEAD, sauf le changement de son
propre mot de passe et « se déconnecter partout ». Il sert à l'application mobile
« Stander Beauty – Suivi » (dépôt `Stander-beauty-app-mobile`).

## Temps réel

L'API diffuse chaque modification enregistrée (vente, dépense, rendez-vous, stock, caisse, paie,
clôture, paramètres…) par Socket.IO sur le même serveur (`/socket.io`, jeton JWT dans
`auth.token`), une fois la transaction validée. Chaque compte ne reçoit que ce qu'il a le droit de
lire. Les événements sont gardés en mémoire (200 derniers) et dans la table `activity_events`
(90 jours) ; `GET /api/activity?since=<date ISO>` permet de rattraper ceux manqués. Les réponses des
routes existantes sont inchangées. Derrière un proxy, autoriser les WebSockets (en-têtes `Upgrade`).

## Données financières

- **Devises : jamais de conversion cachée.** Chaque vente, paiement, dette, remboursement, commission,
  versement à l'équipe, dépense et mouvement de caisse garde sa devise. Les totaux (caisse, rapports,
  historique, clôtures, rémunérations) sont toujours présentés **par devise**, jamais additionnés, et
  aucun montant n'est affiché « converti » dans l'autre devise. Les seules conversions sont explicites :
  le caissier choisit d'encaisser dans l'autre devise que celle du catalogue (le taux du salon est
  affiché sur chaque ligne et enregistré sur la vente), ou l'administrateur change la devise de base
  (les prix du catalogue, salaires et totaux clients sont alors convertis au taux affiché, après
  confirmation).
- La devise de base et le taux USD/CDF sont des réglages du salon (`GET/PUT /api/settings`), partagés
  par tous les postes. L'API calcule elle-même les prix d'une vente (arrondis au centime ou au franc)
  et la refuse (409) si le total affiché par la caisse ne correspond plus.
- **Reçus.** Chaque vente reçoit un numéro de reçu séquentiel. Le reçu reprend le logo et les
  coordonnées de l'établissement (Paramètres → Établissement : nom, e-mail, téléphone, n° d'impôt,
  adresse), les lignes avec le nom et le prix au moment de la vente, la remise éventuelle, le total, les
  paiements, le reste dû, le mode de paiement et la devise ; il s'imprime ou s'enregistre en PDF.
- **Annulation d'une vente** (`POST /api/sales/:id/cancel`, motif facultatif) : dans une transaction, le
  stock est rétabli, la commission est marquée annulée (conservée), le total du client est corrigé, la
  vente garde ses lignes et paiements avec la date, l'auteur et le motif. Elle ne compte plus dans aucun
  total (encaissé, caisse, chiffre d'affaires, journal de caisse), comme si elle n'avait pas eu lieu.
  Elle reste visible 7 jours après l'annulation (Ventes → Annulées, détail de la journée dans
  l'Historique), puis n'est plus affichée ; elle est conservée en base. Une seconde annulation est
  refusée (409).
- **Dettes.** Un paiement partiel laisse un reste dû ; chaque règlement ultérieur
  (`POST /api/sales/:id/payments`, idempotent) est tracé dans `sale_payments`, dans la devise de la vente.
- **Prix à la caisse.** Le caissier choisit une prestation dans la liste ; son prix catalogue est
  prérempli et peut être modifié (avant l'ajout ou dans le panier). Le prix catalogue d'origine reste
  enregistré sur la ligne (`catalogUnitPrice`) ; la commission porte sur le prix réellement facturé.
- **Produits.** Photo choisie ou prise sur l'appareil (compressée, sans photo : logo du salon). Un produit
  épuisé déclenche une alerte rouge affichée sur toutes les pages.
- **Journal de caisse.** Il est calculé à partir des opérations elles-mêmes (encaissements, règlements de
  dettes, dépenses et leurs annulations, rémunérations, entrées/sorties manuelles) ;
  le comptage de la caisse compare les espèces comptées au solde théorique des opérations en espèces
  du jour. Une dépense saisie par erreur est annulée, jamais effacée.
- **Bénéfice estimé** = chiffre d'affaires − coût d'achat des produits vendus (enregistré à la vente) −
  commissions acquises − dépenses − salaires fixes versés. Il est affiché « non calculable » quand une
  ancienne vente de produit n'a pas de coût enregistré.
- **Rémunérations.** Commission = montant des prestations attribuées × taux du membre (40 % par
  défaut, réglable par membre), dans la devise de chaque prestation. Les avances et paiements
  (`POST /api/payroll/:staffId/payouts`, idempotents, verrouillés par membre) sont déduits une seule
  fois : reste à payer = acquis − avances − paiements, par devise. Il revient à zéro quand tout est
  payé ; un impayé passe à la période suivante (hebdomadaire ou mensuelle, Paramètres) et le cumul
  des prestations reste visible. Un paiement ne peut pas dépasser le reste dû ; une avance le peut.
  Les salaires fixes sont mensuels, dans la devise de base.
- **Historique journalier.** Chaque journée d'activité se consulte en détail (ventes, prestations et
  travailleurs, produits, mouvements de caisse, dépenses, dettes, annulations, rémunérations,
  comptages, avec les comptes qui ont saisi chaque opération). Une journée clôturée garde en plus ses
  totaux figés ; rien n'est écrasé quand une nouvelle journée commence.
- **Rendez-vous.** La prestation se choisit dans le catalogue ; son prix est figé à la réservation. Un
  chevauchement avec un autre rendez-vous du même membre est signalé (et peut être confirmé).
- Les membres de l'équipe au salaire fixe ne génèrent pas de commission. Les prestations peuvent avoir
  un tarif femmes et un tarif hommes ; la ligne de vente enregistre le tarif appliqué.

- Un client ou un membre de l'équipe qui a un historique (ventes, commissions, présences,
  rendez-vous) est archivé, jamais supprimé ; la suppression définitive n'a lieu que sans aucun
  historique, dans une transaction. La base refuse aussi ces suppressions (`ON DELETE RESTRICT`).
- Les anciens règlements de commissions (`commission_payments`) ont été repris comme paiements dans
  `staff_payouts` (migration `007`) ; les routes `/api/commissions/*` utilisent ce même registre.

## Limites connues

- Le jeton de session est conservé dans le `localStorage` : une faille XSS permettrait de le lire.
  Atténuations : durée de vie courte, plafond de session, révocation (`authVersion`), CSP stricte
  sur Vercel. Passer à un cookie `HttpOnly` suppose que l'API et le site partagent un domaine.
- La limitation des tentatives de connexion est en mémoire : propre à chaque instance de l'API,
  remise à zéro au redémarrage.
- Données antérieures à la migration `006` : les commissions et dépenses dont la devise n'était pas
  connue ont été rattachées à l'USD (devise par défaut jusque-là) ; les anciennes ventes sans devise
  restent signalées comme telles et les anciennes clôtures gardent leurs totaux mélangés.
- Migration `007` : les anciennes ventes reçoivent un numéro de reçu dans l'ordre de création et leur
  paiement initial est repris ; leurs lignes de produits n'ont pas de coût d'achat (bénéfice « non
  calculable » sur ces périodes). Les ventes annulées avant cette version prennent leur dernière mise
  à jour comme date d'annulation.
- La caisse n'a pas de saisie de remise : le reçu affiche une remise seulement si elle existe.
