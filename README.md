# Générateur IA — Dobleyou

Une page web avec 3 onglets :
- **Image** (FLUX.2 Pro) et **Vidéo** (Kling) en full qualité, via l'API **Replicate**.
- **Chat** avec **Claude Sonnet 4.6**, via l'API **Anthropic**.

Les clés API restent cachées côté serveur grâce à des functions serverless Vercel.

## Structure

```
generateur-ia/
├── index.html          → la page (3 onglets : Image / Vidéo / Chat)
├── api/generate.js     → function serverless image+vidéo (Replicate)
├── api/chat.js         → function serverless chat (Claude Sonnet 4.6)
├── vercel.json         → autorise les longues générations (vidéo)
└── package.json
```

---

## Étape 1 — Compte Replicate

1. Crée un compte sur https://replicate.com
2. Ajoute un moyen de paiement et mets un peu de crédit (commence avec ~5 à 10 $ pour tester ; la vidéo consomme vite).
3. Va dans **Account → API tokens** et copie ta clé (commence par `r8_...`).

> ⚠️ **Important — vérifie les modèles.** Les noms (slugs) des modèles évoluent. Ouvre :
> - Image : https://replicate.com/black-forest-labs
> - Vidéo : https://replicate.com/kwaivgi (ou cherche « kling »)
>
> Si un slug a changé, ouvre `api/generate.js` et corrige la ligne `slug:` dans l'objet `MODELS`. Chaque page de modèle sur Replicate montre aussi les paramètres d'entrée acceptés (à reporter dans `buildInput` si besoin).

---

## Étape 1 bis — Clé Anthropic (pour le Chat)

1. Crée un compte sur https://console.anthropic.com
2. Ajoute du crédit (onglet **Billing**).
3. Va dans **API Keys → Create Key** et copie ta clé (commence par `sk-ant-...`).

Le chat utilise le modèle `claude-sonnet-4-6` (modifiable dans `api/chat.js`, ligne `MODEL`).

---

## Étape 2 — Déployer sur Vercel (gratuit)

### Option A — via GitHub (recommandé)
1. Mets le dossier `generateur-ia/` dans un dépôt GitHub.
2. Sur https://vercel.com, **New Project → Import** ton dépôt.
3. Dans **Settings → Environment Variables**, ajoute les **deux** clés :
   - `REPLICATE_API_TOKEN` → ta clé `r8_...`
   - `ANTHROPIC_API_KEY` → ta clé `sk-ant-...`
4. Clique **Deploy**. Vercel te donne une URL `https://...vercel.app`.

### Option B — via le CLI
```bash
npm i -g vercel
cd generateur-ia
vercel            # suit les instructions
vercel env add REPLICATE_API_TOKEN   # colle ta clé Replicate
vercel env add ANTHROPIC_API_KEY     # colle ta clé Anthropic
vercel --prod
```

---

## Étape 3 — Utiliser

Ouvre ton URL Vercel. Onglet **Image** ou **Vidéo**, tape un prompt, clique **Générer**.
Pour la vidéo, tu peux coller l'URL d'une image publique pour l'**animer** (image-to-video).

---

## Coûts indicatifs (juin 2026, à confirmer)

- Image (FLUX.2 Pro) : ~0,01 à 0,04 $ par image.
- Vidéo (Kling) : ~0,10 $ par seconde → un clip de 5 s ≈ 0,50 $.

Tu paies uniquement à l'usage, directement sur ton crédit Replicate.

---

## Nouveautés (v1.1)

- **✨ Optimiseur de prompt** : bouton dans la barre de génération qui envoie ton idée à Claude, la traduit en anglais et l'enrichit (sujet, style, lumière, composition) avant de générer. Meilleur rendu sans effort.
- **Format / ratio** : 16:9, 9:16 (Reels/TikTok), 1:1, 4:5, 3:2. Limité automatiquement à 16:9 / 9:16 / 1:1 en mode vidéo (contrainte Kling).
- **Durée vidéo** : 5 s ou 10 s.
- **Variations multiples** : générer 1 à 4 images d'un coup, affichées en grille.
- **Vue plein écran (lightbox)** : clique une image ou vidéo pour l'agrandir.

## Variables d'environnement (Vercel)

Obligatoires :
- `REPLICATE_API_TOKEN` → clé Replicate (`r8_...`)
- `ANTHROPIC_API_KEY` → clé Anthropic (`sk-ant-...`)

Optionnelles — pour corriger un slug de modèle obsolète **sans redéployer le code** :
- `MODEL_IMAGE` (défaut `black-forest-labs/flux-2-pro`)
- `MODEL_VIDEO` (défaut `kwaivgi/kling-v3-video`)
- `MODEL_VIDEO_EDIT` (défaut `kwaivgi/kling-v3-omni-video`)

## Idées d'évolution

- Contrôle du seed (reproductibilité) et prompt négatif.
- Brancher **Veo 3.1** (Google) ou **Runway** pour pousser encore la qualité vidéo.
