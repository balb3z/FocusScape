/**
 * WatchTogetherPanel
 *
 * Rendered inside the GameHud when the player is seated at a table.
 *
 * HOST view:
 *   - Input to paste a YouTube URL
 *   - Embedded YouTube player (via iframe API) with Play / Pause controls
 *   - All controls broadcast state to every seated guest in real time
 *
 * GUEST view:
 *   - Read-only embedded YouTube player that mirrors the host's playback
 *   - "Waiting for host…" placeholder when no video has been set yet
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { Tv2, Play, Pause, Link, X, Loader2, AlertCircle } from "lucide-react";
import { useWatchTogether, extractYouTubeId, type YTPlayer } from "@/hooks/useWatchTogether";

// ── YouTube IFrame API types (minimal) ────────────────────────────────────────
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

// Singleton promise so we only inject the script once per page load
let ytApiPromise: Promise<void> | null = null;
function loadYTApi(): Promise<void> {
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve) => {
    if (window.YT?.Player) { resolve(); return; }
    const prevCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prevCallback?.();
      resolve();
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return ytApiPromise;
}

// ── Component ─────────────────────────────────────────────────────────────────
export function WatchTogetherPanel({
  tableId,
  roomId,
  isHost,
  userId,
}: {
  tableId: string;
  roomId: string;
  isHost: boolean;
  userId: string;
}) {
  const wt = useWatchTogether({ tableId, roomId, isHost, userId });

  const [urlInput, setUrlInput] = useState("");
  const [urlError, setUrlError] = useState("");
  const [apiReady, setApiReady] = useState(false);
  const [playerMounted, setPlayerMounted] = useState(false);
  const [open, setOpen] = useState(false);

  const playerDivRef = useRef<HTMLDivElement>(null);
  const ytPlayerRef = useRef<YTPlayer | null>(null);
  const currentVideoRef = useRef<string>("");

  // ── Load YouTube IFrame API ─────────────────────────────────────────────
  useEffect(() => {
    loadYTApi().then(() => setApiReady(true));
  }, []);

  // ── Create / recreate player when videoId changes ───────────────────────
  useEffect(() => {
    const videoId = wt.videoId;
    if (!apiReady || !open || !videoId) return;
    if (currentVideoRef.current === videoId && ytPlayerRef.current) return;

    currentVideoRef.current = videoId;

    // Destroy old player if any
    if (ytPlayerRef.current) {
      try { ytPlayerRef.current.destroy(); } catch {}
      ytPlayerRef.current = null;
      setPlayerMounted(false);
    }

    // Small delay to let the div re-render
    const timer = setTimeout(() => {
      if (!playerDivRef.current) return;
      const player = new window.YT.Player(playerDivRef.current, {
        videoId,
        playerVars: {
          autoplay: 0,
          controls: isHost ? 1 : 0,
          disablekb: isHost ? 0 : 1,
          rel: 0,
          modestbranding: 1,
        },
        events: {
          onReady: (e) => {
            ytPlayerRef.current = e.target;
            wt.onPlayerReady(e.target);
            setPlayerMounted(true);
          },
        },
      });
    }, 100);

    return () => clearTimeout(timer);
  }, [apiReady, open, wt.videoId, isHost]);

  // ── Sync play state to the player (host's own actions already handled
  //    by the hook; this covers the case where the panel is re-opened) ───
  useEffect(() => {
    if (!ytPlayerRef.current || !playerMounted) return;
    wt.onPlayerReady(ytPlayerRef.current);
  }, [playerMounted]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleSetUrl = useCallback(async () => {
    const id = extractYouTubeId(urlInput.trim());
    if (!id) { setUrlError("Couldn't find a YouTube video ID in that URL."); return; }
    setUrlError("");
    await wt.setVideoUrl(urlInput.trim());
    setUrlInput("");
  }, [urlInput, wt.setVideoUrl]);

  const handlePlay = useCallback(() => wt.play(), [wt.play]);
  const handlePause = useCallback(() => wt.pause(), [wt.pause]);

  // ── Render: collapsed button ──────────────────────────────────────────────
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-full border border-white/15 bg-black/50 px-3 py-1.5 text-[11px] text-white/60 transition hover:border-purple-400/40 hover:text-purple-300 hover:bg-purple-500/10 backdrop-blur-md"
      >
        <Tv2 className="h-3.5 w-3.5" />
        {wt.videoId ? "Watch Together" : "Watch Together"}
        {wt.videoId && (
          <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse" />
        )}
      </button>
    );
  }

  // ── Render: expanded panel ────────────────────────────────────────────────
  return (
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
        <button
          onClick={() => setOpen(false)}
          className="text-white/30 hover:text-white/70 transition"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Host: URL input */}
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
                className="w-full rounded-lg border border-white/15 bg-white/5 pl-8 pr-3 py-1.5 text-xs text-white placeholder-white/30 outline-none focus:border-purple-400/50 focus:bg-white/8 transition"
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
              <AlertCircle className="h-3 w-3 flex-shrink-0" />
              {urlError}
            </div>
          )}
        </div>
      )}

      {/* Player area */}
      <div className="relative bg-black aspect-video w-full">
        {wt.videoId ? (
          <>
            <div ref={playerDivRef} className="w-full h-full" />
            {!playerMounted && (
              <div className="absolute inset-0 flex items-center justify-center bg-black">
                <Loader2 className="h-6 w-6 animate-spin text-purple-400" />
              </div>
            )}
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <Tv2 className="h-8 w-8 text-white/20" />
            <p className="text-xs text-white/40">
              {isHost
                ? "Paste a YouTube link above to start watching together"
                : "Waiting for the host to start a video…"}
            </p>
          </div>
        )}
      </div>

      {/* Host playback controls */}
      {isHost && wt.videoId && (
        <div className="flex items-center justify-center gap-3 px-4 py-2.5 border-t border-white/10">
          {wt.isPlaying ? (
            <button
              onClick={handlePause}
              className="flex items-center gap-1.5 rounded-full bg-white/10 border border-white/15 px-4 py-1.5 text-xs text-white transition hover:bg-white/15"
            >
              <Pause className="h-3.5 w-3.5" /> Pause for everyone
            </button>
          ) : (
            <button
              onClick={handlePlay}
              disabled={!playerMounted}
              className="flex items-center gap-1.5 rounded-full bg-purple-500/20 border border-purple-400/30 px-4 py-1.5 text-xs text-purple-300 transition hover:bg-purple-500/30 disabled:opacity-40"
            >
              <Play className="h-3.5 w-3.5" /> Play for everyone
            </button>
          )}
        </div>
      )}

      {/* Guest status bar */}
      {!isHost && wt.videoId && (
        <div className="flex items-center justify-center gap-1.5 px-4 py-2 border-t border-white/10 text-[10px] text-white/40">
          <span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse" />
          Synced with host
        </div>
      )}

      {wt.error && (
        <div className="px-4 py-2 text-[10px] text-red-400 border-t border-white/10">
          {wt.error}
        </div>
      )}
    </div>
  );
}
