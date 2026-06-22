export class Projection<State, Payload> {
  private constructor(
    readonly name: string,
    readonly initial: State,
    readonly apply: (state: State, payload: Payload) => State,
  ) {}

  static make<State, Payload>(
    name: string,
    initial: State,
    apply: (state: State, payload: Payload) => State,
  ): Projection<State, Payload> {
    return new Projection(name, initial, apply);
  }
}
