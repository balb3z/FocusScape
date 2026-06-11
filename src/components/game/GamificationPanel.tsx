import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Trophy, Zap, Flame, Star, Target, ChevronRight } from "lucide-react";
import { useUiBlock } from "@/lib/uiFocus";

type Achievement = {
  id: string;
  icon: string;
  title: string;
  desc: string;
  condition: (mins: number, streak: number) => boolean;
};

const ACHIEVEMENTS: Achievement[] = [
  { id: "first_session", icon: "🌱", title: "First Step", desc: "Complete your first session", condition: (m) => m >= 1 },
  { id: "hour_one", icon: "⏱️", title: "One Hour In", desc: "Study for 60 minutes total", condition: (m) => m >= 60 },
  { id: "five_hours", icon: "🔥", title: "5 Hours Studied", desc: "Reach 300 total minutes", condition: (m) => m >= 300 },
  { id: "streak_3", icon: "⚡", title: "On a Roll", desc: "3-day study streak", condition: (_, s) => s >= 3 },
  { id: "streak_7", icon: "🌟", title: "7-Day Streak", desc: "Study 7 days in a row", condition: (_, s) => s >= 7 },
  { id: "night_owl", icon: "🦉", title: "Night Scholar", desc: "Study 10+ hours total", condition: (m) => m >= 600 },
  { id: "focus_master", icon: "🎯", title: "Focus Master", desc: "Log 20+ hours", condition: (m) => m >= 1200 },
  { id: "legend", icon: "👑", title: "Legend", desc: "50 hours total focus", condition: (m) => m >= 3000 },
];

const DAILY_MISSIONS = [
  { id: "d1", icon: "⏱️", title: "Study 25 min", xp: 50, completed: false },
  { id: "d2", icon: "💬", title: "Chat in a room", xp: 20, completed: false },
  { id: "d3", icon: "🎯", title: "Complete a focus session", xp: 75, completed: false },
];

function xpForLevel(level: number) { return level * level * 100; }
function levelFromXp(xp: number) {
  let lvl = 1;
  while (xpForLevel(lvl + 1) <= xp) lvl++;
  return lvl;
}

export function GamificationPanel({ totalMinutes, streak }: { totalMinutes: number; streak: number }) {
  const [open, setOpen] = useState(false);
  useUiBlock(open);
  const xp = totalMinutes * 10;
  const level = levelFromXp(xp);
  const levelXp = xpForLevel(level);
  const nextXp = xpForLevel(level + 1);
  const progress = ((xp - levelXp) / (nextXp - levelXp)) * 100;
  const unlocked = ACHIEVEMENTS.filter((a) => a.condition(totalMinutes, streak));

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 text-amber-300 transition hover:bg-amber-400/20"
      >
        <Zap className="h-4 w-4" />
        <span className="text-xs font-bold">Lv.{level}</span>
      </button>

      {open && (
        <div className="absolute bottom-12 right-0 w-80 rounded-2xl border border-white/15 bg-black/75 shadow-2xl backdrop-blur-xl overflow-hidden">
          {/* XP Header */}
          <div className="bg-gradient-to-r from-amber-900/60 to-purple-900/60 p-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-xs text-white/50 uppercase tracking-wider">Level {level}</div>
                <div className="text-lg font-bold text-white">Study Explorer</div>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-400/20 ring-2 ring-amber-400/50">
                <Star className="h-6 w-6 text-amber-400" />
              </div>
            </div>
            <div className="mt-2">
              <div className="flex justify-between text-[10px] text-white/40 mb-1">
                <span>{xp - levelXp} XP</span>
                <span>{nextXp - levelXp} XP to next level</span>
              </div>
              <div className="h-2 w-full rounded-full bg-white/10">
                <div
                  className="h-2 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all"
                  style={{ width: `${Math.min(progress, 100)}%` }}
                />
              </div>
            </div>
            <div className="mt-3 flex gap-4 text-center">
              <div>
                <div className="text-lg font-bold text-amber-400">{Math.floor(totalMinutes / 60)}h {totalMinutes % 60}m</div>
                <div className="text-[10px] text-white/40">Total Focus</div>
              </div>
              <div>
                <div className="text-lg font-bold text-orange-400 flex items-center gap-1"><Flame className="h-4 w-4" />{streak}</div>
                <div className="text-[10px] text-white/40">Day Streak</div>
              </div>
              <div>
                <div className="text-lg font-bold text-purple-400">{unlocked.length}/{ACHIEVEMENTS.length}</div>
                <div className="text-[10px] text-white/40">Achievements</div>
              </div>
            </div>
          </div>

          {/* Daily Missions */}
          <div className="p-4 border-t border-white/10">
            <div className="flex items-center gap-2 mb-2">
              <Target className="h-3 w-3 text-white/40" />
              <span className="text-[10px] uppercase tracking-widest text-white/40">Daily Missions</span>
            </div>
            <div className="space-y-2">
              {DAILY_MISSIONS.map((m) => (
                <div key={m.id} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{m.icon}</span>
                    <span className="text-xs text-white/70">{m.title}</span>
                  </div>
                  <span className="text-[10px] text-amber-400/80">+{m.xp} XP</span>
                </div>
              ))}
            </div>
          </div>

          {/* Achievements */}
          <div className="p-4 border-t border-white/10">
            <div className="flex items-center gap-2 mb-2">
              <Trophy className="h-3 w-3 text-white/40" />
              <span className="text-[10px] uppercase tracking-widest text-white/40">Achievements</span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {ACHIEVEMENTS.map((a) => {
                const earned = a.condition(totalMinutes, streak);
                return (
                  <div
                    key={a.id}
                    title={`${a.title}: ${a.desc}`}
                    className={`flex flex-col items-center gap-1 rounded-xl p-2 transition ${
                      earned ? "bg-amber-400/15 ring-1 ring-amber-400/40" : "bg-white/5 opacity-40 grayscale"
                    }`}
                  >
                    <span className="text-xl">{a.icon}</span>
                    <span className="text-[9px] text-center leading-none text-white/60">{a.title}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
