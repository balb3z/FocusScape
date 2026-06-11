import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type PeerEntry = {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  remoteStream: MediaStream;
};

export type VoiceStatus = "idle" | "requesting-mic" | "connecting" | "live" | "error";

export type VoiceChatState = {
  status: VoiceStatus;
  error: string | null;
  muted: boolean;
  transmitting: boolean;
  speakers: Set<string>;
  peers: number;
};

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:global.stun.twilio.com:3478" },
];

/**
 * Push-to-talk voice mesh scoped to a single table.
 * Signaling: Supabase Realtime broadcast on `voice_{tableId}`.
 * Audio: WebRTC peer connections, one per other seated participant.
 * Local track is always present but kept `enabled = false` until PTT is held.
 */
export function useVoiceChat({
  tableId,
  userId,
  enabled,
}: {
  tableId: string | null;
  userId: string | null;
  enabled: boolean;
}) {
  const [state, setState] = useState<VoiceChatState>({
    status: "idle",
    error: null,
    muted: false,
    transmitting: false,
    speakers: new Set(),
    peers: 0,
  });
  const mutedRef = useRef(false);
  const transmittingRef = useRef(false);

  const localStreamRef = useRef<MediaStream | null>(null);
  const localTrackRef = useRef<MediaStreamTrack | null>(null);
  const peersRef = useRef<Map<string, PeerEntry>>(new Map());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const analyserRef = useRef<{ ctx: AudioContext; analyser: AnalyserNode; raf: number | null } | null>(null);

  const setMuted = useCallback((next: boolean) => {
    mutedRef.current = next;
    setState((s) => ({ ...s, muted: next }));
    const track = localTrackRef.current;
    if (track) track.enabled = !next && transmittingRef.current;
  }, []);

  const setTransmitting = useCallback((next: boolean) => {
    if (transmittingRef.current === next) return;
    transmittingRef.current = next;
    setState((s) => ({ ...s, transmitting: next }));
    const track = localTrackRef.current;
    if (track) track.enabled = next && !mutedRef.current;
    // First PTT press = user gesture → unblock any pending remote audio playback.
    if (next) {
      peersRef.current.forEach((p) => { p.audio.play().catch(() => {/* ignore */}); });
    }
    // Tell peers we're speaking (or not) so they can light up the indicator.
    const ch = channelRef.current;
    if (ch && userId) {
      void ch.send({ type: "broadcast", event: "voice-speaking", payload: { from: userId, speaking: next && !mutedRef.current } });
    }
  }, [userId]);

  // Local speaker indicator (no microphone analysis needed for binary state)
  useEffect(() => {
    if (!enabled || !tableId || !userId) {
      // Tear everything down
      transmittingRef.current = false;
      mutedRef.current = false;
      peersRef.current.forEach((p) => { p.pc.close(); p.audio.pause(); p.audio.srcObject = null; });
      peersRef.current.clear();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      localTrackRef.current = null;
      if (channelRef.current) { void supabase.removeChannel(channelRef.current); channelRef.current = null; }
      if (analyserRef.current) {
        if (analyserRef.current.raf) cancelAnimationFrame(analyserRef.current.raf);
        void analyserRef.current.ctx.close().catch(() => {});
        analyserRef.current = null;
      }
      setState({ status: "idle", error: null, muted: false, transmitting: false, speakers: new Set(), peers: 0 });
      return;
    }

    let cancelled = false;

    (async () => {
      setState((s) => ({ ...s, status: "requesting-mic", error: null }));
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Microphone access denied";
        if (!cancelled) setState((s) => ({ ...s, status: "error", error: msg }));
        return;
      }
      if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }

      localStreamRef.current = stream;
      const track = stream.getAudioTracks()[0] ?? null;
      localTrackRef.current = track;
      if (track) track.enabled = false; // PTT off by default

      const channel = supabase.channel(`voice_${tableId}`, {
        config: { broadcast: { self: false }, presence: { key: userId } },
      });
      channelRef.current = channel;

      const createPeer = (peerId: string, polite: boolean): PeerEntry => {
        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        const remoteStream = new MediaStream();
        const audio = new Audio();
        audio.autoplay = true;
        (audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
        audio.srcObject = remoteStream;
        // Add our mic track BEFORE creating the offer so SDP advertises audio m-line.
        if (track) pc.addTrack(track, stream);
        pc.ontrack = (e) => {
          const incoming = e.streams[0] ?? new MediaStream([e.track]);
          incoming.getAudioTracks().forEach((t) => {
            if (!remoteStream.getTracks().includes(t)) remoteStream.addTrack(t);
          });
          // Re-bind srcObject so the element picks up the new tracks, then play.
          audio.srcObject = remoteStream;
          audio.play().catch((err) => {
            // Autoplay may be blocked until the user gestures inside the page.
            // The PTT button click counts as a gesture, so a retry below recovers.
            console.warn("[voice] remote audio play blocked", err?.name ?? err);
          });
        };
        pc.onicecandidate = (e) => {
          if (e.candidate) {
            void channel.send({ type: "broadcast", event: "voice-ice", payload: { from: userId, to: peerId, candidate: e.candidate } });
          }
        };
        pc.onconnectionstatechange = () => {
          if (pc.connectionState === "connected") {
            setState((s) => ({ ...s, status: "live" }));
            // Try to start playback now that we are connected — first real user gesture
            // (the PTT press) typically unblocks autoplay.
            audio.play().catch(() => {/* ignore */});
          }
        };
        const entry: PeerEntry = { pc, audio, remoteStream };
        peersRef.current.set(peerId, entry);
        setState((s) => ({ ...s, peers: peersRef.current.size }));
        // Caller side: initiate offer when impolite
        if (!polite) {
          (async () => {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            await channel.send({ type: "broadcast", event: "voice-offer", payload: { from: userId, to: peerId, sdp: offer } });
          })().catch((e) => console.warn("[voice] offer failed", e));
        }
        return entry;
      };

      const removePeer = (peerId: string) => {
        const entry = peersRef.current.get(peerId);
        if (!entry) return;
        try { entry.pc.close(); } catch { /* ignore */ }
        entry.audio.pause();
        entry.audio.srcObject = null;
        peersRef.current.delete(peerId);
        setState((s) => {
          const next = new Set(s.speakers); next.delete(peerId);
          return { ...s, speakers: next, peers: peersRef.current.size };
        });
      };

      channel
        .on("broadcast", { event: "voice-hello" }, ({ payload }) => {
          const { from } = payload as { from: string };
          if (!from || from === userId) return;
          if (peersRef.current.has(from)) return;
          // Higher id initiates offer. Avoids glare.
          const initiator = userId! > from;
          createPeer(from, !initiator);
        })
        .on("broadcast", { event: "voice-offer" }, async ({ payload }) => {
          const { from, to, sdp } = payload as { from: string; to: string; sdp: RTCSessionDescriptionInit };
          if (to !== userId) return;
          let entry = peersRef.current.get(from);
          if (!entry) entry = createPeer(from, true);
          await entry.pc.setRemoteDescription(sdp);
          const answer = await entry.pc.createAnswer();
          await entry.pc.setLocalDescription(answer);
          await channel.send({ type: "broadcast", event: "voice-answer", payload: { from: userId, to: from, sdp: answer } });
        })
        .on("broadcast", { event: "voice-answer" }, async ({ payload }) => {
          const { from, to, sdp } = payload as { from: string; to: string; sdp: RTCSessionDescriptionInit };
          if (to !== userId) return;
          const entry = peersRef.current.get(from);
          if (!entry) return;
          await entry.pc.setRemoteDescription(sdp);
        })
        .on("broadcast", { event: "voice-ice" }, async ({ payload }) => {
          const { from, to, candidate } = payload as { from: string; to: string; candidate: RTCIceCandidateInit };
          if (to !== userId) return;
          const entry = peersRef.current.get(from);
          if (!entry) return;
          try { await entry.pc.addIceCandidate(candidate); } catch (e) { console.warn("[voice] ice failed", e); }
        })
        .on("broadcast", { event: "voice-speaking" }, ({ payload }) => {
          const { from, speaking } = payload as { from: string; speaking: boolean };
          if (!from || from === userId) return;
          setState((s) => {
            const next = new Set(s.speakers);
            if (speaking) next.add(from); else next.delete(from);
            return { ...s, speakers: next };
          });
        })
        .on("broadcast", { event: "voice-bye" }, ({ payload }) => {
          const { from } = payload as { from: string };
          if (from) removePeer(from);
        })
        .subscribe(async (status) => {
          if (status === "SUBSCRIBED") {
            // Mic + signaling channel are ready. Move out of "connecting" immediately —
            // peers may or may not join, but the user can already talk.
            setState((s) => ({ ...s, status: "live", error: null }));
            await channel.send({ type: "broadcast", event: "voice-hello", payload: { from: userId } });
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            setState((s) => ({ ...s, status: "error", error: "Voice channel unavailable. Try again." }));
          }
        });

      // Safety net: if for any reason we never reach SUBSCRIBED within 10s,
      // surface an error instead of spinning forever.
      const stuckTimer = window.setTimeout(() => {
        setState((s) => (s.status === "connecting" || s.status === "requesting-mic"
          ? { ...s, status: "error", error: "Voice connection timed out" }
          : s));
      }, 10000);
      (channel as unknown as { _stuckTimer?: number })._stuckTimer = stuckTimer;
    })();

    return () => {
      cancelled = true;
      const ch = channelRef.current;
      if (ch) {
        const t = (ch as unknown as { _stuckTimer?: number })._stuckTimer;
        if (t) window.clearTimeout(t);
      }
      if (ch && userId) {
        void ch.send({ type: "broadcast", event: "voice-bye", payload: { from: userId } });
      }
      peersRef.current.forEach((p) => { try { p.pc.close(); } catch { /* */ } p.audio.pause(); p.audio.srcObject = null; });
      peersRef.current.clear();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      localTrackRef.current = null;
      if (ch) { void supabase.removeChannel(ch); }
      channelRef.current = null;
      transmittingRef.current = false;
      mutedRef.current = false;
      setState({ status: "idle", error: null, muted: false, transmitting: false, speakers: new Set(), peers: 0 });
    };
  }, [enabled, tableId, userId]);

  // Push-to-talk keyboard binding (Space)
  useEffect(() => {
    if (!enabled) return;
    const onDown = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (e.repeat) return;
      e.preventDefault();
      setTransmitting(true);
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      e.preventDefault();
      setTransmitting(false);
    };
    const onBlur = () => setTransmitting(false);
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [enabled, setTransmitting]);

  return {
    ...state,
    setMuted,
    pressStart: () => setTransmitting(true),
    pressEnd: () => setTransmitting(false),
  };
}