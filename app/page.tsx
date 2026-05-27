"use client";

import { useState, useRef, useCallback, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { VIDEO_DATA, type VideoCard } from "@/lib/video-data";
import { track } from "@/lib/analytics";
import { useUser } from "./user-context";

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
  const { hasActiveSubscription, redirectToPremium } = useUser();
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(card.likes);
  const [heartAnimKey, setHeartAnimKey] = useState(0);
  const [paused, setPaused] = useState(false);
  const [indicatorKey, setIndicatorKey] = useState(0);
  const [burstHeart, setBurstHeart] = useState<{ key: number; x: number; y: number } | null>(null);
  const [shimmer, setShimmer] = useState(false);
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
          console.log("[feed] card", card.id, "autoplay —", card.word);
          track("reel_viewed", { reelId: card.id, word: card.word });
        } else if (!visible && wasVisible) {
          v.pause();
          setShimmer(false);
          wasVisible = false;
          console.log("[feed] card", card.id, "paused (scrolled out)");
        }
      },
      { threshold: [0, 0.6] }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [card.id, card.word]);

  // Shimmer the Practice CTA in the last ~5s of the video to lead the user.
  // Video has `loop`, so onEnded never fires — watch currentTime instead and
  // reset when it wraps back to near 0.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTimeUpdate = () => {
      const dur = v.duration;
      if (!dur || !isFinite(dur)) return;
      const remaining = dur - v.currentTime;
      if (remaining <= 5 && remaining > 0) {
        setShimmer(prev => {
          if (!prev) console.log("[feed] shimmer ON — card", card.id, "remaining:", remaining.toFixed(2), "dur:", dur.toFixed(2));
          return true;
        });
      } else if (v.currentTime < 0.4) {
        setShimmer(prev => {
          if (prev) console.log("[feed] shimmer OFF — card", card.id, "looped at", v.currentTime.toFixed(2));
          return false;
        });
      }
    };
    v.addEventListener("timeupdate", onTimeUpdate);
    return () => v.removeEventListener("timeupdate", onTimeUpdate);
  }, [card.id]);

  const handleLike = useCallback(() => {
    setLiked(prev => {
      if (!prev) {
        setLikeCount(c => c + 1);
        setHeartAnimKey(k => k + 1);
        console.log("[feed] liked card", card.id, "—", card.word);
      } else {
        setLikeCount(c => c - 1);
        console.log("[feed] unliked card", card.id, "—", card.word);
      }
      return !prev;
    });
  }, [card.id, card.word]);

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
        className="absolute top-16 right-8 z-20 w-10 h-10 rounded-full flex items-center justify-center transition-opacity active:opacity-70"
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
            onClick={() => {
              console.log("[feed] practice tapped — word:", card.word, "| videoId:", card.id, "| paid:", hasActiveSubscription);
              track("reel_practice_tapped", { reelId: card.id, word: card.word, paid: hasActiveSubscription });
              if (!hasActiveSubscription) {
                track("practice_gated", { reelId: card.id, word: card.word });
                redirectToPremium();
                return;
              }
              router.push(`/practice?word=${encodeURIComponent(card.word)}&phonetic=${encodeURIComponent(card.phonetic)}&sentence=${encodeURIComponent(card.sentence)}&videoId=${card.id}&total=${VIDEO_DATA.length}`);
            }}
            className={`px-5 py-2.5 rounded-lg font-bold text-white text-sm tracking-wide transition-opacity active:opacity-85${shimmer ? " practice-shimmer" : ""}`}
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

const MUTE_KEY = "feed_muted";

function VideoFeedInner() {
  const containerRef = useRef<HTMLDivElement>(null);
  // Always start muted for SSR (avoids hydration mismatch + autoplay policy on fresh load).
  // After mount, restore the user's saved preference — safe because by the time they
  // return from Practice the browser has a user gesture so unmuted autoplay is allowed.
  const [muted, setMuted] = useState(true);
  useEffect(() => {
    const restoreTimer = window.setTimeout(() => {
      try {
        if (sessionStorage.getItem(MUTE_KEY) === "0") {
          setMuted(false);
          console.log("[feed] restored unmuted preference from session");
        }
      } catch {}
    }, 0);
    return () => window.clearTimeout(restoreTimer);
  }, []);
  const toggleMute = useCallback(() => {
    setMuted(m => {
      const next = !m;
      try { sessionStorage.setItem(MUTE_KEY, next ? "1" : "0"); } catch {}
      console.log("[feed] mute toggled →", next ? "muted" : "unmuted");
      return next;
    });
  }, []);
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
