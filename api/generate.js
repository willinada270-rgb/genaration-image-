// api/generate.js — Function serverless Vercel
// Cache la clé Replicate et appelle les modèles image / vidéo.
//
// >>> MODÈLES (vérifie/ajuste les slugs sur https://replicate.com selon ce qui est dispo) <<<
const MODELS = {
  image: {
    slug: "black-forest-labs/flux-2-pro",   // FLUX.2 Pro — image full qualité
    buildInput: ({ prompt, image, aspectRatio }) => ({
      prompt,
      aspect_ratio: aspectRatio || "16:9",
      output_format: "png",
      safety_tolerance: 2,
      // Image de référence à transformer (image-to-image). Le nom du paramètre
      // dépend du modèle : sur FLUX c'est souvent "image_prompt" ou "input_image".
      // Vérifie la page du modèle sur Replicate et ajuste si besoin.
      ...(image ? { image_prompt: image } : {}),
    }),
  },
  video: {
    slug: "kwaivgi/kling-v2.1",               // Kling v2.1 — image-to-video (nécessite une image de départ)
    buildInput: ({ prompt, image, aspectRatio }) => ({
      prompt,
      duration: 5,                            // secondes
      aspect_ratio: aspectRatio || "16:9",
      ...(image ? { start_image: image } : {}), // image-to-video si fournie
    }),
  },
};

const REPLICATE = "https://api.replicate.com/v1";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    return res.status(500).json({ error: "Clé REPLICATE_API_TOKEN manquante côté serveur." });
  }

  try {
    const { type, prompt, aspectRatio } = req.body || {};
    // image = data URI (data:image/...;base64,xxxx) envoyé par la page,
    // ou imageUrl = ancienne URL publique (rétro-compatibilité).
    const image = req.body?.image || req.body?.imageUrl;

    if (!type || !MODELS[type]) {
      return res.status(400).json({ error: "Type invalide (image ou video)." });
    }
    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: "Le prompt est vide." });
    }

    const model = MODELS[type];
    const input = model.buildInput({ prompt: prompt.trim(), image, aspectRatio });

    // 1) Créer la prédiction
    const createRes = await fetch(`${REPLICATE}/models/${model.slug}/predictions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input }),
    });

    const created = await createRes.json();
    if (!createRes.ok) {
      return res.status(createRes.status).json({
        error: created?.detail || "Erreur Replicate lors du lancement.",
      });
    }

    // 2) Polling jusqu'à succès / échec (la vidéo peut prendre 1-2 min)
    let prediction = created;
    const deadline = Date.now() + 290_000; // ~290 s (sous la limite Vercel; voir vercel.json)

    while (
      prediction.status !== "succeeded" &&
      prediction.status !== "failed" &&
      prediction.status !== "canceled"
    ) {
      if (Date.now() > deadline) {
        return res.status(504).json({ error: "Délai dépassé pendant la génération." });
      }
      await new Promise((r) => setTimeout(r, 2000));
      const pollRes = await fetch(`${REPLICATE}/predictions/${prediction.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      prediction = await pollRes.json();
    }

    if (prediction.status !== "succeeded") {
      return res.status(500).json({
        error: prediction.error || "La génération a échoué.",
      });
    }

    // 3) Normaliser la sortie (string, tableau, ou objet)
    let output = prediction.output;
    if (Array.isArray(output)) output = output[0];
    if (output && typeof output === "object" && output.url) output = output.url;

    return res.status(200).json({ url: output });
  } catch (err) {
    return res.status(500).json({ error: "Erreur serveur: " + (err?.message || err) });
  }
}
