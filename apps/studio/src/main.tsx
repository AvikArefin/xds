import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import RenderPage from "./render/RenderPage";

const App = lazy(() => import("./App"));

const root = createRoot(document.getElementById("root")!);

if (window.location.pathname.replace(/\/+$/, "") === "/render") {
  // The headless render page: no StrictMode (no double effects while measuring), no chrome.
  root.render(<RenderPage />);
} else {
  root.render(
    <StrictMode>
      <Suspense fallback={null}>
        <App />
      </Suspense>
    </StrictMode>,
  );
}
