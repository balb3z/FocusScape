import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { MAPS, AVATAR_COLORS } from "@/lib/maps";
import { LogOut, Flame, Clock, Zap, Star, Trophy, Users, ChevronRight, Sparkles } from "lucide-react";

export const Route = createFileRoute("/_authenticated/lobby")({
  component: Lobby,
});

type Profile = {
  username: string;
  avatar_id: number;
  avatar_url: string | null;
  total_focus_minutes: number;
  current_streak: number;
};

function xpForLevel(level: number) { return level * level * 100; }
function levelFromXp(xp: number) {
  let lvl = 1;
  while (xpForLevel(lvl + 1) <= xp) lvl++;
  return lvl;
}

const LEVEL_TITLES = ["Newcomer", "Learner", "Scholar", "Focused", "Expert", "Master", "Legend", "Myth"];

function getLevelTitle(level: number) {
  return LEVEL_TITLES[Math.min(level - 1, LEVEL_TITLES.length - 1)];
}

function Lobby() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("profiles")
        .select("username,avatar_id,avatar_url,total_focus_minutes,current_streak")
        .eq("id", user.id)
        .maybeSingle();
      if (data) setProfile(data as Profile);
    })();
  }, []);

  useEffect(() => {
    const refreshCounts = async () => {
      const cutoff = new Date(Date.now() - 45_000).toISOString();
      const { data, error } = await supabase.from("room_players").select("room_id,last_seen").gte("last_seen", cutoff);
      if (error) { console.warn("[lobby] shared room count failed", error); return; }
      const next: Record<string, number> = {};
      MAPS.forEach((m) => { next[m.id] = 0; });
      data?.forEach((row) => { next[row.room_id] = (next[row.room_id] ?? 0) + 1; });
      setCounts(next);
    };
    void refreshCounts();
    const ch = supabase
      .channel("lobby_room_counts")
      .on("postgres_changes", { event: "*", schema: "public", table: "room_players" }, () => void refreshCounts())
      .subscribe();
    const interval = window.setInterval(refreshCounts, 15_000);
    return () => { window.clearInterval(interval); void supabase.removeChannel(ch); };
  }, []);

  const avatar = AVATAR_COLORS[profile?.avatar_id ?? 0];
  const xp = (profile?.total_focus_minutes ?? 0) * 10;
  const level = levelFromXp(xp);
  const levelXp = xpForLevel(level);
  const nextXp = xpForLevel(level + 1);
  const progress = ((xp - levelXp) / (nextXp - levelXp)) * 100;
  const hours = Math.floor((profile?.total_focus_minutes ?? 0) / 60);
  const mins = (profile?.total_focus_minutes ?? 0) % 60;

  return (
    <main
      className="min-h-screen overflow-y-auto px-4 py-8 md:px-10"
      style={{
        background: "radial-gradient(ellipse at 20% 0%, #1a0e3a 0%, #0d0d1a 50%, #0a0a12 100%)",
      }}
    >
      {/* Ambient background glows */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/4 h-96 w-96 rounded-full bg-purple-600/10 blur-3xl" />
        <div className="absolute top-1/3 right-0 h-80 w-80 rounded-full bg-amber-500/8 blur-3xl" />
        <div className="absolute bottom-0 left-0 h-64 w-64 rounded-full bg-blue-600/8 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-6xl">
        {/* ── HEADER ── */}
        <header className="mb-10 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-white/30 mb-1">
              <Sparkles className="h-3 w-3 text-amber-400/60" />
              Focus Worlds
            </div>
            <h1 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
              Where to study today?
            </h1>
          </div>

          {profile && (
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-2 pr-4 backdrop-blur-xl">
              {/* Avatar */}
              <div className="relative">
                {profile.avatar_url ? (
                  <img
                    src={profile.avatar_url}
                    alt={profile.username}
                    className="h-12 w-12 rounded-xl object-cover ring-2 ring-amber-400/40"
                  />
                ) : (
                  <div
                    className="h-12 w-12 rounded-xl ring-2 ring-amber-400/40"
                    style={{ background: `#${avatar.body.toString(16).padStart(6, "0")}` }}
                  />
                )}
                <div className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold text-white ring-2 ring-black">
                  {level}
                </div>
              </div>
              {/* Info */}
              <div>
                <div className="text-sm font-bold text-white">{profile.username}</div>
                <div className="text-xs text-white/40">{getLevelTitle(level)}</div>
                <div className="mt-1 flex items-center gap-3 text-xs text-white/50">
                  <span className="flex items-center gap-1"><Clock className="h-3 w-3 text-amber-400/70" />{hours}h {mins}m</span>
                  <span className="flex items-center gap-1"><Flame className="h-3 w-3 text-orange-400/70" />{profile.current_streak}d</span>
                </div>
              </div>
              <button
                onClick={async () => { await supabase.auth.signOut(); navigate({ to: "/" }); }}
                className="ml-1 flex h-8 w-8 items-center justify-center rounded-xl text-white/30 transition hover:bg-white/10 hover:text-white/70"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          )}
        </header>

        {/* ── XP PROGRESS STRIP ── */}
        {profile && (
          <div className="mb-8 rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500/30 to-orange-500/30 ring-1 ring-amber-400/30">
                  <Zap className="h-5 w-5 text-amber-400" />
                </div>
                <div>
                  <div className="text-sm font-bold text-white">Level {level} · {getLevelTitle(level)}</div>
                  <div className="text-xs text-white/40">{xp.toLocaleString()} XP total</div>
                </div>
              </div>
              <div className="text-xs text-white/30">{(nextXp - xp).toLocaleString()} XP to Level {level + 1}</div>
            </div>
            <div className="h-2 w-full rounded-full bg-white/10">
              <div
                className="h-2 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all duration-700"
                style={{ width: `${Math.min(progress, 100)}%` }}
              />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-lg font-bold text-amber-400">{hours}h {mins}m</div>
                <div className="text-[10px] text-white/30 uppercase tracking-wider">Focus Time</div>
              </div>
              <div>
                <div className="flex items-center justify-center gap-1 text-lg font-bold text-orange-400">
                  <Flame className="h-4 w-4" />{profile.current_streak}
                </div>
                <div className="text-[10px] text-white/30 uppercase tracking-wider">Day Streak</div>
              </div>
              <div>
                <div className="flex items-center justify-center gap-1 text-lg font-bold text-purple-400">
                  <Trophy className="h-4 w-4" />
                  {profile.total_focus_minutes >= 1 ? "Active" : "Newbie"}
                </div>
                <div className="text-[10px] text-white/30 uppercase tracking-wider">Status</div>
              </div>
            </div>
          </div>
        )}

        {/* ── ROOM GRID ── */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MAPS.map((m, i) => {
            const online = counts[m.id] ?? 0;
            const accentHex = "#" + m.accent.toString(16).padStart(6, "0");
            const ambientHex = "#" + m.ambient.toString(16).padStart(6, "0");
            return (
              <Link
                key={m.id}
                to="/world/$mapId"
                params={{ mapId: m.id }}
                className="group relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-6 transition-all duration-300 hover:-translate-y-1.5 hover:border-white/20 hover:shadow-2xl backdrop-blur-sm"
                style={{
                  boxShadow: online > 0 ? `0 0 40px ${accentHex}15` : undefined,
                }}
              >
                {/* Gradient bg */}
                <div
                  className="absolute inset-0 opacity-30 transition-opacity duration-300 group-hover:opacity-50"
                  style={{
                    background: `radial-gradient(ellipse at 70% 20%, ${accentHex}40, transparent 65%), radial-gradient(ellipse at 20% 80%, ${ambientHex}20, transparent 50%)`,
                  }}
                />

                {/* Animated shimmer on hover */}
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                  style={{
                    background: `linear-gradient(105deg, transparent 40%, ${accentHex}15 50%, transparent 60%)`,
                  }}
                />

                <div className="relative">
                  <div
                    className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 shadow-inner"
                    style={{ boxShadow: `0 4px 20px ${accentHex}30`, background: `linear-gradient(135deg, ${accentHex}33, ${ambientHex}33)` }}
                  >
                    <div
                      className="h-6 w-6 rounded-full"
                      style={{ background: accentHex, boxShadow: `0 0 18px ${accentHex}` }}
                    />
                  </div>

                  <h3 className="mt-4 text-xl font-bold tracking-tight text-white">{m.name}</h3>
                  <p className="mt-1 text-sm text-white/50">{m.tagline}</p>

                  {/* Bottom row */}
                  <div className="mt-5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className={`flex h-2 w-2 rounded-full ${online > 0 ? "animate-pulse" : ""}`}
                        style={{ background: online > 0 ? accentHex : "#ffffff30" }}
                      />
                      <span className="flex items-center gap-1 text-xs text-white/40">
                        <Users className="h-3 w-3" />
                        {online} studying
                      </span>
                    </div>
                    <div
                      className="flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold opacity-0 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0 translate-x-2"
                      style={{ background: `${accentHex}25`, color: accentHex }}
                    >
                      Enter <ChevronRight className="h-3 w-3" />
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </section>

        {/* ── FOOTER NOTE ── */}
        <p className="mt-10 text-center text-xs text-white/20">
          Every minute focused earns 10 XP · Build your streak · Unlock achievements
        </p>
      </div>
    </main>
  );
}
