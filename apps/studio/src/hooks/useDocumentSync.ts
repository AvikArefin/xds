import { useEffect } from "react";
import { api } from "../api";
import { isDirty, useStudio } from "../store";

/** Load the project, keep the SSE connection, and prompt before closing with unsaved edits. */
export function useDocumentSync() {
  useEffect(() => {
    const st = useStudio.getState();
    void st.load("initial");
    const off = st.connect();
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty(useStudio.getState())) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      off();
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);
}

/**
 * The guide comes with the project from the server; when the format changes in the editor (or an
 * undo changes it back) fetch the guide for the new size.
 */
export function useGuideSync() {
  const format = useStudio((s) => s.project?.format);
  useEffect(() => {
    if (!format) return;
    const g = useStudio.getState().guide;
    if (g && g.width === format.width && g.height === format.height && (g.preset === format.preset || (!format.preset && g.preset === "generic-screen")))
      return;
    let cancelled = false;
    api
      .formats({ preset: format.preset, width: format.width, height: format.height })
      .then((r) => {
        if (!cancelled && r.guide) useStudio.setState({ guide: r.guide });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [format]);
}
