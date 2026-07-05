import {
  IndexedDb,
  IndexedDbDatabase,
  IndexedDbTable,
  IndexedDbVersion,
} from "@effect/platform-browser";
import { Effect, Layer, Option, Queue, Ref, Result, Schema, Semaphore, Stream } from "effect";
import { EventId } from "../../event/event-id.ts";
import { EventInstance } from "../../event/event-instance.ts";
import { EventRouterService } from "../../event/event-router.ts";
import { ProjectionRouter } from "../../projection/services/projection.ts";
import { PrimaryProjectionRouter } from "../../primary-sync-engine/services/primary-projection.ts";
import { PrimarySyncEngine } from "../../primary-sync-engine/services/primary-sync-engine.ts";
import { ReplicaApplyContext, type ApplyPhase } from "../services/apply-context.ts";
import {
  ReplicaSyncEngine,
  type IReplicaSyncEngine,
  type SyncMode,
} from "../services/replica-sync-engine.ts";

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

const PendingTaskKind = Schema.Literals(["forward", "reconcile"]);

const PendingTaskRow = Schema.Struct({
  id: IndexedDb.AutoIncrement,
  kind: PendingTaskKind,
});

type PendingTaskRow = typeof PendingTaskRow.Type;

type Task =
  | { readonly kind: "forward"; readonly taskId: number }
  | { readonly kind: "reconcile"; readonly taskId: number };

/**
 * @since 0.0.0
 * @category schema
 */
export const EventHistoryTable = IndexedDbTable.make({
  name: "event_history",
  schema: EventHistoryRow,
  keyPath: "id",
  autoIncrement: true,
  indexes: { eventId: "eventId" },
  durability: "strict",
});

/**
 * @since 0.0.0
 * @category schema
 */
export const ProposedEventsTable = IndexedDbTable.make({
  name: "proposed_events",
  schema: ProposedEventRow,
  keyPath: "id",
  autoIncrement: true,
  indexes: { eventId: "eventId" },
  durability: "strict",
});

/**
 * @since 0.0.0
 * @category schema
 */
export const PendingTasksTable = IndexedDbTable.make({
  name: "pending_tasks",
  schema: PendingTaskRow,
  keyPath: "id",
  autoIncrement: true,
  durability: "strict",
});

const ReplicaSyncEngineVersion = IndexedDbVersion.make(
  EventHistoryTable,
  ProposedEventsTable,
  PendingTasksTable,
);

/**
 * @since 0.0.0
 * @category database
 */
export class ReplicaSyncEngineDatabase extends IndexedDbDatabase.make(
  ReplicaSyncEngineVersion,
  Effect.fn(function* (api) {
    yield* api.createObjectStore("event_history");
    yield* api.createIndex("event_history", "eventId", { unique: true });
    yield* api.createObjectStore("proposed_events");
    yield* api.createIndex("proposed_events", "eventId", { unique: true });
    yield* api.createObjectStore("pending_tasks");
  }),
) {}

/**
 * @since 0.0.0
 * @category layer
 */
export const databaseLayer = (databaseName = "converge-replica-sync-engine") =>
  ReplicaSyncEngineDatabase.layer(databaseName);

/**
 * The replica event log retains only the latest accepted events globally
 * (ADR 0001). Older events remain on the primary.
 *
 * @since 0.0.0
 * @category constants
 */
export const ReplicaEventHistoryCap = 100;

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

/**
 * @since 0.0.0
 * @category layer
 */
export const layer: Layer.Layer<
  ReplicaSyncEngine,
  never,
  | PrimarySyncEngine
  | PrimaryProjectionRouter
  | ProjectionRouter
  | EventRouterService
  | ReplicaApplyContext
  | IndexedDbDatabase.IndexedDbDatabase
> = Layer.effect(
  ReplicaSyncEngine,
  Effect.gen(function* () {
    const primary = yield* PrimarySyncEngine;
    const primaryProjections = yield* PrimaryProjectionRouter;
    const projections = yield* ProjectionRouter;
    const eventRouter = yield* EventRouterService;
    const applyContext = yield* ReplicaApplyContext;
    const api = yield* ReplicaSyncEngineDatabase.getQueryBuilder;
    const eventHistory = api.from("event_history");
    const proposedEvents = api.from("proposed_events");
    const pendingTasks = api.from("pending_tasks");
    const acceptLock = yield* Semaphore.make(1);
    const syncMode = yield* Ref.make<SyncMode>({ _tag: "Latest" });

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
      Effect.gen(function* () {
        const row: EventHistoryInsert = {
          eventId: event.eventId,
          eventType: event.eventType,
          eventDetails: event.eventDetails as EventHistoryInsert["eventDetails"],
        };
        const key = yield* eventHistory.insert(row as never).pipe(Effect.orDie);
        yield* trimEventHistory(Number(key));
      });

    // Rows use a monotonic auto-increment key, so every id at or below
    // `latestId - cap` is outside the rolling window (ADR 0001).
    const trimEventHistory = (latestId: number) =>
      Effect.gen(function* () {
        const evictBelow = latestId - ReplicaEventHistoryCap;
        if (evictBelow <= 0) return;
        yield* eventHistory
          .delete()
          .lte(evictBelow as never)
          .pipe(Effect.asVoid, Effect.orDie);
      });

    const deleteProposedEvent = (eventId: string) =>
      Effect.gen(function* () {
        const rows = yield* proposedEvents.select("eventId").equals(eventId).pipe(Effect.orDie);
        const row = rows[0] as ProposedEventRow | undefined;
        if (row) {
          yield* proposedEvents
            .delete()
            .equals(row.id as never)
            .pipe(Effect.asVoid, Effect.orDie);
        }
      });

    const scanAllProposedEvents = () =>
      proposedEvents.select().pipe(
        Effect.map((rows) => rows as ReadonlyArray<ProposedEventRow>),
        Effect.map((rows) => rows.map(eventFromProposedRow)),
        Effect.orDie,
      );

    const findHandler = (eventType: string) => eventRouter.find(eventType);

    const runHandler = (event: EventInstance, phase: ApplyPhase) =>
      Effect.gen(function* () {
        const handler = findHandler(event.eventType);
        if (!handler) return;

        yield* applyContext.set({ phase, eventId: event.eventId });
        yield* handler
          .run(event)
          .pipe(Effect.ensuring(applyContext.set({ phase: "accepted", eventId: "" })));
      }).pipe(Effect.orDie);

    const applyLocally = (event: EventInstance) =>
      acceptLock
        .withPermits(1)(
          Effect.gen(function* () {
            const existing = yield* findAcceptedEvent(event.eventId);
            if (Option.isSome(existing)) return;

            const proposed = yield* findProposedEvent(event.eventId);
            yield* runHandler(event, "accepted");

            yield* appendAcceptedEvent(event);
            if (Option.isSome(proposed)) {
              yield* deleteProposedEvent(event.eventId);
            }
          }),
        )
        .pipe(Effect.orDie);

    const proposeAndApplyOptimistically = (event: EventInstance) =>
      acceptLock
        .withPermits(1)(
          Effect.gen(function* () {
            const accepted = yield* findAcceptedEvent(event.eventId);
            if (Option.isSome(accepted)) return;

            const proposed = yield* findProposedEvent(event.eventId);
            if (Option.isSome(proposed)) return;

            const row: ProposedEventInsert = {
              eventId: event.eventId,
              eventType: event.eventType,
              eventDetails: event.eventDetails as ProposedEventInsert["eventDetails"],
            };
            yield* proposedEvents.insert(row as never).pipe(Effect.asVoid, Effect.orDie);
            yield* runHandler(event, "optimistic");
          }),
        )
        .pipe(Effect.orDie);

    const insertPendingTask = (row: Record<string, unknown>) =>
      pendingTasks.insert(row as never).pipe(
        Effect.map((key) => Number(key)),
        Effect.orDie,
      );

    const deletePendingTask = (taskId: number) =>
      pendingTasks
        .delete()
        .equals(taskId as never)
        .pipe(Effect.asVoid, Effect.orDie);

    const scanAllPendingTasks = () =>
      pendingTasks.select().pipe(
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
        : { kind: "reconcile", taskId: row.id };

    const flushProposedEvents = Effect.gen(function* () {
      const events = yield* scanAllProposedEvents();
      if (events.length === 0) return;

      const results = yield* primary.push(...events);
      for (const [index, result] of results.entries()) {
        const event = events[index];
        if (!event) continue;
        if (Result.isFailure(result)) {
          yield* acceptLock.withPermits(1)(
            Effect.gen(function* () {
              yield* Effect.logWarning(
                `ReplicaSyncEngine: primary rejected event ${event.eventId}`,
              );
              yield* deleteProposedEvent(event.eventId);
              yield* runHandler(event, "rejected");
            }),
          );
        } else {
          yield* applyLocally(event);
        }
      }
    });

    const seedAcceptedEvent = (event: EventInstance) =>
      acceptLock.withPermits(1)(
        Effect.gen(function* () {
          const existing = yield* findAcceptedEvent(event.eventId);
          if (Option.isSome(existing)) return;

          yield* appendAcceptedEvent(event);
        }),
      );

    const replaceAcceptedEventsWith = (event: EventInstance) =>
      acceptLock.withPermits(1)(
        Effect.gen(function* () {
          yield* eventHistory.clear.pipe(Effect.asVoid, Effect.orDie);
          yield* appendAcceptedEvent(event);
        }),
      );

    const bootstrapReplicaProjectionsAt = (
      event: EventInstance,
      options: {
        readonly replaceSyncPosition: boolean;
      },
    ) =>
      Effect.gen(function* () {
        if (projections.all.length === 0) return;

        const eventId = Schema.decodeUnknownSync(EventId)(event.eventId);
        for (const projection of projections.all) {
          const primaryProjection = primaryProjections.find(projection.key);
          if (!primaryProjection) {
            return yield* Effect.die(new Error(`Missing primary projection for ${projection.key}`));
          }

          const rows = primaryProjection
            .bootstrap({ eventId })
            .pipe(Stream.mapError((error) => error as unknown));
          yield* projection.bootstrap(rows);
        }

        if (options.replaceSyncPosition) {
          yield* replaceAcceptedEventsWith(event);
        } else {
          yield* seedAcceptedEvent(event);
        }
      });

    const bootstrapReplicaProjectionsAtHead = Effect.gen(function* () {
      if (projections.all.length === 0) return;

      const cursorOption = yield* lastEventId();
      if (Option.isSome(cursorOption)) return;

      const latestEvent = yield* primary.getLatestEvent();
      if (Option.isNone(latestEvent)) return;

      yield* bootstrapReplicaProjectionsAt(latestEvent.value, {
        replaceSyncPosition: false,
      });
    });

    const pullRemoteEvents = Effect.gen(function* () {
      yield* bootstrapReplicaProjectionsAtHead;
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
        yield* flushProposedEvents;
        if (task.kind === "reconcile") {
          yield* pullRemoteEvents;
        }
        yield* deletePendingTask(task.taskId);
      });

    const repair: IReplicaSyncEngine["repair"] = Effect.fn("ReplicaSyncEngine.repair")(
      function* () {
        if (projections.all.length === 0) return;

        const mode = yield* Ref.get(syncMode);
        if (mode._tag === "Checkout") {
          const event = yield* primary.getEvent(mode.eventId);
          if (Option.isNone(event)) {
            return yield* Effect.die(new Error(`Cannot repair at unknown eventId ${mode.eventId}`));
          }
          yield* bootstrapReplicaProjectionsAt(event.value, {
            replaceSyncPosition: true,
          }).pipe(Effect.orDie);
        } else {
          const latestEvent = yield* primary.getLatestEvent();
          if (Option.isSome(latestEvent)) {
            yield* bootstrapReplicaProjectionsAt(latestEvent.value, {
              replaceSyncPosition: true,
            }).pipe(Effect.orDie);
          }
        }
      },
    );

    const queue = yield* Queue.unbounded<Task>();

    const recoverPendingTasks = Effect.gen(function* () {
      const rows = yield* scanAllPendingTasks();
      for (const row of rows) {
        yield* Queue.offer(queue, taskFromRow(row));
      }
    });

    yield* recoverPendingTasks;

    yield* Effect.logInfo("ReplicaSyncEngine: starting consumer fiber");

    const consumer = Effect.gen(function* () {
      yield* Effect.logInfo("ReplicaSyncEngine: consumer loop started");
      while (true) {
        const task = yield* Queue.take(queue);
        yield* Effect.logInfo(`ReplicaSyncEngine: consumer processing task ${task.kind}`);
        yield* process(task).pipe(
          Effect.catchCause((cause) =>
            Effect.gen(function* () {
              yield* Effect.logWarning(`ReplicaSyncEngine: consumer task failed — ${cause}`);
              yield* Effect.logInfo("ReplicaSyncEngine: auto-repairing");
              yield* repair().pipe(
                Effect.catchCause((repairCause) =>
                  Effect.logError(`ReplicaSyncEngine: auto-repair failed — ${repairCause}`),
                ),
              );
            }),
          ),
        );
        yield* Effect.logInfo(`ReplicaSyncEngine: consumer finished task ${task.kind}`);
      }
    });

    yield* Effect.forkDetach(consumer);

    /**
     * @since 0.0.0
     * @category service-method
     */
    const push: IReplicaSyncEngine["push"] = Effect.fn("ReplicaSyncEngine.push")(function* (
      ...events
    ) {
      const mode = yield* Ref.get(syncMode);
      if (mode._tag === "Checkout") return;

      for (const event of events) {
        yield* proposeAndApplyOptimistically(event);
      }
      if (events.length > 0) {
        const taskId = yield* insertPendingTask({ kind: "forward" });
        yield* Queue.offer(queue, { kind: "forward", taskId });
      }
    });

    /**
     * @since 0.0.0
     * @category service-method
     */
    const poke: IReplicaSyncEngine["poke"] = Effect.fn("ReplicaSyncEngine.poke")(function* () {
      const mode = yield* Ref.get(syncMode);
      if (mode._tag === "Checkout") return;

      const taskId = yield* insertPendingTask({ kind: "reconcile" });
      yield* Queue.offer(queue, { kind: "reconcile", taskId });
    });

    /**
     * @since 0.0.0
     * @category service-method
     */
    const checkout: IReplicaSyncEngine["checkout"] = Effect.fn("ReplicaSyncEngine.checkout")(
      function* (eventId) {
        if (projections.all.length > 0) {
          const event = yield* primary.getEvent(eventId);
          if (Option.isNone(event)) {
            return yield* Effect.die(new Error(`Cannot checkout unknown eventId ${eventId}`));
          }

          yield* bootstrapReplicaProjectionsAt(event.value, {
            replaceSyncPosition: true,
          }).pipe(Effect.orDie);
        }

        yield* Ref.set(syncMode, { _tag: "Checkout", eventId });
      },
    );

    /**
     * @since 0.0.0
     * @category service-method
     */
    const setLatest: IReplicaSyncEngine["setLatest"] = Effect.fn("ReplicaSyncEngine.setLatest")(
      function* () {
        if (projections.all.length > 0) {
          const latestEvent = yield* primary.getLatestEvent();
          if (Option.isSome(latestEvent)) {
            yield* bootstrapReplicaProjectionsAt(latestEvent.value, {
              replaceSyncPosition: true,
            }).pipe(Effect.orDie);
          }
        }

        yield* Ref.set(syncMode, { _tag: "Latest" });
      },
    );

    return ReplicaSyncEngine.of({
      mode: Ref.get(syncMode),
      push,
      poke,
      checkout,
      setLatest,
      repair,
    });
  }),
);
