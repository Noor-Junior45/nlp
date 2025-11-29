import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import fs from "fs";
import { randomUUID } from "crypto";

dotenv.config();

const app = express();

// Structured request logging + request id middleware
app.use((req, res, next) => {
  const id = req.headers['x-request-id'] || randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  const start = Date.now();
  const remote = req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || '';

  // Log incoming request (structured)
  const incoming = {
    ts: new Date().toISOString(),
    event: 'request_start',
    id,
    method: req.method,
    url: req.originalUrl || req.url,
    remote,
    userAgent: req.get('User-Agent') || '',
  };

  console.log(JSON.stringify(incoming));

  res.once('finish', () => {
    const duration = Date.now() - start;
    const out = {
      ts: new Date().toISOString(),
      event: 'request_end',
      id,
      method: req.method,
      url: req.originalUrl || req.url,
      status: res.statusCode,
      duration_ms: duration,
    };
    console.log(JSON.stringify(out));
  });

  next();
});

// Read from .env
const PORT = process.env.PORT || 3001;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// Helper: build request body for Gemini
function buildGeminiBody(query) {
  const systemPrompt = `You are an AI Pharmacist for the pharmacy "New Lucky Pharma" in India.

Your goals:
- If the user starts with a simple greeting (e.g., "Hi", "Hello", "How are you?"), reply briefly with a friendly, single-sentence greeting and ask how you can help (e.g., "Hello! How can I assist you with your health questions today?").
- For all other queries (i.e., medical questions, product questions), reply directly and immediately to the user's query. Do not add any extra conversational text.
- Help customers understand medicines, their uses, and basic health questions.
- IMPORTANT: Always answer medical/product queries in numbered points (1., 2., 3., etc.), with each point on a separate line.
- Keep Answer short and clean, aiming for 5 to 10 lines maximum.
- Keep each point short and clear.
- Do not write long paragraphs; break information into separate numbered points.
- You are NOT a doctor. Always end replies with: Please consult a doctor for serious advice.

Example format for medical query:
1. Medicine name and type
2. How it is used
3. When to take it
4. Important warnings`;

  return {
    contents: [
      {
        parts: [
          { text: systemPrompt },
          { text: query },
        ],
      },
    ],
  };
}

/**
 * POST /api/ai
 * Body: { query: string }
 * Returns: { reply: string }
 */
app.post("/api/ai", async (req, res) => {
  const { query } = req.body || {};

  if (!query || typeof query !== "string") {
    return res.status(400).json({ reply: "Missing or invalid query." });
  }

  if (!GOOGLE_API_KEY) {
    return res.status(500).json({
      reply: "AI is not configured at the moment. Please call the pharmacy directly. 📞 Please consult a doctor for serious advice.",
    });
  }

  try {
    const MODEL_NAME = process.env.GOOGLE_MODEL || "gemini-2.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1/models/${MODEL_NAME}:generateContent?key=${GOOGLE_API_KEY}`;
    const body = buildGeminiBody(query);

    const apiResponse = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await apiResponse.json();

    if (!apiResponse.ok) {
      console.error("Gemini API HTTP error:", apiResponse.status, data);
    }

    if (data?.promptFeedback?.blockReason) {
      console.error("Prompt blocked:", data.promptFeedback);
      return res.json({
        reply: "I cannot answer that question due to safety guidelines. Please consult a doctor directly. Please consult a doctor for serious advice.",
      });
    }

    const reply =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "Sorry, I'm not sure how to answer that safely. You can call or visit the store for help. Please consult a doctor for serious advice.";

    return res.json({ reply });
  } catch (err) {
    console.error("Gemini API error:", err);
    return res.status(500).json({
      reply: "AI is currently not responding. Please call the pharmacy directly. 📞 Please consult a doctor for serious advice.",
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});