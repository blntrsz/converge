import { EventInstance } from "converge/event";
import { ReplicaSyncEngine } from "converge/replica-sync-engine";
import { Effect } from "effect";
import { replicaAtomRuntime } from "./replica";

export const commit = replicaAtomRuntime.fn((event: EventInstance.EventInstance) =>
  Effect.gen(function* () {
    const replica = yield* ReplicaSyncEngine.ReplicaSyncEngine;
    yield* replica.push(event);
  }),
);
