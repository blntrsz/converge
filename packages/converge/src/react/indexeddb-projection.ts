import { Context, type Layer, type Schema } from "effect";
import type * as Atom from "effect/unstable/reactivity/Atom";
import { indexedDbReplicaLayer } from "../projection/layers/indexeddb-replica-projection.ts";
import type {
  BootstrapFn,
  IReactiveReplicaProjection,
  IReplicaProjectionStore,
  ReplicaProjectionStorageError,
} from "../projection/services/replica-projection.ts";

let projectionCounter = 0;

type ProjectionTags<TSnapshot> = {
  readonly Projection: Context.Service<
    any,
    IReactiveReplicaProjection<TSnapshot, ReplicaProjectionStorageError>
  >;
  readonly Store: Context.Service<
    any,
    IReplicaProjectionStore<TSnapshot, ReplicaProjectionStorageError>
  >;
};

const createProjectionTags = <TSnapshot>(
  id: number,
): ProjectionTags<TSnapshot> => {
  class Projection extends Context.Service<
    Projection,
    IReactiveReplicaProjection<TSnapshot, ReplicaProjectionStorageError>
  >()(`ConvergeIndexedDbProjection_${id}`) {}

  class Store extends Context.Service<
    Store,
    IReplicaProjectionStore<TSnapshot, ReplicaProjectionStorageError>
  >()(`ConvergeIndexedDbProjectionStore_${id}`) {}

  return { Projection, Store };
};

/**
 * @since 0.0.0
 * @category model
 */
export interface IndexedDbProjection<TSnapshot> {
  readonly key: string;
  readonly schema: Schema.Schema<TSnapshot>;
  readonly initialValue: TSnapshot;
  readonly store: Context.Service<
    any,
    IReplicaProjectionStore<TSnapshot, ReplicaProjectionStorageError>
  >;
  readonly atom: Atom.Atom<TSnapshot>;
  readonly _tags: ProjectionTags<TSnapshot>;
  readonly _layer: Layer.Layer<any, any, any>;
}

/**
 * @since 0.0.0
 * @category constructor
 */
export function indexeddbProjection<const TSchema extends Schema.Schema<any>>(options: {
  readonly key: string;
  readonly schema: TSchema & {
    readonly DecodingServices: never;
    readonly EncodingServices: never;
  };
  readonly initialValue: Schema.Schema.Type<TSchema>;
  readonly databaseName?: string;
  readonly table?: string | { readonly name: string };
  readonly bootstrap?: BootstrapFn<
    Schema.Schema.Type<TSchema>,
    unknown,
    ReplicaProjectionStorageError
  >;
}): IndexedDbProjection<Schema.Schema.Type<TSchema>> {
  type TSnapshot = Schema.Schema.Type<TSchema>;
  const id = projectionCounter++;
  const tags = createProjectionTags<TSnapshot>(id);
  const atomHolder: { current: Atom.Atom<TSnapshot> | undefined } = { current: undefined };

  const layer = indexedDbReplicaLayer(tags.Projection, {
    databaseName: options.databaseName,
    table: options.table,
    key: options.key,
    schema: options.schema,
    initialValue: options.initialValue,
    store: tags.Store,
    bootstrap: options.bootstrap,
  });

  return {
    key: options.key,
    schema: options.schema,
    initialValue: options.initialValue,
    store: tags.Store,
    get atom() {
      if (!atomHolder.current) {
        throw new Error(
          `Projection "${options.key}" is not active yet. Mount EventStoreProvider first.`,
        );
      }
      return atomHolder.current;
    },
    _tags: tags,
    _layer: layer,
    _setAtom(atom: Atom.Atom<TSnapshot>) {
      atomHolder.current = atom;
    },
  } as IndexedDbProjection<TSnapshot> & {
    _setAtom(atom: Atom.Atom<TSnapshot>): void;
  };
}
