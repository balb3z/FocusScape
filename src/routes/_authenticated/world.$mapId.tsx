import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const PhaserGame = lazy(() => import("@/components/game/PhaserGame"));

export const Route = createFileRoute("/_authenticated/world/$mapId")({
  component: WorldPage,
});

function WorldPage() {
  const { mapId } = useParams({ from: "/_authenticated/world/$mapId" });
  const navigate = useNavigate();
  return (
    <div className="relative h-screen w-screen overflow-hidden bg-background">
      <Suspense fallback={<div className="flex h-full items-center justify-center text-muted-foreground">Loading world…</div>}>
        <PhaserGame mapId={mapId} onLeave={() => navigate({ to: "/lobby" })} />
      </Suspense>
    </div>
  );
}