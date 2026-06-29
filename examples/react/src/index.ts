import { serve } from "bun";
import { Effect, Layer, ManagedRuntime, Result } from "effect";
import * as EventInstance from "../../../packages/converge/src/event/event-instance.ts";
import * as PrimarySyncEngine from "../../../packages/converge/src/primary-sync-engine/services/primary-sync-engine.ts";
import index from "./index.html";
import { listPrimaryTodos, PrimaryTodoLayer } from "./todo-primary";

type WireEvent = {
  readonly eventId: string;
  readonly eventType: string;
  readonly eventDetails: unknown;
};

const primaryRuntime = ManagedRuntime.make(PrimaryTodoLayer, {
  memoMap: Layer.makeMemoMapUnsafe(),
});

const isWireEvent = (input: unknown): input is WireEvent => {
  if (typeof input !== "object" || input === null) return false;
  const event = input as Record<string, unknown>;

  return (
    typeof event.eventId === "string" &&
    typeof event.eventType === "string" &&
    "eventDetails" in event
  );
};

const eventFromWire = (event: WireEvent) =>
  new EventInstance.EventInstance({
    eventId: event.eventId,
    eventType: event.eventType,
    eventDetails: event.eventDetails,
  });

const eventToWire = (event: EventInstance.EventInstance): WireEvent => ({
  eventId: event.eventId,
  eventType: event.eventType,
  eventDetails: event.eventDetails,
});

const pullPrimary = (cursor?: string) =>
  Effect.gen(function* () {
    const primary = yield* PrimarySyncEngine.PrimarySyncEngine;

    return yield* primary.pull(cursor);
  });

const pushPrimary = (events: EventInstance.EventInstance[]) =>
  Effect.gen(function* () {
    const primary = yield* PrimarySyncEngine.PrimarySyncEngine;

    return yield* primary.push(...events);
  });

const jsonError = (message: string, status: number) =>
  Response.json({ message }, { status });

const server = serve({
  routes: {
    // Serve index.html for all unmatched routes.
    "/*": index,

    "/api/sync/pull": {
      async GET(req) {
        const cursor = new URL(req.url).searchParams.get("cursor") ?? undefined;
        const page = await primaryRuntime.runPromise(pullPrimary(cursor));

        return Response.json({
          ...page,
          data: page.data.map(eventToWire),
        });
      },
    },

    "/api/sync/push": {
      async POST(req) {
        const body = (await req.json()) as { events?: unknown };
        if (!Array.isArray(body.events) || !body.events.every(isWireEvent)) {
          return jsonError("Expected { events: WireEvent[] }", 400);
        }

        const events = body.events.map(eventFromWire);
        const results = await primaryRuntime.runPromise(pushPrimary(events));

        return Response.json({
          results: results.map((result) =>
            Result.isSuccess(result)
              ? { ok: true, event: eventToWire(result.success) }
              : { ok: false, event: eventToWire(result.failure) },
          ),
        });
      },
    },

    "/api/todos": {
      async GET() {
        const todos = await primaryRuntime.runPromise(listPrimaryTodos);

        return Response.json({ todos });
      },
    },
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`Server running at ${server.url}`);
