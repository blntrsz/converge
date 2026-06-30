/**
 * This file is the entry point for the React app, it sets up the root
 * element and renders the App component to the DOM.
 *
 * It is included in `src/index.html`.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ProjectionRegistryProvider } from "../../../packages/converge/src/projection/index.ts";
import { App } from "./App";

const elem = document.getElementById("root")!;
const app = (
  <StrictMode>
    <ProjectionRegistryProvider>
      <App />
    </ProjectionRegistryProvider>
  </StrictMode>
);

// https://bun.com/docs/bundler/hot-reloading#import-meta-hot-data
(import.meta.hot.data.root ??= createRoot(elem)).render(app);
