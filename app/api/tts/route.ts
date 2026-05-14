import { z } from "zod";

// Sonic English — warm, clear female voice
const CARTESIA_VOICE_ID = "95d51f79-c397-46f9-b49a-23763d3eaa2d";
const CARTESIA_API_VERSION = "2024-06-10";

const BodySchema = z.object({
  text: z.string().min(1).max(500),
});

export async function POST(request: Request) {
  const start = Date.now();
  console.log("[tts] POST received");

  let body: unknown;
  try {
    body = await request.json();
  } catch (e) {
    console.error("[tts] invalid JSON body", e);
    return new Response("Bad request", { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    console.error("[tts] schema invalid", parsed.error);
    return new Response("Bad request", { status: 400 });
  }

  const { text } = parsed.data;

  try {
    const res = await fetch("https://api.cartesia.ai/tts/bytes", {
      method: "POST",
      headers: {
        "Cartesia-Version": CARTESIA_API_VERSION,
        "X-API-Key": process.env.CARTESIA_API_KEY!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model_id: "sonic-english",
        transcript: text,
        voice: {
          mode: "id",
          id: CARTESIA_VOICE_ID,
        },
        output_format: {
          container: "mp3",
          encoding: "mp3",
          sample_rate: 44100,
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error("[tts] Cartesia error", res.status, detail.slice(0, 200));
      return new Response("TTS unavailable", { status: 502 });
    }

    const audioBuffer = await res.arrayBuffer();
    console.log("[tts] done in", Date.now() - start, "ms,", audioBuffer.byteLength, "bytes");

    return new Response(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch (e) {
    console.error("[tts] fetch error", e);
    return new Response("TTS unavailable", { status: 502 });
  }
}
