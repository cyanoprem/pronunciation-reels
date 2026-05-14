const cache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();

let currentAudio: HTMLAudioElement | null = null;
let speakGeneration = 0;

async function fetchBlobUrl(text: string): Promise<string> {
  // If already in-flight, return the same promise — collapses concurrent calls into one fetch
  const inflight = pending.get(text);
  if (inflight) return inflight;

  const promise = (async () => {
    console.log("[tts] fetching audio for:", text.slice(0, 40));
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const detail = await res.text();
      console.error("[tts] request failed", res.status, detail.slice(0, 100));
      throw new Error(`TTS failed: ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    cache.set(text, url);
    console.log("[tts] cached audio for:", text.slice(0, 40));
    return url;
  })().finally(() => {
    pending.delete(text);
  });

  pending.set(text, promise);
  return promise;
}

export async function speak(text: string): Promise<void> {
  if (typeof window === "undefined") return;

  // Stop whatever is currently playing
  currentAudio?.pause();
  currentAudio = null;

  // Stamp this call — if a newer speak() fires while we're fetching, we bail out
  const gen = ++speakGeneration;

  let url: string;
  try {
    url = cache.get(text) ?? await fetchBlobUrl(text);
  } catch (e) {
    console.error("[tts] could not get audio", e);
    return;
  }

  // A newer speak() was called while we were fetching — don't play stale audio
  if (gen !== speakGeneration) {
    console.log("[tts] speak cancelled (superseded):", text.slice(0, 40));
    return;
  }

  return new Promise((resolve) => {
    const audio = new Audio(url);
    currentAudio = audio;
    audio.onended = () => resolve();
    audio.onerror = (e) => {
      console.error("[tts] playback error", e);
      resolve();
    };
    audio.play().catch((e) => {
      console.error("[tts] play() rejected", e);
      resolve();
    });
  });
}

export function stopSpeaking() {
  speakGeneration++; // Cancels any in-flight speak() calls
  currentAudio?.pause();
  currentAudio = null;
}
