import { Equal, Hash, Schema } from "effect";

export class Event<Version extends string, Payload> implements Equal.Equal {
  private constructor(
    readonly version: Version,
    readonly payloadSchema: Schema.Schema<Payload>,
  ) {}

  [Hash.symbol](): number {
    return Hash.string(this.version);
  }

  [Equal.symbol](that: Equal.Equal): boolean {
    return that instanceof Event && that.version === this.version;
  }

  static make<const Version extends string, const Fields extends Schema.Struct.Fields>(
    version: Version,
    fields: Fields,
  ): Event<Version, Schema.Struct.Type<Fields>> {
    return new Event(version, Schema.Struct(fields));
  }
}
