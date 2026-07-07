import type { Type } from "./model.ts";

/**
 * @category reduce
 */
export const applyCreated = (
  snapshot: ReadonlyArray<Type>,
  todo: Type,
): ReadonlyArray<Type> => {
  if (snapshot.some((item) => item.id === todo.id)) {
    return snapshot;
  }

  return [...snapshot, todo];
};

/**
 * @category reduce
 */
export const applyCompletionSet = (
  snapshot: ReadonlyArray<Type>,
  details: { readonly id: string; readonly completed: boolean },
): ReadonlyArray<Type> =>
  snapshot.map((todo) =>
    todo.id === details.id ? { ...todo, completed: details.completed } : todo,
  );

/**
 * @category reduce
 */
export const applyDeleted = (
  snapshot: ReadonlyArray<Type>,
  details: { readonly id: string },
): ReadonlyArray<Type> => snapshot.filter((todo) => todo.id !== details.id);
