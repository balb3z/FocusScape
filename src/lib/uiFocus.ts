/**
 * Tiny global registry of "UI is taking input" state.
 * Any modal / popover / panel mounted in the React tree calls useUiBlock()
 * to increment the counter. PhaserGame checks isUiBlocked() inside update()
 * and pointerdown handlers so the world stops reacting to clicks/keys while
 * a panel is open. We also explicitly skip movement when an <input>,
 * <textarea>, or contentEditable element holds focus — that handles in-game
 * chat input even when no panel is registered.
 */
import { useEffect } from "react";

let count = 0;
const listeners = new Set<(n: number) => void>();

export function pushUiBlock(): () => void {
  count++;
  listeners.forEach((l) => l(count));
  let released = false;
  return () => {
    if (released) return;
    released = true;
    count = Math.max(0, count - 1);
    listeners.forEach((l) => l(count));
  };
}

export function isUiBlocked(): boolean {
  if (count > 0) return true;
  const ae = typeof document !== "undefined" ? document.activeElement : null;
  if (!ae) return false;
  const tag = (ae.tagName || "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if ((ae as HTMLElement).isContentEditable) return true;
  return false;
}

export function useUiBlock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const release = pushUiBlock();
    return release;
  }, [active]);
}
