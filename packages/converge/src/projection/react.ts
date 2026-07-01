import { useAtomValue } from "@effect/atom-react";
import type { IProjection } from "./projection";

/**
 * @since 0.0.0
 * @category hook
 */
export function useProjection<TSnapshot>(projection: IProjection<TSnapshot, any>): TSnapshot {
  return useAtomValue(projection.atom);
}

/**
 * @since 0.0.0
 * @category hook
 */
export function useProjectionSelector<TSnapshot, TSelected>(
  projection: IProjection<TSnapshot, any>,
  selector: (snapshot: TSnapshot) => TSelected,
): TSelected {
  return useAtomValue(projection.atom, selector);
}

export { RegistryProvider as ProjectionRegistryProvider } from "@effect/atom-react";
