import { useAtomValue } from "@effect/atom-react";
import { useState, type SubmitEvent } from "react";
import { Effect } from "effect";
import {
  makeCompletionSetEvent,
  makeCreatedEvent,
  makeDeletedEvent,
} from "@converge/react-core/todo";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { todosAtom } from "./replica";
import { useEventStore } from "./use-event-store";

export function TodoApp() {
  const todos = useAtomValue(todosAtom);
  const { commit } = useEventStore();
  const [title, setTitle] = useState("");

  const completedCount = todos.filter((todo) => todo.completed).length;
  const openCount = todos.length - completedCount;

  const handleSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle) return;

    setTitle("");
    await commit(await Effect.runPromise(makeCreatedEvent({ title: nextTitle })));
  };

  const handleTodoCompletedChange = async (id: string, completed: boolean) => {
    await commit(await Effect.runPromise(makeCompletionSetEvent({ id, completed })));
  };

  const handleTodoDelete = async (id: string) => {
    await commit(await Effect.runPromise(makeDeletedEvent({ id })));
  };

  return (
    <main className="min-h-screen px-4 py-8 text-zinc-950 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <section className="rounded-4xl border border-white/70 bg-white/70 p-6 shadow-xl shadow-zinc-200/70 backdrop-blur sm:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-4">
              <Badge variant="outline">Converge example</Badge>
              <div className="space-y-3">
                <h1 className="max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">
                  Local-first todos with primary and replica sync engines.
                </h1>
                <p className="max-w-2xl text-base leading-7 text-zinc-600">
                  Writes land in the browser replica immediately, then forward to the Bun primary
                  engine in the background. Reconcile pulls accepted events back from the server.
                </p>
              </div>
            </div>
            <div className="grid gap-2 rounded-2xl border border-zinc-200 bg-white p-4 text-sm shadow-sm">
              <div className="flex items-center justify-between gap-6">
                <span className="text-zinc-500">Replica</span>
                <span className="font-medium">IndexedDB</span>
              </div>
              <div className="flex items-center justify-between gap-6">
                <span className="text-zinc-500">Primary</span>
                <span className="font-medium">PGlite</span>
              </div>
            </div>
          </div>
        </section>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Todos</CardTitle>
              <CardDescription>
                {openCount} open, {completedCount} completed.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row">
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Add a todo, even while offline"
                aria-label="Todo title"
              />
              <Button type="submit" disabled={!title.trim()}>
                Add todo
              </Button>
            </form>

            <div className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white">
              {todos.length === 0 ? (
                <div className="p-8 text-center text-sm text-zinc-500">
                  Add your first todo. It will appear before the network roundtrip finishes.
                </div>
              ) : (
                todos.map((todo) => (
                  <div key={todo.id} className="flex items-center gap-3 p-4">
                    <input
                      type="checkbox"
                      checked={todo.completed}
                      onChange={(event) => {
                        void handleTodoCompletedChange(todo.id, event.target.checked);
                      }}
                      className="h-4 w-4 rounded border-zinc-300 text-zinc-950 focus:ring-zinc-950"
                      aria-label={`Mark ${todo.title} complete`}
                    />
                    <span
                      className={
                        todo.completed
                          ? "flex-1 text-sm text-zinc-400 line-through"
                          : "flex-1 text-sm font-medium text-zinc-900"
                      }
                    >
                      {todo.title}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        void handleTodoDelete(todo.id);
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                ))
              )}
            </div>
          </CardContent>
          <CardFooter className="justify-between text-xs text-zinc-500">
            <span>Replica projection persists via Converge + Effect Atom.</span>
            <span>Replica event log persists in IndexedDB.</span>
          </CardFooter>
        </Card>
      </div>
    </main>
  );
}

export default TodoApp;
