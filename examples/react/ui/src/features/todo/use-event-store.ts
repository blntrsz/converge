import { useAtomSet } from "@effect/atom-react";
import { commit } from "./event-store";

export const useEventStore = () => {
  const commitEvent = useAtomSet(commit, { mode: "promise" });

  return { commit: commitEvent };
};
