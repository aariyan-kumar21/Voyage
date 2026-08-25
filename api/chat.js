/**
 * /api/chat.js — Vercel Serverless Function (Node.js runtime)
 *
 * Acts as a secure server-side proxy between the Voyage front end and AI APIs:
 *   1. Primary: Google Gemini API (gemini-3.6-flash, gemini-3.5-flash-lite, gemini-3.5-flash)
 *   2. Secondary Fallback: Groq API (llama-3.3-70b-versatile, llama-3.1-8b-instant)
 *
 * Environment Variables (Set in Vercel or .env.local):
 *   GEMINI_API_KEY = <your Gemini API key>
 *   GROQ_API_KEY   = <your Groq API key>
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

// --- Groq Fallback Helper ----------------------------------------------------

async function callGroqFallback(messages, systemInstruction, responseSchema, apiKey) {
  const GROQ_MODELS = [
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant"
  ];

  let systemPrompt = systemInstruction || "";
  if (responseSchema) {
    systemPrompt += `\n\nCRITICAL INSTRUCTION: You MUST return your response as a valid raw JSON object matching this schema: ${JSON.stringify(responseSchema)}. Do NOT wrap in markdown backticks or commentary; output raw JSON only.`;
  }

  const groqMessages = [];
  if (systemPrompt) {
    groqMessages.push({ role: "system", content: systemPrompt });
  }

  for (const m of messages) {
    groqMessages.push({
      role: (m.role === 'model' || m.role === 'assistant') ? 'assistant' : 'user',
      content: m.text || ""
    });
  }

  for (const model of GROQ_MODELS) {
    try {
      const payload = {
        model,
        messages: groqMessages,
        temperature: 0.7,
      };

      if (responseSchema) {
        payload.response_format = { type: "json_object" };
      }

      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        const data = await response.json();
        const text = data?.choices?.[0]?.message?.content ?? "";
        if (text) {
          console.log(`[/api/chat] Successfully used Groq fallback model: ${model}`);
          return { success: true, text, model, provider: "groq" };
        }
      }

      const errText = await response.text();
      console.warn(`[/api/chat] Groq model ${model} returned ${response.status}: ${errText}`);
    } catch (err) {
      console.error(`[/api/chat] Network error calling Groq model ${model}:`, err);
    }
  }

  return { success: false, error: "All Groq fallback models failed." };
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

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  const GROQ_API_KEY = process.env.GROQ_API_KEY;

  if (!GEMINI_API_KEY && !GROQ_API_KEY) {
    return res.status(500).json({
      error:
        "No AI API keys configured. Please set GEMINI_API_KEY or GROQ_API_KEY in your environment variables.",
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

  // --- 1. Try Primary Provider: Google Gemini -------------------------------

  if (GEMINI_API_KEY) {
    const contents = messages.map(({ role, text }) => ({
      role: role === 'model' || role === 'assistant' ? 'model' : 'user',
      parts: [{ text }],
    }));

    const geminiBody = { contents };

    if (systemInstruction && typeof systemInstruction === "string") {
      geminiBody.systemInstruction = {
        parts: [{ text: systemInstruction }],
      };
    }

    if (responseSchema && typeof responseSchema === "object") {
      geminiBody.generationConfig = {
        responseMimeType: "application/json",
        responseSchema,
      };
    }

    const CANDIDATE_MODELS = [
      "gemini-3.6-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.5-flash",
      "gemini-2.5-flash",
      "gemini-2.0-flash"
    ];

    for (const model of CANDIDATE_MODELS) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(geminiBody),
        });

        if (response.ok) {
          const data = await response.json();
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
          if (text) {
            return res.status(200).json({ text, provider: "gemini", model });
          }
        }

        console.warn(`[/api/chat] Gemini model ${model} returned ${response.status}. Trying next candidate.`);
      } catch (networkErr) {
        console.error(`[/api/chat] Network error calling Gemini model ${model}:`, networkErr);
      }
    }
  }

  // --- 2. Try Secondary Provider: Groq (Llama 3.3 / 3.1) --------------------

  if (GROQ_API_KEY) {
    console.log("[/api/chat] Gemini unavailable or exhausted. Engaging Groq fallback.");
    const groqResult = await callGroqFallback(messages, systemInstruction, responseSchema, GROQ_API_KEY);
    if (groqResult.success) {
      return res.status(200).json({ text: groqResult.text, provider: "groq", model: groqResult.model });
    }
  }

  // --- 3. Both Cloud Providers Failed ---------------------------------------

  return res.status(502).json({
    error: "All primary and secondary AI services are temporarily unavailable.",
  });
}
