import { Context, Effect, Layer, type Effect as EffectType } from "effect";

/**
 * Anchor for versioned primary storage reads during bootstrap.
 *
 * Resolve sync position `eventId` to `sequence` at the bootstrap boundary.
 * Encoders use `sequence` (event_history.id) for `since` filters — not eventId.
 *
 * @since 0.0.0
 * @category type
 */
export interface BootstrapAnchor {
  readonly sequence: number;
}

/**
 * @since 0.0.0
 * @category type
 */
export interface PrimaryProjectionBootstrapEncoder<R = never> {
  readonly projectionKey: string;
  readonly encode: (anchor: BootstrapAnchor) => EffectType.Effect<unknown, never, R>;
}

/**
 * @since 0.0.0
 * @category type
 */
export type AnyPrimaryProjectionBootstrapEncoder = PrimaryProjectionBootstrapEncoder<any>;

/**
 * @since 0.0.0
 * @category type
 */
export type PrimaryProjectionBootstrapEncoderContext<TEncoder> =
  TEncoder extends PrimaryProjectionBootstrapEncoder<infer R> ? R : never;

function provideEncoderContext<const TEncoder extends AnyPrimaryProjectionBootstrapEncoder>(
  encoder: TEncoder,
  context: Context.Context<PrimaryProjectionBootstrapEncoderContext<TEncoder>>,
): PrimaryProjectionBootstrapEncoder<never> {
  return {
    projectionKey: encoder.projectionKey,
    encode: (anchor) =>
      (
        encoder.encode(anchor) as EffectType.Effect<
          unknown,
          never,
          PrimaryProjectionBootstrapEncoderContext<TEncoder>
        >
      ).pipe(Effect.provideContext(context)),
  };
}

/**
 * @since 0.0.0
 * @category model
 */
export class PrimaryProjectionBootstrap<
  const TEncoders extends ReadonlyArray<AnyPrimaryProjectionBootstrapEncoder> =
    ReadonlyArray<AnyPrimaryProjectionBootstrapEncoder>,
> {
  private readonly encodersByKey: Map<string, PrimaryProjectionBootstrapEncoder<never>>;

  constructor(input: { readonly encoders: ReadonlyArray<PrimaryProjectionBootstrapEncoder<never>> }) {
    this.encodersByKey = new Map(
      input.encoders.map((encoder) => [encoder.projectionKey, encoder] as const),
    );
  }

  find(projectionKey: string): PrimaryProjectionBootstrapEncoder | undefined {
    return this.encodersByKey.get(projectionKey);
  }
}

/**
 * @since 0.0.0
 * @category service
 */
export class PrimaryProjectionBootstrapService extends Context.Service<
  PrimaryProjectionBootstrapService,
  PrimaryProjectionBootstrap
>()("PrimaryProjectionBootstrap") {}

/**
 * @since 0.0.0
 * @category constructor
 */
export function make<const TEncoders extends ReadonlyArray<AnyPrimaryProjectionBootstrapEncoder>>(
  input: { readonly encoders: ReadonlyArray<PrimaryProjectionBootstrapEncoder<never>> },
) {
  return new PrimaryProjectionBootstrap<TEncoders>(input);
}

/**
 * @since 0.0.0
 * @category layer
 */
export function layer<const TEncoders extends ReadonlyArray<AnyPrimaryProjectionBootstrapEncoder>>(
  input: { readonly encoders: TEncoders },
): Layer.Layer<
  PrimaryProjectionBootstrapService,
  never,
  PrimaryProjectionBootstrapEncoderContext<TEncoders[number]>
> {
  return Layer.effect(
    PrimaryProjectionBootstrapService,
    Effect.gen(function* () {
      const context = yield* Effect.context<
        PrimaryProjectionBootstrapEncoderContext<TEncoders[number]>
      >();

      return make({
        encoders: input.encoders.map(
          (encoder) =>
            provideEncoderContext(
              encoder,
              context as Context.Context<PrimaryProjectionBootstrapEncoderContext<typeof encoder>>,
            ),
        ),
      });
    }),
  );
}
