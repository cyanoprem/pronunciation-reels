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
  console.log("[analyze] POST received");

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (e) {
    console.error("[analyze] failed to parse formData", e);
    return Response.json(FALLBACK);
  }

  const audio = formData.get("audio");
  const target = (formData.get("target") as string | null) ?? "";
  const mode = (formData.get("mode") as string | null) ?? "word";

  if (!audio || !(audio instanceof Blob) || !target) {
    console.error("[analyze] missing audio or target");
    return Response.json(FALLBACK);
  }

  const arrayBuffer = await audio.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const mimeType = audio.type || "audio/webm";

  const prompt = mode === "sentence"
    ? `You are a pronunciation coach. The learner was asked to say this sentence: "${target}"

Listen to the audio and respond with ONLY a JSON object (no markdown, no explanation) with these fields:
- "score": integer 0-100 (how accurately they pronounced the full sentence)
- "heardAs": a rough phonetic spelling of what they actually said (English spelling approximation)
- "tip": one short, encouraging coaching tip (max 12 words)

Example: {"score": 78, "heardAs": "I hav won kwik kwes-chen", "tip": "Great flow! Soften the 'qu' in question."}`
    : `You are a pronunciation coach. The learner was asked to say the word: "${target}"

Listen to the audio and respond with ONLY a JSON object (no markdown, no explanation) with these fields:
- "score": integer 0-100 (how accurately they pronounced this word)
- "heardAs": a rough phonetic spelling of what they actually said (English spelling approximation, like "kwesh-en")
- "tip": one short, encouraging coaching tip (max 12 words)

Example: {"score": 65, "heardAs": "kwesh-en", "tip": "Almost! It's 'kwes-chun', not 'kwesh-en'."}`;

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType,
          data: base64,
        },
      },
      prompt,
    ]);

    const text = result.response.text().trim();
    console.log("[analyze] raw Gemini response:", text.slice(0, 200));

    // Strip markdown code fences if present
    const json = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = ResponseSchema.safeParse(JSON.parse(json));

    if (!parsed.success) {
      console.error("[analyze] schema parse failed", parsed.error);
      return Response.json(FALLBACK);
    }

    console.log("[analyze] done in", Date.now() - start, "ms, score:", parsed.data.score);
    return Response.json(parsed.data);
  } catch (e) {
    console.error("[analyze] Gemini error", e);
    return Response.json(FALLBACK);
  }
}
