/**
 * WatchTogetherPanel
 *
 * HOST:
 *   - Paste YouTube URL → loads for everyone
 *   - Play / Pause / ±10s skip / timeline scrubber → ALL synced to guests via Supabase Realtime
 *   - Fullscreen overlay — controls work identically, state broadcasts to guests
 *
 * GUEST:
 *   - Both panel and fullscreen players are registered simultaneously
 *   - Any state change (play/pause/seek) from host applies to whichever view is open
 *   - Timeline shows position (read-only scrubber)
 *   - Fullscreen button available
 *
 * LAYOUT FIX:
 *   - Fullscreen uses a pure flexbox column: top-bar / video (flex-1) / bottom-bar
 *   - Bottom bar never overflows; video shrinks to fill whatever is left
 *   - Works on 15.6" 1080p screens and larger
 */

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Tv2, Play, Pause, Link, X, Loader2, AlertCircle,
  Maximize2, Minimize2, SkipBack, SkipForward,
} from "lucide-react";
import { useWatchTogether, extractYouTubeId, type YTPlayer } from "@/hooks/useWatchTogether";

// ── YouTube IFrame API ────────────────────────────────────────────────────────
declare global {
  interface Window {
    YT: {
      Player: new (el: HTMLElement | string, opts: {
        videoId?: string;
        playerVars?: Record<string, unknown>;
        events?: {
          onReady?: (e: { target: YTPlayer }) => void;
          onStateChange?: (e: { data: number }) => void;
        };
      }) => YTPlayer;
      PlayerState: { PLAYING: number; PAUSED: number; ENDED: number };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<void> | null = null;
function loadYTApi(): Promise<void> {
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve) => {
    if (window.YT?.Player) { resolve(); return; }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return ytApiPromise;
}

function buildYTPlayer(
  el: HTMLDivElement, videoId: string,
  onReady: (p: YTPlayer) => void,
  onStateChange: (state: number) => void,
) {
  new window.YT.Player(el, {
    videoId,
    playerVars: { autoplay: 0, controls: 0, disablekb: 1, rel: 0, modestbranding: 1, iv_load_policy: 3 },
    events: {
      onReady: (e) => onReady(e.target),
      onStateChange: (e) => onStateChange(e.data),
    },
  });
}

function fmt(s: number) {
  if (!isFinite(s) || s < 0) return "0:00";
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

// ── Component ─────────────────────────────────────────────────────────────────
export function WatchTogetherPanel({ tableId, roomId, isHost, userId }: {
  tableId: string; roomId: string; isHost: boolean; userId: string;
}) {
  const wt = useWatchTogether({ tableId, roomId, isHost, userId });

  const [urlInput, setUrlInput]     = useState("");
  const [urlError, setUrlError]     = useState("");
  const [apiReady, setApiReady]     = useState(false);
  const [panelReady, setPanelReady] = useState(false);
  const [fsReady, setFsReady]       = useState(false);
  const [open, setOpen]             = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  // Timeline
  const [currentTime, setCurrentTime] = useState(0);
  const [duration,    setDuration]    = useState(0);
  const [scrubbing,   setScrubbing]   = useState(false);
  const [scrubVal,    setScrubVal]    = useState(0);

  const panelDivRef   = useRef<HTMLDivElement>(null);
  const fsDivRef      = useRef<HTMLDivElement>(null);
  const panelRef      = useRef<YTPlayer | null>(null);
  const fsRef         = useRef<YTPlayer | null>(null);
  const currentVidRef = useRef("");
  const tickRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrubbingRef  = useRef(false);
  const fsOpenRef     = useRef(false);

  // Keep refs current
  useEffect(() => { scrubbingRef.current = scrubbing; }, [scrubbing]);
  useEffect(() => { fsOpenRef.current = fullscreen; }, [fullscreen]);

  useEffect(() => { loadYTApi().then(() => setApiReady(true)); }, []);

  function safeDestroy(ref: React.MutableRefObject<YTPlayer | null>, id: string) {
    if (ref.current) {
      try { ref.current.destroy(); } catch {}
      ref.current = null;
      wt.unregisterPlayer(id);
    }
  }

  // ── Ticker — reads whichever player is currently visible ──────────────────
  useEffect(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(() => {
      if (scrubbingRef.current) return;
      const p = fsOpenRef.current ? fsRef.current : panelRef.current;
      if (!p) return;
      try {
        const ct  = p.getCurrentTime();
        const dur = p.getDuration();
        setCurrentTime(ct);
        if (dur > 0) setDuration(dur);
      } catch {}
    }, 250);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, []); // once — refs handle switching

  // ── Build PANEL player ────────────────────────────────────────────────────
  useEffect(() => {
    const vid = wt.videoId;
    if (!apiReady || !open || !vid) return;
    if (currentVidRef.current === vid && panelRef.current) return;
    currentVidRef.current = vid;
    safeDestroy(panelRef, "panel");
    setPanelReady(false);
    const t = setTimeout(() => {
      if (!panelDivRef.current) return;
      buildYTPlayer(
        panelDivRef.current, vid,
        (p) => {
          panelRef.current = p;
          wt.registerPlayer("panel", p);  // hook syncs it immediately
          setPanelReady(true);
        },
        (state) => {
          // Host: broadcast play/pause to guests when YT player state changes
          if (isHost && (state === 1 || state === 2) && panelRef.current) {
            const t = panelRef.current.getCurrentTime();
            wt.broadcastState(state === 1, t);
          }
        },
      );
    }, 100);
    return () => clearTimeout(t);
  }, [apiReady, open, wt.videoId]);

  // ── Build FULLSCREEN player ───────────────────────────────────────────────
  useEffect(() => {
    const vid = wt.videoId;
    if (!apiReady || !fullscreen || !vid) return;
    safeDestroy(fsRef, "fullscreen");
    setFsReady(false);
    const t = setTimeout(() => {
      if (!fsDivRef.current) return;
      buildYTPlayer(
        fsDivRef.current, vid,
        (p) => {
          fsRef.current = p;
          wt.registerPlayer("fullscreen", p);  // hook syncs it to current session immediately
          setFsReady(true);
        },
        (state) => {
          // Host: broadcast play/pause from fullscreen player too
          if (isHost && (state === 1 || state === 2) && fsRef.current) {
            const t = fsRef.current.getCurrentTime();
            wt.broadcastState(state === 1, t);
          }
        },
      );
    }, 100);
    return () => clearTimeout(t);
  }, [apiReady, fullscreen, wt.videoId]);

  // ── Cleanup fullscreen player when closed ────────────────────────────────
  useEffect(() => {
    if (!fullscreen) {
      safeDestroy(fsRef, "fullscreen");
      setFsReady(false);
    }
  }, [fullscreen]);

  // ── URL ───────────────────────────────────────────────────────────────────
  const handleSetUrl = useCallback(async () => {
    const id = extractYouTubeId(urlInput.trim());
    if (!id) { setUrlError("Couldn't find a YouTube video ID in that URL."); return; }
    setUrlError("");
    await wt.setVideoUrl(urlInput.trim());
    setUrlInput("");
    setCurrentTime(0); setDuration(0);
  }, [urlInput, wt.setVideoUrl]);

  // ── Active player (whichever is visible right now) ────────────────────────
  const activePlayer = useCallback(
    () => fsOpenRef.current ? fsRef.current : panelRef.current,
    [],
  );

  // ── Host controls ─────────────────────────────────────────────────────────
  const handlePlay = useCallback(async () => {
    const p = activePlayer(); if (!p) return;
    const t = p.getCurrentTime();
    p.playVideo();
    await wt.broadcastState(true, t);
  }, [wt]);

  const handlePause = useCallback(async () => {
    const p = activePlayer(); if (!p) return;
    const t = p.getCurrentTime();
    p.pauseVideo();
    await wt.broadcastState(false, t);
  }, [wt]);

  const handleSkip = useCallback(async (delta: number) => {
    const p = activePlayer(); if (!p) return;
    const t = Math.max(0, p.getCurrentTime() + delta);
    p.seekTo(t, true);
    setCurrentTime(t);
    await wt.seek(t);
  }, [wt]);

  // ── Timeline scrubber ─────────────────────────────────────────────────────
  const onScrubStart = useCallback(() => {
    if (!isHost) return;
    setScrubbing(true); setScrubVal(currentTime);
  }, [isHost, currentTime]);

  const onScrubMove = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isHost) return;
    setScrubVal(Number(e.target.value));
  }, [isHost]);

  const onScrubEnd = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isHost) return;
    const t = Number(e.target.value);
    setScrubbing(false); setCurrentTime(t);
    activePlayer()?.seekTo(t, true);
    await wt.seek(t);
  }, [isHost, wt]);

  const displayTime = scrubbing ? scrubVal : currentTime;
  const pct = duration > 0 ? Math.min(100, (displayTime / duration) * 100) : 0;

  // ── Reusable UI pieces ────────────────────────────────────────────────────

  function TimelineBar({ large = false }: { large?: boolean }) {
    if (!wt.videoId) return null;
    const trackH = large ? 5 : 3;
    const thumbSz = large ? 14 : 11;
    return (
      <div className={large ? "px-6 pt-4 pb-2" : "px-4 pt-2 pb-1"}>
        <div className="relative flex items-center group" style={{ height: thumbSz + 8 }}>
          {/* track */}
          <div className="absolute inset-x-0 rounded-full bg-white/15" style={{ height: trackH }} />
          {/* fill */}
          <div
            className="absolute left-0 rounded-full bg-gradient-to-r from-purple-500 to-purple-400 pointer-events-none"
            style={{ width: `${pct}%`, height: trackH }}
          />
          {/* thumb */}
          <div
            className="absolute rounded-full bg-purple-400 shadow-lg shadow-purple-500/60 pointer-events-none transition-transform group-hover:scale-125"
            style={{ width: thumbSz, height: thumbSz, left: `calc(${pct}% - ${thumbSz / 2}px)` }}
          />
          {/* range input */}
          <input
            type="range" min={0} max={duration > 0 ? duration : 100} step={0.5}
            value={displayTime} disabled={!isHost}
            onMouseDown={onScrubStart} onTouchStart={onScrubStart}
            onChange={onScrubMove}
            onMouseUp={onScrubEnd} onTouchEnd={onScrubEnd as any}
            className={`absolute inset-0 w-full opacity-0 ${isHost ? "cursor-pointer" : "cursor-default"}`}
            style={{ height: thumbSz + 8 }}
          />
        </div>
        <div className={`flex justify-between font-mono text-white/40 mt-1 ${large ? "text-xs" : "text-[10px]"}`}>
          <span>{fmt(displayTime)}</span>
          <span>{duration > 0 ? fmt(duration) : "--:--"}</span>
        </div>
      </div>
    );
  }

  function HostButtons({ large = false }: { large?: boolean }) {
    if (!isHost || !wt.videoId) return null;
    const skipCls = `flex items-center gap-1 rounded-full border border-white/15 bg-white/5 text-white/60 transition hover:bg-white/10 hover:text-white ${large ? "px-3 py-2 text-xs" : "px-2.5 py-1.5 text-[11px]"}`;
    const iconSz  = large ? "h-4 w-4" : "h-3.5 w-3.5";
    return (
      <div className={`flex items-center justify-center gap-2 ${large ? "pb-4 pt-1 px-6" : "pb-3 pt-1 px-4"}`}>
        <button onClick={() => handleSkip(-10)} className={skipCls}>
          <SkipBack className={iconSz} /> 10s
        </button>

        {wt.isPlaying ? (
          <button
            onClick={handlePause}
            className={`flex items-center gap-2 rounded-full bg-white/10 border border-white/20 font-medium text-white transition hover:bg-white/20 ${large ? "px-5 py-2 text-sm" : "px-4 py-1.5 text-xs"}`}
          >
            <Pause className={iconSz} /> Pause for everyone
          </button>
        ) : (
          <button
            onClick={handlePlay}
            disabled={!panelReady && !fsReady}
            className={`flex items-center gap-2 rounded-full bg-purple-500/25 border border-purple-400/40 font-medium text-purple-200 transition hover:bg-purple-500/40 disabled:opacity-40 ${large ? "px-5 py-2 text-sm" : "px-4 py-1.5 text-xs"}`}
          >
            <Play className={iconSz} /> Play for everyone
          </button>
        )}

        <button onClick={() => handleSkip(10)} className={skipCls}>
          10s <SkipForward className={iconSz} />
        </button>
      </div>
    );
  }

  function GuestBar({ large = false }: { large?: boolean }) {
    if (isHost || !wt.videoId) return null;
    return (
      <div className={`flex items-center justify-center gap-2 text-white/40 ${large ? "pb-4 pt-1 text-sm" : "pb-3 pt-1 text-[10px]"}`}>
        <span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse" />
        Synced with host
      </div>
    );
  }

  // ── Collapsed pill ────────────────────────────────────────────────────────
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-full border border-white/15 bg-black/50 px-3 py-1.5 text-[11px] text-white/60 transition hover:border-purple-400/40 hover:text-purple-300 hover:bg-purple-500/10 backdrop-blur-md"
      >
        <Tv2 className="h-3.5 w-3.5" />
        Watch Together
        {wt.videoId && <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse" />}
      </button>
    );
  }

  // ── Fullscreen overlay ────────────────────────────────────────────────────
  // Pure flex column — video flex-1 so it fills whatever space remains.
  // Bottom bar is flex-shrink-0 so it is ALWAYS visible regardless of screen height.
  const FullscreenOverlay = fullscreen && (
    <div className="fixed inset-0 z-[200] bg-black flex flex-col overflow-hidden">

      {/* Top bar — flex-shrink-0 */}
      <div className="flex-shrink-0 flex items-center justify-between px-5 py-3 bg-black/80 border-b border-white/10 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <Tv2 className="h-4 w-4 text-purple-400" />
          <span className="text-sm font-semibold text-white">Watch Together</span>
          {!isHost && (
            <span className="rounded-full bg-purple-500/15 px-2 py-0.5 text-[9px] uppercase tracking-widest text-purple-400">
              Synced
            </span>
          )}
        </div>
        <button
          onClick={() => setFullscreen(false)}
          className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/60 transition hover:text-white hover:bg-white/10"
        >
          <Minimize2 className="h-3.5 w-3.5" /> Exit fullscreen
        </button>
      </div>

      {/* Video — flex-1, fills all remaining space */}
      <div className="relative flex-1 bg-black min-h-0">
        {wt.videoId ? (
          <>
            <div ref={fsDivRef} className="absolute inset-0 w-full h-full" />
            {!fsReady && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-purple-400" />
              </div>
            )}
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <Tv2 className="h-12 w-12 text-white/20" />
            <p className="text-sm text-white/40">No video loaded yet</p>
          </div>
        )}
      </div>

      {/* Bottom controls — flex-shrink-0, always visible */}
      <div className="flex-shrink-0 bg-black/90 border-t border-white/10 backdrop-blur-md">
        <TimelineBar large />
        <HostButtons large />
        <GuestBar large />
      </div>
    </div>
  );

  // ── Panel ─────────────────────────────────────────────────────────────────
  return (
    <>
      {FullscreenOverlay}

      <div className="rounded-2xl border border-white/15 bg-black/80 backdrop-blur-xl shadow-2xl overflow-hidden w-80">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Tv2 className="h-4 w-4 text-purple-400" />
            <span className="text-sm font-semibold text-white">Watch Together</span>
            {!isHost && (
              <span className="rounded-full bg-purple-500/15 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-purple-400">
                Guest
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {wt.videoId && (
              <button
                onClick={() => setFullscreen(true)}
                title="Fullscreen"
                className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-white/40 transition hover:text-white hover:bg-white/10"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              onClick={() => setOpen(false)}
              className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-white/40 transition hover:text-white hover:bg-white/10"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Host URL input */}
        {isHost && (
          <div className="px-4 py-3 border-b border-white/10">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Link className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/30" />
                <input
                  type="text" value={urlInput}
                  onChange={(e) => { setUrlInput(e.target.value); setUrlError(""); }}
                  onKeyDown={(e) => e.key === "Enter" && handleSetUrl()}
                  placeholder="Paste YouTube URL…"
                  className="w-full rounded-lg border border-white/15 bg-white/5 pl-8 pr-3 py-1.5 text-xs text-white placeholder-white/30 outline-none focus:border-purple-400/50 transition"
                />
              </div>
              <button
                onClick={handleSetUrl} disabled={!urlInput.trim()}
                className="rounded-lg bg-purple-500/20 border border-purple-400/30 px-3 py-1.5 text-xs text-purple-300 transition hover:bg-purple-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Load
              </button>
            </div>
            {urlError && (
              <div className="mt-1.5 flex items-center gap-1 text-[10px] text-red-400">
                <AlertCircle className="h-3 w-3 flex-shrink-0" /> {urlError}
              </div>
            )}
          </div>
        )}

        {/* Player */}
        <div className="relative bg-black aspect-video w-full">
          {wt.videoId ? (
            <>
              <div ref={panelDivRef} className="w-full h-full" />
              {!panelReady && (
                <div className="absolute inset-0 flex items-center justify-center bg-black">
                  <Loader2 className="h-6 w-6 animate-spin text-purple-400" />
                </div>
              )}
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
              <Tv2 className="h-8 w-8 text-white/20" />
              <p className="text-xs text-white/40">
                {isHost ? "Paste a YouTube link above to start watching together" : "Waiting for the host to start a video…"}
              </p>
            </div>
          )}
        </div>

        {/* Timeline + controls */}
        {wt.videoId && (
          <div className="border-t border-white/10 bg-black/40">
            <TimelineBar />
            <HostButtons />
            <GuestBar />
          </div>
        )}

        {wt.error && (
          <div className="px-4 py-2 text-[10px] text-red-400 border-t border-white/10">{wt.error}</div>
        )}
      </div>
    </>
  );
}
