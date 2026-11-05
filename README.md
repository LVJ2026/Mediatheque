# Mediatheque

Application JavaScript de reservation de ressources pour la mediatheque de l'Education nationale.

## Architecture

- `worker/public/` : interface web statique JavaScript.
- `worker/functions/` : Cloudflare Pages Functions, API JavaScript connectee a Grist.
- Grist : source des tables `Inventaire_des_jeux` et `Table1`.

## Deploiement Cloudflare Pages

Connecter le depot GitHub avec :

- Root directory : laisser vide (le dossier `public/` est maintenant a la racine du depot)
- Framework preset : `None`
- Build command : `npm run build`
- Build output directory : `public`

Les dossiers `public/` et `functions/` sont directement a la racine pour que Cloudflare les detecte automatiquement.

Dans **Settings > Environment variables**, ajouter pour Production et Preview :

```text
GRIST_API_KEY=ta-cle-api-grist
GRIST_DOC_ID=iSya7D8N4oHCP1GrHQGzRB
GRIST_BASE_URL=https://grist.numerique.gouv.fr
GRIST_INVENTORY_TABLE=Inventaire_des_jeux
GRIST_BOOKS_INVENTORY_TABLE=Inventaire livres albums
GRIST_BOOKS_LOANS_TABLE=Emprunts livres albums
GRIST_DIGITAL_INVENTORY_TABLE=Inventaire Numerique
GRIST_DIGITAL_LOANS_TABLE=Emprunt Numerique
GRIST_LOANS_TABLE=Table1
GRIST_SCHOOLS_TABLE=Ecoles
GRIST_ENABLED=true
MANAGER_PASSWORD=mot-de-passe-gestionnaire
```

Les secrets Grist, SMTP et le mot de passe gestionnaire doivent etre saisis dans Cloudflare, jamais dans GitHub. Pour les courriels de confirmation, configurer `SMTP_USER`, `SMTP_PASSWORD` et `SMTP_FROM`; `SMTP_HOST` et `SMTP_PORT` sont facultatifs (par défaut `smtps.ac-nancy-metz.fr` et `465`, TLS implicite). Le serveur doit autoriser SMTP AUTH LOGIN et l’envoi depuis cette adresse. La réservation est conservée dans Grist même si le courriel échoue. Le mot de passe gestionnaire permet d’enregistrer dans Grist un retour anticipé ou une annulation, d’imprimer une fiche d’emprunt ou de retour et de gérer les réservations dans le calendrier. La table `Ecoles` fournit les choix du formulaire (par défaut, colonne `Ecole`, `École` ou `Nom`).

## Developpement local

Installer Node.js LTS, puis depuis `worker/` :

```powershell
npm install
Copy-Item .dev.vars.example .dev.vars
npx wrangler pages dev public
```

Le fichier `.dev.vars` contient les variables locales et ne doit jamais etre committe.

## Deploiement manuel

```powershell
cd worker
npm install
npx wrangler login
npm run deploy
```

Depuis la racine du depot, le deploiement direct est :

```powershell
npx wrangler pages deploy public --project-name mediatheque-reservations
```

Ne pas utiliser `npx wrangler deploy` : cette commande concerne les Workers classiques et produit une erreur dans un projet Pages. Pour un deploiement Git Cloudflare Pages, utiliser `npm run build` comme commande de build ; Cloudflare publie ensuite `public/`.

## Rappels de retour

Le Worker `mediatheque-rappels-emprunts` s'exécute chaque jour à 08:00 UTC (09:00 en hiver, 10:00 en été, heure de Paris) et envoie un rappel trois jours avant la fin prévue. Il groupe les jeux d'un même emprunteur et d'une même période. Après un envoi réussi, il enregistre la date dans `Rappel_Envoye` pour éviter les doublons. Ajouter cette colonne comme colonne Date à la table des emprunts.

Les secrets du Worker de rappels sont distincts de ceux de Pages. Depuis `worker/`, les créer avec `npx wrangler secret put` pour chacun de ces noms : `GRIST_API_KEY`, `GRIST_DOC_ID`, `SMTP_USER`, `SMTP_PASSWORD` et `SMTP_FROM`. Déployer ensuite avec `npm run deploy:reminders`. Les paramètres non secrets (tables et serveur SMTP) sont dans `wrangler.reminders.toml`.

## Colonnes Grist attendues

Inventaire : `Jeu`, `Marque`, `Age_indique`, `Joueurs`, `Remarques`.

Emprunts jeux (`Table1`) : `Nom`, `Prenom`, `Mail_professionnel`, `Ecole`, `Date_Emprunt`, `Date_Fin`, `Jeu`, `Retour`, `Date_Annulation` et `Rappel_Envoye`.

Emprunts livres/albums (`Emprunts livres albums`) : ajouter les colonnes emprunteur/dates `Nom`, `Prenom`, `Mail_professionnel`, `Ecole`, `Date_Emprunt`, `Date_Fin`, `Retour`, `Date_Annulation`, `Rappel_Envoye` et `Confirmation_Envoyee`, en plus de `Titre`, `Auteur`, `Lieu` et `Quantite`. La quantité de la ligne est celle demandée pour cette série.

Inventaire livres/albums (`Inventaire livres albums`) : `Titre`, `Auteur`, `Lieu`, `Quantite`, `Qte_empruntee` (affiché « Qté empruntée ») et `Reste`. `Quantite` est le stock total. `Qte_empruntee` contient le nombre total d’exemplaires actuellement empruntés et est recalculé depuis les emprunts actifs après réservation, retour ou annulation. `Reste` est la disponibilité affichée dans l’application, généralement calculée par Grist comme `Quantite - Qte_empruntee`. Une réservation de plusieurs séries crée une ligne par série, avec le même emprunteur et la même période. Les marqueurs `Rappel_Envoye` et `Confirmation_Envoyee` évitent les courriels en double; ajoutez-les comme colonnes Date dans la table des emprunts livres/albums.

Les rappels de retour des jeux lisent `Table1`; la confirmation des livres/albums part dès la création de la réservation, et les courriels des livres/albums sont envoyés par le Worker depuis `Emprunts livres albums`.

Matériel numérique : une réservation crée une ligne par équipement dans `Emprunt Numerique`; les lignes partagent les mêmes coordonnées et dates, ce qui constitue une fiche unique. Une nouvelle demande est une pré-réservation (`Validee = FALSE`) et réserve le stock pour éviter les doubles réservations. Depuis le calendrier numérique en mode gestionnaire, le bouton **Valider la pré-réservation** passe toutes les lignes de la fiche à `Validee = TRUE` et envoie immédiatement le courriel de confirmation. Le Worker planifié envoie ensuite un courriel le jour du début et un rappel trois jours avant le retour, uniquement pour les emprunts validés. Déployer le Worker (`npm run deploy:reminders`) après chaque modification de ses rappels.

Inventaire numérique (`Inventaire Numerique`) : `Equipement`, `Marque`, `Type`, `Quantite` (ou `Quantité`), `Qte_empruntee` et `Reste`. `Quantite` est le stock total. L’application recalcule `Qte_empruntee` depuis les pré-réservations et emprunts actifs; `Reste` doit être une colonne calculée par Grist (par exemple `Quantite - Qte_empruntee`).

Emprunts numériques (`Emprunt Numerique`) : `Nom`, `Prenom`, `Mail_professionnel`, `Ecole`, `Date_Emprunt`, `Date_Retour_prevu`, `Equipement` (référence vers l’inventaire), `Quantite`, `Validee` (case à cocher), `Retour`, `Date_Annulation`, `Confirmation_Envoyee` et `Rappel_Envoye`. Ajouter les colonnes de suivi des courriels comme colonnes Date. Le Worker lit `Date_Retour_prevu` pour calculer le rappel à trois jours. Une fiche avec plusieurs équipements est enregistrée sur plusieurs lignes, une par équipement.

Une reservation groupant plusieurs jeux cree une ligne Grist par jeu, pour la meme periode.
