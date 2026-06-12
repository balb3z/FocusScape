import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CharacterSetup } from "@/components/game/CharacterSetup";
import type { User } from "@supabase/supabase-js";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { user } = Route.useRouteContext() as { user: User };
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [defaultUsername, setDefaultUsername] = useState("");

  useEffect(() => {
    (async () => {
      // Check if this user has already configured their character
      const { data: profile } = await supabase
        .from("profiles")
        .select("gender, character_config, username")
        .eq("id", user.id)
        .maybeSingle();

      // A Google/OAuth user needs setup if character_config is null
      // (they came through OAuth and haven't picked a character yet)
      const isOAuthUser =
        user.app_metadata?.provider === "google" ||
        (user.identities ?? []).some((i: { provider: string }) => i.provider === "google");

      const hasCharacterConfig =
        profile?.character_config !== null && profile?.character_config !== undefined;

      if (isOAuthUser && !hasCharacterConfig) {
        const name =
          profile?.username ||
          user.user_metadata?.full_name?.split(" ")[0] ||
          user.user_metadata?.name?.split(" ")[0] ||
          user.email?.split("@")[0] ||
          "explorer";
        setDefaultUsername(name);
        setNeedsSetup(true);
      } else {
        setNeedsSetup(false);
      }
    })();
  }, [user]);

  if (needsSetup === null) {
    // Loading — minimal flash
    return (
      <div
        className="fixed inset-0 flex items-center justify-center"
        style={{ background: "#0d0d1a" }}
      >
        <div className="text-white/30 text-sm animate-pulse">Loading…</div>
      </div>
    );
  }

  if (needsSetup) {
    return (
      <CharacterSetup
        userId={user.id}
        defaultUsername={defaultUsername}
        onComplete={() => setNeedsSetup(false)}
      />
    );
  }

  return <Outlet />;
}
