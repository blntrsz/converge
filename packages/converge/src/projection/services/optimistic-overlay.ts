import { Effect, Layer } from "effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRef from "effect/unstable/reactivity/AtomRef";
import type { Context } from "effect";
import type { EventInstance } from "../../event/event-instance.ts";
import { applyReduces, type ReduceFunction } from "./reduce.ts";
import type { IReactiveProjection } from "./projection.ts";

/**
 * @since 0.0.0
 * @category model
 */
export interface OptimisticOverlayOptions<TSnapshot> {
  readonly projection: IReactiveProjection<TSnapshot>;
  readonly findReduce: (eventType: string) => ReduceFunction<TSnapshot> | undefined;
}

/**
 * @since 0.0.0
 * @category service-interface
 */
export interface IOptimisticOverlay<TSnapshot> {
  readonly atom: Atom.Atom<TSnapshot>;
  readonly apply: (event: EventInstance) => Effect.Effect<void>;
  readonly remove: (eventId: string) => Effect.Effect<void>;
  readonly clear: Effect.Effect<void>;
  readonly isEmpty: Effect.Effect<boolean>;
}

/**
 * @since 0.0.0
 * @category constructor
 */
export function make<TSnapshot>(
  options: OptimisticOverlayOptions<TSnapshot>,
): Effect.Effect<IOptimisticOverlay<TSnapshot>> {
  return Effect.gen(function* () {
    const pending = new Map<string, EventInstance>();
    const pendingRef = AtomRef.make<ReadonlyArray<EventInstance>>([]);

    const syncPendingRef = () => {
      pendingRef.set([...pending.values()]);
    };

    const atom = Atom.make((get) => {
      const committed = get(options.projection.atom);

      const unsubscribePending = pendingRef.subscribe(() => {
        get.setSelf(
          applyReduces(
            get(options.projection.atom),
            pendingRef.value,
            options.findReduce,
          ),
        );
      });

      get.addFinalizer(unsubscribePending);
      return applyReduces(committed, pendingRef.value, options.findReduce);
    });

    return {
      atom,
      apply: (event) =>
        Effect.sync(() => {
          pending.set(event.eventId, event);
          syncPendingRef();
        }),
      remove: (eventId) =>
        Effect.sync(() => {
          pending.delete(eventId);
          syncPendingRef();
        }),
      clear: Effect.sync(() => {
        pending.clear();
        syncPendingRef();
      }),
      isEmpty: Effect.sync(() => pending.size === 0),
    };
  });
}

/**
 * @since 0.0.0
 * @category layer
 */
export function layer<TIdentifier, TSnapshot>(
  tag: Context.Service<TIdentifier, IOptimisticOverlay<TSnapshot>>,
  options: OptimisticOverlayOptions<TSnapshot>,
): Layer.Layer<TIdentifier> {
  return Layer.effect(tag, make(options));
}
