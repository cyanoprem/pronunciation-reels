const cache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();

let currentAudio: HTMLAudioElement | null = null;
let currentPlayPromise: Promise<void> | null = null;
let speakGeneration = 0;

async function fetchBlobUrl(text: string): Promise<string> {
  const inflight = pending.get(text);
  if (inflight) return inflight;

  const promise = (async () => {
    console.log("[tts] ── sending to Cartesia ──────────────────");
    console.log("[tts] text:", `"${text}"`);
    console.log("──────────────────────────────────────────────");
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
    console.log("[tts] ✓ cached:", `"${text}"`);
    return url;
  })().finally(() => {
    pending.delete(text);
  });

  pending.set(text, promise);
  return promise;
}

export async function speak(text: string): Promise<void> {
  if (typeof window === "undefined") return;

  // Stamp generation BEFORE any async work so the check after fetch is reliable
  const gen = ++speakGeneration;

  // Synchronously stop current audio. If play() hasn't resolved yet the browser
  // rejects it with AbortError — we catch that silently at the play() site below.
  currentAudio?.pause();
  currentAudio = null;
  currentPlayPromise = null;

  let url: string;
  try {
    url = cache.get(text) ?? await fetchBlobUrl(text);
  } catch (e) {
    console.error("[tts] could not get audio", e);
    return;
  }

  // A newer speak() fired while we were fetching — bail out
  if (gen !== speakGeneration) {
    console.log("[tts] speak cancelled (superseded):", text.slice(0, 40));
    return;
  }

  return new Promise((resolve) => {
    const audio = new Audio(url);
    currentAudio = audio;

    console.log("[tts] ▶ playing now:", `"${text}"`);
    audio.onended = () => { console.log("[tts] ■ finished:", `"${text}"`); currentPlayPromise = null; resolve(); };
    audio.onerror = (e) => {
      console.error("[tts] playback error", e);
      currentPlayPromise = null;
      resolve();
    };

    // Store play() promise so stopSpeaking() can await it before pausing
    currentPlayPromise = audio.play().catch((e) => {
      // AbortError is expected when pause() is called before play() resolves — silent
      if ((e as DOMException).name !== "AbortError") {
        console.error("[tts] play() rejected", e);
      }
      currentPlayPromise = null;
      resolve();
    });
  });
}

export async function stopSpeaking() {
  speakGeneration++; // cancels any in-flight speak() calls
  // Await the play promise before pausing so we don't trigger AbortError
  if (currentPlayPromise) {
    await currentPlayPromise.catch(() => {});
    currentPlayPromise = null;
  }
  currentAudio?.pause();
  currentAudio = null;
}
