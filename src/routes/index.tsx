import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "FocusScape — Study together in immersive virtual worlds" },
      { name: "description", content: "Premium multiplayer study worlds with gamification, ambient audio, and beautiful environments." },
    ],
  }),
  component: Landing,
});

const WORLDS = [
  { emoji: "☕", name: "Cozy Café", desc: "Rain & fireplace", color: "#f0c987" },
  { emoji: "📚", name: "Silent Library", desc: "Golden lamplight", color: "#c9a352" },
  { emoji: "💻", name: "Programming Hub", desc: "Neon & lo-fi", color: "#4ade80" },
  { emoji: "🎓", name: "University Hall", desc: "Grand & focused", color: "#e8a87c" },
  { emoji: "🌳", name: "Focus Park", desc: "Nature & birdsong", color: "#7dd3a8" },
];

const FEATURES = [
  { icon: "🎮", title: "Gamified Study", desc: "Earn XP, level up, and unlock achievements as you study." },
  { icon: "👥", title: "Study Together", desc: "Real-time multiplayer — see friends studying beside you." },
  { icon: "🎵", title: "Ambient Audio", desc: "Rain, café noise, lo-fi — your perfect soundscape." },
  { icon: "⏱️", title: "Focus Timer", desc: "Built-in Pomodoro timer. Track every session automatically." },
];

function Landing() {
  const navigate = useNavigate();
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/lobby" });
    });
  }, [navigate]);

  return (
    <main className="relative min-h-screen overflow-hidden"
      style={{ background: "radial-gradient(ellipse at 15% 0%, #1a0e3a 0%, #0d0d1a 55%, #080810 100%)" }}
    >
      {/* Background glows */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-20 left-1/4 h-[500px] w-[500px] rounded-full opacity-20" style={{ background: "radial-gradient(circle, #7c3aed, transparent)" }} />
        <div className="absolute top-1/2 right-0 h-[400px] w-[400px] rounded-full opacity-10" style={{ background: "radial-gradient(circle, #f59e0b, transparent)" }} />
        <div className="absolute bottom-0 left-0 h-[300px] w-[300px] rounded-full opacity-10" style={{ background: "radial-gradient(circle, #2563eb, transparent)" }} />
      </div>

      <div className="relative mx-auto max-w-5xl px-6 py-20">
        {/* Hero section */}
        <div className="text-center">
          <div className="mb-6 inline-flex items-center gap-2.5 rounded-full border border-white/10 bg-white/5 px-5 py-2 text-xs font-medium backdrop-blur" style={{ color: "rgba(255,255,255,0.5)" }}>
            <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
            Multiplayer · Gamified · Beautiful
          </div>
          <h1 className="text-6xl font-bold leading-tight tracking-tight text-white md:text-8xl">
            <span style={{ background: "linear-gradient(135deg, #fbbf24, #f97316, #f59e0b)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Focus</span>
            <span className="text-white">Scape</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg" style={{ color: "rgba(255,255,255,0.5)" }}>
            Study in gorgeous virtual worlds alongside others. Earn XP, build streaks, and actually stay focused.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link to="/auth"
              className="flex items-center gap-2 rounded-full px-8 py-3.5 text-sm font-bold text-white transition hover:scale-105"
              style={{ background: "linear-gradient(135deg, #f59e0b, #ea580c)", boxShadow: "0 8px 30px rgba(245,158,11,0.35)" }}
            >
              Enter the World ✨
            </Link>
            <Link to="/auth"
              className="flex items-center gap-2 rounded-full border px-8 py-3.5 text-sm font-medium backdrop-blur transition hover:border-white/30"
              style={{ borderColor: "rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.7)" }}
            >
              Sign in
            </Link>
          </div>
        </div>

        {/* World cards */}
        <div className="mt-20 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          {WORLDS.map((w) => (
            <div key={w.name}
              className="rounded-2xl p-4 text-center backdrop-blur transition hover:-translate-y-1"
              style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.05)" }}
            >
              <div className="text-3xl">{w.emoji}</div>
              <div className="mt-2 text-xs font-semibold text-white">{w.name}</div>
              <div className="mt-0.5 text-[10px]" style={{ color: "rgba(255,255,255,0.3)" }}>{w.desc}</div>
            </div>
          ))}
        </div>

        {/* Feature grid */}
        <div className="mt-16 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl p-5 backdrop-blur"
              style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)" }}
            >
              <div className="text-2xl">{f.icon}</div>
              <div className="mt-3 text-sm font-bold text-white">{f.title}</div>
              <div className="mt-1 text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>{f.desc}</div>
            </div>
          ))}
        </div>

        <p className="mt-16 text-center text-xs" style={{ color: "rgba(255,255,255,0.2)" }}>
          Free to use · No downloads · Study anywhere
        </p>
      </div>
    </main>
  );
}
