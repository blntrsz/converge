import { IndexedDb, IndexedDbDatabase, IndexedDbTable, IndexedDbVersion } from "@effect/platform-browser";
import { Effect, Layer, Option, Queue, Ref, Result, Semaphore, Schema } from "effect";
import { EventInstance } from "../../event/event-instance.ts";
import { EventRouterService } from "../../event/event-router.ts";
import { ProjectionBootstrapClient } from "../../projection-bootstrap/services/projection-bootstrap-client.ts";
import { ReplicaProjectionBootstrap } from "../../projection-bootstrap/services/projection-bootstrap.ts";
import { PrimarySyncEngine } from "../../primary-sync-engine/services/primary-sync-engine.ts";
import { ReplicaApplyContext } from "../services/apply-context.ts";
import { OptimisticEventApplier } from "../services/optimistic-event-applier.ts";
import { ReplicaSyncEngine, type IReplicaSyncEngine } from "../services/replica-sync-engine.ts";
import { SyncMode, SyncState, type SyncStateSnapshot } from "../services/sync-state.ts";

const EventHistoryRow = Schema.Struct({
  id: IndexedDb.AutoIncrement,
  eventId: Schema.String,
  eventType: Schema.String,
  eventDetails: Schema.Json,
});

type EventHistoryRow = typeof EventHistoryRow.Type;
type EventHistoryInsert = Omit<EventHistoryRow, "id">;

const ProposedEventRow = Schema.Struct({
  id: IndexedDb.AutoIncrement,
  eventId: Schema.String,
  eventType: Schema.String,
  eventDetails: Schema.Json,
});

type ProposedEventRow = typeof ProposedEventRow.Type;
type ProposedEventInsert = Omit<ProposedEventRow, "id">;

const PendingTaskKind = Schema.Literals(["forward", "reconcile", "bootstrap"]);

const PendingTaskRow = Schema.Struct({
  id: IndexedDb.AutoIncrement,
  kind: PendingTaskKind,
  syncAnchor: Schema.optional(Schema.String),
});

type PendingTaskRow = typeof PendingTaskRow.Type;

type Task =
  | { readonly kind: "forward"; readonly taskId: number }
  | { readonly kind: "reconcile"; readonly taskId: number }
  | { readonly kind: "bootstrap"; readonly taskId: number; readonly syncAnchor?: string };

const SyncMetaRow = Schema.Struct({
  id: Schema.Literal(1),
  mode: Schema.Literals(["latest", "checkout"]),
  syncAnchor: Schema.String,
  bootstrapped: Schema.Boolean,
});

type SyncMetaRow = typeof SyncMetaRow.Type;

export const EventHistoryTable = IndexedDbTable.make({
  name: "event_history",
  schema: EventHistoryRow,
  keyPath: "id",
  autoIncrement: true,
  indexes: { eventId: "eventId" },
  durability: "strict",
});

export const ProposedEventsTable = IndexedDbTable.make({
  name: "proposed_events",
  schema: ProposedEventRow,
  keyPath: "id",
  autoIncrement: true,
  indexes: { eventId: "eventId" },
  durability: "strict",
});

export const PendingTasksTable = IndexedDbTable.make({
  name: "pending_tasks",
  schema: PendingTaskRow,
  keyPath: "id",
  autoIncrement: true,
  durability: "strict",
});

const SyncMetaTable = IndexedDbTable.make({
  name: "sync_meta",
  schema: SyncMetaRow,
  keyPath: "id",
  durability: "strict",
});

const ReplicaSyncEngineVersion = IndexedDbVersion.make(
  EventHistoryTable,
  ProposedEventsTable,
  PendingTasksTable,
  SyncMetaTable,
);

export class ReplicaSyncEngineDatabase extends IndexedDbDatabase.make(
  ReplicaSyncEngineVersion,
  Effect.fn(function* (api) {
    yield* api.createObjectStore("event_history");
    yield* api.createIndex("event_history", "eventId", { unique: true });
    yield* api.createObjectStore("proposed_events");
    yield* api.createIndex("proposed_events", "eventId", { unique: true });
    yield* api.createObjectStore("pending_tasks");
    yield* api.createObjectStore("sync_meta");
  }),
) {}

export const databaseLayer = (databaseName = "converge-replica-sync-engine") =>
  ReplicaSyncEngineDatabase.layer(databaseName);

const defaultSyncState: SyncStateSnapshot = {
  mode: SyncMode.Latest(),
  bootstrapped: false,
};

const snapshotFromRow = (row: SyncMetaRow): SyncStateSnapshot => ({
  mode:
    row.mode === "checkout"
      ? SyncMode.Checkout({ syncAnchor: row.syncAnchor })
      : SyncMode.Latest(),
  bootstrapped: row.bootstrapped,
});

const rowFromSnapshot = (snapshot: SyncStateSnapshot): SyncMetaRow => ({
  id: 1 as const,
  mode: snapshot.mode._tag === "Checkout" ? "checkout" : "latest",
  syncAnchor: snapshot.mode._tag === "Checkout" ? snapshot.mode.syncAnchor : "",
  bootstrapped: snapshot.bootstrapped,
});

const eventFromRow = (row: EventHistoryRow) =>
  new EventInstance({
    eventId: row.eventId,
    eventType: row.eventType,
    eventDetails: row.eventDetails,
  });

const eventFromProposedRow = (row: ProposedEventRow) =>
  new EventInstance({
    eventId: row.eventId,
    eventType: row.eventType,
    eventDetails: row.eventDetails,
  });

export const syncStateLayer: Layer.Layer<SyncState, never, IndexedDbDatabase.IndexedDbDatabase> =
  Layer.effect(
    SyncState,
    Effect.gen(function* () {
      const api = yield* ReplicaSyncEngineDatabase.getQueryBuilder;
      const syncMeta = api.from("sync_meta");

      const loadSyncState = Effect.gen(function* () {
        const rows = yield* syncMeta.select().equals(1).limit(1).pipe(Effect.orDie);
        const row = rows[0] as SyncMetaRow | undefined;
        return row ? snapshotFromRow(row) : defaultSyncState;
      });

      const saveSyncState = (snapshot: SyncStateSnapshot) =>
        syncMeta.upsert(rowFromSnapshot(snapshot) as never).pipe(Effect.asVoid, Effect.orDie);

      const ref = yield* Ref.make(yield* loadSyncState);

      return SyncState.of({
        current: Ref.get(ref),
        set: (snapshot) => Ref.set(ref, snapshot).pipe(Effect.tap(() => saveSyncState(snapshot))),
      });
    }),
  );

const engineLayer: Layer.Layer<
  ReplicaSyncEngine,
  never,
  | PrimarySyncEngine
  | EventRouterService
  | ReplicaApplyContext
  | ProjectionBootstrapClient
  | ReplicaProjectionBootstrap
  | OptimisticEventApplier
  | SyncState
  | IndexedDbDatabase.IndexedDbDatabase
> = Layer.effect(
  ReplicaSyncEngine,
  Effect.gen(function* () {
    const primary = yield* PrimarySyncEngine;
    const eventRouter = yield* EventRouterService;
    const applyContext = yield* ReplicaApplyContext;
    const bootstrapClient = yield* ProjectionBootstrapClient;
    const replicaBootstrap = yield* ReplicaProjectionBootstrap;
    const optimistic = yield* OptimisticEventApplier;
    const syncState = yield* SyncState;
    const api = yield* ReplicaSyncEngineDatabase.getQueryBuilder;
    const eventHistory = api.from("event_history");
    const proposedEvents = api.from("proposed_events");
    const pendingTasks = api.from("pending_tasks");
    const acceptLock = yield* Semaphore.make(1);

    const findAcceptedEvent = (eventId: string) =>
      eventHistory
        .select("eventId")
        .equals(eventId)
        .limit(1)
        .pipe(
          Effect.map((rows) => Option.fromUndefinedOr(rows[0]).pipe(Option.map(eventFromRow))),
          Effect.orDie,
        );

    const findProposedEvent = (eventId: string) =>
      proposedEvents
        .select("eventId")
        .equals(eventId)
        .limit(1)
        .pipe(
          Effect.map((rows) => Option.fromUndefinedOr(rows[0] as ProposedEventRow | undefined)),
          Effect.orDie,
        );

    const appendAcceptedEvent = (event: EventInstance) =>
      eventHistory
        .insert({
          eventId: event.eventId,
          eventType: event.eventType,
          eventDetails: event.eventDetails as EventHistoryInsert["eventDetails"],
        } as never)
        .pipe(Effect.asVoid, Effect.orDie);

    const seedAnchorEvent = (event: EventInstance) =>
      Effect.gen(function* () {
        const existing = yield* findAcceptedEvent(event.eventId);
        if (Option.isNone(existing)) {
          yield* appendAcceptedEvent(event);
        }
      });

    const deleteProposedEvent = (eventId: string) =>
      Effect.gen(function* () {
        const rows = yield* proposedEvents.select("eventId").equals(eventId).pipe(Effect.orDie);
        const row = rows[0] as ProposedEventRow | undefined;
        if (row) {
          yield* proposedEvents.delete().equals(row.id as never).pipe(Effect.asVoid, Effect.orDie);
        }
      });

    const scanAllProposedEvents = () =>
      proposedEvents
        .select()
        .pipe(
          Effect.map((rows) => (rows as ReadonlyArray<ProposedEventRow>).map(eventFromProposedRow)),
          Effect.orDie,
        );

    const runAcceptedHandler = (event: EventInstance) =>
      Effect.gen(function* () {
        const handler = eventRouter.find(event.eventType);
        if (!handler) {
          return;
        }

        yield* applyContext.set({ phase: "accepted", eventId: event.eventId });
        yield* handler
          .run(event)
          .pipe(Effect.ensuring(applyContext.set({ phase: "accepted", eventId: "" })));
      }).pipe(Effect.orDie);

    const applyLocally = (event: EventInstance) =>
      acceptLock.withPermits(1)(
        Effect.gen(function* () {
          const existing = yield* findAcceptedEvent(event.eventId);
          if (Option.isSome(existing)) {
            return;
          }

          const proposed = yield* findProposedEvent(event.eventId);
          yield* runAcceptedHandler(event);
          yield* optimistic.remove(event.eventId);
          yield* appendAcceptedEvent(event);
          if (Option.isSome(proposed)) {
            yield* deleteProposedEvent(event.eventId);
          }
        }),
      ).pipe(Effect.orDie);

    const proposeOptimistically = (event: EventInstance) =>
      acceptLock.withPermits(1)(
        Effect.gen(function* () {
          const state = yield* syncState.current;
          if (state.mode._tag === "Checkout") {
            return;
          }

          const accepted = yield* findAcceptedEvent(event.eventId);
          if (Option.isSome(accepted)) {
            return;
          }

          const proposed = yield* findProposedEvent(event.eventId);
          if (Option.isSome(proposed)) {
            return;
          }

          yield* proposedEvents
            .insert({
              eventId: event.eventId,
              eventType: event.eventType,
              eventDetails: event.eventDetails as ProposedEventInsert["eventDetails"],
            } as never)
            .pipe(Effect.asVoid, Effect.orDie);
          yield* optimistic.apply(event);
        }),
      ).pipe(Effect.orDie);

    const bootstrapProjections = (syncAnchor?: string, mode?: SyncMode) =>
      Effect.gen(function* () {
        const keys = yield* replicaBootstrap.listKeys;
        if (keys.length === 0) {
          yield* syncState.set({
            mode: mode ?? SyncMode.Latest(),
            bootstrapped: true,
          });
          return;
        }

        let anchor = syncAnchor;
        let anchorEvent: EventInstance | undefined;
        let resolvedAnchor = "";

        for (const key of keys) {
          const result = yield* bootstrapClient.fetch(key, anchor);
          resolvedAnchor = result.syncAnchor;
          anchor = result.syncAnchor;
          anchorEvent = result.anchorEvent;
          yield* replicaBootstrap.importProjection({
            projectionKey: result.projectionKey,
            syncAnchor: result.syncAnchor,
            snapshot: result.snapshot,
          });
        }

        if (anchorEvent) {
          yield* seedAnchorEvent(anchorEvent);
        }

        yield* syncState.set({
          mode:
            mode ??
            (syncAnchor !== undefined
              ? SyncMode.Checkout({ syncAnchor: resolvedAnchor })
              : SyncMode.Latest()),
          bootstrapped: true,
        });
        yield* optimistic.clear();
      });

    const insertPendingTask = (row: Record<string, unknown>) =>
      pendingTasks.insert(row as never).pipe(
        Effect.map((key) => Number(key)),
        Effect.orDie,
      );

    const deletePendingTask = (taskId: number) =>
      pendingTasks.delete().equals(taskId as never).pipe(Effect.asVoid, Effect.orDie);

    const scanAllPendingTasks = () =>
      pendingTasks
        .select()
        .pipe(
          Effect.map((rows) => rows as ReadonlyArray<PendingTaskRow>),
          Effect.orDie,
        );

    const lastEventId = () =>
      eventHistory
        .select()
        .reverse()
        .limit(1)
        .pipe(
          Effect.map((rows) =>
            Option.fromUndefinedOr(rows[0]).pipe(
              Option.map((row) => (row as EventHistoryRow).eventId),
            ),
          ),
          Effect.orDie,
        );

    const taskFromRow = (row: PendingTaskRow): Task =>
      row.kind === "forward"
        ? { kind: "forward", taskId: row.id }
        : row.kind === "reconcile"
          ? { kind: "reconcile", taskId: row.id }
          : { kind: "bootstrap", taskId: row.id, syncAnchor: row.syncAnchor };

    const flushProposedEvents = Effect.gen(function* () {
      const state = yield* syncState.current;
      if (state.mode._tag === "Checkout") {
        return;
      }

      const events = yield* scanAllProposedEvents();
      if (events.length === 0) {
        return;
      }

      const results = yield* primary.push(...events);
      for (const [index, result] of results.entries()) {
        const event = events[index];
        if (!event) {
          continue;
        }
        if (Result.isFailure(result)) {
          yield* acceptLock.withPermits(1)(
            Effect.gen(function* () {
              yield* Effect.logWarning(
                `ReplicaSyncEngine: primary rejected event ${event.eventId}`,
              );
              yield* deleteProposedEvent(event.eventId);
              yield* optimistic.remove(event.eventId);
            }),
          );
        } else {
          yield* applyLocally(event);
        }
      }
    });

    const pullRemoteEvents = Effect.gen(function* () {
      const state = yield* syncState.current;
      if (state.mode._tag === "Checkout") {
        return;
      }

      let cursorOption = yield* lastEventId();
      while (true) {
        const page = yield* primary.pull(Option.getOrUndefined(cursorOption));
        for (const event of page.data) {
          yield* applyLocally(event);
        }
        if (page.hasNext) {
          cursorOption = Option.some(page.cursor);
        } else {
          break;
        }
      }
    });

    const process = (task: Task) =>
      Effect.gen(function* () {
        if (task.kind === "bootstrap") {
          yield* bootstrapProjections(
            task.syncAnchor,
            task.syncAnchor !== undefined
              ? SyncMode.Checkout({ syncAnchor: task.syncAnchor })
              : SyncMode.Latest(),
          );
        } else {
          yield* flushProposedEvents;
          if (task.kind === "reconcile") {
            const state = yield* syncState.current;
            if (!state.bootstrapped) {
              yield* bootstrapProjections(
                state.mode._tag === "Checkout" ? state.mode.syncAnchor : undefined,
                state.mode,
              );
            }
            yield* pullRemoteEvents;
          }
        }
        yield* deletePendingTask(task.taskId);
      });

    const queue = yield* Queue.unbounded<Task>();

    const recoverPendingTasks = Effect.gen(function* () {
      const rows = yield* scanAllPendingTasks();
      for (const row of rows) {
        yield* Queue.offer(queue, taskFromRow(row));
      }
    });

    yield* recoverPendingTasks;

    yield* Effect.forkDetach(
      Effect.gen(function* () {
        while (true) {
          const task = yield* Queue.take(queue);
          yield* process(task).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning(`ReplicaSyncEngine: consumer task failed — ${cause}`),
            ),
          );
        }
      }),
    );

    const push: IReplicaSyncEngine["push"] = Effect.fn("ReplicaSyncEngine.push")(
      function* (...events) {
        for (const event of events) {
          yield* proposeOptimistically(event);
        }
        if (events.length > 0) {
          const taskId = yield* insertPendingTask({ kind: "forward" });
          yield* Queue.offer(queue, { kind: "forward", taskId });
        }
      },
    );

    const poke: IReplicaSyncEngine["poke"] = Effect.fn("ReplicaSyncEngine.poke")(
      function* () {
        const state = yield* syncState.current;
        if (state.mode._tag === "Checkout") {
          return;
        }

        const taskId = yield* insertPendingTask({ kind: "reconcile" });
        yield* Queue.offer(queue, { kind: "reconcile", taskId });
      },
    );

    const checkout: IReplicaSyncEngine["checkout"] = Effect.fn("ReplicaSyncEngine.checkout")(
      function* (syncAnchor) {
        yield* syncState.set({
          mode: SyncMode.Checkout({ syncAnchor }),
          bootstrapped: false,
        });
        const taskId = yield* insertPendingTask({ kind: "bootstrap", syncAnchor });
        yield* Queue.offer(queue, { kind: "bootstrap", taskId, syncAnchor });
      },
    );

    const setLatest: IReplicaSyncEngine["setLatest"] = Effect.fn("ReplicaSyncEngine.setLatest")(
      function* () {
        yield* syncState.set({
          mode: SyncMode.Latest(),
          bootstrapped: false,
        });
        const taskId = yield* insertPendingTask({ kind: "bootstrap" });
        yield* Queue.offer(queue, { kind: "bootstrap", taskId });
      },
    );

    return ReplicaSyncEngine.of({ push, poke, checkout, setLatest });
  }),
);

/**
 * @since 0.0.0
 * @category layer
 */
export const layer = engineLayer.pipe(Layer.provideMerge(syncStateLayer));
