// api/chat.js — Function serverless Vercel
// Cache la clé Anthropic et discute avec Claude Sonnet 4.6.
// Supporte l'analyse d'images (vision) : un message peut contenir une image.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

// Transforme un message { role, content, image? } au format attendu par l'API.
// image = data URI "data:image/png;base64,XXXX"
function toApiMessage(m) {
  const text = m.content ? String(m.content) : "";

  if (m.image && typeof m.image === "string" && m.image.startsWith("data:")) {
    const match = m.image.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
    if (match) {
      const blocks = [
        {
          type: "image",
          source: { type: "base64", media_type: match[1], data: match[2] },
        },
      ];
      if (text) blocks.push({ type: "text", text });
      return { role: m.role, content: blocks };
    }
  }

  return { role: m.role, content: text };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return res.status(500).json({ error: "Clé ANTHROPIC_API_KEY manquante côté serveur." });
  }

  try {
    const { messages, system } = req.body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Aucun message fourni." });
    }

    const clean = messages
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && (m.content || m.image))
      .slice(-20)
      .map(toApiMessage);

    const apiRes = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        system: system || "Tu es un assistant utile qui répond en français de façon claire et concise.",
        messages: clean,
      }),
    });

    const data = await apiRes.json();

    if (!apiRes.ok) {
      return res.status(apiRes.status).json({
        error: data?.error?.message || "Erreur de l'API Anthropic.",
      });
    }

    const text = Array.isArray(data.content)
      ? data.content.filter((b) => b.type === "text").map((b) => b.text).join("")
      : "";

    return res.status(200).json({ reply: text || "(réponse vide)" });
  } catch (err) {
    return res.status(500).json({ error: "Erreur serveur: " + (err?.message || err) });
  }
}
