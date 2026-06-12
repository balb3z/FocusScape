import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  SKIN_TONES,
  HAIR_COLORS,
  SHIRT_COLORS,
  PANTS_COLORS,
  MALE_HAIR_STYLES,
  FEMALE_HAIR_STYLES,
  DEFAULT_MALE_CONFIG,
  DEFAULT_FEMALE_CONFIG,
  type Gender,
  type CharacterConfig,
  type HairStyle,
} from "@/lib/maps";

// ─── Inline pixel-art character SVG ────────────────────────────────────────
function CharacterPreview({
  gender,
  config,
  size = 120,
}: {
  gender: Gender;
  config: CharacterConfig;
  size?: number;
}) {
  const skin  = SKIN_TONES[config.skinId]?.hex    ?? "#f0c987";
  const hair  = HAIR_COLORS[config.hairColorId]?.hex ?? "#3a2418";
  const shirt = SHIRT_COLORS[config.shirtId]?.hex  ?? "#3b82f6";
  const pants = PANTS_COLORS[config.pantsId]?.hex  ?? "#1f2937";
  const hs    = config.hairStyle;

  // Build hair path based on style
  const hairPaths: JSX.Element[] = [];
  if (hs !== "bald") {
    // Common top
    hairPaths.push(
      <ellipse key="top" cx="50" cy="22" rx="19" ry="10" fill={hair} />
    );
    if (hs === "long" || hs === "wavy") {
      hairPaths.push(
        <rect key="left"  x="28" y="22" width="8" height="28" rx="4" fill={hair} />,
        <rect key="right" x="64" y="22" width="8" height="28" rx="4" fill={hair} />,
      );
      if (hs === "wavy") {
        hairPaths.push(
          <path key="wave-l" d="M28 38 Q24 44 28 50 Q24 56 28 62" stroke={hair} strokeWidth="6" fill="none" strokeLinecap="round" />,
          <path key="wave-r" d="M72 38 Q76 44 72 50 Q76 56 72 62" stroke={hair} strokeWidth="6" fill="none" strokeLinecap="round" />,
        );
      }
    } else if (hs === "bun") {
      hairPaths.push(
        <ellipse key="bun" cx="50" cy="12" rx="10" ry="10" fill={hair} />,
        <rect key="stick-l" x="29" y="22" width="7" height="16" rx="3" fill={hair} />,
        <rect key="stick-r" x="64" y="22" width="7" height="16" rx="3" fill={hair} />,
      );
    } else if (hs === "braids") {
      hairPaths.push(
        <rect key="bl" x="28" y="24" width="6" height="36" rx="3" fill={hair} />,
        <rect key="br" x="66" y="24" width="6" height="36" rx="3" fill={hair} />,
        // braid marks
        <line key="bl1" x1="28" y1="32" x2="34" y2="32" stroke={skin} strokeWidth="2" />,
        <line key="bl2" x1="28" y1="42" x2="34" y2="42" stroke={skin} strokeWidth="2" />,
        <line key="br1" x1="66" y1="32" x2="72" y2="32" stroke={skin} strokeWidth="2" />,
        <line key="br2" x1="66" y1="42" x2="72" y2="42" stroke={skin} strokeWidth="2" />,
      );
    } else if (hs === "short_f") {
      // tight cap
      hairPaths.push(
        <ellipse key="cap" cx="50" cy="26" rx="19" ry="14" fill={hair} />,
      );
    } else if (hs === "curly") {
      // multiple small circles
      for (let i = 0; i < 6; i++) {
        hairPaths.push(
          <circle key={`c${i}`} cx={34 + i * 7} cy={20} r="7" fill={hair} />
        );
      }
    } else if (hs === "fade") {
      // tighter top, faded sides
      hairPaths.push(
        <ellipse key="fade" cx="50" cy="23" rx="19" ry="8" fill={hair} />,
        <rect key="fl" x="31" y="22" width="5" height="10" rx="2" fill={hair} opacity="0.5" />,
        <rect key="fr" x="64" y="22" width="5" height="10" rx="2" fill={hair} opacity="0.5" />,
      );
    } else if (hs === "long_m") {
      hairPaths.push(
        <rect key="left"  x="28" y="22" width="7" height="22" rx="4" fill={hair} />,
        <rect key="right" x="65" y="22" width="7" height="22" rx="4" fill={hair} />,
      );
    }
    // short is just the top cap (already drawn)
  }

  return (
    <svg
      width={size}
      height={size * 1.4}
      viewBox="0 0 100 140"
      xmlns="http://www.w3.org/2000/svg"
      style={{ filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.45))" }}
    >
      {/* Shadow */}
      <ellipse cx="50" cy="135" rx="22" ry="5" fill="#000" opacity="0.3" />
      {/* Legs */}
      <rect x="36" y="95" width="11" height="28" rx="4" fill={pants} />
      <rect x="53" y="95" width="11" height="28" rx="4" fill={pants} />
      {/* Shoes */}
      <ellipse cx="41" cy="124" rx="8" ry="4" fill="#111" />
      <ellipse cx="59" cy="124" rx="8" ry="4" fill="#111" />
      {/* Body / shirt */}
      <rect x="30" y="62" width="40" height="36" rx="8" fill={shirt} stroke="#00000040" strokeWidth="1.5" />
      {/* Arms */}
      <rect x="17" y="63" width="14" height="26" rx="6" fill={shirt} stroke="#00000040" strokeWidth="1" />
      <rect x="69" y="63" width="14" height="26" rx="6" fill={shirt} stroke="#00000040" strokeWidth="1" />
      {/* Hands */}
      <ellipse cx="24" cy="90" rx="6" ry="5" fill={skin} />
      <ellipse cx="76" cy="90" rx="6" ry="5" fill={skin} />
      {/* Neck */}
      <rect x="45" y="52" width="10" height="12" rx="3" fill={skin} />
      {/* Head */}
      <ellipse cx="50" cy="37" rx="20" ry="22" fill={skin} stroke="#00000030" strokeWidth="1.5" />
      {/* Hair (behind ears/face but rendered over head background) */}
      {...hairPaths}
      {/* Ears */}
      <ellipse cx="30" cy="37" rx="4" ry="5" fill={skin} />
      <ellipse cx="70" cy="37" rx="4" ry="5" fill={skin} />
      {/* Eyes */}
      <circle cx="43" cy="36" r="3" fill="#1a1209" />
      <circle cx="57" cy="36" r="3" fill="#1a1209" />
      <circle cx="44" cy="35" r="1" fill="#fff" opacity="0.6" />
      <circle cx="58" cy="35" r="1" fill="#fff" opacity="0.6" />
      {/* Nose */}
      <ellipse cx="50" cy="42" rx="2" ry="1.5" fill="#00000020" />
      {/* Smile */}
      <path d={gender === "female" ? "M44 48 Q50 54 56 48" : "M44 47 Q50 52 56 47"} stroke="#00000050" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      {/* Shirt details */}
      <line x1="50" y1="62" x2="50" y2="94" stroke="#00000020" strokeWidth="1" />
      <ellipse cx="50" cy="65" rx="3" ry="2" fill="#00000015" />
    </svg>
  );
}

// ─── Swatch row ────────────────────────────────────────────────────────────
function SwatchRow<T extends { id: number | string; name: string; hex: string }>({
  label,
  items,
  selected,
  onSelect,
  round = false,
}: {
  label: string;
  items: readonly T[];
  selected: T["id"];
  onSelect: (id: T["id"]) => void;
  round?: boolean;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-white/50">{label}</p>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            title={item.name}
            onClick={() => onSelect(item.id as T["id"])}
            className={`transition-all ${round ? "rounded-full" : "rounded-lg"} border-2 ${selected === item.id ? "border-white scale-110 ring-2 ring-white/40" : "border-white/20 hover:border-white/60"}`}
            style={{
              width: 28,
              height: 28,
              background: item.hex,
              boxShadow: selected === item.id ? `0 0 10px ${item.hex}99` : undefined,
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────
export function CharacterSetup({
  userId,
  defaultUsername,
  onComplete,
}: {
  userId: string;
  defaultUsername: string;
  onComplete: () => void;
}) {
  const [step, setStep] = useState<"gender" | "customize" | "saving">("gender");
  const [gender, setGender] = useState<Gender>("male");
  const [username, setUsername] = useState(defaultUsername);
  const [config, setConfig] = useState<CharacterConfig>(DEFAULT_MALE_CONFIG);
  const [saving, setSaving] = useState(false);

  const handleGenderSelect = useCallback((g: Gender) => {
    setGender(g);
    setConfig(g === "female" ? DEFAULT_FEMALE_CONFIG : DEFAULT_MALE_CONFIG);
    setStep("customize");
  }, []);

  const patch = useCallback(<K extends keyof CharacterConfig>(key: K, val: CharacterConfig[K]) => {
    setConfig((c) => ({ ...c, [key]: val }));
  }, []);

  const hairStyles = gender === "female" ? FEMALE_HAIR_STYLES : MALE_HAIR_STYLES;

  const handleSave = useCallback(async () => {
    if (!username.trim() || username.trim().length < 2) {
      toast.error("Display name must be at least 2 characters");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          username: username.trim(),
          gender,
          character_config: config as unknown as Record<string, unknown>,
        })
        .eq("id", userId);
      if (error) throw error;
      toast.success("Character saved! Welcome to FocusScape 🎉");
      onComplete();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save character");
    } finally {
      setSaving(false);
    }
  }, [userId, username, gender, config, onComplete]);

  // ── STEP: gender selection ──────────────────────────────────────────────
  if (step === "gender") {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center px-4"
        style={{ background: "radial-gradient(ellipse at 30% 0%, #1a0e3a 0%, #0d0d1a 60%, #0a0a12 100%)" }}
      >
        {/* Ambient glows */}
        <div className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="absolute -top-32 left-1/4 h-72 w-72 rounded-full bg-purple-600/15 blur-3xl" />
          <div className="absolute bottom-0 right-1/4 h-64 w-64 rounded-full bg-pink-500/10 blur-3xl" />
        </div>

        <div className="relative w-full max-w-lg text-center">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.3em] text-white/30">
            ✦ Welcome to FocusScape
          </div>
          <h1 className="text-4xl font-bold text-white mb-2">Create Your Character</h1>
          <p className="text-white/50 mb-10 text-sm">Choose your avatar to get started. You can customize everything next.</p>

          <div className="grid grid-cols-2 gap-5">
            {(["male", "female"] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => handleGenderSelect(g)}
                className="group relative flex flex-col items-center gap-4 rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur transition-all hover:border-white/30 hover:bg-white/10 hover:scale-[1.02] active:scale-[0.98]"
              >
                <div className="transition-transform group-hover:scale-105">
                  <CharacterPreview
                    gender={g}
                    config={g === "female" ? DEFAULT_FEMALE_CONFIG : DEFAULT_MALE_CONFIG}
                    size={90}
                  />
                </div>
                <span className="text-lg font-semibold capitalize text-white">{g}</span>
                <div className="absolute inset-0 rounded-3xl ring-2 ring-inset ring-transparent transition-all group-hover:ring-white/20" />
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ── STEP: customize ─────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 overflow-y-auto py-8"
      style={{ background: "radial-gradient(ellipse at 30% 0%, #1a0e3a 0%, #0d0d1a 60%, #0a0a12 100%)" }}
    >
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 left-1/4 h-72 w-72 rounded-full bg-purple-600/15 blur-3xl" />
        <div className="absolute bottom-0 right-1/4 h-64 w-64 rounded-full bg-pink-500/10 blur-3xl" />
      </div>

      <div className="relative w-full max-w-2xl">
        <button
          type="button"
          onClick={() => setStep("gender")}
          className="mb-6 text-sm text-white/40 hover:text-white/80 transition-colors flex items-center gap-1"
        >
          ← Back
        </button>

        <div className="mb-6">
          <div className="text-xs font-semibold uppercase tracking-[0.3em] text-white/30 mb-1">✦ FocusScape</div>
          <h2 className="text-3xl font-bold text-white">Customize Your Character</h2>
          <p className="text-white/40 text-sm mt-1">
            Your character will appear in every room. Make it yours.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-[200px_1fr]">
          {/* Preview */}
          <div className="flex flex-col items-center gap-4">
            <div
              className="w-full rounded-3xl border border-white/10 bg-white/5 p-6 flex items-center justify-center"
              style={{ minHeight: 220 }}
            >
              <CharacterPreview gender={gender} config={config} size={90} />
            </div>
            <div className="w-full">
              <p className="text-xs font-semibold uppercase tracking-widest text-white/50 mb-1">Display Name</p>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                maxLength={20}
                minLength={2}
                className="w-full rounded-xl border border-white/15 bg-white/8 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-white/40 focus:ring-1 focus:ring-white/20"
                placeholder="cozy_scholar"
              />
            </div>
          </div>

          {/* Options */}
          <div className="flex flex-col gap-5 rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
            <SwatchRow
              label="Skin Tone"
              items={SKIN_TONES}
              selected={config.skinId}
              onSelect={(id) => patch("skinId", id as number)}
              round
            />
            <SwatchRow
              label="Hair Color"
              items={HAIR_COLORS}
              selected={config.hairColorId}
              onSelect={(id) => patch("hairColorId", id as number)}
              round
            />

            {/* Hair style */}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-white/50">Hair Style</p>
              <div className="flex flex-wrap gap-2">
                {hairStyles.map((hs) => (
                  <button
                    key={hs.id}
                    type="button"
                    onClick={() => patch("hairStyle", hs.id as HairStyle)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all border ${
                      config.hairStyle === hs.id
                        ? "border-white/60 bg-white/20 text-white"
                        : "border-white/15 bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/80"
                    }`}
                  >
                    {hs.name}
                  </button>
                ))}
              </div>
            </div>

            <SwatchRow
              label="Shirt Color"
              items={SHIRT_COLORS}
              selected={config.shirtId}
              onSelect={(id) => patch("shirtId", id as number)}
            />
            <SwatchRow
              label="Pants Color"
              items={PANTS_COLORS}
              selected={config.pantsId}
              onSelect={(id) => patch("pantsId", id as number)}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={saving || username.trim().length < 2}
          className="mt-6 w-full rounded-2xl py-4 text-base font-bold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:scale-[1.01] active:scale-[0.99]"
          style={{
            background: saving
              ? "rgba(255,255,255,0.1)"
              : "linear-gradient(135deg, #7c3aed 0%, #ec4899 100%)",
            boxShadow: saving ? undefined : "0 0 30px rgba(124,58,237,0.4)",
          }}
        >
          {saving ? "Saving…" : "Enter FocusScape →"}
        </button>
      </div>
    </div>
  );
}
