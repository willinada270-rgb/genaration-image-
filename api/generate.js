// api/generate.js — Function serverless Vercel
// Cache la clé Replicate et appelle les modèles image / vidéo.
//
// >>> MODÈLES (vérifie/ajuste les slugs sur https://replicate.com selon ce qui est dispo) <<<
// Les slugs sont surchargeables via variables d'environnement Vercel :
//   MODEL_IMAGE, MODEL_VIDEO, MODEL_VIDEO_EDIT
// → tu peux corriger un slug obsolète sans redéployer le code.
const SLUGS = {
  image: process.env.MODEL_IMAGE || "black-forest-labs/flux-2-pro",
  video: process.env.MODEL_VIDEO || "kwaivgi/kling-v2.5-turbo-pro",
  video_edit: process.env.MODEL_VIDEO_EDIT || "kwaivgi/kling-v3-omni-video",
  avatar: process.env.MODEL_AVATAR || "kwaivgi/kling-avatar-v2",
};

const MODELS = {
  // Image — FLUX.2 Pro
  image: {
    slug: SLUGS.image,
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
    slug: SLUGS.video,
    // Kling 2.5 Turbo Pro : 1080p natif. Paramètres épurés selon le schéma du modèle.
    buildInput: ({ prompt, image, endImage, aspectRatio, duration }) => ({
      prompt,
      duration: duration || 5,                // 5 ou 10 s
      aspect_ratio: aspectRatio || "16:9",
      negative_prompt: "blurry, low quality, distorted, deformed, watermark",
      ...(image ? { start_image: image } : {}),   // image de début (image→vidéo)
      ...(endImage ? { end_image: endImage } : {}), // image de fin (interpolation début→fin)
    }),
  },
  // Vidéo à partir d'une vidéo — Kling v3 Omni (édition / animation)
  video_edit: {
    slug: SLUGS.video_edit,
    buildInput: ({ prompt, video, resolution }) => ({
      prompt,
      mode: resolution === "720p" ? "standard" : "pro",
      reference_video: video,                 // .mp4/.mov, 3-10 s
      video_reference_type: "base",           // base = édition de la vidéo selon le prompt
    }),
  },
  // Avatar parlant — Kling AI Avatar (image + audio → vidéo lip-sync)
  // Noms de paramètres selon le modèle Replicate ; ajuste si besoin (image / audio).
  avatar: {
    slug: SLUGS.avatar,
    buildInput: ({ image, audio }) => ({
      image,
      audio,
    }),
  },
};

// Moteurs vidéo au choix (image→vidéo). Chacun a son propre schéma de paramètres.
// Slugs surchargeables : MODEL_VIDEO, MODEL_VIDEO_SEEDANCE, MODEL_VIDEO_VIDU
const VIDEO_MODELS = {
  kling: {
    slug: process.env.MODEL_VIDEO || "kwaivgi/kling-v2.5-turbo-pro",
    build: ({ prompt, image, endImage, aspectRatio, duration }) => ({
      prompt,
      duration: duration || 5,
      aspect_ratio: aspectRatio || "16:9",
      negative_prompt: "blurry, low quality, distorted, deformed, watermark",
      ...(image ? { start_image: image } : {}),
      ...(endImage ? { end_image: endImage } : {}),
    }),
  },
  seedance: {
    slug: process.env.MODEL_VIDEO_SEEDANCE || "bytedance/seedance-2.0",
    build: ({ prompt, image, aspectRatio, duration }) => ({
      prompt,
      duration: duration || 5,
      aspect_ratio: aspectRatio || "16:9",
      resolution: "1080p",
      ...(image ? { image } : {}),
    }),
  },
  vidu: {
    slug: process.env.MODEL_VIDEO_VIDU || "vidu/q3-pro",
    build: ({ prompt, image, endImage, aspectRatio, duration }) => ({
      prompt,
      duration: duration || 5,
      aspect_ratio: aspectRatio || "16:9",
      ...(image ? { start_image: image } : {}),
      ...(endImage ? { end_image: endImage } : {}),
    }),
  },
};

const REPLICATE = "https://api.replicate.com/v1";

// ---- Moteur GPT Image (OpenAI) ----
const OPENAI_IMAGES = "https://api.openai.com/v1/images";
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";

function openaiSize(aspectRatio) {
  if (aspectRatio === "1:1") return "1024x1024";
  if (["9:16", "4:5", "2:3", "3:4"].includes(aspectRatio)) return "1024x1536"; // portrait
  return "1536x1024"; // paysage (16:9, 3:2…) par défaut
}
function dataUriToBuffer(uri) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(uri || "");
  return m ? { mime: m[1], buffer: Buffer.from(m[2], "base64") } : null;
}
async function openaiImage({ key, prompt, aspectRatio, image }) {
  const size = openaiSize(aspectRatio);
  let r;
  if (image) {
    // image → image : endpoint "edits" (multipart)
    const parsed = dataUriToBuffer(image);
    const form = new FormData();
    form.append("model", OPENAI_IMAGE_MODEL);
    form.append("prompt", "Edit the provided image, keeping its overall composition and main subject: " + prompt);
    form.append("size", size);
    if (parsed) form.append("image", new Blob([parsed.buffer], { type: parsed.mime }), "input.png");
    r = await fetch(`${OPENAI_IMAGES}/edits`, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
  } else {
    r = await fetch(`${OPENAI_IMAGES}/generations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: OPENAI_IMAGE_MODEL, prompt, size, quality: "high", n: 1 }),
    });
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.message || "Erreur OpenAI (image).");
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error("Réponse OpenAI inattendue (pas d'image).");
  return "data:image/png;base64," + b64;
}

// ---- Moteur GPT Image 2 via OpenRouter (moins cher que l'API OpenAI directe) ----
const OPENROUTER_IMAGES = "https://openrouter.ai/api/v1/images";
const OPENROUTER_IMAGE_MODEL = process.env.OPENROUTER_IMAGE_MODEL || "openai/gpt-image-2";
async function openrouterImage({ key, prompt, aspectRatio, image }) {
  const finalPrompt = image
    ? "Using the attached reference image as the base, transform it as follows while keeping its overall composition, framing and main subject: " + prompt
    : prompt;
  const body = {
    model: OPENROUTER_IMAGE_MODEL,
    prompt: finalPrompt,
    aspect_ratio: aspectRatio || "1:1", // OpenRouter accepte directement les ratios
    quality: "high",
    n: 1,
  };
  if (image) body.input_references = [{ type: "image_url", image_url: { url: image } }];
  const r = await fetch(OPENROUTER_IMAGES, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.message || "Erreur OpenRouter (image).");
  const item = data?.data?.[0];
  if (!item?.b64_json) throw new Error("Réponse OpenRouter inattendue (pas d'image).");
  return "data:" + (item.media_type || "image/png") + ";base64," + item.b64_json;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  try {
    const { type, prompt, aspectRatio, duration, resolution, engine } = req.body || {};
    const image = req.body?.image || req.body?.imageUrl; // data URI ou URL (image de début)
    const endImage = req.body?.endImage;                  // data URI ou URL (image de fin, vidéo)
    const video = req.body?.video;                        // data URI ou URL (vidéo de départ)
    const audio = req.body?.audio;                        // data URI ou URL (pour l'avatar)

    if (!type || (type !== "image" && type !== "video" && type !== "avatar")) {
      return res.status(400).json({ error: "Type invalide (image, video ou avatar)." });
    }

    if (type === "avatar") {
      if (!image) return res.status(400).json({ error: "Image de portrait manquante." });
      if (!audio) return res.status(400).json({ error: "Audio manquant." });
    } else if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: "Le prompt est vide." });
    }

    // Moteur GPT Image (OpenAI direct) — réponse en base64
    if (type === "image" && engine === "openai") {
      const okey = process.env.OPENAI_API_KEY;
      if (!okey) return res.status(500).json({ error: "Clé OPENAI_API_KEY manquante côté serveur." });
      const url = await openaiImage({ key: okey, prompt: prompt.trim(), aspectRatio, image });
      return res.status(200).json({ url });
    }

    // Moteur GPT Image 2 via OpenRouter — réponse en base64
    if (type === "image" && engine === "openrouter") {
      const okey = process.env.OPENROUTER_API_KEY;
      if (!okey) return res.status(500).json({ error: "Clé OPENROUTER_API_KEY manquante côté serveur." });
      const url = await openrouterImage({ key: okey, prompt: prompt.trim(), aspectRatio, image });
      return res.status(200).json({ url });
    }

    // Sinon : Replicate (FLUX / Kling)
    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) {
      return res.status(500).json({ error: "Clé REPLICATE_API_TOKEN manquante côté serveur." });
    }

    // Choix du modèle et des paramètres.
    let slug, input;
    if (type === "video" && !video) {
      // Vidéo simple (texte/image → vidéo) : moteur au choix
      const ve = VIDEO_MODELS[req.body?.videoEngine] || VIDEO_MODELS.kling;
      slug = ve.slug;
      input = ve.build({ prompt: prompt ? prompt.trim() : "", image, endImage, aspectRatio, duration });
    } else {
      // Avatar, ou vidéo→édition si une vidéo est fournie
      const key = type === "avatar" ? "avatar" : (type === "video" && video ? "video_edit" : type);
      const model = MODELS[key];
      slug = model.slug;
      input = model.buildInput({ prompt: prompt ? prompt.trim() : "", image, endImage, video, audio, aspectRatio, duration, resolution });
    }

    // 1) Créer la prédiction — avec réessai automatique si Replicate throttle (429)
    let createRes;
    for (let attempt = 0; attempt < 5; attempt++) {
      createRes = await fetch(`${REPLICATE}/models/${slug}/predictions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input }),
      });
      if (createRes.status !== 429) break;
      const ra = parseInt(createRes.headers.get("retry-after") || "0", 10);
      await new Promise((r) => setTimeout(r, (ra > 0 ? ra : 12) * 1000));
    }

    const created = await createRes.json();
    if (!createRes.ok) {
      const msg = createRes.status === 429
        ? "Limite de débit Replicate atteinte. Avec moins de 5 $ de crédit, tu es limité à 6 requêtes/min et 1 à la fois. Ajoute du crédit sur Replicate, ou réessaie dans quelques secondes."
        : (created?.detail || "Erreur Replicate lors du lancement.");
      return res.status(createRes.status).json({ error: msg });
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
