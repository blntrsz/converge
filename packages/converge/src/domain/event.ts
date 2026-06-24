import { Schema } from "effect"

/**
  * @since 0.0.0
  * @category type
  */
export type AnyEventType = Event<string, any>
/**
  * @since 0.0.0
  * @category type
  */
export type AnyEvent = EventInstance<string, any>

/**
  * @since 0.0.0
  * @category type
  */
export type EventData<EventDefinition extends AnyEventType | AnyEvent> =
  EventDefinition extends Event<string, infer EventDetails extends Schema.Struct.Fields>
  ? Schema.Struct.Type<EventDetails>
  : EventDefinition extends EventInstance<string, infer EventDetails extends Schema.Struct.Fields>
  ? Schema.Struct.Type<EventDetails>
  : never

/**
  * @since 0.0.0
  * @category type
  */
export type EventPayload<EventDefinition extends AnyEventType | AnyEvent> =
  EventData<EventDefinition>

/**
  * @since 0.0.0
  * @category type
  */
export type EventFrom<EventDefinition extends AnyEventType> =
  EventDefinition extends Event<infer EventType, infer EventDetails extends Schema.Struct.Fields>
  ? EventInstance<EventType, EventDetails>
  : never

/**
  * @since 0.0.0
  * @category entity
  */
export class EventInstance<
  TEventType extends string,
  TEventDetails extends Schema.Struct.Fields,
> {
  private readonly privateData: Schema.Struct.Type<TEventDetails>

  constructor(
    readonly type: TEventType,
    schema: Schema.brand<Schema.Struct<TEventDetails>, TEventType>,
    eventData: Schema.Struct.MakeIn<TEventDetails>,
  ) {
    this.privateData = schema.make(eventData)
  }

  get data(): Schema.Struct.Type<TEventDetails> {
    return this.privateData
  }
}

/**
  * @since 0.0.0
  * @category entity
  */
export class Event<
  TEventType extends string,
  TEventDetails extends Schema.Struct.Fields,
> {
  private readonly schema: Schema.brand<Schema.Struct<TEventDetails>, TEventType>

  constructor(
    readonly type: TEventType,
    private readonly eventDetails: TEventDetails,
  ) {
    this.schema = Schema.Struct(eventDetails).pipe(Schema.brand(type))
  }

  make(
    input: Schema.Struct.MakeIn<TEventDetails>,
  ): EventInstance<TEventType, TEventDetails> {
    return new EventInstance(this.type, this.schema, input)
  }
}

/**
  * @since 0.0.0
  * @category constructor
  */
export function make<
  const TEventType extends string,
  const TEventDetails extends Schema.Struct.Fields,
>(
  eventType: TEventType,
  eventDetails: TEventDetails,
) {
  return new Event(eventType, eventDetails)
}
