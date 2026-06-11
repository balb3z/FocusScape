import { useEffect, useMemo, useRef, useState } from "react";
import { Volume2, VolumeX, Music, Sparkles, Pause, Play } from "lucide-react";
import { toast } from "sonner";
import { useUiBlock } from "@/lib/uiFocus";

function useClickOutside(ref: React.RefObject<HTMLElement | null>, handler: () => void) {
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) handler();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handler();
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, handler]);
}

type SoundTrack = { id: string; label: string; url: string };

// Free CC0 ambient loops served by Mixkit / Pixabay CDNs (long-lived URLs verified to stream).
const TRACKS: SoundTrack[] = [
  { id: "rain",         label: "Rain",         url: "https://assets.mixkit.co/active_storage/sfx/2515/2515.wav" },
  { id: "cafe",         label: "Café",         url: "https://assets.mixkit.co/active_storage/sfx/2521/2521.wav" },
  { id: "library",      label: "Library",      url: "https://assets.mixkit.co/active_storage/sfx/2434/2434.wav" },
  { id: "nature",       label: "Nature",       url: "https://assets.mixkit.co/active_storage/sfx/2434/2434.wav" },
  { id: "fire",         label: "Fireplace",    url: "https://assets.mixkit.co/active_storage/sfx/2516/2516.wav" },
  { id: "keyboard",     label: "Keyboard",     url: "https://assets.mixkit.co/active_storage/sfx/2513/2513.wav" },
  { id: "white",        label: "White Noise",  url: "https://assets.mixkit.co/active_storage/sfx/2438/2438.wav" },
  { id: "lofi",         label: "Lo-Fi",        url: "https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3?filename=lofi-study-112191.mp3" },
  { id: "instrumental", label: "Instrumental", url: "https://cdn.pixabay.com/download/audio/2022/08/02/audio_2dde668ca0.mp3?filename=relaxing-145038.mp3" },
  { id: "focus",        label: "Focus Music",  url: "https://cdn.pixabay.com/download/audio/2023/06/19/audio_3c7c79a1c8.mp3?filename=ambient-piano-amp-strings-10711.mp3" },
];

type Prefs = { active: string[]; volumes: Record<string, number>; master: number; muted: boolean };
const STORAGE = "ambient-prefs-v2";

const FADE_MS = 600;

function loadPrefs(): Prefs {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE) : null;
    if (raw) return { master: 0.6, muted: false, volumes: {}, active: [], ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { active: [], volumes: {}, master: 0.6, muted: false };
}

export function AmbientAudio({ suggestions = [] }: { suggestions?: string[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());
  const audioRefs = useRef<Record<string, HTMLAudioElement>>({});
  const fadeRefs = useRef<Record<string, number>>({});
  const suggestionShownRef = useRef(false);

  useClickOutside(containerRef, () => setOpen(false));
  useUiBlock(open);



  const activeSet = useMemo(() => new Set(prefs.active), [prefs.active]);

  // Persist
  useEffect(() => {
    try { localStorage.setItem(STORAGE, JSON.stringify(prefs)); } catch { /* ignore */ }
  }, [prefs]);

  // Preload audio
  useEffect(() => {
    TRACKS.forEach((t) => {
      if (!audioRefs.current[t.id]) {
        const audio = new Audio(t.url);
        audio.loop = true;
        audio.crossOrigin = "anonymous";
        audio.preload = "auto";
        audio.volume = 0;
        audio.addEventListener("error", () => {
          console.warn("[audio] failed to load", t.id, t.url);
          toast.error(`Could not load "${t.label}" sound`);
        });
        audioRefs.current[t.id] = audio;
      }
    });
    return () => {
      Object.values(audioRefs.current).forEach((a) => a.pause());
      Object.values(fadeRefs.current).forEach((id) => window.clearInterval(id));
    };
  }, []);

  // Smooth fades + volume sync
  useEffect(() => {
    TRACKS.forEach((t) => {
      const audio = audioRefs.current[t.id];
      if (!audio) return;
      const trackVol = prefs.volumes[t.id] ?? 0.5;
      const targetActive = activeSet.has(t.id) && !prefs.muted;
      const target = targetActive ? trackVol * prefs.master : 0;

      if (fadeRefs.current[t.id]) window.clearInterval(fadeRefs.current[t.id]);
      const step = 30; // ms
      const ticks = Math.max(1, Math.round(FADE_MS / step));
      const start = audio.volume;
      let i = 0;
      if (targetActive && audio.paused) {
        audio.play().catch((err) => {
          // Autoplay blocked? toast a one-time hint.
          if (err?.name === "NotAllowedError") {
            toast.info("Click anywhere to enable ambient sound");
          } else if (err?.name !== "AbortError") {
            console.warn("[audio] play failed", t.id, err);
          }
        });
      }
      fadeRefs.current[t.id] = window.setInterval(() => {
        i++;
        const v = start + (target - start) * (i / ticks);
        audio.volume = Math.max(0, Math.min(1, v));
        if (i >= ticks) {
          window.clearInterval(fadeRefs.current[t.id]);
          delete fadeRefs.current[t.id];
          if (!targetActive) audio.pause();
        }
      }, step);
    });
  }, [activeSet, prefs.volumes, prefs.master, prefs.muted]);

  // Surface room suggestions once per room (non-destructive — user still toggles)
  useEffect(() => {
    if (!suggestions.length || suggestionShownRef.current) return;
    suggestionShownRef.current = true;
  }, [suggestions]);

  const toggle = (id: string) => {
    setPrefs((p) => {
      const set = new Set(p.active);
      if (set.has(id)) set.delete(id); else set.add(id);
      return { ...p, active: [...set] };
    });
  };
  const setTrackVol = (id: string, v: number) =>
    setPrefs((p) => ({ ...p, volumes: { ...p.volumes, [id]: v } }));
  const playAllSuggested = () => {
    if (!suggestions.length) return;
    setPrefs((p) => ({ ...p, active: Array.from(new Set([...p.active, ...suggestions])) }));
  };
  const muteAll = () => setPrefs((p) => ({ ...p, active: [] }));

  const activeCount = activeSet.size;

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex h-10 items-center gap-2 rounded-full border px-3 transition-all ${
          activeCount > 0 && !prefs.muted
            ? "border-amber-400/60 bg-amber-400/15 text-amber-300 shadow-[0_0_14px_rgba(240,201,135,0.35)]"
            : "border-white/20 bg-black/50 text-white/70 hover:border-white/40 hover:text-white"
        }`}
        title="Ambient sounds"
      >
        {prefs.muted || activeCount === 0 ? <VolumeX className="h-4 w-4" /> : <Music className="h-4 w-4" />}
        <span className="text-xs">{activeCount > 0 ? `${activeCount} on` : "Sounds"}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-12 z-30 w-80 rounded-2xl border border-white/15 bg-black/80 p-4 shadow-2xl backdrop-blur-xl">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-widest text-white/60">Soundscape</span>
            <button
              onClick={() => setPrefs((p) => ({ ...p, muted: !p.muted }))}
              className="text-[10px] text-white/50 hover:text-white"
            >
              {prefs.muted ? "Unmute all" : "Mute all"}
            </button>
          </div>

          {/* Master volume */}
          <div className="mb-3 flex items-center gap-2 rounded-xl bg-white/5 px-3 py-2">
            <Volume2 className="h-3.5 w-3.5 text-white/50" />
            <span className="text-[10px] uppercase tracking-wider text-white/40">Master</span>
            <input
              type="range" min="0" max="1" step="0.01"
              value={prefs.master}
              onChange={(e) => setPrefs((p) => ({ ...p, master: parseFloat(e.target.value) }))}
              className="ml-auto h-1 w-32 accent-amber-400"
            />
          </div>

          {suggestions.length > 0 && (
            <button
              onClick={playAllSuggested}
              className="mb-3 flex w-full items-center justify-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-300 hover:bg-amber-400/20"
            >
              <Sparkles className="h-3 w-3" />
              Play suggested for this room
            </button>
          )}

          <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {TRACKS.map((t) => {
              const on = activeSet.has(t.id);
              const vol = prefs.volumes[t.id] ?? 0.5;
              return (
                <div
                  key={t.id}
                  className={`flex items-center gap-2 rounded-xl px-2 py-1.5 transition-colors ${
                    on ? "bg-amber-400/10 ring-1 ring-amber-400/40" : "bg-white/5 hover:bg-white/10"
                  }`}
                >
                  <button
                    onClick={() => toggle(t.id)}
                    className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                      on ? "bg-amber-400/30 text-amber-200" : "bg-black/40 text-white/60"
                    }`}
                    title={on ? "Stop" : "Play"}
                  >
                    {on ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  </button>
                  <span className={`flex-1 text-xs ${on ? "text-amber-300" : "text-white/70"}`}>{t.label}</span>
                  <input
                    type="range" min="0" max="1" step="0.01"
                    value={vol}
                    onChange={(e) => setTrackVol(t.id, parseFloat(e.target.value))}
                    className="h-1 w-20 accent-amber-400"
                    disabled={!on}
                  />
                </div>
              );
            })}
          </div>

          {activeCount > 0 && (
            <button
              onClick={muteAll}
              className="mt-3 w-full rounded-xl bg-white/5 px-3 py-1.5 text-[11px] text-white/50 hover:bg-white/10 hover:text-white"
            >
              Stop all sounds
            </button>
          )}
        </div>
      )}
    </div>
  );
}
