import { Model } from "effect/unstable/schema";
import { Context, Effect, HashMap, Layer, Option, Schema } from "effect";
import * as EventHandler from "./event-handler";

type EventRouterServiceShape = EventRouter<
  ReadonlyArray<EventHandler.EventHandler<any, any, any, never>>
>;

function provideHandlerContext<const THandler extends EventHandler.AnyEventHandler>(
  handler: THandler,
  context: Context.Context<EventHandler.EventHandlerContext<THandler>>,
): EventHandler.EventHandler<any, any, EventHandler.EventHandlerError<THandler>, never> {
  return new EventHandler.EventHandler(handler.event, (event) =>
    (
      handler.run(event) as Effect.Effect<
        unknown,
        EventHandler.EventHandlerError<THandler>,
        EventHandler.EventHandlerContext<THandler>
      >
    ).pipe(Effect.provideContext(context)),
  );
}

/**
 * @since 0.0.0
 * @category type
 */
const AnyEventHandler = Schema.instanceOf(
  EventHandler.EventHandler,
) as Schema.Schema<EventHandler.AnyEventHandler>;

/**
 * @since 0.0.0
 * @category type
 */
export type EventRouterContext<TEventRouter> =
  TEventRouter extends EventRouter<infer THandlers>
    ? EventHandler.EventHandlerContext<THandlers[number]>
    : never;

/**
 * @since 0.0.0
 * @category model
 */
export class EventRouter<
  const THandlers extends ReadonlyArray<EventHandler.AnyEventHandler> =
    ReadonlyArray<EventHandler.AnyEventHandler>,
> extends Model.Class<EventRouter<any>>("EventRouter")({
  handlers: Schema.Array(AnyEventHandler),
}) {
  declare readonly handlers: THandlers;

  readonly handlersByEventType: HashMap.HashMap<string, THandlers[number]>;

  constructor(input: { readonly handlers: THandlers }) {
    super(input);
    this.handlersByEventType = HashMap.fromIterable(
      input.handlers.map((handler) => [handler.event.eventType, handler] as const),
    );
  }

  find(eventType: string): THandlers[number] | undefined {
    return Option.getOrUndefined(HashMap.get(this.handlersByEventType, eventType));
  }
}

/**
 * @since 0.0.0
 * @category service
 */
export class EventRouterService extends Context.Service<
  EventRouterService,
  EventRouterServiceShape
>()("EventRouter") {}

/**
 * @since 0.0.0
 * @category constructor
 */
export function make<const THandlers extends ReadonlyArray<EventHandler.AnyEventHandler>>(input: {
  readonly handlers: THandlers;
}) {
  return new EventRouter<THandlers>(input);
}

/**
 * @since 0.0.0
 * @category layer
 */
export function layer<const THandlers extends ReadonlyArray<EventHandler.AnyEventHandler>>(input: {
  readonly handlers: THandlers;
}): Layer.Layer<EventRouterService, never, EventHandler.EventHandlerContext<THandlers[number]>> {
  return Layer.effect(
    EventRouterService,
    Effect.gen(function* () {
      const context = yield* Effect.context<EventHandler.EventHandlerContext<THandlers[number]>>();

      return make({
        handlers: input.handlers.map(
          (handler) =>
            provideHandlerContext(
              handler,
              context as Context.Context<EventHandler.EventHandlerContext<typeof handler>>,
            ),
        ),
      });
    }),
  );
}
