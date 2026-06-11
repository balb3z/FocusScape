import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AVATAR_COLORS } from "@/lib/maps";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  ssr: false,
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [avatarId, setAvatarId] = useState(0);
  const [gender, setGender] = useState<"male" | "female">("male");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/lobby" });
    });
  }, [navigate]);

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { username: username || email.split("@")[0], avatar_id: avatarId, gender },
          },
        });
        if (error) throw error;
        toast.success("Welcome! Entering the world…");
        navigate({ to: "/lobby" });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/lobby" });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Auth failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) {
      toast.error(error.message ?? "Google sign-in failed");
      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center px-4" style={{ background: "var(--gradient-dusk)" }}>
      <Link to="/" className="absolute left-6 top-6 text-sm text-muted-foreground hover:text-foreground">← Back</Link>
      <div className="w-full max-w-md rounded-3xl border border-border bg-card/80 p-8 backdrop-blur" style={{ boxShadow: "var(--shadow-cozy)" }}>
        <h1 className="text-3xl font-bold tracking-tight">{mode === "signup" ? "Create your character" : "Welcome back"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{mode === "signup" ? "Pick a name and look, then enter the world." : "Sign in to rejoin your study spot."}</p>

        <form onSubmit={handleEmail} className="mt-6 space-y-4">
          {mode === "signup" && (
            <>
              <div>
                <Label htmlFor="username">Display name</Label>
                <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="cozy_scholar" required minLength={2} maxLength={20} />
              </div>
              <div>
                <Label>Gender</Label>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  {(["male", "female"] as const).map((g) => {
                    const selected = gender === g;
                    const shirt = g === "male" ? "#3b82f6" : "#ec4899";
                    return (
                      <button
                        type="button"
                        key={g}
                        onClick={() => setGender(g)}
                        className={`flex flex-col items-center gap-2 rounded-xl border-2 p-3 transition ${selected ? "border-primary scale-[1.02]" : "border-border opacity-80 hover:opacity-100"}`}
                      >
                        <svg width="48" height="56" viewBox="0 0 48 56" aria-hidden>
                          <ellipse cx="24" cy="52" rx="14" ry="3" fill="#000" opacity="0.25" />
                          <rect x="14" y="36" width="20" height="14" rx="3" fill="#1f2937" />
                          <rect x="10" y="22" width="28" height="20" rx="6" fill={shirt} stroke="#000" strokeOpacity="0.35" strokeWidth="1.5" />
                          <circle cx="24" cy="14" r="9" fill="#f0c987" stroke="#000" strokeOpacity="0.35" strokeWidth="1.5" />
                          {g === "male" ? (
                            <ellipse cx="24" cy="8" rx="9" ry="4" fill="#3a2418" />
                          ) : (
                            <>
                              <path d="M14 12 Q14 4 24 4 Q34 4 34 12 L34 22 Q30 18 24 18 Q18 18 14 22 Z" fill="#5b2a86" />
                              <circle cx="24" cy="14" r="9" fill="#f0c987" />
                            </>
                          )}
                          <circle cx="21" cy="14" r="1.2" fill="#111" />
                          <circle cx="27" cy="14" r="1.2" fill="#111" />
                        </svg>
                        <span className="text-sm font-medium capitalize">{g}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <Label>Accent color</Label>
                <div className="mt-2 grid grid-cols-6 gap-2">
                  {AVATAR_COLORS.map((a) => (
                    <button type="button" key={a.id} onClick={() => setAvatarId(a.id)}
                      className={`aspect-square rounded-xl border-2 transition ${avatarId === a.id ? "border-primary scale-110" : "border-border opacity-70 hover:opacity-100"}`}
                      style={{ background: `#${a.body.toString(16).padStart(6, "0")}` }}
                      aria-label={a.name}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          </div>
          <Button type="submit" disabled={loading} className="w-full rounded-full" style={{ background: "var(--gradient-warm)", color: "var(--primary-foreground)" }}>
            {loading ? "…" : mode === "signup" ? "Create character" : "Sign in"}
          </Button>
        </form>

        <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" />
        </div>
        <Button variant="outline" className="w-full rounded-full" onClick={handleGoogle} disabled={loading}>
          Continue with Google
        </Button>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          {mode === "signup" ? "Already have an account?" : "New here?"}{" "}
          <button onClick={() => setMode(mode === "signup" ? "signin" : "signup")} className="text-primary hover:underline">
            {mode === "signup" ? "Sign in" : "Create one"}
          </button>
        </p>
      </div>
    </main>
  );
}
