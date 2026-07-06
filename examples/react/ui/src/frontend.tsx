/**
 * This file is the entry point for the React app, it sets up the root
 * element and renders the App component to the DOM.
 *
 * It is included in `src/index.html`.
 */

import { StrictMode } from "react";
import { RegistryProvider } from "@effect/atom-react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { TodoApp } from "./features/todos/TodoApp";
import { getTodoProjection } from "./features/todos/replica";

const elem = document.getElementById("root")!;

// https://bun.com/docs/bundler/hot-reloading#import-meta-hot-data
const root = (import.meta.hot.data.root ??= createRoot(elem));
const todoProjection = await getTodoProjection();

root.render(
  <StrictMode>
    <RegistryProvider>
      <TodoApp todoProjection={todoProjection} />
    </RegistryProvider>
  </StrictMode>,
);
