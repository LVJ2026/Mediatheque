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
GRIST_LOANS_TABLE=Table1
GRIST_ENABLED=true
```

Les secrets Grist doivent etre saisis dans Cloudflare, jamais dans GitHub.

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

## Colonnes Grist attendues

Inventaire : `Jeu`, `Marque`, `Age_indique`, `Joueurs`, `Remarques`.

Emprunts (`Table1`) : `Nom`, `Prenom`, `Mail_professionnel`, `Ecole`, `Date_Emprunt`, `Retour`, `Jeu`.

Une reservation groupant plusieurs jeux cree une ligne Grist par jeu, pour la meme periode de 21 jours.
