/**
 * /api/chat.js — Vercel Serverless Function (Node.js runtime)
 *
 * Acts as a secure server-side proxy between the Voyage front end and Google's
 * Gemini API. The browser never touches the API key directly.
 *
 * BEFORE DEPLOYING TO VERCEL:
 *   Go to your Vercel project ? Settings ? Environment Variables and add:
 *     GEMINI_API_KEY = <your real Gemini API key>
 *   The .env.local file only works for local development (`vercel dev`).
 *   It is intentionally excluded from git via .gitignore.
 *
 * Local dev:  vercel dev  (reads GEMINI_API_KEY from .env.local automatically)
 * Endpoint:   POST /api/chat
 */

// --- CORS helpers ------------------------------------------------------------

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function setCors(res) {
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
}

// --- Main handler ------------------------------------------------------------

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    setCors(res);
    return res.status(204).end();
  }

  setCors(res);

  // Only allow POST
  if (req.method !== "POST") {
    return res
      .status(405)
      .json({ error: `Method ${req.method} not allowed. Use POST.` });
  }

  // Guard: API key must be present in the environment
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    return res.status(500).json({
      error:
        "GEMINI_API_KEY is not set. Add it to your Vercel project's Environment Variables (or .env.local for local dev).",
    });
  }

  // --- Parse & validate request body ----------------------------------------

  let messages, systemInstruction, responseSchema;

  try {
    ({ messages, systemInstruction, responseSchema } = req.body);
  } catch {
    return res.status(400).json({ error: "Invalid or missing JSON body." });
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return res
      .status(400)
      .json({ error: '"messages" must be a non-empty array.' });
  }

  // --- Build the Gemini request payload -------------------------------------

  // Map { role, text } ? Gemini's { role, parts: [{ text }] }
  const contents = messages.map(({ role, text }) => ({
    role,
    parts: [{ text }],
  }));

  const geminiBody = { contents };

  // Optional: system instruction
  if (systemInstruction && typeof systemInstruction === "string") {
    geminiBody.systemInstruction = {
      parts: [{ text: systemInstruction }],
    };
  }

  // Optional: structured JSON output via responseSchema
  if (responseSchema && typeof responseSchema === "object") {
    geminiBody.generationConfig = {
      responseMimeType: "application/json",
      responseSchema,
    };
  }

  // --- Call Gemini ----------------------------------------------------------

  const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

  let geminiResponse;

  try {
    geminiResponse = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(geminiBody),
    });
  } catch (networkErr) {
    console.error("[/api/chat] Network error calling Gemini:", networkErr);
    return res.status(502).json({
      error: "Failed to reach the Gemini API. Check your network/firewall.",
    });
  }

  // Pass 429 (rate-limit) through directly so the front end can handle it
  if (!geminiResponse.ok) {
    const statusCode = geminiResponse.status === 429 ? 429 : 502;
    let errorDetail = `Gemini API returned ${geminiResponse.status}`;

    try {
      const errBody = await geminiResponse.json();
      errorDetail = errBody?.error?.message || errorDetail;
    } catch {
      // response body wasn't JSON — keep the default message
    }

    console.error(`[/api/chat] Gemini error ${geminiResponse.status}:`, errorDetail);
    return res.status(statusCode).json({ error: errorDetail });
  }

  // --- Extract and return the reply -----------------------------------------

  try {
    const data = await geminiResponse.json();

    // Gemini response shape: data.candidates[0].content.parts[0].text
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    // Return a simple, consistent shape to the front end.
    // If JSON mode was used, `text` is already a JSON string — the front end
    // is responsible for parsing it with JSON.parse().
    return res.status(200).json({ text });
  } catch (parseErr) {
    console.error("[/api/chat] Failed to parse Gemini response:", parseErr);
    return res
      .status(500)
      .json({ error: "Received an unreadable response from Gemini." });
  }
}
