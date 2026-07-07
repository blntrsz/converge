import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { assert, describe, it } from "vitest";
import { Effect, Layer, Option, Result, Schema } from "effect";
import { render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { IndexedDb } from "@effect/platform-browser";
import { Event, EventHandler, EventInstance } from "../../src/event/index.ts";
import { PrimarySyncEngine } from "../../src/primary-sync-engine/index.ts";
import * as Atom from "effect/unstable/reactivity/Atom";
import { EventStoreProvider, indexeddbProjection, useEventStore } from "../../src/react/index.ts";

const todoCreated = Event.make("todo.created.v1", {
  id: Schema.String,
  title: Schema.String,
  createdAt: Schema.Number,
});

const TodoSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  completed: Schema.Boolean,
  createdAt: Schema.Number,
});

const TodoListSchema = Schema.Array(TodoSchema);

type Todo = Schema.Schema.Type<typeof TodoSchema>;

const todoProjection = indexeddbProjection({
  key: "todos",
  schema: TodoListSchema,
  initialValue: [] as ReadonlyArray<Todo>,
  databaseName: `react-event-store-${Date.now()}`,
});

const todoCreatedHandler = EventHandler.make(
  todoCreated,
  Effect.fn(function* (event) {
    const store = yield* todoProjection.store;

    yield* store.update((todos) => [
      [
        ...todos,
        {
          id: event.eventDetails.id,
          title: event.eventDetails.title,
          completed: false,
          createdAt: event.eventDetails.createdAt,
        },
      ],
      undefined,
    ] as const);
  }),
);

const FakeIndexedDbLayer = Layer.succeed(
  IndexedDb.IndexedDb,
  IndexedDb.make({ indexedDB, IDBKeyRange }),
);

const MockPrimarySyncEngineLayer = Layer.succeed(
  PrimarySyncEngine.PrimarySyncEngine,
  PrimarySyncEngine.PrimarySyncEngine.of({
    pull: () => Effect.succeed({ data: [], hasNext: false as const }),
    push: (...events) =>
      Effect.succeed(
        events.map((event) => Result.succeed(event) as Result.Result<typeof event, typeof event>),
      ),
    getLatestEvent: () => Effect.succeed(Option.none()),
    getEvent: () => Effect.succeed(Option.none()),
  }),
);

const eventStoreConfig = {
  syncUrl: "/api/sync",
  handlers: [todoCreatedHandler],
  projections: [todoProjection],
  replicaDatabaseName: `react-event-store-replica-${Date.now()}`,
  primarySyncEngineLayer: MockPrimarySyncEngineLayer,
  indexedDbLayer: FakeIndexedDbLayer,
} as const;

const TestTodoList = () => {
  const { commit } = useEventStore();
  const commitEvent = useAtomSet(commit, { mode: "promise" });
  const todos = useAtomValue(todoProjection.atom);

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          void EventInstance.make(todoCreated, {
            id: "todo-1",
            title: "Buy milk",
            createdAt: 1,
          }).pipe(
            Effect.flatMap((event) => Effect.promise(() => commitEvent(event))),
            Effect.runPromise,
          );
        }}
      >
        Add
      </button>
      <ul>
        {todos.map((todo) => (
          <li key={todo.id}>{todo.title}</li>
        ))}
      </ul>
    </div>
  );
};

const CommitProbe = ({ onCommit }: { readonly onCommit: (commit: unknown) => void }) => {
  const { commit } = useEventStore();

  useEffect(() => {
    onCommit(commit);
  }, [commit, onCommit]);

  return null;
};

describe("useEventStore", () => {
  it("exposes commit as a writable atom", async () => {
    let commit: unknown;

    render(
      <EventStoreProvider config={eventStoreConfig}>
        <CommitProbe onCommit={(value) => {
          commit = value;
        }} />
      </EventStoreProvider>,
    );

    await waitFor(() => {
      assert.ok(commit);
      assert.ok(Atom.isWritable(commit as Atom.Writable<unknown, unknown>));
    });
  });

  it("commits events through the provider and updates projection atoms", async () => {
    render(
      <EventStoreProvider config={eventStoreConfig}>
        <TestTodoList />
      </EventStoreProvider>,
    );

    await screen.findByRole("button", { name: "Add" });
    screen.getByRole("button", { name: "Add" }).click();

    await waitFor(() => {
      assert.ok(screen.getByText("Buy milk"));
    });

    assert.strictEqual(screen.getAllByRole("listitem").length, 1);
  });
});
