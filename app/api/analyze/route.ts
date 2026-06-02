import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";

// TODO: add per-user rate limiting before any public deploy

const FALLBACK = { score: 0, heardAs: "—", tip: "Audio unclear, please try again." };

const ResponseSchema = z.object({
  score: z.number().min(0).max(100),
  heardAs: z.string(),
  tip: z.string(),
});

export async function POST(request: Request) {
  const start = Date.now();
  console.log("[analyze] ── POST received ──────────────────────────");

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (e) {
    console.error("[analyze] ✗ failed to parse formData", e);
    return Response.json(FALLBACK);
  }

  const audio = formData.get("audio");
  const target = (formData.get("target") as string | null) ?? "";
  const mode = (formData.get("mode") as string | null) ?? "word";

  if (!audio || !(audio instanceof Blob) || !target) {
    console.error("[analyze] ✗ missing audio or target — audio:", !!audio, "target:", target);
    return Response.json(FALLBACK);
  }

  const arrayBuffer = await audio.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const mimeType = audio.type || "audio/webm";

  console.log("[analyze] audio received —", Math.round(arrayBuffer.byteLength / 1024), "KB,", mimeType);
  console.log("[analyze] target:", `"${target}"`, "| mode:", mode);
  console.log("[analyze] calling Gemini 2.0 Flash…");

  const prompt = mode === "sentence"
    ? `You are a strict pronunciation scoring system for an English learning app.

The learner was supposed to say this exact sentence: "${target}"

STEP 1 — Transcribe exactly what you heard in the audio.
STEP 2 — Compare every word to the target sentence "${target}".
STEP 3 — Score using this table:

| What you heard | Score range |
|---|---|
| Silence, noise, or completely unrelated sounds | 0–5 |
| A completely different sentence with no matching words | 0–15 |
| Attempted but fewer than half the words match | 16–45 |
| More than half the words match but with clear errors | 46–69 |
| All words recognisable with only minor pronunciation errors | 70–84 |
| Near-native pronunciation of the full sentence | 85–100 |

CRITICAL RULES:
1. Every single word in the sentence must be attempted to score above 45.
2. If the learner skips, replaces, or garbles more than one word, the score MUST be below 50.
3. Saying a different sentence fluently still scores 0–15 — only the correct target sentence earns credit.
4. Do not be generous. A score of 70+ means a native speaker would clearly recognise the full sentence.

Respond with ONLY valid JSON (no markdown, no extra text):
{"score": <integer 0-100>, "heardAs": "<phonetic of what you heard>", "tip": "<one coaching tip, max 12 words>"}

Example: {"score": 58, "heardAs": "I hav won kwik kwes-chen", "tip": "Good flow! Crisp up the 'tion' ending."}`
    : `You are a strict pronunciation scoring system for an English learning app.

The learner was supposed to say the single word: "${target}"

STEP 1 — Transcribe exactly what sound you heard in the audio.
STEP 2 — Decide if it phonetically resembles "${target}". If it does NOT, the score MUST be 0–15.
STEP 3 — Score using these rules:

| What you heard | Score range |
|---|---|
| Silence, noise, or completely unrelated sounds | 0–5 |
| A real English word that is NOT "${target}" (e.g. "krah-koo", "brakula", "peeking", "swam-ik") | 0–15 |
| Attempted "${target}" but barely recognisable | 16–45 |
| Recognisably "${target}" with clear errors | 46–69 |
| Clearly "${target}" with only minor accent issues | 70–84 |
| Near-native pronunciation of "${target}" | 85–100 |

CRITICAL RULE: A clearly-spoken word that is NOT "${target}" still scores 0–15. Fluent English pronunciation of the WRONG word earns no credit. Only the correct target word earns a score above 15.

Respond with ONLY valid JSON (no markdown, no extra text):
{"score": <integer 0-100>, "heardAs": "<phonetic of what you heard, e.g. krah-koo>", "tip": "<one coaching tip, max 12 words>"}`;

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });

    const result = await model.generateContent([
      { inlineData: { mimeType, data: base64 } },
      prompt,
    ]);

    const geminiMs = Date.now() - start;
    const text = result.response.text().trim();
    console.log("[analyze] Gemini responded in", geminiMs, "ms");
    console.log("[analyze] raw response:", text.slice(0, 300));

    // Strip markdown code fences if present
    const json = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = ResponseSchema.safeParse(JSON.parse(json));

    if (!parsed.success) {
      console.error("[analyze] ✗ schema parse failed:", parsed.error.flatten());
      return Response.json(FALLBACK);
    }

    const { score, heardAs, tip } = parsed.data;
    console.log("[analyze] ✓ score:", score, "| heardAs:", `"${heardAs}"`, "| tip:", `"${tip}"`);
    console.log("[analyze] ── done in", Date.now() - start, "ms ──────────────────");
    return Response.json(parsed.data);
  } catch (e) {
    console.error("[analyze] ✗ Gemini error after", Date.now() - start, "ms:", e);
    return Response.json(FALLBACK);
  }
}
