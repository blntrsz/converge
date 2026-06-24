import { Schema } from "effect";
import { Model } from "effect/unstable/schema";

export class Projection<State, Payload> extends Model.Class<Projection<any, any>>("Projection")({
  name: Schema.String,
  initial: Schema.Any,
  apply: Schema.Any,
}) {
  declare readonly initial: State;
  declare readonly apply: (state: State, payload: Payload) => State;

  static override make<State, Payload>(
    name: string,
    initial: State,
    apply: (state: State, payload: Payload) => State,
  ): Projection<State, Payload>;
  static override make<Args extends Array<any>, X>(this: new (...args: Args) => X, ...args: Args): X;
  static override make(...args: Array<any>): any {
    if (typeof args[0] === "string") {
      return new Projection({ name: args[0], initial: args[1], apply: args[2] });
    }
    return new (this as any)(...args);
  }
}
