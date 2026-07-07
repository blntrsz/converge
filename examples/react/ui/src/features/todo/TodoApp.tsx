import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { EventInstance } from "converge/event";
import { useEventStore } from "converge/react";
import { todoCompletionSet, todoCreated, todoDeleted } from "@converge/react-core/todo";
import * as TodoModel from "@converge/react-core/todo/model";
import { Effect } from "effect";
import { useEffect, useState, type FormEvent } from "react";
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
import { todoProjection } from "./replica";

export function TodoApp() {
  const { commit } = useEventStore();
  const commitEvent = useAtomSet(commit, { mode: "promise" });
  const todos = useAtomValue(todoProjection.atom);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("Ready");
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  const completedCount = todos.filter((todo) => todo.completed).length;
  const openCount = todos.length - completedCount;

  useEffect(() => {
    const markOnline = () => setIsOnline(true);
    const markOffline = () => setIsOnline(false);

    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);

    return () => {
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
    };
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle) return;

    setTitle("");
    setStatus("Saving locally...");
    await commitEvent(
      Effect.gen(function* () {
        const todo = yield* TodoModel.make({ title: nextTitle });
        return yield* EventInstance.make(todoCreated, todo);
      }),
    );
    setStatus("Saved locally; sync queued");
  };

  return (
    <main className="min-h-screen px-4 py-8 text-zinc-950 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <section className="rounded-[2rem] border border-white/70 bg-white/70 p-6 shadow-xl shadow-zinc-200/70 backdrop-blur sm:p-8">
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
                <span className="text-zinc-500">Network</span>
                <Badge variant={isOnline ? "default" : "secondary"}>
                  {isOnline ? "Online" : "Offline"}
                </Badge>
              </div>
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
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle>Todos</CardTitle>
                <CardDescription>
                  {openCount} open, {completedCount} completed. {status}.
                </CardDescription>
              </div>
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
                        setStatus("Saving locally...");
                        void commitEvent(
                          EventInstance.make(todoCompletionSet, {
                            id: todo.id,
                            completed: event.target.checked,
                          }),
                        ).then(() => {
                          setStatus("Saved locally; sync queued");
                        });
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
                        setStatus("Saving locally...");
                        void commitEvent(EventInstance.make(todoDeleted, { id: todo.id })).then(
                          () => {
                            setStatus("Saved locally; sync queued");
                          },
                        );
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
