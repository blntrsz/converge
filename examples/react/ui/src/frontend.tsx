/**
 * This file is the entry point for the React app, it sets up the root
 * element and renders the App component to the DOM.
 *
 * It is included in `src/index.html`.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { EventStoreProvider } from "converge/react";
import "./index.css";
import { TodoApp } from "./features/todo/TodoApp";
import { eventStoreConfig } from "./features/todo/replica";

const elem = document.getElementById("root")!;

// https://bun.com/docs/bundler/hot-reloading#import-meta-hot-data
const root = (import.meta.hot.data.root ??= createRoot(elem));

root.render(
  <StrictMode>
    <EventStoreProvider config={eventStoreConfig}>
      <TodoApp />
    </EventStoreProvider>
  </StrictMode>,
);
