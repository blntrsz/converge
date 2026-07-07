/**
 * This file is the entry point for the React app, it sets up the root
 * element and renders the App component to the DOM.
 *
 * It is included in `src/index.html`.
 */

import { StrictMode } from "react";
import { RegistryProvider } from "@effect/atom-react";
import * as Atom from "effect/unstable/reactivity/Atom";
import { createRoot } from "react-dom/client";
import "./index.css";
import { TodoApp } from "./features/todo/todo-app";
import { replicaAtomRuntime, ReplicaTodoLayer } from "./features/todo/replica";

const elem = document.getElementById("root")!;

// https://bun.com/docs/bundler/hot-reloading#import-meta-hot-data
const root = (import.meta.hot.data.root ??= createRoot(elem));

root.render(
  <StrictMode>
    <RegistryProvider
      initialValues={[Atom.initialValue(replicaAtomRuntime.layer, ReplicaTodoLayer)]}
    >
      <TodoApp />
    </RegistryProvider>
  </StrictMode>,
);
