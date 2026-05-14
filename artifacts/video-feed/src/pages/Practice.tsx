import { useLocation, useSearch } from "wouter";
import avatarImg from "@assets/Screenshot_2026-01-28_at_13.46.50_1_(1)_1778765201280.png";

export default function Practice() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const word = params.get("word") ?? "Celebrity";
  const phonetic = params.get("phonetic") ?? "Sih-lub-ruh-tee";

  return (
    <div
      className="fixed inset-0 flex flex-col"
      style={{ background: "#0A0B14" }}
    >
      <div className="flex items-center px-5 pt-6 pb-2">
        <button
          onClick={() => setLocation("/")}
          className="w-10 h-10 flex items-center justify-center text-white active:opacity-70"
          aria-label="Close"
          data-testid="practice-close"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center px-6 pt-8">
        <div
          className="w-36 h-36 rounded-full flex items-center justify-center mb-8 overflow-hidden"
          style={{
            background: "linear-gradient(135deg, hsl(258 90% 66%), hsl(280 90% 60%))",
            padding: "4px",
          }}
        >
          <div
            className="w-full h-full rounded-full overflow-hidden flex items-end justify-center"
            style={{ background: "#1a1d2e" }}
          >
            <img
              src={avatarImg}
              alt="Tutor avatar"
              className="w-full h-full object-cover object-top"
            />
          </div>
        </div>

        <p className="text-white text-lg mb-6 font-medium">Its pronounced as:</p>

        <div
          className="w-full rounded-3xl p-6"
          style={{
            background: "hsl(228 22% 13%)",
            border: "1px solid hsl(228 20% 22%)",
          }}
        >
          <h2
            className="text-center text-3xl font-bold text-white mb-5"
            data-testid="practice-word"
          >
            {word}
          </h2>
          <div
            className="rounded-2xl py-4 px-5 flex items-center justify-center gap-3"
            style={{ background: "hsl(228 25% 18%)" }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="white">
              <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
              <path d="M19 10v1a7 7 0 0 1-14 0v-1" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" />
              <line x1="12" y1="18" x2="12" y2="22" stroke="white" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span
              className="text-white font-semibold text-lg tracking-wide"
              data-testid="practice-phonetic"
            >
              {phonetic}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
