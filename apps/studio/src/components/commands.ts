/**
 * Commands that change project files on the server (designs/add, models/import, fonts/fetch).
 * They need a saved document: save first, run, then reload from disk.
 */
import { api } from "../api";
import { useStudio } from "../store";

export async function serverCommand<T>(what: string, run: () => Promise<T>): Promise<T | null> {
  const st = useStudio.getState();
  if (st.readOnly) {
    st.notify("warning", "Read-only project.");
    return null;
  }
  if (!(await st.saveThen(what))) return null;
  try {
    const r = await run();
    await useStudio.getState().load("refresh");
    return r;
  } catch (e) {
    useStudio.getState().notify("error", `${what} failed: ${(e as Error).message}`);
    return null;
  }
}

export async function addStarterBackground(starter: string) {
  const r = await serverCommand("Adding a background design", () => api.addDesign(starter));
  if (!r) return;
  const st = useStudio.getState();
  if (st.mode !== "ground") st.setMode("ground");
  useStudio.getState().addBackground(r.id);
}

export async function importModel(file: File) {
  const st = useStudio.getState();
  const base = file.name.replace(/\.[^.]+$/, "");
  const id = await st.ask({
    title: "Add model",
    message: `${file.name} is converted to .glb, checked against the model conventions and placed on this slide.`,
    label: "Object id",
    value: base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "model",
    confirm: "Add model",
  });
  if (!id) return;
  const slide = st.activeSlideId;
  const r = await serverCommand("Adding a model", () => api.importModel(file, id, { name: base, slide }));
  if (!r) return;
  const warnings = r.result?.warnings ?? [];
  if (warnings.length) useStudio.getState().notify("warning", `Model added with warnings: ${warnings.join("; ")}`);
  else useStudio.getState().notify("success", `Added model “${id}”.`);
  const s = useStudio.getState();
  if (s.mode !== "render") s.setMode("render");
  const node = (s.project?.slides.find((x) => x.id === slide)?.nodes ?? []).find(
    (n) => n.layer === "render" && n.data.object === id,
  );
  if (node) useStudio.getState().select([node.id]);
}

export async function fetchFont() {
  const st = useStudio.getState();
  const family = await st.ask({
    title: "Fetch from Fontshare",
    message: "Downloads the family into fonts/ and registers its files.",
    label: "Family name (e.g. Satoshi, General Sans)",
    confirm: "Fetch",
  });
  if (!family?.trim()) return;
  const r = await serverCommand("Fetching a font", () => api.fetchFonts(family.trim()));
  if (r) useStudio.getState().notify("success", `Fetched ${r.fonts.length} font file(s) for ${family}.`);
}
