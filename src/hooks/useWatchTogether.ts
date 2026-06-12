/**
 * useWatchTogether
 *
 * Real-time synced YouTube playback for a study table.
 *
 * KEY DESIGN:
 * - playerRefs is a SET — both panel + fullscreen players are tracked simultaneously.
 *   When a guest receives a state change, ALL active players are synced.
 *   This means host pause from fullscreen immediately affects every guest player.
 * - broadcastState writes to Supabase → Realtime fires on all guests → applyRemoteState
 *   runs on every registered player of each guest.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export type WatchSession = {
  table_id: string;
  room_id: string;
  host_id: string;
  video_url: string;
  video_id: string;
  is_playing: boolean;
  current_seconds: number;
  updated_at: string;
};

export type UseWatchTogetherOptions = {
  tableId: string | null;
  roomId: string;
  isHost: boolean;
  userId: string | null;
};

export type UseWatchTogetherReturn = {
  session: WatchSession | null;
  videoId: string;
  isPlaying: boolean;
  /** Register a player instance — call for BOTH panel and fullscreen players */
  registerPlayer: (id: string, player: YTPlayer) => void;
  /** Unregister when a player is destroyed */
  unregisterPlayer: (id: string) => void;
  setVideoUrl: (url: string) => Promise<void>;
  broadcastState: (playing: boolean, seconds: number) => Promise<void>;
  seek: (seconds: number) => Promise<void>;
  loading: boolean;
  error: string | null;
};

export type YTPlayer = {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  destroy: () => void;
};

const SYNC_TOLERANCE_S = 1.5;

export function extractYouTubeId(url: string): string {
  if (!url) return "";
  const short  = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);  if (short)  return short[1];
  const long   = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);       if (long)   return long[1];
  const embed  = url.match(/embed\/([a-zA-Z0-9_-]{11})/);       if (embed)  return embed[1];
  const shorts = url.match(/shorts\/([a-zA-Z0-9_-]{11})/);      if (shorts) return shorts[1];
  return "";
}

export function useWatchTogether({
  tableId, roomId, isHost, userId,
}: UseWatchTogetherOptions): UseWatchTogetherReturn {

  const [session, setSession] = useState<WatchSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // Map of id → player so we can sync ALL registered players at once
  const playersRef   = useRef<Map<string, YTPlayer>>(new Map());
  const channelRef   = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const applyingRef  = useRef(false);
  const sessionRef   = useRef<WatchSession | null>(null);
  sessionRef.current = session;

  // ── Fetch initial session ──────────────────────────────────────────────────
  useEffect(() => {
    if (!tableId) { setSession(null); return; }
    let cancelled = false;
    setLoading(true);
    supabase
      .from("watch_together_sessions")
      .select("*")
      .eq("table_id", tableId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) { setSession(data as WatchSession | null); setLoading(false); }
      });
    return () => { cancelled = true; };
  }, [tableId]);

  // ── Realtime subscription ──────────────────────────────────────────────────
  useEffect(() => {
    if (!tableId) return;
    if (channelRef.current) { supabase.removeChannel(channelRef.current); channelRef.current = null; }

    const channel = supabase
      .channel(`watch_together:${tableId}`)
      .on("postgres_changes", {
        event: "*", schema: "public",
        table: "watch_together_sessions",
        filter: `table_id=eq.${tableId}`,
      }, (payload) => {
        if (payload.eventType === "DELETE") { setSession(null); return; }
        const incoming = payload.new as WatchSession;
        setSession(incoming);
        // Guests: apply to ALL registered players (panel + fullscreen)
        if (!isHost) {
          applyToAllPlayers(incoming);
        }
      })
      .subscribe();

    channelRef.current = channel;
    return () => { supabase.removeChannel(channel); channelRef.current = null; };
  }, [tableId, isHost]);

  // Also apply when session changes via React state (belt-and-suspenders)
  useEffect(() => {
    if (isHost || !session) return;
    applyToAllPlayers(session);
  }, [session, isHost]);

  // ── Apply state to every registered player ─────────────────────────────────
  function applyToAllPlayers(s: WatchSession) {
    if (applyingRef.current) return;
    applyingRef.current = true;
    try {
      playersRef.current.forEach((player) => {
        try {
          const ct = player.getCurrentTime();
          if (Math.abs(ct - s.current_seconds) > SYNC_TOLERANCE_S) {
            player.seekTo(s.current_seconds, true);
          }
          if (s.is_playing) player.playVideo();
          else player.pauseVideo();
        } catch {}
      });
    } finally {
      setTimeout(() => { applyingRef.current = false; }, 500);
    }
  }

  // ── Upsert ─────────────────────────────────────────────────────────────────
  async function upsertSession(patch: Partial<WatchSession>) {
    if (!tableId || !userId) return;
    const base: WatchSession = sessionRef.current ?? {
      table_id: tableId, room_id: roomId, host_id: userId,
      video_url: "", video_id: "", is_playing: false,
      current_seconds: 0, updated_at: new Date().toISOString(),
    };
    const next = { ...base, ...patch, updated_at: new Date().toISOString() };
    const { error: err } = await supabase
      .from("watch_together_sessions")
      .upsert(next, { onConflict: "table_id" });
    if (err) setError(err.message);
    else setSession(next);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  const registerPlayer = useCallback((id: string, player: YTPlayer) => {
    playersRef.current.set(id, player);
    // Immediately sync this new player to current session
    if (sessionRef.current) {
      try {
        player.seekTo(sessionRef.current.current_seconds, true);
        if (sessionRef.current.is_playing) player.playVideo();
        else player.pauseVideo();
      } catch {}
    }
  }, []);

  const unregisterPlayer = useCallback((id: string) => {
    playersRef.current.delete(id);
  }, []);

  const setVideoUrl = useCallback(async (url: string) => {
    if (!isHost) return;
    const videoId = extractYouTubeId(url);
    await upsertSession({ video_url: url, video_id: videoId, is_playing: false, current_seconds: 0 });
  }, [isHost, tableId, userId]);

  const broadcastState = useCallback(async (playing: boolean, seconds: number) => {
    if (!isHost) return;
    await upsertSession({ is_playing: playing, current_seconds: seconds });
  }, [isHost, tableId, userId]);

  const seek = useCallback(async (seconds: number) => {
    if (!isHost) return;
    await upsertSession({ current_seconds: seconds });
  }, [isHost, tableId, userId]);

  return {
    session,
    videoId: session?.video_id ?? "",
    isPlaying: session?.is_playing ?? false,
    registerPlayer,
    unregisterPlayer,
    setVideoUrl,
    broadcastState,
    seek,
    loading,
    error,
  };
}
