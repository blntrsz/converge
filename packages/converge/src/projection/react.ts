import { useAtomValue } from "@effect/atom-react";
import type { Projection } from "./projection";

/**
 * @since 0.0.0
 * @category hook
 */
export function useProjection<TSnapshot>(
  projection: Projection<TSnapshot, ReadonlyArray<any>, any>,
): TSnapshot {
  return useAtomValue(projection.atom);
}

/**
 * @since 0.0.0
 * @category hook
 */
export function useProjectionSelector<TSnapshot, TSelected>(
  projection: Projection<TSnapshot, ReadonlyArray<any>, any>,
  selector: (snapshot: TSnapshot) => TSelected,
): TSelected {
  return useAtomValue(projection.atom, selector);
}

export { RegistryProvider as ProjectionRegistryProvider } from "@effect/atom-react";
