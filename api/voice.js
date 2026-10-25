// api/voice.js — Function serverless Vercel
// Cache la clé Fish Audio et gère : clonage de voix + synthèse (TTS).
//   action "clone" : { title, audio (data URI) }        -> { id, state }
//   action "tts"   : { reference_id, text }             -> { audio (data URI mp3) }
//
// Variable d'environnement requise : FISH_API_KEY
// Le modèle TTS est surchargeable via FISH_MODEL (défaut "s2-pro").

const FISH_BASE = "https://api.fish.audio";
const FISH_MODEL = process.env.FISH_MODEL || "s2-pro";

// Décode une data URI "data:audio/mpeg;base64,XXXX" -> { mime, buffer }
function parseDataUri(uri) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(uri || "");
  if (!m) return null;
  return { mime: m[1], buffer: Buffer.from(m[2], "base64") };
}
function extFromMime(mime) {
  if (/mpeg|mp3/.test(mime)) return "mp3";
  if (/wav/.test(mime)) return "wav";
  if (/mp4|m4a|aac/.test(mime)) return "m4a";
  if (/ogg|opus/.test(mime)) return "opus";
  return "mp3";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  const key = process.env.FISH_API_KEY;
  if (!key) {
    return res.status(500).json({ error: "Clé FISH_API_KEY manquante côté serveur." });
  }

  try {
    const { action } = req.body || {};

    // ---------- 1) Cloner une voix ----------
    if (action === "clone") {
      const { title, audio } = req.body || {};
      const parsed = parseDataUri(audio);
      if (!parsed) return res.status(400).json({ error: "Échantillon audio invalide." });

      const form = new FormData();
      form.append("type", "tts");
      form.append("title", (title || "Ma voix").slice(0, 80));
      form.append("visibility", "private");
      form.append("train_mode", "fast");
      form.append("enhance_audio_quality", "true");
      const filename = "sample." + extFromMime(parsed.mime);
      form.append("voices", new Blob([parsed.buffer], { type: parsed.mime }), filename);

      const r = await fetch(`${FISH_BASE}/model`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        return res.status(r.status).json({ error: data?.message || data?.detail || "Erreur Fish Audio (clonage)." });
      }
      const id = data._id || data.id;
      if (!id) return res.status(500).json({ error: "Réponse Fish Audio inattendue (pas d'id)." });
      return res.status(200).json({ id, state: data.state || "trained" });
    }

    // ---------- 2) Synthèse vocale ----------
    if (action === "tts") {
      const { reference_id, text } = req.body || {};
      if (!reference_id) return res.status(400).json({ error: "reference_id manquant (clone une voix d'abord)." });
      if (!text || !text.trim()) return res.status(400).json({ error: "Texte vide." });

      const r = await fetch(`${FISH_BASE}/v1/tts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          model: FISH_MODEL,
        },
        body: JSON.stringify({ text: text.trim(), reference_id, format: "mp3" }),
      });

      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        return res.status(r.status).json({ error: err?.message || err?.detail || "Erreur Fish Audio (synthèse)." });
      }

      const buf = Buffer.from(await r.arrayBuffer());
      const dataUri = "data:audio/mpeg;base64," + buf.toString("base64");
      return res.status(200).json({ audio: dataUri });
    }

    return res.status(400).json({ error: "Action inconnue (clone ou tts)." });
  } catch (err) {
    return res.status(500).json({ error: "Erreur serveur: " + (err?.message || err) });
  }
}
