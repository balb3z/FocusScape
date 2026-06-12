import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getMap, AVATAR_COLORS, getCharacterStyle, type Gender, type CharacterConfig, type MapDef, type Decor } from "@/lib/maps";
import { PlayerStateManager, RealtimeSyncManager, RemotePlayerManager, type SharedPlayerState, type SyncMetrics } from "@/lib/multiplayer";
import { GameHud } from "./GameHud";
import { CreateTableDialog, type NewTableInput } from "./CreateTableDialog";
import { toast } from "sonner";
import { isUiBlocked } from "@/lib/uiFocus";

type PlayerState = SharedPlayerState;

type ChatMsg = { id: string; user: string; text: string; ts: number };

export type RoomTable = {
  id: string;
  room_id: string;
  creator_id: string;
  creator_username: string;
  name: string;
  subject: string;
  goal: string | null;
  duration_minutes: number;
  x: number;
  y: number;
  max_seats: number;
  created_at: string;
};

export type ActiveTableInfo = {
  tableId: string;
  name: string;
  subject: string;
  goal: string | null;
  duration: number;
  creator: string;
  creatorId: string;
  isOwner: boolean;
  occupants: number;
  maxSeats: number;
  occupantIds: string[];
};

export default function PhaserGame({ mapId, onLeave }: { mapId: string; onLeave: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const sceneApiRef = useRef<{
    sendChat: (text: string) => void;
    setTyping: (isTyping: boolean) => void;
    sitAt: (tableId: string) => void;
    leaveTable: () => void;
    closeTable: () => Promise<void>;
  } | null>(null);
  const [chatLog, setChatLog] = useState<ChatMsg[]>([]);
  const [tableInfo, setTableInfo] = useState<ActiveTableInfo | null>(null);
  const [onlineCount, setOnlineCount] = useState(0);
  const [debugMetrics, setDebugMetrics] = useState<SyncMetrics | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const pendingPosRef = useRef<{ x: number; y: number } | null>(null);
  const createTableRef = useRef<((input: NewTableInput) => Promise<void>) | null>(null);
  const map: MapDef = getMap(mapId);

  const handleChat = useCallback((text: string) => sceneApiRef.current?.sendChat(text), []);
  const handleTyping = useCallback((isTyping: boolean) => sceneApiRef.current?.setTyping(isTyping), []);
  const handleLeaveTable = useCallback(() => sceneApiRef.current?.leaveTable(), []);
  const handleCloseTable = useCallback(async () => {
    await sceneApiRef.current?.closeTable();
  }, []);

  useEffect(() => {
    let destroyed = false;
    let game: import("phaser").Game | null = null;

    (async () => {
      const Phaser = (await import("phaser")).default;
      if (destroyed || !containerRef.current) return;

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setMyUserId(user.id);
      const { data: profile } = await supabase.from("profiles").select("username,avatar_id,avatar_url,gender,character_config").eq("id", user.id).maybeSingle();
      const myId = user.id;
      const myUsername = profile?.username ?? "student";
      const myAvatarId = profile?.avatar_id ?? 0;
      const myAvatarUrl = (profile?.avatar_url as string | null | undefined) ?? null;
      const myGender: Gender = (profile?.gender === "female" ? "female" : "male");
      const myCharacterConfig = (profile?.character_config as unknown as CharacterConfig | null) ?? null;
      const { data: savedRoomPlayer } = await supabase
        .from("room_players")
        .select("x,y,animation_state,table_id,seat_index,focus_status,last_seen")
        .eq("user_id", myId)
        .eq("room_id", map.id)
        .maybeSingle();
      const initialX = typeof savedRoomPlayer?.x === "number" ? savedRoomPlayer.x : 800;
      const initialY = typeof savedRoomPlayer?.y === "number" ? savedRoomPlayer.y : 600;
      const initialAnim = savedRoomPlayer?.animation_state === "focused" ? "focused" : "idle";
      const initialFocus = savedRoomPlayer?.focus_status === "focused" ? "focused" : "idle";
      const initialTable = savedRoomPlayer?.table_id ?? null;
      const initialSeat = (savedRoomPlayer?.seat_index ?? null) as number | null;

      class WorldScene extends Phaser.Scene {
        me!: Phaser.GameObjects.Container;
        meBody!: Phaser.GameObjects.Rectangle;
        meName!: Phaser.GameObjects.Text;
        meHead!: Phaser.GameObjects.Arc;
        meAvatar?: Phaser.GameObjects.Image;
        meAvatarMask?: Phaser.GameObjects.Graphics;
        meAvatarRing?: Phaser.GameObjects.Arc;
        meBubble?: Phaser.GameObjects.Container;
        cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
        wasd!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
        sharedRoom!: PlayerStateManager;
        presenceSync!: RealtimeSyncManager;
        remotePlayers!: RemotePlayerManager;
        lastSent = 0;
        lastX = 0;
        lastY = 0;
        lastAnim: PlayerState["animationState"] = "idle";
        myStatus: PlayerState["status"] = "idle";
        myTable: string | null = null;
        roomReady = false;
        roomTables = new Map<string, RoomTable>();
        tablesLoaded = false;
        tableObjs = new Map<string, {
          container: Phaser.GameObjects.Container;
          surface: Phaser.GameObjects.Rectangle;
          seats: Phaser.GameObjects.Arc[];
          nameText: Phaser.GameObjects.Text;
          subjectText: Phaser.GameObjects.Text;
          countText: Phaser.GameObjects.Text;
        }>();
        // Authoritative seat occupancy from the DB: tableId -> (seatIndex -> userId)
        tableOccupancy = new Map<string, Map<number, string>>();
        mySeatIdx: number | null = null;
        claimInFlight = false;
        floorHit?: Phaser.GameObjects.Rectangle;
        worldW = 1600;
        worldH = 1200;
        loadedAvatarKeys = new Set<string>();
        particles: Phaser.GameObjects.GameObject[] = [];
        vignette?: Phaser.GameObjects.Graphics;

        create() {
          this.cameras.main.setBackgroundColor(map.floor);
          this.physics.world.setBounds(0, 0, this.worldW, this.worldH);

          // ─── BACKGROUND IMAGE (replaces procedural floor/walls/decor) ───
          if (map.bgImage) {
            const bgKey = `bg-${map.id}`;
            const placeBg = () => {
              if (!this.textures.exists(bgKey)) return;
              const img = this.add.image(this.worldW / 2, this.worldH / 2, bgKey).setDepth(-10);
              img.setDisplaySize(this.worldW, this.worldH);
            };
            if (this.textures.exists(bgKey)) {
              placeBg();
            } else {
              this.load.crossOrigin = "anonymous";
              this.load.image(bgKey, map.bgImage);
              this.load.once(Phaser.Loader.Events.COMPLETE, placeBg);
              this.load.once("loaderror", () => {/* fall back to camera bg color */});
              this.load.start();
            }
          } else {
            // ─── FLOOR ───
            if (map.floorStyle === "planks") {
              const plankH = 56;
              const accent = map.floorAccent ?? 0x3a2218;
              for (let y = 0; y < this.worldH; y += plankH) {
                const shade = ((y / plankH) % 2 === 0) ? map.floor : accent;
                this.add.rectangle(this.worldW / 2, y + plankH / 2, this.worldW, plankH, shade).setDepth(-10);
                this.add.rectangle(this.worldW / 2, y, this.worldW, 1, 0x000000, 0.45).setDepth(-9);
                for (let gx = 0; gx < this.worldW; gx += 220) {
                  const grainX = gx + (y % 3) * 40;
                  this.add.rectangle(grainX, y + plankH / 2, 80, 1, 0x000000, 0.18).setDepth(-9);
                  this.add.rectangle(grainX + 40, y + plankH / 2 + 14, 60, 1, 0x000000, 0.12).setDepth(-9);
                }
                const joint = (((y / plankH) | 0) * 280) % this.worldW;
                this.add.rectangle(joint, y + plankH / 2, 2, plankH, 0x000000, 0.35).setDepth(-9);
              }
            } else {
              const tileSize = 40;
              for (let x = 0; x < this.worldW; x += tileSize) {
                for (let y = 0; y < this.worldH; y += tileSize) {
                  if (((x + y) / tileSize) % 2 === 0) {
                    this.add.rectangle(x, y, tileSize, tileSize, map.floor, 0.5).setOrigin(0).setDepth(-10);
                  }
                }
              }
            }

            // ─── WALLS ───
            const wallT = 32;
            const drawWall = (x: number, y: number, w: number, h: number) => {
              this.add.rectangle(x, y, w, h, map.wall).setDepth(-5);
              if (map.wallStyle === "brick") {
                const brickH = 12;
                const brickW = 40;
                const rows = Math.ceil(h / brickH);
                for (let r = 0; r < rows; r++) {
                  const by = y - h / 2 + r * brickH + brickH / 2;
                  const offset = (r % 2) * (brickW / 2);
                  this.add.rectangle(x, by, w, 1, 0x000000, 0.35).setDepth(-4);
                  if (w > h) {
                    for (let bx = -w / 2 + offset; bx <= w / 2; bx += brickW) {
                      this.add.rectangle(x + bx, by, 1, brickH, 0x000000, 0.3).setDepth(-4);
                    }
                  }
                }
              }
            };
            drawWall(this.worldW / 2, wallT / 2, this.worldW, wallT);
            drawWall(this.worldW / 2, this.worldH - wallT / 2, this.worldW, wallT);
            drawWall(wallT / 2, this.worldH / 2, wallT, this.worldH);
            drawWall(this.worldW - wallT / 2, this.worldH / 2, wallT, this.worldH);

            // Ambient glow blobs
            for (let i = 0; i < 4; i++) {
              const g = this.add.circle(Phaser.Math.Between(100, this.worldW - 100), Phaser.Math.Between(100, this.worldH - 100), 180, map.ambient, 0.1).setDepth(-8);
              this.tweens.add({ targets: g, alpha: 0.18, duration: 2500 + i * 400, yoyo: true, repeat: -1 });
            }

            // Map decor (windows, lamps, plants, monitors, neon, trees, fireplaces…)
            map.decor.forEach((d) => this.spawnDecor(d));
          }

          // Cinematic lighting vignette (renders above world, below HUD)
          this.vignette = this.add.graphics().setScrollFactor(0).setDepth(40);
          this.drawVignette();
          this.scale.on("resize", () => this.drawVignette());

          // Weather / ambient particles (skip when bg image already contains weather)
          if (!map.bgImage) this.spawnWeather();


          // Focus tables
          // Empty-floor click → open create-table dialog at that spot
          this.floorHit = this.add.rectangle(this.worldW / 2, this.worldH / 2, this.worldW, this.worldH, 0x000000, 0.001)
            .setDepth(-9)
            .setInteractive({ useHandCursor: false });
          this.floorHit.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
            if (isUiBlocked()) return; // a modal/panel/input is active
            if (this.myTable) return;
            const wx = pointer.worldX, wy = pointer.worldY;
            // Reject clicks too close to existing tables or walls
            for (const t of this.roomTables.values()) {
              if (Math.hypot(t.x - wx, t.y - wy) < 160) return;
            }
            if (wx < 120 || wy < 140 || wx > this.worldW - 120 || wy > this.worldH - 120) return;
            // Only allow creating near the player
            if (Math.hypot(this.me.x - wx, this.me.y - wy) > 220) {
              toast("Walk closer to that spot to place a table");
              return;
            }
            pendingPosRef.current = { x: wx, y: wy };
            setCreateOpen(true);
          });

          // ─── MY AVATAR (modern multi-part character) ───
          const myColors = AVATAR_COLORS[myAvatarId] ?? AVATAR_COLORS[0];
          const myStyle = getCharacterStyle(myGender, myCharacterConfig);
          void myColors;
          this.me = this.add.container(initialX, initialY).setDepth(10);
          const shadow   = this.add.ellipse(0, 22, 30, 9, 0x000000, 0.35);
          // legs (pants)
          const legL = this.add.rectangle(-5, 14, 7, 14, myStyle.pants).setStrokeStyle(1, 0x000000, 0.3);
          const legR = this.add.rectangle(5,  14, 7, 14, myStyle.pants).setStrokeStyle(1, 0x000000, 0.3);
          // torso (shirt)
          this.meBody = this.add.rectangle(0, 2, 20, 22, myStyle.shirt).setStrokeStyle(2, 0x000000, 0.35);
          // arms (shirt sleeves)
          const armL = this.add.rectangle(-12, 2, 5, 16, myStyle.shirt).setStrokeStyle(1, 0x000000, 0.3);
          const armR = this.add.rectangle(12,  2, 5, 16, myStyle.shirt).setStrokeStyle(1, 0x000000, 0.3);
          // neck
          const neck = this.add.rectangle(0, -10, 6, 4, myStyle.skin);
          // head
          this.meHead = this.add.circle(0, -18, 10, myStyle.skin).setStrokeStyle(2, 0x000000, 0.35);
          // hair — short cap for male, longer flowing for female
          // hair drawn in hairExtras block below
          const hairExtras: Phaser.GameObjects.GameObject[] = [];
          const hs = myStyle.hairStyle;
          if (hs !== "bald") {
            // Top cap for all non-bald styles
            hairExtras.push(this.add.ellipse(0, -23, 19, 9, myStyle.hair));
            if (hs === "long" || hs === "wavy") {
              hairExtras.push(this.add.ellipse(-9, -14, 7, 14, myStyle.hair));
              hairExtras.push(this.add.ellipse(9, -14, 7, 14, myStyle.hair));
            } else if (hs === "bun") {
              hairExtras.push(this.add.circle(0, -30, 7, myStyle.hair));
              hairExtras.push(this.add.ellipse(-7, -18, 6, 10, myStyle.hair));
              hairExtras.push(this.add.ellipse(7, -18, 6, 10, myStyle.hair));
            } else if (hs === "braids") {
              hairExtras.push(this.add.rectangle(-9, -8, 5, 20, myStyle.hair));
              hairExtras.push(this.add.rectangle(9, -8, 5, 20, myStyle.hair));
            } else if (hs === "curly") {
              for (let ci = -3; ci <= 3; ci++) {
                hairExtras.push(this.add.circle(ci * 4, -26, 5, myStyle.hair));
              }
            } else if (hs === "fade") {
              hairExtras.push(this.add.ellipse(0, -24, 18, 7, myStyle.hair));
              hairExtras.push(this.add.ellipse(-8, -20, 5, 9, myStyle.hair, 0.5));
              hairExtras.push(this.add.ellipse(8, -20, 5, 9, myStyle.hair, 0.5));
            } else if (hs === "long_m") {
              hairExtras.push(this.add.ellipse(-9, -16, 6, 12, myStyle.hair));
              hairExtras.push(this.add.ellipse(9, -16, 6, 12, myStyle.hair));
            } else if (hs === "short_f") {
              // tight cap — already drawn
            }
            // "short" = just the top cap
          }
          // face dots
          const eyeL = this.add.circle(-3, -19, 1.2, 0x111111);
          const eyeR = this.add.circle(3, -19, 1.2, 0x111111);
          // Profile photo ring (premium look)
          const ringOuter = this.add.circle(0, -52, 19, map.accent, 0.0).setStrokeStyle(3, map.accent, 0.95);
          const ringGlow  = this.add.circle(0, -52, 22, map.accent, 0.18);
          this.meAvatarRing = ringOuter;
          // Online dot
          const onlineDot = this.add.circle(13, -42, 3.5, 0x4ade80).setStrokeStyle(1.5, 0x0a0a0a, 0.9);
          this.meName = this.add.text(0, -76, myUsername, { fontFamily: "system-ui, sans-serif", fontSize: "12px", color: "#ffffff", backgroundColor: "#00000099", padding: { x: 6, y: 2 }, fontStyle: "600" }).setOrigin(0.5);
          this.me.add([shadow, legL, legR, this.meBody, armL, armR, neck, this.meHead, ...hairExtras, eyeL, eyeR, ringGlow, ringOuter, onlineDot, this.meName]);
          // store limb refs for sit pose
          (this.me as unknown as { _limbs: { legL: Phaser.GameObjects.Rectangle; legR: Phaser.GameObjects.Rectangle; armL: Phaser.GameObjects.Rectangle; armR: Phaser.GameObjects.Rectangle } })._limbs = { legL, legR, armL, armR };
          this.physics.world.enable(this.me);
          (this.me.body as Phaser.Physics.Arcade.Body).setSize(22, 30).setCollideWorldBounds(true);

          if (myAvatarUrl) this.loadAvatar(myAvatarUrl, (key) => {
            if (!this.me || !this.meAvatarRing) return;
            // Image lives inside the container so it follows the avatar.
            this.meAvatar = this.add.image(0, -52, key).setDisplaySize(30, 30).setDepth(11);
            this.me.add(this.meAvatar);
            // Mask must be a top-level Graphics; container transforms don't apply to GeometryMask.
            // We re-position it every frame in update() so the circular clip tracks the head.
            const mask = this.add.graphics();
            mask.fillStyle(0xffffff, 1).fillCircle(0, 0, 14);
            mask.setVisible(false);
            this.meAvatar.setMask(new Phaser.Display.Masks.GeometryMask(this, mask));
            this.meAvatarMask = mask;
          });

          // Subtle online-dot pulse
          this.tweens.add({ targets: onlineDot, scale: 1.25, duration: 1100, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
          this.tweens.add({ targets: ringGlow, alpha: { from: 0.08, to: 0.28 }, duration: 1800, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });

          // Subtle breathing animation when idle
          this.tweens.add({
            targets: this.meBody,
            scaleY: 1.04,
            duration: 1700,
            yoyo: true,
            repeat: -1,
            ease: "Sine.easeInOut",
          });

          this.cameras.main.startFollow(this.me, true, 0.1, 0.1);
          this.cameras.main.setBounds(0, 0, this.worldW, this.worldH);

          this.cursors = this.input.keyboard!.createCursorKeys();
          // Pass enableCapture=false so Phaser does NOT preventDefault on W/A/S/D —
          // otherwise dialog/chat <input> elements never receive those letters.
          this.wasd = this.input.keyboard!.addKeys("W,A,S,D", true, false) as typeof this.wasd;
          // Also strip any default arrow/space capture so typing/scrolling in DOM inputs works.
          this.input.keyboard!.removeCapture("W,A,S,D,SPACE,UP,DOWN,LEFT,RIGHT");

          // Shared multiplayer room: durable room state + realtime presence + broadcasted movement.
          this.sharedRoom = new PlayerStateManager(map.id);
          this.remotePlayers = new RemotePlayerManager(this, Phaser, map, myId, this.loadAvatar.bind(this));
          const localPlayer: SharedPlayerState = {
            id: myId,
            userId: myId,
            username: myUsername,
            avatar_id: myAvatarId,
            avatar_url: myAvatarUrl,
            gender: myGender,
            character_config: myCharacterConfig,
            roomId: map.id,
            x: this.me.x,
            y: this.me.y,
            animationState: initialAnim,
            status: initialAnim,
            table: initialTable,
            tableId: initialTable,
            seatIndex: initialSeat,
            focusStatus: initialFocus,
            typing: false,
            vx: 0,
            vy: 0,
            sentAt: savedRoomPlayer?.last_seen ? new Date(savedRoomPlayer.last_seen).getTime() : Date.now(),
            clientSeq: 0,
            lastSeen: savedRoomPlayer?.last_seen ? new Date(savedRoomPlayer.last_seen).getTime() : Date.now(),
          };
          this.myTable = initialTable;
          this.mySeatIdx = initialSeat;
          this.myStatus = initialAnim;
          // Initial table info will be filled in when room_tables loads.
          this.sharedRoom.subscribe((players) => {
            console.log("[mp] connected players count", players.length);
            setOnlineCount(players.length);
            // Rebuild authoritative seat occupancy from row state.
            this.tableOccupancy.clear();
            players.forEach((p) => {
              const tableId = p.tableId ?? p.table;
              const seat = p.seatIndex;
              if (!tableId || seat === null || seat === undefined) return;
              let m = this.tableOccupancy.get(tableId);
              if (!m) { m = new Map(); this.tableOccupancy.set(tableId, m); }
              m.set(seat, p.userId);
            });
            this.refreshTablesOccupancy();
            // If I'm seated, keep my seat anchored using the authoritative seat index.
            const myPlayer = players.find((pp) => pp.userId === myId);
            const myTableExists = myPlayer?.tableId ? this.roomTables.has(myPlayer.tableId) : false;
            const tableIsOrphaned = this.tablesLoaded && !!myPlayer?.tableId && !myTableExists;
            if (myPlayer && myPlayer.tableId && myPlayer.seatIndex !== null && myPlayer.seatIndex !== undefined && !tableIsOrphaned) {
              this.myTable = myPlayer.tableId;
              this.mySeatIdx = myPlayer.seatIndex;
              const seatPos = this.getMySeatPosition();
              if (seatPos) this.me.setPosition(seatPos.x, seatPos.y);
              this.refreshActiveTableInfo();
            } else if (this.myTable && (!myPlayer?.tableId || tableIsOrphaned)) {
              // Either someone (owner) stood us up, or our DB row still
              // points at a table that no longer exists (orphaned seat).
              // In both cases, stand up locally and resume movement.
              this.myTable = null;
              this.mySeatIdx = null;
              this.myStatus = "idle";
              this.applySitPose(false);
              setTableInfo(null);
              // Clear the orphaned seat in the DB so other clients (and our
              // own next resync) stop seeing us as seated at a dead table.
              if (tableIsOrphaned) {
                void supabase
                  .from("room_players")
                  .update({ table_id: null, seat_index: null, animation_state: "idle", focus_status: "idle" })
                  .eq("user_id", myId)
                  .eq("room_id", map.id);
              }
            }
            this.remotePlayers.render(players);
          });
          this.presenceSync = new RealtimeSyncManager(
            supabase,
            this.sharedRoom,
            localPlayer,
            (status) => console.log(`[mp] channel room:${map.id} status:`, status),
            (player) => this.applyAuthoritativeLocalState(player),
          );
          this.presenceSync.onMetrics(setDebugMetrics);
          this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => void this.presenceSync?.leave());
          this.presenceSync.onBroadcast("chat", (payload) => {
            const { id, user, text } = payload as { id: string; user: string; text: string };
            setChatLog((l) => [...l.slice(-49), { id: crypto.randomUUID(), user, text, ts: Date.now() }]);
            if (id === myId) this.showBubble(this.me, text);
            else this.remotePlayers.showBubble(id, text);
          });
          // Owner-triggered table-close broadcast — every seated client stands up locally.
          this.presenceSync.onBroadcast("table_closed", (payload) => {
            const { tableId } = payload as { tableId: string };
            if (this.myTable === tableId) this.standUp();
            this.removeTable(tableId);
          });
          void this.presenceSync.join().then(() => {
            this.applyAuthoritativeLocalState(this.presenceSync.getLocalPlayer());
            this.roomReady = true;
            void this.loadRoomTables();
            this.subscribeRoomTables();
          });

          // Expose API
          sceneApiRef.current = {
            sendChat: (text) => {
              this.presenceSync.sendChat({ id: myId, user: myUsername, text });
            },
            setTyping: (isTyping) => this.presenceSync.sendTyping(isTyping),
            sitAt: (tableId) => this.sitAtTable(tableId),
            leaveTable: () => this.standUp(),
            closeTable: async () => {
              const tableId = this.myTable;
              if (!tableId) return;
              const t = this.roomTables.get(tableId);
              if (!t || t.creator_id !== myId) {
                toast.error("Only the table owner can close it");
                return;
              }
              // Broadcast first so seated peers stand up before the row vanishes.
              this.presenceSync.sendBroadcastEvent("table_closed", { tableId });
              const { error } = await supabase.from("room_tables").delete().eq("id", tableId);
              if (error) { toast.error(error.message); return; }
              this.standUp();
              toast.success("Table closed");
            },
          };

          // Wire the create-table callback used by the React dialog
          createTableRef.current = async (input) => {
            const pos = pendingPosRef.current;
            if (!pos) return;
            const { error } = await supabase.from("room_tables").insert({
              room_id: map.id,
              creator_id: myId,
              creator_username: myUsername,
              name: input.name,
              subject: input.subject,
              goal: input.goal || null,
              duration_minutes: input.duration,
              x: pos.x,
              y: pos.y,
            });
            if (error) { toast.error(error.message); return; }
            pendingPosRef.current = null;
          };
        }

        // ---------- DECOR ----------
        spawnDecor(d: Decor) {
          switch (d.type) {
            case "window": {
              const w = d.w ?? 120, h = d.h ?? 70;
              this.add.rectangle(d.x, d.y, w + 12, h + 12, 0x1a1108).setDepth(-4);
              const pane = this.add.rectangle(d.x, d.y, w, h, d.color ?? 0x6b8eb5, 0.85).setDepth(-3);
              this.add.rectangle(d.x, d.y, w, 2, 0x1a1108).setDepth(-2);
              this.add.rectangle(d.x, d.y, 2, h, 0x1a1108).setDepth(-2);
              // soft window glow on the floor below
              this.add.rectangle(d.x, d.y + h, w * 1.4, h * 1.8, d.color ?? 0x6b8eb5, 0.08).setDepth(-7);
              this.tweens.add({ targets: pane, alpha: 0.7, duration: 4000, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
              break;
            }
            case "lamp": {
              this.add.rectangle(d.x, d.y - 18, 4, 14, 0x222222).setDepth(-3);
              this.add.circle(d.x, d.y, 10, 0x222222).setDepth(-2);
              const bulb = this.add.circle(d.x, d.y, 7, d.color ?? 0xffd388, 1).setDepth(-1);
              const halo = this.add.circle(d.x, d.y + 4, 80, d.color ?? 0xffd388, 0.14).setDepth(-6);
              this.tweens.add({ targets: [bulb, halo], alpha: { from: 0.9, to: 1 }, duration: 1200 + Math.random() * 800, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
              break;
            }
            case "plant": {
              this.add.rectangle(d.x, d.y + 14, 22, 16, 0x6b4a3a).setDepth(0);
              const leaf1 = this.add.ellipse(d.x - 8, d.y - 4, 18, 24, 0x4e7a3a).setDepth(1);
              const leaf2 = this.add.ellipse(d.x + 8, d.y - 4, 18, 24, 0x3f6a30).setDepth(1);
              const leaf3 = this.add.ellipse(d.x, d.y - 14, 16, 22, 0x5a8a42).setDepth(1);
              this.tweens.add({ targets: [leaf1, leaf3], angle: 4, duration: 2200, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
              this.tweens.add({ targets: leaf2, angle: -4, duration: 2400, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
              break;
            }
            case "monitor": {
              this.add.rectangle(d.x, d.y + 22, 26, 6, 0x222222).setDepth(0);
              this.add.rectangle(d.x, d.y, 80, 50, 0x0a0a14).setStrokeStyle(2, 0x222a3a).setDepth(1);
              const screen = this.add.rectangle(d.x, d.y, 72, 42, 0x1e2a44).setDepth(2);
              // glow
              this.add.rectangle(d.x, d.y, 120, 80, 0x4ade80, 0.06).setDepth(-3);
              this.tweens.add({ targets: screen, fillColor: { from: 0x1e2a44, to: 0x2a4060 } as unknown as number, duration: 900, yoyo: true, repeat: -1 });
              // RGB keyboard glow
              const kb = this.add.rectangle(d.x, d.y + 36, 90, 6, 0xff3ea5, 0.6).setDepth(2);
              this.tweens.add({ targets: kb, fillColor: { from: 0xff3ea5, to: 0x4ade80 } as unknown as number, duration: 1400, yoyo: true, repeat: -1 });
              break;
            }
            case "fireplace": {
              this.add.rectangle(d.x, d.y, 70, 90, 0x1a0e08).setStrokeStyle(3, 0x4a2a18).setDepth(0);
              const flame1 = this.add.ellipse(d.x, d.y + 10, 30, 40, d.color ?? 0xff6a3d, 0.9).setDepth(1);
              const flame2 = this.add.ellipse(d.x, d.y + 18, 20, 26, 0xffd388, 0.95).setDepth(2);
              this.add.circle(d.x, d.y + 30, 60, d.color ?? 0xff6a3d, 0.12).setDepth(-3);
              this.tweens.add({ targets: flame1, scaleY: 1.2, scaleX: 0.9, duration: 380, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
              this.tweens.add({ targets: flame2, scaleY: 0.85, scaleX: 1.1, duration: 260, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
              break;
            }
            case "tree": {
              this.add.ellipse(d.x, d.y + 50, 60, 16, 0x000000, 0.3).setDepth(0);
              this.add.rectangle(d.x, d.y + 30, 14, 40, 0x4a2e1f).setDepth(1);
              const crown = this.add.circle(d.x, d.y, 46, 0x3f6a30).setDepth(2);
              const crown2 = this.add.circle(d.x - 16, d.y - 8, 30, 0x4e7a3a).setDepth(2);
              const crown3 = this.add.circle(d.x + 16, d.y - 8, 30, 0x4e7a3a).setDepth(2);
              this.tweens.add({ targets: [crown, crown2, crown3], scaleX: 1.04, scaleY: 0.97, duration: 2200, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
              break;
            }
            case "bookshelf": {
              const w = d.w ?? 40, h = d.h ?? 200;
              this.add.rectangle(d.x, d.y, w, h, d.color ?? 0x2a1810).setDepth(-2);
              const rows = Math.floor(h / 30);
              for (let i = 0; i < rows; i++) {
                const y = d.y - h / 2 + 18 + i * 30;
                const colors = [0x8a2a2a, 0x2a6a8a, 0x6a8a2a, 0x8a6a2a, 0x6a2a8a];
                for (let j = 0; j < 4; j++) {
                  const c = colors[(i + j) % colors.length];
                  this.add.rectangle(d.x - w / 2 + 6 + j * (w - 12) / 4 + (w - 12) / 8, y, (w - 16) / 4, 22, c).setDepth(-1);
                }
              }
              break;
            }
            case "neonSign": {
              const text = d.text ?? "FOCUS";
              const color = d.color ?? 0xff3ea5;
              const hex = "#" + color.toString(16).padStart(6, "0");
              const t = this.add.text(d.x, d.y, text, {
                fontFamily: "monospace",
                fontSize: "20px",
                color: hex,
                fontStyle: "bold",
              }).setOrigin(0.5).setDepth(-3);
              const glow = this.add.rectangle(d.x, d.y, text.length * 14 + 24, 30, color, 0.12).setDepth(-5);
              this.tweens.add({
                targets: [t, glow],
                alpha: { from: 1, to: 0.45 },
                duration: 140,
                repeat: -1,
                ease: "Stepped",
                delay: Math.random() * 1000,
                yoyo: true,
                hold: 2000 + Math.random() * 2000,
              });
              break;
            }
            case "rug": {
              this.add.rectangle(d.x, d.y, d.w ?? 600, d.h ?? 360, d.color ?? 0x7a3a22, 0.55).setDepth(-9);
              this.add.rectangle(d.x, d.y, (d.w ?? 600) - 40, (d.h ?? 360) - 40, 0x000000, 0.0).setStrokeStyle(2, d.color ?? 0x7a3a22, 0.7).setDepth(-9);
              break;
            }
            case "bench": {
              this.add.rectangle(d.x, d.y, 80, 14, 0x4a2e1f).setDepth(0);
              this.add.rectangle(d.x - 32, d.y + 14, 6, 18, 0x2a1810).setDepth(0);
              this.add.rectangle(d.x + 32, d.y + 14, 6, 18, 0x2a1810).setDepth(0);
              break;
            }
            case "painting": {
              const color = d.color ?? 0xc9a352;
              const pw = d.w ?? 100, ph = d.h ?? 70;
              this.add.rectangle(d.x, d.y, pw + 14, ph + 14, 0x3a2010).setDepth(-4);
              this.add.rectangle(d.x, d.y, pw, ph, color, 0.8).setDepth(-3);
              // Abstract painting details
              this.add.ellipse(d.x - 14, d.y - 8, 24, 28, 0xffffff, 0.2).setDepth(-2);
              this.add.ellipse(d.x + 16, d.y + 10, 18, 20, 0x000000, 0.15).setDepth(-2);
              this.add.rectangle(d.x, d.y - 20, pw + 24, 4, 0x1a0e08, 0.9).setDepth(-2);
              // Glow beneath painting
              const glow = this.add.rectangle(d.x, d.y + ph, pw * 0.8, 12, color, 0.10).setDepth(-7);
              this.tweens.add({ targets: glow, alpha: 0.18, duration: 3000, yoyo: true, repeat: -1 });
              break;
            }
            case "chandelier": {
              const color = d.color ?? 0xffd388;
              // Rod
              this.add.rectangle(d.x, d.y + 20, 4, 40, 0x222222).setDepth(-1);
              // Canopy top
              this.add.ellipse(d.x, d.y + 40, 40, 12, 0x333333).setDepth(-1);
              // Arms
              for (let arm = -2; arm <= 2; arm++) {
                const ax = d.x + arm * 28;
                const ay = d.y + 64;
                this.add.rectangle(ax, d.y + 52, Math.abs(arm) * 56 + 4, 3, 0x222222).setDepth(-1);
                const bulb = this.add.circle(ax, ay, 6, color, 1).setDepth(0);
                const halo = this.add.circle(ax, ay + 6, 40, color, 0.08).setDepth(-6);
                this.tweens.add({ targets: [bulb, halo], alpha: { from: 0.8, to: 1 }, duration: 1600 + arm * 200, yoyo: true, repeat: -1 });
              }
              // Main glow beneath chandelier
              const mainGlow = this.add.circle(d.x, d.y + 180, 120, color, 0.12).setDepth(-6);
              this.tweens.add({ targets: mainGlow, alpha: 0.18, duration: 2200, yoyo: true, repeat: -1 });
              break;
            }
            case "arcade": {
              const color = d.color ?? 0xff3ea5;
              // Cabinet body
              this.add.rectangle(d.x, d.y - 40, 60, 80, 0x111111).setStrokeStyle(2, color, 0.5).setDepth(0);
              // Screen
              const screen = this.add.rectangle(d.x, d.y - 52, 44, 34, 0x000000).setDepth(1);
              const screenGlow = this.add.rectangle(d.x, d.y - 52, 44, 34, color, 0.2).setDepth(1);
              this.tweens.add({ targets: screenGlow, alpha: 0.05, duration: 800, yoyo: true, repeat: -1 });
              // Controls
              this.add.circle(d.x - 10, d.y - 22, 5, 0xff3333).setDepth(1);
              this.add.circle(d.x + 4, d.y - 28, 4, 0x33ff33).setDepth(1);
              this.add.circle(d.x + 16, d.y - 22, 4, 0x3333ff).setDepth(1);
              // Screen glow on floor
              this.add.rectangle(d.x, d.y + 20, 100, 30, color, 0.07).setDepth(-7);
              void screen;
              break;
            }
            case "floorLight": {
              const color = d.color ?? 0xa78bfa;
              const strip = this.add.rectangle(d.x, d.y, d.w ?? 200, 4, color, 0.9).setDepth(0);
              const glow = this.add.rectangle(d.x, d.y - 4, d.w ?? 200, 20, color, 0.08).setDepth(-1);
              this.tweens.add({ targets: [strip, glow], alpha: { from: 0.6, to: 1 }, duration: 1200 + Math.random() * 600, yoyo: true, repeat: -1 });
              break;
            }
            case "fountain": {
              this.add.circle(d.x, d.y, 60, 0x4a4a5a).setDepth(0);
              this.add.circle(d.x, d.y, 48, 0x3a5a8a, 0.9).setDepth(1);
              const splash = this.add.circle(d.x, d.y, 18, 0xc9e0f8, 0.7).setDepth(2);
              this.tweens.add({ targets: splash, scale: 1.4, alpha: 0.3, duration: 1400, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
              break;
            }
            case "stringLights": {
              const x2 = d.x2 ?? d.x + 200;
              const y2 = d.y2 ?? d.y;
              const count = d.count ?? 10;
              const color = d.color ?? 0xffd388;
              // cord
              const len = Math.hypot(x2 - d.x, y2 - d.y);
              const ang = Math.atan2(y2 - d.y, x2 - d.x);
              const cord = this.add.rectangle((d.x + x2) / 2, (d.y + y2) / 2, len, 1.5, 0x111111, 0.85).setDepth(-3);
              cord.rotation = ang;
              for (let i = 0; i < count; i++) {
                const t = (i + 0.5) / count;
                const bx = d.x + (x2 - d.x) * t;
                const by = d.y + (y2 - d.y) * t + Math.sin(t * Math.PI) * 6; // slight droop
                this.add.rectangle(bx, by - 4, 1, 6, 0x222222).setDepth(-2);
                const bulb = this.add.circle(bx, by, 4, color, 1).setDepth(-1);
                const halo = this.add.circle(bx, by + 6, 56, color, 0.10).setDepth(-7);
                this.tweens.add({
                  targets: [bulb, halo],
                  alpha: { from: 0.85, to: 1 },
                  duration: 1200 + Math.random() * 1400,
                  yoyo: true, repeat: -1, ease: "Sine.easeInOut",
                });
              }
              break;
            }
            case "hangingBulb": {
              const color = d.color ?? 0xffd388;
              this.add.rectangle(d.x, d.y - 60, 1, 120, 0x111111).setDepth(-3);
              const cap = this.add.circle(d.x, d.y, 6, 0x1a1108).setStrokeStyle(1, 0x000000, 0.5).setDepth(-2);
              const bulb = this.add.circle(d.x, d.y + 6, 8, color, 1).setDepth(-1);
              const halo1 = this.add.circle(d.x, d.y + 30, 90, color, 0.18).setDepth(-7);
              const halo2 = this.add.circle(d.x, d.y + 60, 160, color, 0.10).setDepth(-7);
              // pool of warm light on the floor below
              this.add.ellipse(d.x, d.y + 110, 240, 110, color, 0.08).setDepth(-7);
              this.tweens.add({ targets: [bulb, halo1, halo2], alpha: { from: 0.9, to: 1 }, duration: 1800, yoyo: true, repeat: -1 });
              void cap;
              break;
            }
            case "sofa": {
              const w = d.w ?? 160, h = d.h ?? 60;
              const color = d.color ?? 0x3a2418;
              // shadow
              this.add.rectangle(d.x, d.y + h / 2 + 4, w + 8, 10, 0x000000, 0.35).setDepth(-2);
              // base
              this.add.rectangle(d.x, d.y, w, h, color).setStrokeStyle(2, 0x000000, 0.4).setDepth(-1);
              // backrest (top edge)
              this.add.rectangle(d.x, d.y - h / 2 + 8, w, 16, 0x2a1810).setDepth(-1);
              // cushion separators
              for (let i = 1; i < 3; i++) {
                this.add.rectangle(d.x - w / 2 + (w / 3) * i, d.y + 4, 1, h - 16, 0x000000, 0.3).setDepth(0);
              }
              // armrests
              this.add.rectangle(d.x - w / 2 + 6, d.y, 10, h - 4, 0x2a1810).setDepth(0);
              this.add.rectangle(d.x + w / 2 - 6, d.y, 10, h - 4, 0x2a1810).setDepth(0);
              // throw pillow accent
              this.add.rectangle(d.x - w / 4, d.y + 2, 18, 16, 0xc9a352, 0.9).setDepth(0);
              break;
            }
            case "coffeeTable": {
              const color = d.color ?? 0x5a3a22;
              this.add.ellipse(d.x, d.y + 6, 80, 18, 0x000000, 0.35).setDepth(-1);
              this.add.ellipse(d.x, d.y, 70, 44, color).setStrokeStyle(2, 0x2a1810, 0.6).setDepth(0);
              this.add.ellipse(d.x, d.y - 2, 56, 32, 0x6b4630, 0.6).setDepth(0);
              break;
            }
            case "barCounter": {
              const w = d.w ?? 600, h = d.h ?? 70;
              const color = d.color ?? 0x4a2e1a;
              // shadow
              this.add.rectangle(d.x, d.y + h / 2 + 4, w + 12, 10, 0x000000, 0.45).setDepth(-2);
              // counter base (dark wood)
              this.add.rectangle(d.x, d.y, w, h, color).setStrokeStyle(2, 0x1a0e08, 0.7).setDepth(-1);
              // wood grain
              for (let i = -w / 2 + 40; i < w / 2; i += 80) {
                this.add.rectangle(d.x + i, d.y, 1, h - 8, 0x000000, 0.25).setDepth(0);
              }
              // counter top highlight strip
              this.add.rectangle(d.x, d.y - h / 2 + 3, w - 8, 3, 0xc9a352, 0.7).setDepth(0);
              // coffee machine on the left
              this.add.rectangle(d.x - w / 3, d.y, 36, 26, 0x222222).setStrokeStyle(1, 0x4a4a4a).setDepth(0);
              this.add.circle(d.x - w / 3 - 8, d.y, 4, 0xffd388, 0.9).setDepth(1);
              this.add.circle(d.x - w / 3 + 8, d.y, 4, 0xffd388, 0.9).setDepth(1);
              // pastry display on the right
              this.add.rectangle(d.x + w / 3, d.y, 60, 24, 0x2a1810).setStrokeStyle(1, 0xc9a352, 0.6).setDepth(0);
              for (let i = 0; i < 3; i++) {
                this.add.circle(d.x + w / 3 - 18 + i * 18, d.y, 4, 0xe8a87c).setDepth(1);
              }
              break;
            }
            case "menuBoard": {
              const color = d.color ?? 0xc9a352;
              this.add.rectangle(d.x, d.y, 84, 56, 0x2a1810).setStrokeStyle(3, color, 0.8).setDepth(0);
              this.add.rectangle(d.x, d.y, 76, 48, 0x0d0a07).setDepth(1);
              const text = d.text ?? "COFFEE";
              this.add.text(d.x, d.y, text, {
                fontFamily: "Georgia, serif",
                fontSize: "7px",
                color: "#f0c987",
                align: "center",
                lineSpacing: 2,
              }).setOrigin(0.5).setDepth(2);
              // soft sign glow
              this.add.rectangle(d.x, d.y + 30, 100, 6, color, 0.18).setDepth(-1);
              break;
            }
            case "candle": {
              const color = d.color ?? 0xffd388;
              // candle holder
              this.add.circle(d.x, d.y + 2, 6, 0x6b4630).setStrokeStyle(1, 0x000000, 0.4).setDepth(1);
              // wax
              this.add.rectangle(d.x, d.y - 4, 4, 10, 0xf0e0c0).setDepth(2);
              // flame
              const flame = this.add.ellipse(d.x, d.y - 12, 4, 8, color, 0.95).setDepth(3);
              const halo = this.add.circle(d.x, d.y - 10, 28, color, 0.22).setDepth(-2);
              const pool = this.add.ellipse(d.x, d.y + 14, 80, 38, color, 0.10).setDepth(-7);
              this.tweens.add({ targets: flame, scaleY: 1.3, scaleX: 0.85, duration: 280, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
              this.tweens.add({ targets: [halo, pool], alpha: { from: 0.18, to: 0.28 }, duration: 700, yoyo: true, repeat: -1 });
              break;
            }
            case "framedSign": {
              const color = d.color ?? 0xc9a352;
              const w = d.w ?? 56, h = d.h ?? 64;
              // frame shadow
              this.add.rectangle(d.x + 2, d.y + 3, w + 8, h + 8, 0x000000, 0.4).setDepth(-4);
              // frame
              this.add.rectangle(d.x, d.y, w + 6, h + 6, 0x3a2010).setStrokeStyle(2, color, 0.8).setDepth(-3);
              // sign body
              this.add.rectangle(d.x, d.y, w, h, 0x1a1108).setDepth(-2);
              const text = d.text ?? "FOCUS";
              this.add.text(d.x, d.y, text, {
                fontFamily: "Georgia, serif",
                fontSize: "8px",
                color: "#e8c98a",
                align: "center",
                lineSpacing: 3,
              }).setOrigin(0.5).setDepth(-1);
              // tiny lamp glow above
              this.add.circle(d.x, d.y - h / 2 - 6, 22, color, 0.16).setDepth(-5);
              break;
            }
          }
        }

        // ---------- WEATHER ----------
        spawnWeather() {
          const W = this.worldW, H = this.worldH;
          switch (map.weather) {
            case "rain": {
              for (let i = 0; i < 90; i++) {
                const drop = this.add.rectangle(
                  Phaser.Math.Between(0, W),
                  Phaser.Math.Between(-H, H),
                  1, 10, 0xb0d4ff, 0.55,
                ).setDepth(45);
                this.tweens.add({
                  targets: drop,
                  y: drop.y + H + 60,
                  x: drop.x + 24,
                  duration: Phaser.Math.Between(700, 1300),
                  repeat: -1,
                  onRepeat: () => {
                    drop.y = -20;
                    drop.x = Phaser.Math.Between(0, W);
                  },
                });
                this.particles.push(drop);
              }
              break;
            }
            case "dust": {
              for (let i = 0; i < 60; i++) {
                const p = this.add.circle(
                  Phaser.Math.Between(0, W),
                  Phaser.Math.Between(0, H),
                  Phaser.Math.Between(1, 2),
                  0xffe8b8, 0.35,
                ).setDepth(44);
                this.tweens.add({
                  targets: p,
                  y: p.y - Phaser.Math.Between(40, 120),
                  x: p.x + Phaser.Math.Between(-30, 30),
                  alpha: { from: 0.35, to: 0 },
                  duration: Phaser.Math.Between(4000, 8000),
                  repeat: -1,
                  onRepeat: () => {
                    p.y = Phaser.Math.Between(H - 200, H);
                    p.x = Phaser.Math.Between(0, W);
                    p.alpha = 0.35;
                  },
                });
                this.particles.push(p);
              }
              break;
            }
            case "leaves": {
              for (let i = 0; i < 40; i++) {
                const colors = [0xf6a23a, 0xe87a3a, 0xc5572a, 0xf0c987];
                const leaf = this.add.ellipse(
                  Phaser.Math.Between(0, W),
                  Phaser.Math.Between(-200, 0),
                  8, 5,
                  colors[i % colors.length], 0.9,
                ).setDepth(45);
                this.tweens.add({
                  targets: leaf,
                  y: leaf.y + H + 200,
                  x: leaf.x + Phaser.Math.Between(-180, 180),
                  angle: 360,
                  duration: Phaser.Math.Between(6000, 11000),
                  repeat: -1,
                  onRepeat: () => {
                    leaf.y = -20;
                    leaf.x = Phaser.Math.Between(0, W);
                  },
                });
                this.particles.push(leaf);
              }
              break;
            }
            case "neon": {
              for (let i = 0; i < 50; i++) {
                const colors = [0x4ade80, 0xa78bfa, 0xff3ea5, 0x7dd3fc];
                const p = this.add.circle(
                  Phaser.Math.Between(0, W),
                  Phaser.Math.Between(0, H),
                  1,
                  colors[i % colors.length], 0.6,
                ).setDepth(44);
                this.tweens.add({
                  targets: p,
                  alpha: 0,
                  scale: 2,
                  duration: Phaser.Math.Between(2000, 4000),
                  repeat: -1,
                  onRepeat: () => {
                    p.x = Phaser.Math.Between(0, W);
                    p.y = Phaser.Math.Between(0, H);
                    p.alpha = 0.6;
                    p.setScale(1);
                  },
                });
                this.particles.push(p);
              }
              break;
            }
            case "sun":
            default:
              break;
          }
        }

        // ---------- LIGHTING VIGNETTE ----------
        drawVignette() {
          if (!this.vignette) return;
          const g = this.vignette;
          g.clear();
          const w = this.scale.width;
          const h = this.scale.height;
          // dark edges (multiply look via alpha-blended dark rectangle with radial cutout approximated by layered ellipses)
          g.fillStyle(map.lightColor, map.lightStrength);
          g.fillRect(0, 0, w, h);
          // soft warm center
          g.fillStyle(map.ambient, 0.08);
          g.fillCircle(w / 2, h / 2, Math.max(w, h) * 0.45);
          // top edge darker
          g.fillStyle(0x000000, 0.18);
          g.fillRect(0, 0, w, 80);
          g.fillRect(0, h - 80, w, 80);
        }

        // ---------- REMOTE AVATAR LOADER ----------
        loadAvatar(url: string, onReady: (key: string) => void) {
          const key = `pp-${this.hash(url)}`;
          if (this.textures.exists(key)) { onReady(key); return; }
          if (this.loadedAvatarKeys.has(key)) return;
          this.loadedAvatarKeys.add(key);
          this.load.crossOrigin = "anonymous";
          this.load.image(key, url);
          this.load.once(Phaser.Loader.Events.COMPLETE, () => {
            if (this.textures.exists(key)) onReady(key);
          });
          this.load.once(`loaderror`, () => {/* ignore failures */});
          this.load.start();
        }
        hash(s: string) {
          let h = 0; for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
          return Math.abs(h).toString(36);
        }

        showBubble(target: Phaser.GameObjects.Container, text: string) {
          const trimmed = text.slice(0, 80);
          const bg = this.add.rectangle(0, -100, Math.min(160, trimmed.length * 8 + 16), 22, 0xffffff, 0.95).setStrokeStyle(2, 0x000000, 0.2);
          const txt = this.add.text(0, -100, trimmed, { fontFamily: "monospace", fontSize: "11px", color: "#222" }).setOrigin(0.5);
          const bubble = this.add.container(0, 0, [bg, txt]).setDepth(20);
          target.add(bubble);
          this.time.delayedCall(3500, () => bubble.destroy());
        }

        applyAuthoritativeLocalState(player: PlayerState) {
          if (player.roomId !== map.id || !this.me) return;
          const body = this.me.body as Phaser.Physics.Arcade.Body | undefined;
          body?.setVelocity(player.vx ?? 0, player.vy ?? 0);
          this.me.setPosition(player.x, player.y);
          this.lastX = player.x;
          this.lastY = player.y;
          this.lastAnim = player.animationState;
          this.myStatus = player.status;
          this.myTable = player.tableId ?? player.table ?? null;
          this.mySeatIdx = (player.seatIndex ?? null) as number | null;
          this.meBody.scaleY = player.animationState === "walking" ? 1.08 : 1;
          this.applySitPose(!!this.myTable);
          this.refreshActiveTableInfo();
        }

        // ─── TABLE GEOMETRY ───
        seatOffsets(): { x: number; y: number }[] {
          return [
            { x: 0,  y: -78 }, // top
            { x: 78, y: 0 },   // right
            { x: 0,  y: 78 },  // bottom
            { x: -78, y: 0 },  // left
          ];
        }
        getSeatPosition(table: RoomTable, seatIdx: number) {
          const off = this.seatOffsets()[seatIdx % 4];
          return { x: table.x + off.x, y: table.y + off.y };
        }
        getMySeatPosition() {
          if (!this.myTable || this.mySeatIdx === null) return null;
          const t = this.roomTables.get(this.myTable);
          if (!t) return null;
          return this.getSeatPosition(t, this.mySeatIdx);
        }

        applySitPose(sitting: boolean) {
          const limbs = (this.me as unknown as { _limbs?: { legL: Phaser.GameObjects.Rectangle; legR: Phaser.GameObjects.Rectangle; armL: Phaser.GameObjects.Rectangle; armR: Phaser.GameObjects.Rectangle } })._limbs;
          if (!limbs) return;
          if (sitting) {
            limbs.legL.setVisible(false);
            limbs.legR.setVisible(false);
            limbs.armL.angle = -15;
            limbs.armR.angle = 15;
            this.meBody.y = 6;
          } else {
            limbs.legL.setVisible(true);
            limbs.legR.setVisible(true);
            limbs.armL.angle = 0;
            limbs.armR.angle = 0;
            this.meBody.y = 2;
          }
        }

        // ─── ROOM TABLES (USER-CREATED) ───
        async loadRoomTables() {
          // Safety net: remove any tables whose occupants have all gone
          // stale (e.g. browser closed without a clean disconnect).
          const { error: cleanupError } = await supabase.rpc("cleanup_stale_room_tables", { p_room_id: map.id });
          if (cleanupError) console.warn("[tables] cleanup failed", cleanupError);

          const { data, error } = await supabase
            .from("room_tables")
            .select("*")
            .eq("room_id", map.id)
            .gt("expires_at", new Date().toISOString());
          if (error) { console.warn("[tables] load failed", error); return; }
          (data ?? []).forEach((row) => this.upsertTable(row as RoomTable));
          this.refreshTablesOccupancy();
          this.refreshActiveTableInfo();
          this.tablesLoaded = true;
        }

        subscribeRoomTables() {
          const ch = supabase
            .channel(`room_tables:${map.id}`)
            .on("postgres_changes", { event: "*", schema: "public", table: "room_tables", filter: `room_id=eq.${map.id}` }, (payload) => {
              if (payload.eventType === "DELETE") {
                const oldRow = payload.old as { id?: string };
                if (oldRow.id) this.removeTable(oldRow.id);
              } else {
                this.upsertTable(payload.new as RoomTable);
                this.refreshTablesOccupancy();
              }
            })
            .subscribe();
          this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { void supabase.removeChannel(ch); });
        }

        upsertTable(t: RoomTable) {
          this.roomTables.set(t.id, t);
          const existing = this.tableObjs.get(t.id);
          if (existing) {
            existing.container.setPosition(t.x, t.y);
            existing.nameText.setText(t.name);
            existing.subjectText.setText(t.subject);
            return;
          }
          const c = this.add.container(t.x, t.y).setDepth(1);

          // Themed palette per room
          const theme = (() => {
            switch (map.id) {
              case "library": return { wood: 0x6b4a2a, woodDark: 0x3a2418, edge: 0x2a1810, chair: 0x4a3018 };
              case "hub":     return { wood: 0x2a2a3a, woodDark: 0x14141e, edge: 0x4ade80, chair: 0x1a1a24 };
              case "park":    return { wood: 0x6a4a2a, woodDark: 0x3a2818, edge: 0x4e7a3a, chair: 0x4a2e1f };
              case "hall":    return { wood: 0x5a4030, woodDark: 0x2a1f18, edge: 0xc9a352, chair: 0x3a2418 };
              case "cafe":
              default:        return { wood: 0x6b4226, woodDark: 0x3a2010, edge: 0xc9a352, chair: 0x2a1810 };
            }
          })();

          // Soft warm light pool from the hanging bulb above the table (premium feel)
          const lightPool = this.add.ellipse(0, 12, 260, 200, map.accent, 0.10);
          const lightPool2 = this.add.ellipse(0, 8, 180, 140, map.ambient, 0.10);
          this.tweens.add({ targets: [lightPool, lightPool2], alpha: { from: 0.08, to: 0.16 }, duration: 2400, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });

          // Drop shadow
          const shadow = this.add.ellipse(2, 16, 200, 70, 0x000000, 0.45);

          // Chairs (back + seat) at 4 cardinal positions
          const seats: Phaser.GameObjects.Arc[] = [];
          const chairExtras: Phaser.GameObjects.GameObject[] = [];
          this.seatOffsets().forEach((o) => {
            // Backrest oriented toward the table center
            const ang = Math.atan2(-o.y, -o.x);
            const back = this.add.rectangle(o.x, o.y, 26, 8, theme.chair).setStrokeStyle(1, 0x000000, 0.6);
            back.rotation = ang + Math.PI / 2;
            // Push backrest slightly outside the seat
            const push = 12;
            back.x = o.x + Math.cos(ang + Math.PI) * push * -1;
            back.y = o.y + Math.sin(ang + Math.PI) * push * -1;
            const chairShadow = this.add.ellipse(o.x + 2, o.y + 4, 28, 10, 0x000000, 0.35);
            const seat = this.add.circle(o.x, o.y, 14, theme.chair).setStrokeStyle(2, 0x000000, 0.5);
            chairExtras.push(back, chairShadow);
            seats.push(seat);
          });

          // Wooden rectangular table top (with rounded feel via inner highlight)
          const topW = 150, topH = 100;
          const tableShadow = this.add.rectangle(2, 6, topW + 8, topH + 8, 0x000000, 0.45);
          const surfaceRect = this.add.rectangle(0, 0, topW, topH, theme.wood).setStrokeStyle(3, theme.edge, 0.85);
          // Stored as `surface` for occupancy re-stroke.
          const surface = surfaceRect;
          // Wood plank grain
          const grain: Phaser.GameObjects.GameObject[] = [];
          for (let gx = -topW / 2 + 16; gx < topW / 2; gx += 22) {
            grain.push(this.add.rectangle(gx, 0, 1, topH - 16, 0x000000, 0.22));
          }
          // Inner inlay (lighter wood)
          const inlay = this.add.rectangle(0, -3, topW - 28, topH - 30, 0x8a5a36, 0.35);
          // Subtle highlight at top edge
          const hi = this.add.rectangle(0, -topH / 2 + 4, topW - 16, 3, 0xffe1b0, 0.35);

          // Themed accessories on the table (drawn after the surface).
          // Stored `surface` references `surfaceRect` so occupancy can re-stroke it.
          const acc: Phaser.GameObjects.GameObject[] = [];
          if (map.id === "cafe") {
            // Coffee cup + saucer
            acc.push(this.add.ellipse(-32, -10, 22, 12, 0xf5f0e0).setStrokeStyle(1, 0x6b4226, 0.6));
            acc.push(this.add.circle(-32, -10, 7, 0x3a1f10));
            acc.push(this.add.circle(-32, -10, 5, 0x6b3a1a));
            // Open book
            acc.push(this.add.rectangle(22, -4, 36, 24, 0xf3e6c0).setStrokeStyle(1, 0x4a2e1f, 0.6));
            acc.push(this.add.rectangle(22, -4, 1, 22, 0x6b4226));
            acc.push(this.add.rectangle(14, -4, 14, 1, 0x6b4226, 0.6));
            acc.push(this.add.rectangle(30, -4, 14, 1, 0x6b4226, 0.6));
            // Tiny pastry plate
            acc.push(this.add.ellipse(36, 22, 16, 8, 0xeeeeee));
            acc.push(this.add.circle(36, 22, 4, 0xe8a87c));
          } else if (map.id === "library") {
            // Book stack + reading lamp
            acc.push(this.add.rectangle(-28, -8, 30, 8, 0x8a2a2a));
            acc.push(this.add.rectangle(-28, -16, 26, 8, 0x2a6a8a));
            acc.push(this.add.rectangle(-28, -24, 28, 8, 0x6a8a2a));
            acc.push(this.add.rectangle(24, -2, 8, 24, 0x222222));
            acc.push(this.add.ellipse(24, -22, 22, 12, 0xffd388).setStrokeStyle(1, 0x4a2e1f, 0.6));
            acc.push(this.add.circle(24, -10, 30, 0xffd388, 0.12));
          } else if (map.id === "hub") {
            // Laptop + mug
            acc.push(this.add.rectangle(-6, -4, 56, 36, 0x1a1a24).setStrokeStyle(1, 0x4ade80, 0.6));
            acc.push(this.add.rectangle(-6, -4, 50, 30, 0x0a0a14));
            acc.push(this.add.rectangle(-6, 12, 60, 4, 0x222a3a));
            acc.push(this.add.circle(34, -8, 7, 0x2a1810).setStrokeStyle(1, 0xc9a352, 0.6));
          } else if (map.id === "park") {
            // Mug + small leaf cluster + notebook
            acc.push(this.add.circle(-26, -4, 9, 0xeeeeee).setStrokeStyle(1, 0x4a2e1f, 0.6));
            acc.push(this.add.circle(-26, -4, 6, 0x3a1f10));
            acc.push(this.add.rectangle(20, -2, 32, 22, 0xf3e6c0).setStrokeStyle(1, 0x4a2e1f, 0.5));
            acc.push(this.add.ellipse(36, 22, 12, 6, 0x4e7a3a));
          } else {
            // Notebook + pen + mug (default / hall)
            acc.push(this.add.rectangle(-20, -4, 36, 26, 0xf3e6c0).setStrokeStyle(1, 0x4a2e1f, 0.5));
            acc.push(this.add.rectangle(-20, -4, 1, 22, 0x4a2e1f, 0.5));
            acc.push(this.add.rectangle(0, -16, 18, 2, 0x222222));
            acc.push(this.add.circle(28, -2, 8, 0xeeeeee).setStrokeStyle(1, 0x4a2e1f, 0.6));
          }

          // Floating labels
          const nameText = this.add.text(0, -96, t.name, { fontFamily: "system-ui, sans-serif", fontSize: "14px", color: "#ffffff", backgroundColor: "#000000aa", padding: { x: 8, y: 3 }, fontStyle: "600" }).setOrigin(0.5);
          const subjectText = this.add.text(0, -78, t.subject, { fontFamily: "system-ui, sans-serif", fontSize: "11px", color: "#f0c987", backgroundColor: "#00000080", padding: { x: 6, y: 2 } }).setOrigin(0.5);
          const countText = this.add.text(0, 110, `0/${t.max_seats} seated`, { fontFamily: "system-ui, sans-serif", fontSize: "11px", color: "#ffffffcc", backgroundColor: "#00000066", padding: { x: 6, y: 1 } }).setOrigin(0.5);

          c.add([lightPool, lightPool2, shadow, ...chairExtras, ...seats, tableShadow, surfaceRect, ...grain, inlay, hi, ...acc, nameText, subjectText, countText]);
          this.tableObjs.set(t.id, { container: c, surface, seats, nameText, subjectText, countText });

          // Click any chair seat to claim it
          seats.forEach((seat, seatIdx) => {
            seat.setInteractive({ useHandCursor: true }).on("pointerdown", () => {
              if (isUiBlocked()) return;
              const dx = this.me.x - t.x;
              const dy = this.me.y - t.y;
              if (Math.hypot(dx, dy) > 200) {
                toast("Walk closer to that table to sit");
                return;
              }
              void this.sitAtTable(t.id, seatIdx);
            });
          });
        }

        removeTable(id: string) {
          const obj = this.tableObjs.get(id);
          obj?.container.destroy();
          this.tableObjs.delete(id);
          this.roomTables.delete(id);
          this.tableOccupancy.delete(id);
          if (this.myTable === id) this.standUp();
        }

        refreshTablesOccupancy() {
          this.tableObjs.forEach((obj, tid) => {
            const occ = this.tableOccupancy.get(tid) ?? new Map<number, string>();
            const n = occ.size;
            const table = this.roomTables.get(tid);
            const max = table?.max_seats ?? 4;
            obj.countText.setText(`${n}/${max} seated`);
            // color seats by authoritative occupancy index
            obj.seats.forEach((seat, i) => {
              const occupied = occ.has(i);
              seat.setFillStyle(occupied ? 0xf0c987 : 0x2a1810);
              seat.setStrokeStyle(2, occupied ? 0xff9a3a : 0x55392a, 0.9);
            });
            obj.surface.setStrokeStyle(3, n > 0 ? 0x4ade80 : map.accent, n > 0 ? 0.8 : 0.5);
          });
        }

        refreshActiveTableInfo() {
          if (!this.myTable) { setTableInfo(null); return; }
          const t = this.roomTables.get(this.myTable);
          if (!t) { setTableInfo(null); return; }
          const occMap = this.tableOccupancy.get(this.myTable) ?? new Map<number, string>();
          const occupantIds = [...occMap.values()];
          setTableInfo({
            tableId: t.id,
            name: t.name,
            subject: t.subject,
            goal: t.goal,
            duration: t.duration_minutes,
            creator: t.creator_username,
            creatorId: t.creator_id,
            isOwner: t.creator_id === myId,
            occupants: occMap.size || 1,
            maxSeats: t.max_seats,
            occupantIds,
          });
        }

        async sitAtTable(tableId: string, preferredSeat?: number) {
          if (this.claimInFlight) return;
          const t = this.roomTables.get(tableId);
          if (!t) return;
          if (this.myTable === tableId && this.mySeatIdx !== null) return;
          this.claimInFlight = true;
          try {
            const seatIdx = await this.claimSeatAtomic(t, preferredSeat);
            if (seatIdx === null) { toast.error("Table is full"); return; }
            const seat = this.getSeatPosition(t, seatIdx);
            this.myTable = tableId;
            this.mySeatIdx = seatIdx;
            this.myStatus = "focused";
            (this.me.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
            this.tweens.add({ targets: this.me, x: seat.x, y: seat.y, duration: 400, ease: "Sine.easeInOut" });
            this.applySitPose(true);
            this.refreshActiveTableInfo();
            this.presenceSync.syncLocal({
              x: seat.x, y: seat.y,
              animationState: "focused",
              status: "focused",
              focusStatus: "focused",
              table: tableId,
              tableId,
              seatIndex: seatIdx,
            }, true);
          } finally {
            this.claimInFlight = false;
          }
        }

        // Atomic-ish seat claim — relies on the DB unique index (room_id, table_id, seat_index)
        // to reject double-occupancy; retries the lowest free slot until it sticks.
        async claimSeatAtomic(t: RoomTable, preferredSeat?: number): Promise<number | null> {
          const max = t.max_seats;
          for (let attempt = 0; attempt < 5; attempt++) {
            const { data: occRows } = await supabase
              .from("room_players")
              .select("user_id, seat_index")
              .eq("room_id", t.room_id)
              .eq("table_id", t.id)
              .not("seat_index", "is", null);
            const taken = new Set<number>();
            (occRows ?? []).forEach((r) => {
              if (r.user_id !== myId && typeof r.seat_index === "number") taken.add(r.seat_index);
            });
            const order: number[] = [];
            if (typeof preferredSeat === "number" && preferredSeat >= 0 && preferredSeat < max) order.push(preferredSeat);
            for (let i = 0; i < max; i++) if (!order.includes(i)) order.push(i);
            const pick = order.find((i) => !taken.has(i));
            if (pick === undefined) return null;
            const { error } = await supabase
              .from("room_players")
              .update({
                table_id: t.id,
                seat_index: pick,
                animation_state: "focused",
                focus_status: "focused",
                last_seen: new Date().toISOString(),
              })
              .eq("user_id", myId)
              .eq("room_id", t.room_id);
            if (!error) return pick;
            const code = (error as { code?: string }).code;
            if (code !== "23505") {
              console.warn("[seat] claim error", error);
              return null;
            }
            // unique violation — someone took it; retry
          }
          return null;
        }

        async standUp() {
          const wasTable = this.myTable;
          this.myTable = null;
          this.mySeatIdx = null;
          this.myStatus = "idle";
          setTableInfo(null);
          this.applySitPose(false);
          this.presenceSync.syncLocal({
            x: this.me.x,
            y: this.me.y,
            animationState: "idle",
            status: "idle",
            focusStatus: "idle",
            table: null,
            tableId: null,
            seatIndex: null,
          }, true);
          if (wasTable) {
            // Make sure the DB clears the seat too (the upsert path is partial).
            await supabase
              .from("room_players")
              .update({ table_id: null, seat_index: null, animation_state: "idle", focus_status: "idle" })
              .eq("user_id", myId)
              .eq("room_id", map.id);
          }
        }

        update(_t: number, dt: number) {
          this.remotePlayers?.update(dt);
          // Keep the circular photo mask glued to the head above the avatar.
          if (this.meAvatarMask && this.me) {
            this.meAvatarMask.setPosition(this.me.x, this.me.y - 52);
          }
          if (this.myTable) return; // seated, no movement
          const body = this.me.body as Phaser.Physics.Arcade.Body;
          // Suspend keyboard movement while a modal/popover is open or an input/textarea has focus.
          if (isUiBlocked()) { body.setVelocity(0, 0); return; }
          const speed = 220;
          let vx = 0, vy = 0;
          if (this.cursors.left.isDown || this.wasd.A.isDown) vx = -speed;
          else if (this.cursors.right.isDown || this.wasd.D.isDown) vx = speed;
          if (this.cursors.up.isDown || this.wasd.W.isDown) vy = -speed;
          else if (this.cursors.down.isDown || this.wasd.S.isDown) vy = speed;
          body.setVelocity(vx, vy);

          const moving = vx !== 0 || vy !== 0;
          if (moving) {
            this.meBody.scaleY = 1 + Math.sin(this.time.now / 80) * 0.06;
          }

          // High-frequency websocket broadcast for smooth remote interpolation.
          const now = this.time.now;
          const animationState = moving ? "walking" : "idle";
          const moved = Math.abs(this.me.x - this.lastX) > 1 || Math.abs(this.me.y - this.lastY) > 1;
          const stateChanged = animationState !== this.lastAnim;
          if (now - this.lastSent > 33 && (moved || stateChanged)) {
            this.lastSent = now;
            this.lastX = this.me.x;
            this.lastY = this.me.y;
            this.lastAnim = animationState;
            this.presenceSync.syncLocal({
              x: this.me.x, y: this.me.y,
              vx, vy,
              animationState,
              status: animationState,
              focusStatus: "idle",
              table: null,
              tableId: null,
            });
          }

          void dt;
        }

        shutdown() {
          void this.presenceSync?.leave();
          this.remotePlayers?.destroy();
        }
      }

      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: containerRef.current,
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
        backgroundColor: map.floor,
        physics: { default: "arcade", arcade: { debug: false } },
        scene: WorldScene,
        pixelArt: false,
        antialias: true,
        roundPixels: false,
        scale: { mode: Phaser.Scale.RESIZE },
      });
    })();

    return () => {
      destroyed = true;
      if (game) game.destroy(true);
    };
  }, [mapId, map.id, map.floor, map.wall, map.ambient, map.accent]);

  return (
    <>
      <div ref={containerRef} className="absolute inset-0" />
      <GameHud
        map={map}
        onLeave={onLeave}
        onChat={handleChat}
        onTyping={handleTyping}
        onLeaveTable={handleLeaveTable}
        onCloseTable={handleCloseTable}
        chatLog={chatLog}
        tableInfo={tableInfo}
        onlineCount={onlineCount}
        debugMetrics={debugMetrics}
        myUserId={myUserId}
      />
      <CreateTableDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={async (input) => {
          if (createTableRef.current) await createTableRef.current(input);
        }}
      />
    </>
  );
}