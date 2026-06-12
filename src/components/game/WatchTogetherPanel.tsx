/**
 * WatchTogetherPanel
 *
 * HOST:
 *   - Paste YouTube URL → loads for everyone
 *   - Play / Pause → synced to all guests
 *   - Full timeline scrubber → drag to any point, releases broadcast new position to all
 *   - ±10s skip buttons → also synced
 *   - Expand button → fullscreen overlay
 *
 * GUEST:
 *   - Player mirrors host (play, pause, seek) in real-time
 *   - Expand button → fullscreen overlay (read-only, still synced)
 *   - Cannot control playback
 */

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Tv2, Play, Pause, Link, X, Loader2, AlertCircle,
  Maximize2, Minimize2, SkipBack, SkipForward,
} from "lucide-react";
import { useWatchTogether, extractYouTubeId, type YTPlayer } from "@/hooks/useWatchTogether";

// ── YouTube IFrame API types ──────────────────────────────────────────────────
declare global {
  interface Window {
    YT: {
      Player: new (
        el: HTMLElement | string,
        opts: {
          videoId?: string;
          playerVars?: Record<string, unknown>;
          events?: {
            onReady?: (e: { target: YTPlayer }) => void;
            onStateChange?: (e: { data: number }) => void;
          };
        },
      ) => YTPlayer;
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

function buildPlayer(
  el: HTMLDivElement,
  videoId: string,
  onReady: (p: YTPlayer) => void,
  onStateChange: (state: number) => void,
): YTPlayer {
  return new window.YT.Player(el, {
    videoId,
    playerVars: { autoplay: 0, controls: 0, disablekb: 1, rel: 0, modestbranding: 1, iv_load_policy: 3 },
    events: {
      onReady: (e) => onReady(e.target),
      onStateChange: (e) => onStateChange(e.data),
    },
  });
}

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

// ── Main component ────────────────────────────────────────────────────────────
export function WatchTogetherPanel({
  tableId, roomId, isHost, userId,
}: {
  tableId: string;
  roomId: string;
  isHost: boolean;
  userId: string;
}) {
  const wt = useWatchTogether({ tableId, roomId, isHost, userId });

  const [urlInput, setUrlInput]     = useState("");
  const [urlError, setUrlError]     = useState("");
  const [apiReady, setApiReady]     = useState(false);
  const [mounted, setMounted]       = useState(false);
  const [fsMounted, setFsMounted]   = useState(false);
  const [open, setOpen]             = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  // Timeline state
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration]       = useState(0);
  const [scrubbing, setScrubbing]     = useState(false);
  const [scrubValue, setScrubValue]   = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const panelDivRef    = useRef<HTMLDivElement>(null);
  const fsDivRef       = useRef<HTMLDivElement>(null);
  const panelPlayerRef = useRef<YTPlayer | null>(null);
  const fsPlayerRef    = useRef<YTPlayer | null>(null);
  const currentVidRef  = useRef("");

  // ── YT API ────────────────────────────────────────────────────────────────
  useEffect(() => { loadYTApi().then(() => setApiReady(true)); }, []);

  function destroyPlayer(ref: React.MutableRefObject<YTPlayer | null>) {
    if (ref.current) { try { ref.current.destroy(); } catch {} ref.current = null; }
  }

  // ── Timeline ticker — updates currentTime every 500ms while playing ───────
  useEffect(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(() => {
      if (scrubbing) return;
      const p = fullscreen ? fsPlayerRef.current : panelPlayerRef.current;
      if (!p) return;
      try {
        const ct = p.getCurrentTime();
        const dur = (p as any).getDuration?.() ?? 0;
        setCurrentTime(ct);
        if (dur > 0) setDuration(dur);
      } catch {}
    }, 500);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [fullscreen, scrubbing]);

  // ── Build PANEL player ────────────────────────────────────────────────────
  useEffect(() => {
    const vid = wt.videoId;
    if (!apiReady || !open || !vid) return;
    if (currentVidRef.current === vid && panelPlayerRef.current) return;
    currentVidRef.current = vid;
    destroyPlayer(panelPlayerRef);
    setMounted(false);
    const t = setTimeout(() => {
      if (!panelDivRef.current) return;
      buildPlayer(panelDivRef.current, vid,
        (p) => { panelPlayerRef.current = p; wt.onPlayerReady(p); setMounted(true); },
        (state) => { if (isHost) handleHostStateChange(state, panelPlayerRef); },
      );
    }, 100);
    return () => clearTimeout(t);
  }, [apiReady, open, wt.videoId]);

  // ── Build FULLSCREEN player ───────────────────────────────────────────────
  useEffect(() => {
    const vid = wt.videoId;
    if (!apiReady || !fullscreen || !vid) return;
    destroyPlayer(fsPlayerRef);
    setFsMounted(false);
    const t = setTimeout(() => {
      if (!fsDivRef.current) return;
      buildPlayer(fsDivRef.current, vid,
        (p) => {
          fsPlayerRef.current = p;
          if (wt.session) {
            p.seekTo(wt.session.current_seconds, true);
            if (wt.session.is_playing) p.playVideo(); else p.pauseVideo();
          }
          setFsMounted(true);
        },
        (state) => { if (isHost) handleHostStateChange(state, fsPlayerRef); },
      );
    }, 100);
    return () => clearTimeout(t);
  }, [apiReady, fullscreen, wt.videoId]);

  // Re-sync panel when fullscreen closes
  useEffect(() => {
    if (!fullscreen && panelPlayerRef.current && wt.session) {
      const p = panelPlayerRef.current;
      p.seekTo(wt.session.current_seconds, true);
      if (wt.session.is_playing) p.playVideo(); else p.pauseVideo();
    }
  }, [fullscreen]);

  useEffect(() => {
    if (mounted && panelPlayerRef.current) wt.onPlayerReady(panelPlayerRef.current);
  }, [mounted]);

  function handleHostStateChange(state: number, ref: React.MutableRefObject<YTPlayer | null>) {
    if (state === 1) {
      const t = ref.current?.getCurrentTime() ?? 0;
      wt.broadcastState(true, t);
    } else if (state === 2) {
      const t = ref.current?.getCurrentTime() ?? 0;
      wt.broadcastState(false, t);
    }
  }

  // ── URL ───────────────────────────────────────────────────────────────────
  const handleSetUrl = useCallback(async () => {
    const id = extractYouTubeId(urlInput.trim());
    if (!id) { setUrlError("Couldn't find a YouTube video ID in that URL."); return; }
    setUrlError("");
    await wt.setVideoUrl(urlInput.trim());
    setUrlInput("");
    setCurrentTime(0); setDuration(0);
  }, [urlInput, wt.setVideoUrl]);

  // ── Playback controls ─────────────────────────────────────────────────────
  const activePlayer = () => fullscreen ? fsPlayerRef.current : panelPlayerRef.current;

  const handlePlay = useCallback(async () => {
    const p = activePlayer(); if (!p) return;
    await wt.broadcastState(true, p.getCurrentTime());
    p.playVideo();
  }, [wt, fullscreen]);

  const handlePause = useCallback(async () => {
    const p = activePlayer(); if (!p) return;
    await wt.broadcastState(false, p.getCurrentTime());
    p.pauseVideo();
  }, [wt, fullscreen]);

  const handleSkip = useCallback(async (delta: number) => {
    const p = activePlayer(); if (!p) return;
    const t = Math.max(0, p.getCurrentTime() + delta);
    await wt.seek(t);
    p.seekTo(t, true);
    setCurrentTime(t);
  }, [wt, fullscreen]);

  // ── Timeline scrubber handlers (host only) ────────────────────────────────
  const handleScrubStart = useCallback(() => {
    if (!isHost) return;
    setScrubbing(true);
    setScrubValue(currentTime);
  }, [isHost, currentTime]);

  const handleScrubChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isHost) return;
    setScrubValue(Number(e.target.value));
  }, [isHost]);

  const handleScrubEnd = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isHost) return;
    const t = Number(e.target.value);
    setScrubbing(false);
    setCurrentTime(t);
    const p = activePlayer();
    if (p) p.seekTo(t, true);
    await wt.seek(t);
  }, [isHost, wt, fullscreen]);

  const displayTime   = scrubbing ? scrubValue : currentTime;
  const progressPct   = duration > 0 ? (displayTime / duration) * 100 : 0;

  // ── Timeline component (reused in panel + fullscreen) ────────────────────
  function Timeline() {
    if (!wt.videoId) return null;
    return (
      <div className="px-4 pt-2 pb-1">
        {/* Scrubber track */}
        <div className="relative h-4 flex items-center group">
          {/* Track background */}
          <div className="absolute inset-x-0 h-1 rounded-full bg-white/10" />
          {/* Progress fill */}
          <div
            className="absolute left-0 h-1 rounded-full bg-gradient-to-r from-purple-500 to-purple-400 pointer-events-none"
            style={{ width: `${progressPct}%` }}
          />
          {/* Thumb dot */}
          <div
            className="absolute h-3 w-3 rounded-full bg-purple-400 shadow-lg shadow-purple-500/50 pointer-events-none transition-transform group-hover:scale-125"
            style={{ left: `calc(${progressPct}% - 6px)` }}
          />
          {/* Range input — host: interactive, guest: display only */}
          <input
            type="range"
            min={0}
            max={duration > 0 ? duration : 100}
            step={1}
            value={displayTime}
            disabled={!isHost}
            onMouseDown={handleScrubStart}
            onTouchStart={handleScrubStart}
            onChange={handleScrubChange}
            onMouseUp={handleScrubEnd}
            onTouchEnd={handleScrubEnd as any}
            className={`absolute inset-0 w-full opacity-0 h-4 ${isHost ? "cursor-pointer" : "cursor-default"}`}
          />
        </div>
        {/* Time labels */}
        <div className="flex justify-between text-[10px] text-white/35 mt-0.5 font-mono">
          <span>{formatTime(displayTime)}</span>
          <span>{duration > 0 ? formatTime(duration) : "--:--"}</span>
        </div>
      </div>
    );
  }

  // ── Controls bar ──────────────────────────────────────────────────────────
  function ControlsBar() {
    if (!wt.videoId) return null;
    return (
      <div className="border-t border-white/10 bg-black/40">
        <Timeline />
        {isHost && (
          <div className="flex items-center justify-center gap-2 px-4 pb-3 pt-1">
            <button
              onClick={() => handleSkip(-10)}
              className="flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2.5 py-1.5 text-[11px] text-white/60 transition hover:bg-white/10 hover:text-white"
            >
              <SkipBack className="h-3.5 w-3.5" /> 10s
            </button>

            {wt.isPlaying ? (
              <button
                onClick={handlePause}
                className="flex items-center gap-1.5 rounded-full bg-white/10 border border-white/20 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-white/20"
              >
                <Pause className="h-3.5 w-3.5" /> Pause for everyone
              </button>
            ) : (
              <button
                onClick={handlePlay}
                disabled={!mounted && !fsMounted}
                className="flex items-center gap-1.5 rounded-full bg-purple-500/25 border border-purple-400/40 px-4 py-1.5 text-xs font-medium text-purple-200 transition hover:bg-purple-500/40 disabled:opacity-40"
              >
                <Play className="h-3.5 w-3.5" /> Play for everyone
              </button>
            )}

            <button
              onClick={() => handleSkip(10)}
              className="flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2.5 py-1.5 text-[11px] text-white/60 transition hover:bg-white/10 hover:text-white"
            >
              10s <SkipForward className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        {!isHost && (
          <div className="flex items-center justify-center gap-1.5 px-4 pb-3 pt-1 text-[10px] text-white/40">
            <span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse" />
            Synced with host
          </div>
        )}
      </div>
    );
  }

  // ── Collapsed button ──────────────────────────────────────────────────────
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

  // ── Fullscreen overlay (both host & guest) ────────────────────────────────
  const FullscreenOverlay = fullscreen && (
    <div className="fixed inset-0 z-[200] flex flex-col bg-black">
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 bg-black/80 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <Tv2 className="h-4 w-4 text-purple-400" />
          <span className="text-sm font-semibold text-white">Watch Together</span>
          {!isHost && (
            <span className="rounded-full bg-purple-500/15 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-purple-400">
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

      {/* Video fills available space */}
      <div className="relative flex-1 bg-black overflow-hidden">
        {wt.videoId ? (
          <>
            <div ref={fsDivRef} className="w-full h-full" />
            {!fsMounted && (
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

      {/* Controls at bottom */}
      <div className="bg-black/90 backdrop-blur-md border-t border-white/10">
        <ControlsBar />
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
                  type="text"
                  value={urlInput}
                  onChange={(e) => { setUrlInput(e.target.value); setUrlError(""); }}
                  onKeyDown={(e) => e.key === "Enter" && handleSetUrl()}
                  placeholder="Paste YouTube URL…"
                  className="w-full rounded-lg border border-white/15 bg-white/5 pl-8 pr-3 py-1.5 text-xs text-white placeholder-white/30 outline-none focus:border-purple-400/50 transition"
                />
              </div>
              <button
                onClick={handleSetUrl}
                disabled={!urlInput.trim()}
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
              {!mounted && (
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

        {/* Controls + timeline */}
        <ControlsBar />

        {wt.error && (
          <div className="px-4 py-2 text-[10px] text-red-400 border-t border-white/10">{wt.error}</div>
        )}
      </div>
    </>
  );
}
