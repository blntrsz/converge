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
import { getTodoProjection } from "./todo-replica";

const elem = document.getElementById("root")!;

// https://bun.com/docs/bundler/hot-reloading#import-meta-hot-data
const root = (import.meta.hot.data.root ??= createRoot(elem));
const todoProjection = await getTodoProjection();

root.render(
  <StrictMode>
    <ProjectionRegistryProvider>
      <App todoProjection={todoProjection} />
    </ProjectionRegistryProvider>
  </StrictMode>,
);
