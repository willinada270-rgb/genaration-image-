// api/generate.js — Function serverless Vercel
// Cache la clé Replicate et appelle les modèles image / vidéo.
//
// >>> MODÈLES (vérifie/ajuste les slugs sur https://replicate.com selon ce qui est dispo) <<<
const MODELS = {
  // Image — FLUX.2 Pro
  image: {
    slug: "black-forest-labs/flux-2-pro",
    buildInput: ({ prompt, image, aspectRatio }) => ({
      prompt,
      aspect_ratio: aspectRatio || "16:9",
      output_format: "png",
      safety_tolerance: 2,
      // Image de référence (image-to-image). Param selon modèle : image_prompt / input_image.
      ...(image ? { image_prompt: image } : {}),
    }),
  },
  // Vidéo — Kling v3 (texte→vidéo et image→vidéo, audio, jusqu'à 15 s)
  video: {
    slug: "kwaivgi/kling-v3-video",
    buildInput: ({ prompt, image, aspectRatio, duration }) => ({
      prompt,
      mode: "standard",                       // standard (720p) | pro (1080p)
      duration: duration || 5,                // 3 à 15 s
      aspect_ratio: aspectRatio || "16:9",
      generate_audio: false,
      ...(image ? { start_image: image } : {}), // image→vidéo si fournie
    }),
  },
  // Vidéo à partir d'une vidéo — Kling v3 Omni (édition / animation)
  video_edit: {
    slug: "kwaivgi/kling-v3-omni-video",
    buildInput: ({ prompt, video }) => ({
      prompt,
      mode: "standard",
      reference_video: video,                 // .mp4/.mov, 3-10 s
      video_reference_type: "base",           // base = édition de la vidéo selon le prompt
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
    const { type, prompt, aspectRatio, duration } = req.body || {};
    const image = req.body?.image || req.body?.imageUrl; // data URI ou URL
    const video = req.body?.video;                        // data URI ou URL (vidéo de départ)

    if (!type || (type !== "image" && type !== "video")) {
      return res.status(400).json({ error: "Type invalide (image ou video)." });
    }
    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: "Le prompt est vide." });
    }

    // Si une vidéo est fournie en mode vidéo, on passe sur le modèle d'édition (Omni).
    const key = type === "video" && video ? "video_edit" : type;
    const model = MODELS[key];
    const input = model.buildInput({ prompt: prompt.trim(), image, video, aspectRatio, duration });

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

    // 2) Polling jusqu'à succès / échec (la vidéo peut prendre 1-3 min)
    let prediction = created;
    const deadline = Date.now() + 290_000;

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
      return res.status(500).json({ error: prediction.error || "La génération a échoué." });
    }

    // 3) Normaliser la sortie
    let output = prediction.output;
    if (Array.isArray(output)) output = output[0];
    if (output && typeof output === "object" && output.url) output = output.url;

    return res.status(200).json({ url: output });
  } catch (err) {
    return res.status(500).json({ error: "Erreur serveur: " + (err?.message || err) });
  }
}
