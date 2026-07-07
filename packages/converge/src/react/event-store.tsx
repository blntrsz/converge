import { RegistryProvider } from "@effect/atom-react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { CommitAtom, EventStoreConfig } from "./make-event-store.ts";
import { makeEventStore } from "./make-event-store.ts";

type EventStoreContextValue = {
  readonly commit: CommitAtom;
};

const EventStoreContext = createContext<EventStoreContextValue | null>(null);

const SyncOnMount = ({ poke }: { readonly poke: () => Promise<void> }) => {
  useEffect(() => {
    const sync = () => {
      void poke().catch(() => undefined);
    };

    sync();
    window.addEventListener("online", sync);

    return () => {
      window.removeEventListener("online", sync);
    };
  }, [poke]);

  return null;
};

/**
 * @since 0.0.0
 * @category components
 */
export const EventStoreProvider = ({
  config,
  children,
}: {
  readonly config: EventStoreConfig;
  readonly children: ReactNode;
}) => {
  const store = useMemo(() => makeEventStore(config), [config]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void store.activate().then(() => {
      if (!cancelled) {
        setReady(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [store]);

  if (!ready) {
    return null;
  }

  return (
    <EventStoreContext.Provider value={{ commit: store.commit }}>
      <RegistryProvider>
        <SyncOnMount poke={store.poke} />
        {children}
      </RegistryProvider>
    </EventStoreContext.Provider>
  );
};

/**
 * @since 0.0.0
 * @category hooks
 */
export const useEventStore = () => {
  const context = useContext(EventStoreContext);
  if (!context) {
    throw new Error("useEventStore must be used within EventStoreProvider");
  }

  return context;
};
