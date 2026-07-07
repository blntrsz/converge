import { IndexedDbReplicaSyncEngine } from "converge/replica-sync-engine";
import { TodoModel } from "@converge/react-core/todo/model";
import { todoHandlers } from "./handlers";
import { TodoProjection } from "./projection";

export { TodoProjection } from "./projection";

export const { layer: ReplicaTodoLayer, runtime: replicaAtomRuntime, atom: todosAtom } =
  IndexedDbReplicaSyncEngine.browserLayer({
    handlers: todoHandlers,
    projection: [TodoProjection],
    primary: {
      baseUrl: "/api/sync",
      projections: [
        {
          key: TodoProjection.key,
          rowSchema: TodoModel.json,
        },
      ],
    },
  });
