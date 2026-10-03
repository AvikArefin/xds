/** Keyboard shortcuts (human-interaction.md §3). Ignored while typing in a field. */
import { useEffect } from "react";
import { useStudio, type Mode } from "../store";

const MODE_KEYS: Record<string, Mode> = { "1": "present", "2": "type", "3": "image", "4": "render", "5": "ground" };

export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || el.isContentEditable) return true;
  if (tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (el as HTMLInputElement).type;
    return !["checkbox", "radio", "range", "button", "color"].includes(type);
  }
  return false;
}

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useStudio.getState();
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      // Save works everywhere (also while typing: commit the field first).
      if (mod && key === "s") {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur?.();
        setTimeout(() => void useStudio.getState().save());
        return;
      }
      if (mod && key === "k") {
        e.preventDefault();
        st.setPalette(!st.commandPaletteOpen);
        return;
      }
      if (mod && key === "o") {
        e.preventDefault();
        st.setProjectBrowser("open");
        return;
      }
      if (isTyping(e.target)) return;
      if (st.prompt || st.projectBrowser || st.commandPaletteOpen || st.exportBlocked) {
        return; // dialogs handle their own keys
      }

      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
        return;
      }
      if (mod && key === "y") {
        e.preventDefault();
        st.redo();
        return;
      }
      if (mod && key === "a") {
        e.preventDefault();
        st.selectAll();
        return;
      }
      if (mod && key === "d") {
        e.preventDefault();
        st.duplicateSelection();
        return;
      }
      if (mod || e.altKey) return;

      if (MODE_KEYS[e.key]) {
        e.preventDefault();
        st.setMode(MODE_KEYS[e.key]);
        return;
      }
      switch (e.key) {
        case "Escape":
          st.clearSelection();
          return;
        case "Delete":
        case "Backspace":
          if (st.selectedIds.length) {
            e.preventDefault();
            st.deleteSelection();
          }
          return;
        case "ArrowLeft":
        case "ArrowRight":
        case "ArrowUp":
        case "ArrowDown": {
          if (!st.selectedIds.length) return;
          e.preventDefault();
          const dx = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
          const dy = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
          // A run of key repeats is one undo step.
          if (!e.repeat) st.endGesture();
          st.beginGesture();
          st.nudge(dx, dy, e.shiftKey);
          return;
        }
      }
      if (key === "a" && !e.shiftKey) {
        e.preventDefault();
        void st.runAudit();
      } else if (key === "g") {
        e.preventDefault();
        st.toggleGuides();
      } else if (st.mode === "render" && !e.shiftKey) {
        if (key === "w") st.setTransformMode("translate");
        else if (key === "e") st.setTransformMode("rotate");
        else if (key === "r") st.setTransformMode("scale");
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key.startsWith("Arrow")) useStudio.getState().endGesture();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);
}
