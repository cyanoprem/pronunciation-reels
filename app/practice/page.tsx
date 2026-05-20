"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useReducer, useEffect, useRef, useCallback, useState } from "react";
import { createRecorder, Recorder } from "@/lib/recorder";
import { speak, stopSpeaking } from "@/lib/tts";

// ─── Types ────────────────────────────────────────────────────────────────────

type Stage =
  | "intro"
  | "word-hint"
  | "recording"
  | "reviewing"
  | "analyzing"
  | "fail"
  | "pass-word"
  | "word-no-hint"
  | "sentence"
  | "sentence-recording"
  | "sentence-reviewing"
  | "sentence-analyzing"
  | "sentence-fail"
  | "sentence-pass"
  | "summary";

interface State {
  stage: Stage;
  wordScores: number[];
  sentenceScore: number | null;
  heardAs: string;
  tip: string;
  startedAt: number;
  micError: string | null;
}

type Action =
  | { type: "NEXT_STAGE"; stage: Stage }
  | { type: "ANALYZED"; score: number; heardAs: string; tip: string }
  | { type: "SENTENCE_ANALYZED"; score: number; heardAs: string; tip: string }
  | { type: "MIC_ERROR"; message: string }
  | { type: "CLEAR_MIC_ERROR" };

const PASS = 70;

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "NEXT_STAGE":
      return { ...state, stage: action.stage, micError: null };
    case "ANALYZED": {
      const pass = action.score >= PASS;
      return {
        ...state,
        wordScores: [...state.wordScores, action.score],
        heardAs: action.heardAs,
        tip: action.tip,
        stage: pass ? "pass-word" : "fail",
      };
    }
    case "SENTENCE_ANALYZED": {
      const pass = action.score >= PASS;
      return {
        ...state,
        sentenceScore: action.score,
        heardAs: action.heardAs,
        tip: action.tip,
        stage: pass ? "sentence-pass" : "sentence-fail",
      };
    }
    case "MIC_ERROR":
      return { ...state, micError: action.message, stage: "word-hint" };
    case "CLEAR_MIC_ERROR":
      return { ...state, micError: null };
    default:
      return state;
  }
}

const initialState: State = {
  stage: "word-hint",
  wordScores: [],
  sentenceScore: null,
  heardAs: "",
  tip: "",
  startedAt: Date.now(),
  micError: null,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function avgScore(scores: number[]): number {
  if (!scores.length) return 0;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

// ─── Shared UI atoms ──────────────────────────────────────────────────────────

function AvatarRing({ size = 144 }: { size?: number }) {
  return (
    <div
      className="rounded-full flex items-center justify-center overflow-hidden flex-shrink-0"
      style={{
        width: size,
        height: size,
        background: "linear-gradient(135deg, hsl(258 90% 66%), hsl(280 90% 60%))",
        padding: 4,
      }}
    >
      <div className="w-full h-full rounded-full overflow-hidden flex items-end justify-center" style={{ background: "#1a1d2e" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/avatar.png" alt="Tutor" className="w-full h-full object-cover object-top" />
      </div>
    </div>
  );
}

function SpeakerButton({ text, small, onPlayStart, onPlayEnd }: { text: string; small?: boolean; onPlayStart?: () => void; onPlayEnd?: () => void }) {
  const [playing, setPlaying] = useState(false);
  const handlePlay = useCallback(async () => {
    if (playing) return;
    setPlaying(true);
    onPlayStart?.();
    await speak(text);
    setPlaying(false);
    onPlayEnd?.();
  }, [text, playing, onPlayStart, onPlayEnd]);

  const sz = small ? 34 : 40;
  return (
    <button
      onClick={handlePlay}
      className="rounded-full flex items-center justify-center transition-opacity active:opacity-70"
      style={{ width: sz, height: sz, background: "rgba(255,255,255,0.12)" }}
      aria-label="Replay audio"
    >
      {playing ? (
        <svg xmlns="http://www.w3.org/2000/svg" width={small ? 14 : 18} height={small ? 14 : 18} viewBox="0 0 24 24" fill="white">
          <rect x="6" y="4" width="4" height="16" rx="1" />
          <rect x="14" y="4" width="4" height="16" rx="1" />
        </svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" width={small ? 14 : 18} height={small ? 14 : 18} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 5 6 9H2v6h4l5 4z" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </svg>
      )}
    </button>
  );
}

function MicButton({ onPress, loading }: { onPress: () => void; loading?: boolean }) {
  return (
    <button
      onClick={onPress}
      disabled={loading}
      className="w-20 h-20 rounded-full flex items-center justify-center transition-transform active:scale-95 disabled:opacity-60"
      style={{ background: "hsl(258 90% 66%)", boxShadow: "0 6px 28px hsl(258 90% 66% / 0.5)" }}
      aria-label="Start recording"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 24 24" fill="white">
        <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
        <path d="M19 10v1a7 7 0 0 1-14 0v-1" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" />
        <line x1="12" y1="18" x2="12" y2="22" stroke="white" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </button>
  );
}

function PhoneticChip({ phonetic }: { phonetic: string }) {
  return (
    <div
      className="flex items-center gap-2.5 rounded-2xl px-5 py-3"
      style={{ background: "hsl(228 25% 18%)" }}
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="white">
        <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
        <path d="M19 10v1a7 7 0 0 1-14 0v-1" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" />
        <line x1="12" y1="18" x2="12" y2="22" stroke="white" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span className="text-white font-semibold text-lg tracking-wide">{phonetic}</span>
    </div>
  );
}

function Header({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex items-center px-5 pt-6 pb-2">
      <button
        onClick={onClose}
        className="w-10 h-10 flex items-center justify-center text-white active:opacity-70"
        aria-label="Close"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}

// ─── Waveform ─────────────────────────────────────────────────────────────────

function Waveform({ analyser }: { analyser: AnalyserNode | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!analyser || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d")!;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const barCount = 28;
      const barWidth = 4;
      const gap = (canvas.width - barCount * barWidth) / (barCount + 1);
      const step = Math.floor(bufferLength / barCount);

      for (let i = 0; i < barCount; i++) {
        const value = dataArray[i * step] / 255;
        const height = Math.max(4, value * canvas.height * 0.9);
        const x = gap + i * (barWidth + gap);
        const y = (canvas.height - height) / 2;
        ctx.fillStyle = `rgba(255,255,255,${0.4 + value * 0.6})`;
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, height, 2);
        ctx.fill();
      }
    };
    draw();

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [analyser]);

  return (
    <canvas
      ref={canvasRef}
      width={240}
      height={60}
      className="rounded-xl w-full"
      style={{ background: "rgba(255,255,255,0.06)" }}
    />
  );
}

// ─── Stage Views ──────────────────────────────────────────────────────────────

function IntroView({ word, onSkip }: { word: string; onSkip: () => void }) {
  useEffect(() => {
    console.log("[practice] stage: intro — word:", word);
    speak(`Let's practice pronouncing the word: ${word}. Tap the mic when you're ready.`).catch(() => {});
    const t = setTimeout(() => { console.log("[practice] intro auto-advanced"); onSkip(); }, 3200);
    return () => clearTimeout(t);
  }, [word, onSkip]);

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6">
      <AvatarRing />
      <p className="text-white text-xl font-semibold text-center leading-snug">
        Let's practice pronouncing this word!
      </p>
      <button onClick={onSkip} className="text-white/40 text-sm mt-2 active:opacity-70">
        Tap to continue
      </button>
    </div>
  );
}

function WordView({
  word,
  phonetic,
  showPhonetic,
  onMicPress,
  micError,
  onClearMicError,
  recordingStage,
  analyser,
  onCancel,
  onStopAndSubmit,
}: {
  word: string;
  phonetic: string;
  showPhonetic: boolean;
  onMicPress: () => void;
  micError: string | null;
  onClearMicError: () => void;
  recordingStage?: "recording" | "analyzing";
  analyser?: AnalyserNode | null;
  onCancel?: () => void;
  onStopAndSubmit?: () => void;
}) {
  const [ttsPlaying, setTtsPlaying] = useState(true);
  const didRecordRef = useRef(false);

  useEffect(() => {
    if (recordingStage) {
      didRecordRef.current = true; // mic was used
      return;
    }
    if (didRecordRef.current) {
      // returning from a cancelled recording — skip auto-play
      didRecordRef.current = false;
      setTtsPlaying(false);
      return;
    }
    console.log("[practice] stage:", showPhonetic ? "word-hint" : "word-no-hint", "— speaking word:", word);
    setTtsPlaying(true);
    const ttsText = showPhonetic
      ? `Now you try saying it. ${word}.`
      : `Now try saying it without the hint. ${word}.`;
    const t = setTimeout(() => {
      speak(ttsText)
        .catch(() => {})
        .finally(() => setTtsPlaying(false));
    }, 50);
    return () => clearTimeout(t);
  }, [word, showPhonetic, recordingStage]);

  const tutorText =
    recordingStage === "recording" ? "Listening..." :
    recordingStage === "analyzing" ? "Analyzing..." :
    showPhonetic ? "Now you try saying it" : "Now try again without seeing the Hint";

  return (
    <div className="flex-1 flex flex-col items-center px-6 pt-4 gap-5">
      <AvatarRing size={112} />
      <p className="text-white text-xl font-bold text-center">{tutorText}</p>

      <div
        className="w-full rounded-3xl p-6"
        style={{ background: "hsl(228 22% 13%)", border: "1px solid hsl(228 20% 22%)" }}
      >
        <h2 className="text-center text-3xl font-bold text-white mb-4">{word}</h2>
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1" style={!showPhonetic ? { filter: "blur(7px)", userSelect: "none", pointerEvents: "none" } : undefined}>
            <PhoneticChip phonetic={phonetic} />
          </div>
          {showPhonetic && !recordingStage && (
            <SpeakerButton
              text={`Now you try saying it. ${word}.`}
              small
              onPlayStart={() => setTtsPlaying(true)}
              onPlayEnd={() => setTtsPlaying(false)}
            />
          )}
        </div>
      </div>

      {micError && !recordingStage && (
        <div
          className="w-full rounded-xl px-4 py-3 flex items-start gap-3"
          style={{ background: "hsl(0 60% 18%)", border: "1px solid hsl(0 70% 30%)" }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" className="flex-shrink-0 mt-0.5">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p className="text-red-300 text-sm flex-1">{micError}</p>
          <button onClick={onClearMicError} className="text-red-300/60 text-xs underline flex-shrink-0">Dismiss</button>
        </div>
      )}

      {/* IDLE — mic button */}
      {!recordingStage && (
        <div className="flex-1 flex items-end justify-center pb-8">
          <div className="flex flex-col items-center gap-3">
            <MicButton onPress={onMicPress} loading={ttsPlaying} />
            <p className="text-white/40 text-xs">{ttsPlaying ? "Listen first…" : "Tap to record"}</p>
          </div>
        </div>
      )}

      {/* RECORDING — unified bar: trash | live waveform | tick (stop+submit) */}
      {recordingStage === "recording" && (
        <div className="flex-1 flex items-end pb-8 w-full">
          <div className="w-full flex items-center gap-3">
            <button
              onClick={onCancel}
              className="w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0 transition-opacity active:opacity-70"
              style={{ background: "hsl(228 22% 20%)" }}
              aria-label="Cancel recording"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" />
              </svg>
            </button>
            <div className="flex-1 min-w-0">
              <Waveform analyser={analyser ?? null} />
            </div>
            <button
              onClick={onStopAndSubmit}
              className="w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0 transition-opacity active:opacity-70"
              style={{ background: "hsl(258 90% 66%)", boxShadow: "0 4px 16px hsl(258 90% 66% / 0.4)" }}
              aria-label="Submit recording"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* ANALYZING — inline bottom bar */}
      {recordingStage === "analyzing" && (
        <div className="flex-1 flex items-end pb-8 w-full">
          <div
            className="w-full rounded-2xl py-5 flex flex-col items-center gap-3"
            style={{ background: "hsl(228 22% 13%)", border: "1px solid hsl(228 20% 22%)" }}
          >
            <svg className="animate-spin" xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="hsl(258 90% 76%)" strokeWidth="2.5" strokeLinecap="round">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            <p className="text-white/70 text-sm font-semibold tracking-wide">Analysing audio...</p>
          </div>
        </div>
      )}
    </div>
  );
}


function FailView({
  word,
  phonetic,
  onRetry,
}: {
  word: string;
  phonetic?: string;
  onRetry: () => void;
}) {
  useEffect(() => {
    console.log("[practice] stage: fail — word:", word);
  }, [word]);

  return (
    <div className="flex-1 flex flex-col items-center px-6 pt-4">
      <AvatarRing size={112} />

      <p className="mt-5 text-xl font-bold text-center" style={{ color: "hsl(38 95% 62%)" }}>
        Not quite there<br />Try again
      </p>

      <div
        className="w-full rounded-3xl p-6 mt-5"
        style={{ background: "hsl(228 22% 13%)", border: "2px solid hsl(38 95% 55%)" }}
      >
        {phonetic ? (
          <>
            <h2 className="text-center text-3xl font-bold text-white mb-4">{word}</h2>
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2.5 rounded-2xl px-5 py-3" style={{ background: "hsl(228 25% 18%)" }}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="hsl(38 95% 62%)">
                    <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                    <path d="M19 10v1a7 7 0 0 1-14 0v-1" stroke="hsl(38 95% 62%)" strokeWidth="2" fill="none" strokeLinecap="round" />
                    <line x1="12" y1="18" x2="12" y2="22" stroke="hsl(38 95% 62%)" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  <span className="font-semibold text-lg tracking-wide" style={{ color: "hsl(38 95% 62%)" }}>{phonetic}</span>
                </div>
              </div>
              <SpeakerButton text={`The correct pronunciation is. ${word}.`} small />
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="flex-1 text-white text-lg font-medium leading-relaxed">{word}</p>
            <SpeakerButton text={`Now say the full sentence. ${word}`} small />
          </div>
        )}
      </div>

      <div className="flex-1 flex items-end pb-8 w-full">
        <button
          onClick={onRetry}
          className="w-full py-4 rounded-2xl font-bold text-white text-sm tracking-widest uppercase transition-opacity active:opacity-70"
          style={{ background: "hsl(258 90% 66%)", boxShadow: "0 6px 24px hsl(258 90% 66% / 0.4)" }}
        >
          Try Again
        </button>
      </div>
    </div>
  );
}

function PassWordView({
  word,
  phonetic,
  onNext,
  nextLabel = "Next",
}: {
  word: string;
  phonetic?: string;
  onNext: () => void;
  nextLabel?: string;
}) {
  useEffect(() => {
    console.log("[practice] stage: pass-word — word:", word);
  }, [word]);

  return (
    <div className="flex-1 flex flex-col items-center px-6 pt-4">
      <AvatarRing size={112} />

      <p className="mt-5 text-xl font-bold text-center" style={{ color: "#4ade80" }}>
        🎉 Great job
      </p>

      <div
        className="w-full rounded-3xl p-6 mt-5"
        style={{ background: "hsl(228 22% 13%)", border: "2px solid hsl(142 60% 38%)" }}
      >
        {phonetic ? (
          <>
            <h2 className="text-center text-3xl font-bold text-white mb-4">{word}</h2>
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2.5 rounded-2xl px-5 py-3" style={{ background: "hsl(228 25% 18%)" }}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="white">
                    <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                    <path d="M19 10v1a7 7 0 0 1-14 0v-1" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" />
                    <line x1="12" y1="18" x2="12" y2="22" stroke="white" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  <span className="text-white font-semibold text-lg tracking-wide">{phonetic}</span>
                </div>
              </div>
              <SpeakerButton text={`Say. ${word}.`} small />
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <p className="flex-1 text-white text-lg font-medium leading-relaxed">{word}</p>
            <SpeakerButton text={`Now say the full sentence. ${word}`} small />
          </div>
        )}
      </div>

      <div className="flex-1 flex items-end pb-8 w-full">
        <button
          onClick={onNext}
          className="w-full py-4 rounded-2xl font-bold text-white text-sm tracking-widest uppercase transition-opacity active:opacity-70"
          style={{ background: "hsl(258 90% 66%)", boxShadow: "0 6px 24px hsl(258 90% 66% / 0.4)" }}
        >
          {nextLabel}
        </button>
      </div>
    </div>
  );
}

function SentenceView({
  sentence,
  word,
  onMicPress,
  micError,
  onClearMicError,
  recordingStage,
  analyser,
  onCancel,
  onStopAndSubmit,
}: {
  sentence: string;
  word: string;
  onMicPress: () => void;
  micError: string | null;
  onClearMicError: () => void;
  recordingStage?: "recording" | "analyzing";
  analyser?: AnalyserNode | null;
  onCancel?: () => void;
  onStopAndSubmit?: () => void;
}) {
  const [ttsPlaying, setTtsPlaying] = useState(true);
  const didRecordRef = useRef(false);

  useEffect(() => {
    if (recordingStage) {
      didRecordRef.current = true;
      return;
    }
    if (didRecordRef.current) {
      didRecordRef.current = false;
      setTtsPlaying(false);
      return;
    }
    console.log("[practice] stage: sentence — sentence:", sentence);
    setTtsPlaying(true);
    const t = setTimeout(() => {
      speak(`Now say the full sentence. ${sentence}`)
        .catch(() => {})
        .finally(() => setTtsPlaying(false));
    }, 50);
    return () => clearTimeout(t);
  }, [sentence, recordingStage]);

  const tutorText =
    recordingStage === "recording" ? "Listening..." :
    recordingStage === "analyzing" ? "Analyzing..." :
    "Now say the full sentence!";

  return (
    <div className="flex-1 flex flex-col items-center px-6 pt-4 gap-5">
      <AvatarRing size={112} />
      <p className="text-white text-xl font-bold text-center">{tutorText}</p>

      <div
        className="w-full rounded-3xl p-6"
        style={{ background: "hsl(228 22% 13%)", border: "1px solid hsl(228 20% 22%)" }}
      >
        <p className="text-white text-xl font-medium text-center leading-relaxed">
          {sentence.split(new RegExp(`(${word})`, "i")).map((part, i) =>
            part.toLowerCase() === word.toLowerCase() ? (
              <mark key={i} className="bg-transparent font-bold" style={{ color: "hsl(258 90% 76%)" }}>
                {part}
              </mark>
            ) : (
              <span key={i}>{part}</span>
            )
          )}
        </p>
        {!recordingStage && (
          <div className="mt-4 flex justify-center">
            <SpeakerButton
              text={`Now say the full sentence. ${sentence}`}
              onPlayStart={() => setTtsPlaying(true)}
              onPlayEnd={() => setTtsPlaying(false)}
            />
          </div>
        )}
      </div>

      {micError && !recordingStage && (
        <div
          className="w-full rounded-xl px-4 py-3 flex items-start gap-3"
          style={{ background: "hsl(0 60% 18%)", border: "1px solid hsl(0 70% 30%)" }}
        >
          <p className="text-red-300 text-sm flex-1">{micError}</p>
          <button onClick={onClearMicError} className="text-red-300/60 text-xs underline flex-shrink-0">Dismiss</button>
        </div>
      )}

      {/* IDLE — mic button */}
      {!recordingStage && (
        <div className="flex-1 flex items-end justify-center pb-8">
          <div className="flex flex-col items-center gap-3">
            <MicButton onPress={onMicPress} loading={ttsPlaying} />
            <p className="text-white/40 text-xs">{ttsPlaying ? "Listen first…" : "Tap to record"}</p>
          </div>
        </div>
      )}

      {/* RECORDING — unified bar: trash | waveform | tick */}
      {recordingStage === "recording" && (
        <div className="flex-1 flex items-end pb-8 w-full">
          <div className="w-full flex items-center gap-3">
            <button
              onClick={onCancel}
              className="w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0 transition-opacity active:opacity-70"
              style={{ background: "hsl(228 22% 20%)" }}
              aria-label="Cancel recording"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" />
              </svg>
            </button>
            <div className="flex-1 min-w-0">
              <Waveform analyser={analyser ?? null} />
            </div>
            <button
              onClick={onStopAndSubmit}
              className="w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0 transition-opacity active:opacity-70"
              style={{ background: "hsl(258 90% 66%)", boxShadow: "0 4px 16px hsl(258 90% 66% / 0.4)" }}
              aria-label="Submit recording"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* ANALYZING — inline bottom bar */}
      {recordingStage === "analyzing" && (
        <div className="flex-1 flex items-end pb-8 w-full">
          <div
            className="w-full rounded-2xl py-5 flex flex-col items-center gap-3"
            style={{ background: "hsl(228 22% 13%)", border: "1px solid hsl(228 20% 22%)" }}
          >
            <svg className="animate-spin" xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="hsl(258 90% 76%)" strokeWidth="2.5" strokeLinecap="round">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            <p className="text-white/70 text-sm font-semibold tracking-wide">Analysing audio...</p>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryView({
  word,
  phonetic,
  wordScores,
  sentenceScore,
  elapsedMs,
  onFinish,
}: {
  word: string;
  phonetic: string;
  wordScores: number[];
  sentenceScore: number | null;
  elapsedMs: number;
  onFinish: () => void;
}) {
  const allScores = sentenceScore != null ? [...wordScores, sentenceScore] : wordScores;
  const avg = avgScore(allScores);
  const scoreColor = avg >= 85 ? "#4ade80" : avg >= 70 ? "#facc15" : "#fb923c";

  useEffect(() => {
    console.log("[practice] stage: summary — word:", word, "| scores:", wordScores, "| sentence:", sentenceScore, "| avg:", avg, "| time:", formatTime(elapsedMs));
  }, [avg, word, wordScores, sentenceScore, elapsedMs]);

  return (
    <div className="flex-1 flex flex-col items-center justify-between px-6 pt-6 pb-8">
      <div className="flex flex-col items-center gap-4 flex-1 justify-center w-full">
        <div style={{ fontSize: 72, lineHeight: 1 }}>🎉</div>
        <p className="text-white text-2xl font-bold text-center">Good Job!</p>
        <p className="text-white/50 text-sm text-center">You learned something new</p>

        <div
          className="w-full rounded-3xl p-6 mt-2 flex flex-col gap-5"
          style={{ background: "hsl(228 22% 13%)", border: "1px solid hsl(228 20% 22%)" }}
        >
          <div className="flex flex-col items-center gap-1">
            <p className="text-white text-2xl font-bold">{word}</p>
            <p className="font-semibold text-base" style={{ color: "hsl(258 90% 76%)" }}>{phonetic}</p>
          </div>

          <div className="w-full h-px" style={{ background: "hsl(228 20% 22%)" }} />

          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span style={{ fontSize: 18 }}>⚡</span>
                <span className="text-white/70 text-sm font-medium">Speaking score</span>
              </div>
              <span className="font-bold text-base tabular-nums" style={{ color: scoreColor }}>{avg}%</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span style={{ fontSize: 18 }}>🕐</span>
                <span className="text-white/70 text-sm font-medium">Learning time</span>
              </div>
              <span className="font-bold text-base tabular-nums" style={{ color: "#f472b6" }}>{formatTime(elapsedMs)}</span>
            </div>
          </div>
        </div>
      </div>

      <button
        onClick={onFinish}
        className="w-full py-4 rounded-2xl font-bold text-white text-base transition-opacity active:opacity-70"
        style={{ background: "hsl(258 90% 66%)", boxShadow: "0 6px 24px hsl(258 90% 66% / 0.4)" }}
      >
        Next Reel →
      </button>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

function PracticeFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const word = searchParams.get("word") ?? "Question";
  const phonetic = searchParams.get("phonetic") ?? "Kwes-chun";
  const sentence = searchParams.get("sentence") ?? "I have one quick question.";
  const videoId = parseInt(searchParams.get("videoId") ?? "1", 10);
  const total = parseInt(searchParams.get("total") ?? "20", 10);

  const [state, dispatch] = useReducer(reducer, {
    ...initialState,
    startedAt: Date.now(),
  });

  const recorderRef = useRef<Recorder | null>(null);
  const blobRef = useRef<Blob | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  const cleanupRecorder = useCallback(() => {
    recorderRef.current?.cleanup();
    recorderRef.current = null;
    analyserRef.current = null;
    setAnalyser(null);
    blobRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      cleanupRecorder();
      void stopSpeaking();
    };
  }, [cleanupRecorder]);

  const handleClose = useCallback(() => {
    cleanupRecorder();
    void stopSpeaking();
    router.push(`/?next=${videoId}`);
  }, [router, cleanupRecorder, videoId]);

  const handleMicPress = useCallback(async (forSentence = false) => {
    console.log("[practice] mic pressed, stage:", state.stage);
    try {
      const rec = await createRecorder();
      recorderRef.current = rec;
      analyserRef.current = rec.getAnalyser();
      setAnalyser(analyserRef.current);
      await rec.start();
      dispatch({ type: "NEXT_STAGE", stage: forSentence ? "sentence-recording" : "recording" });
    } catch (e: unknown) {
      const code = (e as { code?: string }).code;
      const msg =
        code === "permission-denied"
          ? "Mic access needed to practice. Please allow microphone access and try again."
          : code === "not-supported"
          ? "Your browser doesn't support audio recording. Please try Chrome or Safari."
          : "Could not access microphone. Please try again.";
      console.error("[practice] mic error", e);
      dispatch({ type: "MIC_ERROR", message: msg });
    }
  }, [state.stage]);

  const handleStopAndSubmit = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec) return;
    const blob = await rec.stop();
    blobRef.current = blob;
    console.log("[practice] stop+submit —", Math.round(blob.size / 1024), "KB → analyzing");
    dispatch({ type: "NEXT_STAGE", stage: "analyzing" });
    const formData = new FormData();
    formData.append("audio", blob, "recording.webm");
    formData.append("target", word);
    formData.append("mode", "word");
    try {
      const res = await fetch("/api/analyze", { method: "POST", body: formData });
      const data = await res.json() as { score: number; heardAs: string; tip: string };
      console.log("[practice] analyze result:", data);
      dispatch({ type: "ANALYZED", ...data });
    } catch (e) {
      console.error("[practice] stop+submit error", e);
      dispatch({ type: "ANALYZED", score: 0, heardAs: "—", tip: "Network error. Try again." });
    }
  }, [word]);

  const handleSentenceStopAndSubmit = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec) return;
    const blob = await rec.stop();
    blobRef.current = blob;
    console.log("[practice] sentence stop+submit —", Math.round(blob.size / 1024), "KB → sentence-analyzing");
    dispatch({ type: "NEXT_STAGE", stage: "sentence-analyzing" });
    const formData = new FormData();
    formData.append("audio", blob, "recording.webm");
    formData.append("target", sentence);
    formData.append("mode", "sentence");
    try {
      const res = await fetch("/api/analyze", { method: "POST", body: formData });
      const data = await res.json() as { score: number; heardAs: string; tip: string };
      console.log("[practice] sentence analyze result:", data);
      dispatch({ type: "SENTENCE_ANALYZED", ...data });
    } catch (e) {
      console.error("[practice] sentence stop+submit error", e);
      dispatch({ type: "SENTENCE_ANALYZED", score: 0, heardAs: "—", tip: "Network error. Try again." });
    }
  }, [sentence]);

  const handleFinish = useCallback(() => {
    void stopSpeaking();
    const nextId = videoId + 1;
    if (nextId > total) {
      console.log("[practice] finish — videoId:", videoId, "→ returning to feed start (no next card)");
      router.push("/");
    } else {
      console.log("[practice] finish — videoId:", videoId, "→ advancing to card:", nextId);
      router.push(`/?next=${nextId}`);
    }
  }, [router, videoId, total]);

  const { stage, wordScores, sentenceScore, heardAs, tip, startedAt, micError } = state;

  const renderStage = () => {
    switch (stage) {
      case "intro":
        return (
          <IntroView
            word={word}
            onSkip={() => dispatch({ type: "NEXT_STAGE", stage: "word-hint" })}
          />
        );

      case "word-hint":
        return (
          <WordView
            word={word}
            phonetic={phonetic}
            showPhonetic={true}
            onMicPress={() => handleMicPress(false)}
            micError={micError}
            onClearMicError={() => dispatch({ type: "CLEAR_MIC_ERROR" })}
          />
        );

      case "recording": {
        const showHint = wordScores.filter(s => s >= PASS).length === 0;
        return (
          <WordView
            word={word} phonetic={phonetic} showPhonetic={showHint}
            onMicPress={() => handleMicPress(false)}
            micError={micError} onClearMicError={() => dispatch({ type: "CLEAR_MIC_ERROR" })}
            recordingStage="recording" analyser={analyser}
            onCancel={() => { cleanupRecorder(); dispatch({ type: "NEXT_STAGE", stage: showHint ? "word-hint" : "word-no-hint" }); }}
            onStopAndSubmit={handleStopAndSubmit}
          />
        );
      }

      case "reviewing":
        // word reviewing is now skipped — tick submits directly from recording bar
        // fall through to show the same inline analyzing view
        // eslint-disable-next-line no-fallthrough
      case "analyzing": {
        const showHint = wordScores.filter(s => s >= PASS).length === 0;
        return (
          <WordView
            word={word} phonetic={phonetic} showPhonetic={showHint}
            onMicPress={() => handleMicPress(false)}
            micError={micError} onClearMicError={() => dispatch({ type: "CLEAR_MIC_ERROR" })}
            recordingStage="analyzing"
          />
        );
      }

      case "fail": {
        const retryStage = wordScores.some(s => s >= PASS) ? "word-no-hint" : "word-hint";
        return (
          <FailView
            word={word}
            phonetic={phonetic}
            onRetry={() => {
              cleanupRecorder();
              dispatch({ type: "NEXT_STAGE", stage: retryStage });
            }}
          />
        );
      }

      case "pass-word": {
        // Count only passing scores — failures also push to wordScores so .length is unreliable
        const passingCount = wordScores.filter(s => s >= PASS).length;
        return (
          <PassWordView
            word={word}
            phonetic={phonetic}
            nextLabel="Next"
            onNext={() => {
              cleanupRecorder();
              dispatch({ type: "NEXT_STAGE", stage: passingCount >= 2 ? "sentence" : "word-no-hint" });
            }}
          />
        );
      }

      case "word-no-hint":
        return (
          <WordView
            word={word}
            phonetic={phonetic}
            showPhonetic={false}
            onMicPress={() => handleMicPress(false)}
            micError={micError}
            onClearMicError={() => dispatch({ type: "CLEAR_MIC_ERROR" })}
          />
        );

      case "sentence":
        return (
          <SentenceView
            sentence={sentence} word={word}
            onMicPress={() => handleMicPress(true)}
            micError={micError} onClearMicError={() => dispatch({ type: "CLEAR_MIC_ERROR" })}
          />
        );

      case "sentence-recording":
        return (
          <SentenceView
            sentence={sentence} word={word}
            onMicPress={() => handleMicPress(true)}
            micError={micError} onClearMicError={() => dispatch({ type: "CLEAR_MIC_ERROR" })}
            recordingStage="recording" analyser={analyser}
            onCancel={() => { cleanupRecorder(); dispatch({ type: "NEXT_STAGE", stage: "sentence" }); }}
            onStopAndSubmit={handleSentenceStopAndSubmit}
          />
        );

      // sentence-reviewing is now skipped — tick submits directly
      case "sentence-reviewing":
      case "sentence-analyzing":
        return (
          <SentenceView
            sentence={sentence} word={word}
            onMicPress={() => handleMicPress(true)}
            micError={micError} onClearMicError={() => dispatch({ type: "CLEAR_MIC_ERROR" })}
            recordingStage="analyzing"
          />
        );

      case "sentence-fail":
        return (
          <FailView
            word={sentence}
            onRetry={() => {
              cleanupRecorder();
              dispatch({ type: "NEXT_STAGE", stage: "sentence" });
            }}
          />
        );

      case "sentence-pass":
        return (
          <PassWordView
            word={sentence}
            nextLabel="See Results"
            onNext={() => dispatch({ type: "NEXT_STAGE", stage: "summary" })}
          />
        );

      case "summary":
        return (
          <SummaryView
            word={word}
            phonetic={phonetic}
            wordScores={wordScores}
            sentenceScore={sentenceScore}
            elapsedMs={Date.now() - startedAt}
            onFinish={handleFinish}
          />
        );
    }
  };

  return (
    <div className="absolute inset-0 flex flex-col" style={{ background: "#0A0B14" }}>
      <Header onClose={handleClose} />
      {renderStage()}
    </div>
  );
}

export default function Practice() {
  return (
    <Suspense>
      <PracticeFlow />
    </Suspense>
  );
}
