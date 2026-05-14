"use client";

import { useState, useRef, useCallback, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

interface VideoCard {
  id: number;
  word: string;
  phonetic: string;
  sentence: string;
  src: string;
  likes: number;
  definition: string;
}

const BASE_VIDEOS: Omit<VideoCard, "id">[] = [
  {
    word: "Question",
    phonetic: "Kwes-chun",
    sentence: "I have one quick question.",
    src: "https://sn-main.b-cdn.net/system-uploads/scenario-data/27c38b64-d89a-40bb-914c-a4d0faa2489e-Question-.mp4",
    likes: 1243,
    definition: "A sentence asking for information",
  },
  {
    word: "Privacy",
    phonetic: "Pry-vuh-see",
    sentence: "I need privacy.",
    src: "https://sn-main.b-cdn.net/system-uploads/scenario-data/de784283-5919-4b14-ab9c-c2b13874af5b-Privacy.mp4",
    likes: 982,
    definition: "The state of being free from observation",
  },
  {
    word: "Hotel",
    phonetic: "Hoh-tel",
    sentence: "I stayed at a nice hotel.",
    src: "https://sn-main.b-cdn.net/system-uploads/scenario-data/77171a32-d901-4b18-afac-628ca054e046-Hotel.mp4",
    likes: 1567,
    definition: "A place that provides lodging",
  },
  {
    word: "Breakfast",
    phonetic: "Brek-fust",
    sentence: "I like to have a light breakfast.",
    src: "https://sn-main.b-cdn.net/system-uploads/scenario-data/0215efec-3b6a-407a-bcf5-2bfcaabe359a-Breakfast.mp4",
    likes: 2104,
    definition: "The first meal of the day",
  },
  {
    word: "Jewelry",
    phonetic: "Jool-ree",
    sentence: "She loves wearing jewelry.",
    // TODO: swap with a real Jewelry clip when available
    src: "https://sn-main.b-cdn.net/system-uploads/scenario-data/27c38b64-d89a-40bb-914c-a4d0faa2489e-Question-.mp4",
    likes: 874,
    definition: "Decorative items such as rings and necklaces",
  },
];

const VIDEO_DATA: VideoCard[] = Array.from({ length: 20 }, (_, i) => ({
  ...BASE_VIDEOS[i % BASE_VIDEOS.length],
  id: i + 1,
}));

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="28"
      height="28"
      viewBox="0 0 24 22"
      fill={filled ? "#FF4D6D" : "none"}
      stroke={filled ? "#FF4D6D" : "white"}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

function SparkleBadge({ size = 31 }: { size?: number }) {
  const inner = Math.round(size * 0.68);
  return (
    <span
      className="inline-flex items-center justify-center rounded-full flex-shrink-0"
      style={{ width: size, height: size, background: "white" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/assets/sparkle.svg" alt="" width={inner} height={inner} style={{ display: "block" }} />
    </span>
  );
}

function VideoCardItem({ card, muted, onToggleMute }: { card: VideoCard; muted: boolean; onToggleMute: () => void }) {
  const router = useRouter();
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(card.likes);
  const [heartAnimKey, setHeartAnimKey] = useState(0);
  const [paused, setPaused] = useState(false);
  const [indicatorKey, setIndicatorKey] = useState(0);
  const [burstHeart, setBurstHeart] = useState<{ key: number; x: number; y: number } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const v = videoRef.current;
    const el = containerRef.current;
    if (!v || !el) return;

    let wasVisible = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const visible = entry.isIntersecting && entry.intersectionRatio >= 0.6;
        if (visible && !wasVisible) {
          v.currentTime = 0;
          v.play().catch(() => {});
          setPaused(false);
          wasVisible = true;
        } else if (!visible && wasVisible) {
          v.pause();
          wasVisible = false;
        }
      },
      { threshold: [0, 0.6] }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleLike = useCallback(() => {
    setLiked(prev => {
      if (!prev) {
        setLikeCount(c => c + 1);
        setHeartAnimKey(k => k + 1);
      } else {
        setLikeCount(c => c - 1);
      }
      return !prev;
    });
  }, []);

  const handleTogglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => {});
      setPaused(false);
    } else {
      v.pause();
      setPaused(true);
    }
    setIndicatorKey(k => k + 1);
  }, []);

  const handleVideoTap = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (tapTimerRef.current !== null) {
      clearTimeout(tapTimerRef.current);
      tapTimerRef.current = null;

      setLiked(prev => {
        if (prev) {
          setLikeCount(c => c - 1);
        } else {
          setLikeCount(c => c + 1);
          setHeartAnimKey(k => k + 1);
          setBurstHeart({ key: Date.now(), x, y });
        }
        return !prev;
      });
      return;
    }

    tapTimerRef.current = setTimeout(() => {
      tapTimerRef.current = null;
      handleTogglePlay();
    }, 260);
  }, [handleTogglePlay]);

  useEffect(() => () => {
    if (tapTimerRef.current !== null) clearTimeout(tapTimerRef.current);
  }, []);

  const formatCount = (n: number) => {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return n.toString();
  };

  return (
    <div ref={containerRef} className="snap-item" style={{ background: "#0D0E1A" }} data-testid={`video-card-${card.id}`}>
      <div
        className="absolute inset-0 cursor-pointer"
        onClick={handleVideoTap}
        data-testid={`video-tap-${card.id}`}
      >
        <video
          ref={videoRef}
          key={card.id}
          src={card.src}
          className="w-full h-full pointer-events-none"
          loop
          muted={muted}
          playsInline
          preload="metadata"
          style={{ objectFit: "cover" }}
        />
      </div>

      <div className="absolute inset-0 video-overlay-gradient pointer-events-none" />

      {burstHeart && (
        <div
          key={burstHeart.key}
          className="absolute pointer-events-none z-30 burst-heart"
          style={{
            left: burstHeart.x,
            top: burstHeart.y,
            transform: "translate(-50%, -50%)",
          }}
          onAnimationEnd={() => setBurstHeart(null)}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="120" height="110" viewBox="0 0 24 22" fill="white">
            <path d="M12 21s-7.5-4.6-10-9.5C.6 8 2 4.5 5 3.4c2.2-.8 4.5.3 5.5 2 1-.0 2-.7 3.5-1.7 1.5-.8 3.5-1.2 5 0 3 1.1 4.4 4.6 3 8.1C19.5 16.4 12 21 12 21z" />
          </svg>
        </div>
      )}

      <button
        onClick={(e) => { e.stopPropagation(); onToggleMute(); }}
        className="absolute top-5 right-5 z-20 w-10 h-10 rounded-full flex items-center justify-center transition-opacity active:opacity-70"
        style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(6px)" }}
        data-testid={`mute-button-${card.id}`}
        aria-label={muted ? "Unmute" : "Mute"}
      >
        {muted ? (
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 5 6 9H2v6h4l5 4z"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/>
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 5 6 9H2v6h4l5 4z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
          </svg>
        )}
      </button>

      {indicatorKey > 0 && (
        <div
          key={indicatorKey}
          className="absolute inset-0 flex items-center justify-center pointer-events-none z-20"
        >
          <div
            className="pause-indicator-pop w-20 h-20 rounded-full flex items-center justify-center"
            style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" }}
          >
            {paused ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="white">
                <polygon points="6,4 20,12 6,20" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="white">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            )}
          </div>
        </div>
      )}

      <div className="absolute left-5 right-5 bottom-10 z-10 flex items-start justify-between gap-4 pointer-events-none">
        <div className="flex flex-col items-start gap-3 pointer-events-auto">
          <div className="flex items-center gap-2.5">
            <SparkleBadge size={36} />
            <span className="text-white font-semibold text-base drop-shadow-md">
              Speaking Booster 1
            </span>
          </div>
          <button
            onClick={() => router.push(`/practice?word=${encodeURIComponent(card.word)}&phonetic=${encodeURIComponent(card.phonetic)}&sentence=${encodeURIComponent(card.sentence)}&videoId=${card.id}&total=${VIDEO_DATA.length}`)}
            className="px-5 py-2.5 rounded-lg font-bold text-white text-sm tracking-wide transition-opacity active:opacity-85"
            style={{
              background: "hsl(258 90% 66%)",
              boxShadow: "0 6px 20px hsl(258 90% 66% / 0.45)",
            }}
            data-testid={`practice-button-${card.id}`}
          >
            Practice
          </button>
        </div>

        <div className="pointer-events-auto pt-1">
          <button
            onClick={handleLike}
            className="flex flex-col items-center gap-1 transition-transform active:scale-95"
            data-testid={`like-button-${card.id}`}
            aria-label={liked ? "Unlike" : "Like"}
          >
            <div
              key={heartAnimKey}
              className={heartAnimKey > 0 ? "heart-pop" : ""}
            >
              <HeartIcon filled={liked} />
            </div>
            <span className="text-sm font-semibold text-white drop-shadow-md mt-1">
              {formatCount(likeCount)}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

function VideoFeedInner() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [muted, setMuted] = useState(true);
  const toggleMute = useCallback(() => setMuted(m => !m), []);
  const searchParams = useSearchParams();

  useEffect(() => {
    const nextId = searchParams.get("next");
    if (!nextId) return;
    // Clear the param without a navigation so refresh doesn't re-scroll
    window.history.replaceState(null, "", "/");
    const id = parseInt(nextId, 10);
    if (isNaN(id)) return;
    // Wait one tick for cards to mount, then scroll
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-testid="video-card-${id}"]`);
      el?.scrollIntoView({ block: "start", behavior: "instant" });
      console.log("[feed] scrolled to card", id);
    });
  }, [searchParams]);

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{ background: "#07080F" }}
    >
      <div
        ref={containerRef}
        className="snap-container absolute inset-0"
      >
        {VIDEO_DATA.map((card) => (
          <VideoCardItem
            key={card.id}
            card={card}
            muted={muted}
            onToggleMute={toggleMute}
          />
        ))}
      </div>
    </div>
  );
}

export default function VideoFeed() {
  return (
    <Suspense>
      <VideoFeedInner />
    </Suspense>
  );
}
