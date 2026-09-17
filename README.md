# Mediatheque

Application de reservation de ressources pour la mediatheque de l'Education nationale.

## Architecture

- `app/` : application Python, FastAPI pour l'API et Flask pour les pages HTML.
- `worker/` : Cloudflare Worker, proxy HTTPS vers l'application Python.
- Grist : source de donnees des tables `Inventaire des jeux` et `Emprunts`.

## Demarrage local

```powershell
python -m venv .venv
.\\.venv\\Scripts\\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn app.main:app --reload
```

Ouvrir http://127.0.0.1:8000. Tant que `GRIST_ENABLED=false`, l'interface utilise trois jeux d'exemple et aucune reservation persistante. Pour connecter Grist, renseigner les variables dans `.env`, puis definir `GRIST_ENABLED=true`.

Les noms de colonnes attendus sont exactement :

- `Inventaire des jeux` : `Jeu`, `Marque`, `Âge indiqué`, `Joueurs`, `Remarques`.
- `Emprunts` : `Nom`, `Prénom`, `Mail professionnel`, `Ecole`, `Date Emprunt`, `Retour`, `Jeu`.

## Worker Cloudflare

Depuis `worker/`, installer Wrangler puis adapter `ORIGIN_URL` dans `wrangler.toml` :

```powershell
npm install
npx wrangler login
npm run deploy
```

Le Worker ne contient aucune clé Grist : elles restent uniquement dans l'environnement de l'application Python.