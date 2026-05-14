export type RecorderError = "permission-denied" | "not-supported" | "unknown";

export interface Recorder {
  start: () => Promise<void>;
  stop: () => Promise<Blob>;
  getAnalyser: () => AnalyserNode | null;
  cleanup: () => void;
}

function pickMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
    "audio/ogg",
  ];
  for (const type of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return "";
}

export async function createRecorder(): Promise<Recorder> {
  if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    const err = new Error("not-supported") as Error & { code: RecorderError };
    err.code = "not-supported";
    throw err;
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    const err = new Error("permission-denied") as Error & { code: RecorderError };
    err.code =
      e instanceof DOMException && e.name === "NotAllowedError"
        ? "permission-denied"
        : "unknown";
    throw err;
  }

  const audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);

  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: BlobPart[] = [];

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  let stopResolve: ((blob: Blob) => void) | null = null;
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: mimeType || "audio/webm" });
    stopResolve?.(blob);
    stopResolve = null;
  };

  return {
    start: async () => {
      chunks.length = 0;
      recorder.start(100);
      console.log("[recorder] started, mimeType:", mimeType);
    },
    stop: () =>
      new Promise<Blob>((resolve) => {
        stopResolve = resolve;
        recorder.stop();
        console.log("[recorder] stopped");
      }),
    getAnalyser: () => analyser,
    cleanup: () => {
      try {
        recorder.state !== "inactive" && recorder.stop();
        stream.getTracks().forEach((t) => t.stop());
        audioCtx.close();
        console.log("[recorder] cleaned up");
      } catch (e) {
        console.error("[recorder] cleanup error", e);
      }
    },
  };
}
