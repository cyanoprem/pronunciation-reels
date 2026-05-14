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
  stage: "intro",
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

function SpeakerButton({ text, small }: { text: string; small?: boolean }) {
  const [playing, setPlaying] = useState(false);
  const handlePlay = useCallback(async () => {
    if (playing) return;
    setPlaying(true);
    await speak(text);
    setPlaying(false);
  }, [text, playing]);

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
      className="rounded-xl"
      style={{ background: "rgba(255,255,255,0.06)" }}
    />
  );
}

// ─── Stage Views ──────────────────────────────────────────────────────────────

function IntroView({ word, onSkip }: { word: string; onSkip: () => void }) {
  useEffect(() => {
    speak(`Let's practice pronouncing the word: ${word}. Tap the mic when you're ready.`).catch(() => {});
    const t = setTimeout(onSkip, 3200);
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
}: {
  word: string;
  phonetic: string;
  showPhonetic: boolean;
  onMicPress: () => void;
  micError: string | null;
  onClearMicError: () => void;
}) {
  // spokenText uses the real word so Cartesia speaks it correctly
  // tutorText (phonetic) is only for the visual chip and speaker-button replay
  const spokenText = showPhonetic
    ? `It's pronounced: ${word}`
    : `Now try saying ${word} without any hints!`;
  const speakerButtonText = showPhonetic
    ? `It's pronounced: ${word}`
    : spokenText;

  useEffect(() => {
    speak(spokenText).catch(() => {});
  }, [spokenText]);

  return (
    <div className="flex-1 flex flex-col items-center px-6 pt-4 gap-5">
      <AvatarRing size={112} />
      <p className="text-white/70 text-sm font-medium">
        {showPhonetic ? "It's pronounced as:" : "Now try without hints!"}
      </p>

      <div
        className="w-full rounded-3xl p-6"
        style={{ background: "hsl(228 22% 13%)", border: "1px solid hsl(228 20% 22%)" }}
      >
        <h2 className="text-center text-3xl font-bold text-white mb-4">{word}</h2>
        {showPhonetic && (
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1">
              <PhoneticChip phonetic={phonetic} />
            </div>
            <SpeakerButton text={speakerButtonText} small />
          </div>
        )}
      </div>

      {micError && (
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

      <div className="flex-1 flex items-end justify-center pb-8">
        <div className="flex flex-col items-center gap-3">
          <MicButton onPress={onMicPress} />
          <p className="text-white/40 text-xs">Tap to record</p>
        </div>
      </div>
    </div>
  );
}

function RecordingView({
  analyser,
  onStop,
}: {
  analyser: AnalyserNode | null;
  onStop: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-8 px-6">
      <p className="text-white/60 text-sm font-medium">Recording…</p>
      <Waveform analyser={analyser} />
      <button
        onClick={onStop}
        className="w-16 h-16 rounded-full flex items-center justify-center transition-transform active:scale-95"
        style={{ background: "hsl(0 80% 55%)", boxShadow: "0 6px 20px hsl(0 80% 55% / 0.4)" }}
        aria-label="Stop recording"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="white">
          <rect x="4" y="4" width="16" height="16" rx="2" />
        </svg>
      </button>
    </div>
  );
}

function ReviewingView({
  blobUrl,
  onRedo,
  onSubmit,
  label,
}: {
  blobUrl: string;
  onRedo: () => void;
  onSubmit: () => void;
  label?: string;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-8 px-6">
      <p className="text-white/60 text-sm font-medium">{label ?? "How did that sound?"}</p>
      <div className="w-full rounded-2xl p-4" style={{ background: "hsl(228 22% 13%)" }}>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio controls src={blobUrl} className="w-full" style={{ accentColor: "hsl(258 90% 66%)" }} />
      </div>
      <div className="flex gap-4 w-full">
        <button
          onClick={onRedo}
          className="flex-1 py-3.5 rounded-xl font-semibold text-white text-sm transition-opacity active:opacity-70"
          style={{ background: "hsl(228 22% 18%)", border: "1px solid hsl(228 20% 25%)" }}
        >
          Redo
        </button>
        <button
          onClick={onSubmit}
          className="flex-1 py-3.5 rounded-xl font-semibold text-white text-sm transition-opacity active:opacity-70"
          style={{ background: "hsl(258 90% 66%)", boxShadow: "0 4px 16px hsl(258 90% 66% / 0.4)" }}
        >
          Submit
        </button>
      </div>
    </div>
  );
}

function AnalyzingView() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6">
      <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "hsl(258 90% 66% / 0.15)" }}>
        <svg className="animate-spin" xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="hsl(258 90% 66%)" strokeWidth="2.5" strokeLinecap="round">
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      </div>
      <p className="text-white/60 text-sm font-medium">Analyzing your pronunciation…</p>
    </div>
  );
}

function FailView({
  heardAs,
  correct,
  word,
  tip,
  onRetry,
}: {
  heardAs: string;
  correct: string;   // phonetic — visual display only
  word: string;      // actual word — spoken by TTS
  tip: string;
  onRetry: () => void;
}) {
  useEffect(() => {
    speak(`Almost! The correct pronunciation is: ${word}. ${tip}`).catch(() => {});
  }, [word, tip]);

  return (
    <div className="flex-1 flex flex-col items-center px-6 pt-4 gap-5">
      <AvatarRing size={100} />
      <p className="text-white/70 text-sm font-medium text-center">Almost there! Let's try again.</p>

      <div
        className="w-full rounded-3xl p-5 flex flex-col gap-4"
        style={{ background: "hsl(228 22% 13%)", border: "1px solid hsl(228 20% 22%)" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex-1 rounded-xl px-4 py-3 flex items-center gap-2.5"
            style={{ background: "hsl(0 60% 18%)", border: "1px solid hsl(0 70% 28%)" }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            <span className="text-red-300 font-semibold text-base line-through opacity-80">{heardAs}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div
            className="flex-1 rounded-xl px-4 py-3 flex items-center gap-2.5"
            style={{ background: "hsl(142 60% 12%)", border: "1px solid hsl(142 60% 22%)" }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span className="text-green-300 font-semibold text-base">{correct}</span>
          </div>
          <SpeakerButton text={`It's pronounced: ${word}`} small />
        </div>
      </div>

      {tip && (
        <p className="text-white/50 text-xs text-center px-2">{tip}</p>
      )}

      <div className="flex-1 flex items-end justify-center pb-8">
        <button
          onClick={onRetry}
          className="px-8 py-3.5 rounded-xl font-bold text-white text-sm transition-opacity active:opacity-70"
          style={{ background: "hsl(258 90% 66%)", boxShadow: "0 4px 16px hsl(258 90% 66% / 0.4)" }}
        >
          Try Again
        </button>
      </div>
    </div>
  );
}

function PassWordView({ onNext, message }: { onNext: () => void; message?: string }) {
  useEffect(() => {
    speak(message ?? "Nice! Now let's try it without any hints.").catch(() => {});
    const t = setTimeout(onNext, 1800);
    return () => clearTimeout(t);
  }, [message, onNext]);

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6">
      <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{ background: "hsl(142 60% 14%)", border: "2px solid hsl(142 60% 36%)" }}>
        <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <p className="text-green-300 text-xl font-bold">
        {message ? "Well done!" : "Nice!"}
      </p>
      <p className="text-white/50 text-sm text-center">{message ?? "Now let's try without the hint…"}</p>
    </div>
  );
}

function SentenceView({
  sentence,
  word,
  onMicPress,
  micError,
  onClearMicError,
}: {
  sentence: string;
  word: string;
  onMicPress: () => void;
  micError: string | null;
  onClearMicError: () => void;
}) {
  useEffect(() => {
    speak(`Great! Now say this full sentence: "${sentence}"`).catch(() => {});
  }, [sentence]);

  return (
    <div className="flex-1 flex flex-col items-center px-6 pt-4 gap-5">
      <AvatarRing size={100} />
      <p className="text-white/70 text-sm font-medium">Now say the full sentence!</p>

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
        <div className="mt-4 flex justify-center">
          <SpeakerButton text={`"${sentence}"`} />
        </div>
      </div>

      {micError && (
        <div
          className="w-full rounded-xl px-4 py-3 flex items-start gap-3"
          style={{ background: "hsl(0 60% 18%)", border: "1px solid hsl(0 70% 30%)" }}
        >
          <p className="text-red-300 text-sm flex-1">{micError}</p>
          <button onClick={onClearMicError} className="text-red-300/60 text-xs underline flex-shrink-0">Dismiss</button>
        </div>
      )}

      <div className="flex-1 flex items-end justify-center pb-8">
        <div className="flex flex-col items-center gap-3">
          <MicButton onPress={onMicPress} />
          <p className="text-white/40 text-xs">Tap to record</p>
        </div>
      </div>
    </div>
  );
}

function SentenceFailView({
  heardAs,
  tip,
  onRetry,
}: {
  heardAs: string;
  tip: string;
  onRetry: () => void;
}) {
  useEffect(() => {
    speak(`Almost! ${tip}`).catch(() => {});
  }, [tip]);

  return (
    <div className="flex-1 flex flex-col items-center px-6 pt-4 gap-5">
      <AvatarRing size={100} />
      <p className="text-white/70 text-sm font-medium text-center">Almost! One more try.</p>
      <div
        className="w-full rounded-3xl p-5"
        style={{ background: "hsl(228 22% 13%)", border: "1px solid hsl(228 20% 22%)" }}
      >
        <p className="text-white/50 text-xs mb-2 font-medium">What we heard:</p>
        <p className="text-white/80 italic text-base">"{heardAs}"</p>
        {tip && <p className="text-white/40 text-xs mt-3">{tip}</p>}
      </div>
      <div className="flex-1 flex items-end justify-center pb-8">
        <button
          onClick={onRetry}
          className="px-8 py-3.5 rounded-xl font-bold text-white text-sm transition-opacity active:opacity-70"
          style={{ background: "hsl(258 90% 66%)", boxShadow: "0 4px 16px hsl(258 90% 66% / 0.4)" }}
        >
          Try Again
        </button>
      </div>
    </div>
  );
}

function SummaryView({
  word,
  wordScores,
  sentenceScore,
  elapsedMs,
  onFinish,
}: {
  word: string;
  wordScores: number[];
  sentenceScore: number | null;
  elapsedMs: number;
  onFinish: () => void;
}) {
  const allScores = sentenceScore != null ? [...wordScores, sentenceScore] : wordScores;
  const avg = avgScore(allScores);

  useEffect(() => {
    speak(`Amazing! You scored ${avg} out of 100 for ${word}. Keep it up!`).catch(() => {});
  }, [avg, word]);

  const color =
    avg >= 85 ? "#4ade80" : avg >= 70 ? "hsl(258 90% 76%)" : "#fbbf24";

  return (
    <div className="flex-1 flex flex-col items-center justify-between px-6 pt-4 pb-8">
      <div className="flex flex-col items-center gap-5 flex-1 justify-center">
        <AvatarRing size={100} />
        <p className="text-white text-xl font-bold text-center">
          Amazing job on <span style={{ color: "hsl(258 90% 76%)" }}>{word}</span>!
        </p>

        <div
          className="score-reveal w-full rounded-3xl p-6 flex flex-col items-center gap-4"
          style={{ background: "hsl(228 22% 13%)", border: "1px solid hsl(228 20% 22%)" }}
        >
          <div className="flex flex-col items-center gap-1">
            <span className="text-white/50 text-xs font-medium uppercase tracking-wider">Pronunciation Score</span>
            <span className="font-bold tabular-nums" style={{ fontSize: 64, color, lineHeight: 1.1 }}>
              {avg}
            </span>
            <span className="text-white/40 text-sm">out of 100</span>
          </div>

          <div className="w-full flex gap-2">
            {wordScores.map((s, i) => (
              <div key={i} className="flex-1 rounded-xl py-3 flex flex-col items-center gap-1" style={{ background: "hsl(228 25% 18%)" }}>
                <span className="text-white/40 text-xs">{i === 0 ? "With hint" : "No hint"}</span>
                <span className="text-white font-bold text-base">{s}</span>
              </div>
            ))}
            {sentenceScore != null && (
              <div className="flex-1 rounded-xl py-3 flex flex-col items-center gap-1" style={{ background: "hsl(228 25% 18%)" }}>
                <span className="text-white/40 text-xs">Sentence</span>
                <span className="text-white font-bold text-base">{sentenceScore}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 text-white/40 text-sm">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
            {formatTime(elapsedMs)}
          </div>
        </div>
      </div>

      <button
        onClick={onFinish}
        className="w-full py-4 rounded-xl font-bold text-white text-base transition-opacity active:opacity-70"
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
  const blobUrlRef = useRef<string | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  // Determine if we're in sentence recording stages
  const inSentenceRecording = state.stage === "sentence-recording" || state.stage === "sentence-reviewing" || state.stage === "sentence-analyzing";
  const currentTarget = inSentenceRecording ? sentence : word;
  const currentMode: "word" | "sentence" = inSentenceRecording ? "sentence" : "word";

  const cleanupRecorder = useCallback(() => {
    recorderRef.current?.cleanup();
    recorderRef.current = null;
    analyserRef.current = null;
    setAnalyser(null);
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setBlobUrl(null);
    blobRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      cleanupRecorder();
      stopSpeaking();
    };
  }, [cleanupRecorder]);

  const handleClose = useCallback(() => {
    cleanupRecorder();
    stopSpeaking();
    router.push("/");
  }, [router, cleanupRecorder]);

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

  const handleStop = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec) return;
    const blob = await rec.stop();
    blobRef.current = blob;
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    const url = URL.createObjectURL(blob);
    blobUrlRef.current = url;
    setBlobUrl(url);
    const isSentence = state.stage === "sentence-recording";
    dispatch({ type: "NEXT_STAGE", stage: isSentence ? "sentence-reviewing" : "reviewing" });
  }, [state.stage]);

  const handleRedo = useCallback(() => {
    cleanupRecorder();
    const isSentence = inSentenceRecording;
    dispatch({ type: "NEXT_STAGE", stage: isSentence ? "sentence" : (state.stage === "reviewing" && state.wordScores.length >= 1 ? "word-no-hint" : "word-hint") });
  }, [cleanupRecorder, inSentenceRecording, state.stage, state.wordScores.length]);

  const handleSubmit = useCallback(async () => {
    const blob = blobRef.current;
    if (!blob) return;
    const isSentence = inSentenceRecording;
    dispatch({ type: "NEXT_STAGE", stage: isSentence ? "sentence-analyzing" : "analyzing" });

    console.log("[practice] submitting audio, target:", currentTarget, "mode:", currentMode);
    const formData = new FormData();
    formData.append("audio", blob, "recording.webm");
    formData.append("target", currentTarget);
    formData.append("mode", currentMode);

    try {
      const res = await fetch("/api/analyze", { method: "POST", body: formData });
      const data = await res.json() as { score: number; heardAs: string; tip: string };
      console.log("[practice] analyze result:", data);
      if (isSentence) {
        dispatch({ type: "SENTENCE_ANALYZED", ...data });
      } else {
        dispatch({ type: "ANALYZED", ...data });
      }
    } catch (e) {
      console.error("[practice] analyze fetch error", e);
      if (isSentence) {
        dispatch({ type: "SENTENCE_ANALYZED", score: 0, heardAs: "—", tip: "Network error. Try again." });
      } else {
        dispatch({ type: "ANALYZED", score: 0, heardAs: "—", tip: "Network error. Try again." });
      }
    }
  }, [inSentenceRecording, currentTarget, currentMode]);

  const handleFinish = useCallback(() => {
    const nextId = videoId + 1;
    if (nextId > total) {
      router.push("/");
    } else {
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

      case "recording":
        return <RecordingView analyser={analyser} onStop={handleStop} />;

      case "reviewing":
        return (
          <ReviewingView
            blobUrl={blobUrl!}
            onRedo={() => {
              cleanupRecorder();
              // If we already have a word-hint score, we're reviewing a word-no-hint recording
              dispatch({ type: "NEXT_STAGE", stage: wordScores.length >= 1 ? "word-no-hint" : "word-hint" });
            }}
            onSubmit={handleSubmit}
          />
        );

      case "analyzing":
        return <AnalyzingView />;

      case "fail":
        return (
          <FailView
            heardAs={heardAs}
            correct={phonetic}
            word={word}
            tip={tip}
            onRetry={() => {
              cleanupRecorder();
              dispatch({ type: "NEXT_STAGE", stage: "word-hint" });
            }}
          />
        );

      case "pass-word":
        if (wordScores.length >= 2) {
          // Second pass (word-no-hint) — next stop is sentence
          return (
            <PassWordView
              message="Excellent! Now let's try the full sentence."
              onNext={() => {
                cleanupRecorder();
                dispatch({ type: "NEXT_STAGE", stage: "sentence" });
              }}
            />
          );
        }
        return (
          <PassWordView
            onNext={() => {
              cleanupRecorder();
              dispatch({ type: "NEXT_STAGE", stage: "word-no-hint" });
            }}
          />
        );

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
            sentence={sentence}
            word={word}
            onMicPress={() => handleMicPress(true)}
            micError={micError}
            onClearMicError={() => dispatch({ type: "CLEAR_MIC_ERROR" })}
          />
        );

      case "sentence-recording":
        return <RecordingView analyser={analyser} onStop={handleStop} />;

      case "sentence-reviewing":
        return (
          <ReviewingView
            blobUrl={blobUrl!}
            label="How did the sentence sound?"
            onRedo={() => {
              cleanupRecorder();
              dispatch({ type: "NEXT_STAGE", stage: "sentence" });
            }}
            onSubmit={handleSubmit}
          />
        );

      case "sentence-analyzing":
        return <AnalyzingView />;

      case "sentence-fail":
        return (
          <SentenceFailView
            heardAs={heardAs}
            tip={tip}
            onRetry={() => {
              cleanupRecorder();
              dispatch({ type: "NEXT_STAGE", stage: "sentence" });
            }}
          />
        );

      case "sentence-pass":
        return (
          <PassWordView
            message="Excellent! Let's see your score."
            onNext={() => dispatch({ type: "NEXT_STAGE", stage: "summary" })}
          />
        );

      case "summary":
        return (
          <SummaryView
            word={word}
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
