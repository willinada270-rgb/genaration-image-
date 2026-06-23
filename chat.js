// api/chat.js — Function serverless Vercel
// Cache la clé Anthropic et discute avec Claude Sonnet 4.6.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

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

    // On ne garde que role + content, et on limite l'historique envoyé.
    const clean = messages
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content)
      .slice(-20)
      .map((m) => ({ role: m.role, content: String(m.content) }));

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

    // La réponse est dans data.content (tableau de blocs); on concatène le texte.
    const text = Array.isArray(data.content)
      ? data.content.filter((b) => b.type === "text").map((b) => b.text).join("")
      : "";

    return res.status(200).json({ reply: text || "(réponse vide)" });
  } catch (err) {
    return res.status(500).json({ error: "Erreur serveur: " + (err?.message || err) });
  }
}
