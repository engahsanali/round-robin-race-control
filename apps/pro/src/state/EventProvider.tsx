import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { parseEventJson, type EventStateV1 } from "@rr3/domain";
import {
  EventRepositoryValidationError,
  type EventRepository,
  type RestorePreview,
  type SnapshotMetadata,
  type StoragePersistenceStatus,
} from "../persistence/repository";
import {
  createCommandDispatcher,
  type CommandReceipt,
  type EventCommand,
  type PostCommitIssue,
  type PublishCommittedEvent,
} from "./commands";

type EventContextValue = {
  state: EventStateV1 | null;
  loading: boolean;
  error: string | null;
  postCommitIssue: PostCommitIssue | null;
  persistenceStatus: StoragePersistenceStatus;
  snapshots: SnapshotMetadata[];
  dispatchEventCommand(command: EventCommand): Promise<CommandReceipt>;
  requestPersistentStorage(): Promise<StoragePersistenceStatus>;
  importEventJson(text: string, summary?: string): Promise<CommandReceipt>;
  previewSnapshot(snapshotId: string): Promise<RestorePreview>;
  restoreSnapshot(snapshotId: string, confirmed: boolean): Promise<CommandReceipt>;
  refreshSnapshots(): Promise<SnapshotMetadata[]>;
};

const EventContext = createContext<EventContextValue | null>(null);

type EventProviderProps = {
  repository: EventRepository;
  children: ReactNode;
  now?: () => string;
  createId?: () => string;
  publishCommittedEvent?: PublishCommittedEvent;
};

export function EventProvider({
  repository,
  children,
  now,
  createId,
  publishCommittedEvent,
}: EventProviderProps) {
  const [state, setState] = useState<EventStateV1 | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [postCommitIssue, setPostCommitIssue] = useState<PostCommitIssue | null>(null);
  const [persistenceStatus, setPersistenceStatus] =
    useState<StoragePersistenceStatus>("not-requested");
  const [snapshots, setSnapshots] = useState<SnapshotMetadata[]>([]);

  const publish = useCallback<PublishCommittedEvent>(
    (event, receipt) => {
      setState(event);
      publishCommittedEvent?.(event, receipt);
    },
    [publishCommittedEvent],
  );

  const dispatcher = useMemo(
    () => createCommandDispatcher({
      repository,
      now,
      createId,
      publish,
      onPostCommitIssue: setPostCommitIssue,
    }),
    [repository, now, createId, publish],
  );

  const refreshSnapshots = useCallback(async () => {
    const next = await repository.listSnapshots();
    setSnapshots(next);
    return next;
  }, [repository]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void Promise.all([
      repository.load(),
      repository.getStoragePersistenceStatus(),
      repository.listSnapshots(),
    ]).then(([event, status, revisionList]) => {
      if (!active) return;
      setState(event);
      setPersistenceStatus(
        status === "not-requested" && !repository.isPersistentStorageSupported()
          ? "unavailable"
          : status,
      );
      setSnapshots(revisionList);
      setLoading(false);
    }).catch((cause: unknown) => {
      if (!active) return;
      setError(toSafeErrorMessage(cause));
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [repository]);

  const dispatchEventCommand = useCallback(
    async (command: EventCommand) => {
      setError(null);
      setPostCommitIssue(null);
      let receipt: CommandReceipt;
      try {
        receipt = await dispatcher.dispatch(command);
      } catch (cause) {
        setError(toSafeErrorMessage(cause));
        throw cause;
      }
      try {
        await refreshSnapshots();
      } catch (cause) {
        setPostCommitIssue({
          commandId: receipt.commandId,
          area: "snapshot-history",
          message: toSafeErrorMessage(cause),
        });
      }
      return receipt;
    },
    [dispatcher, refreshSnapshots],
  );

  const requestPersistentStorage = useCallback(async () => {
    const status = await repository.requestPersistentStorage({ userInitiated: true });
    setPersistenceStatus(status);
    return status;
  }, [repository]);

  const importEventJson = useCallback(
    async (text: string, summary = "Imported local event backup") => {
      const parsed = parseEventJson(text);
      if (!parsed.ok) {
        const failure = new EventRepositoryValidationError("Imported event is invalid", parsed.issues);
        setError(failure.message);
        throw failure;
      }
      return dispatchEventCommand({ type: "event.replace", event: parsed.data, summary });
    },
    [dispatchEventCommand],
  );

  const previewSnapshot = useCallback(
    (snapshotId: string) => repository.previewRestore(snapshotId),
    [repository],
  );

  const restoreSnapshot = useCallback(
    async (snapshotId: string, confirmed: boolean) => {
      if (!confirmed) throw new Error("Restore confirmation is required");
      const preview = await repository.previewRestore(snapshotId);
      return dispatchEventCommand({
        type: "event.replace",
        event: preview.event,
        summary: `Restored snapshot ${snapshotId}`,
      });
    },
    [dispatchEventCommand, repository],
  );

  const value = useMemo<EventContextValue>(
    () => ({
      state,
      loading,
      error,
      postCommitIssue,
      persistenceStatus,
      snapshots,
      dispatchEventCommand,
      requestPersistentStorage,
      importEventJson,
      previewSnapshot,
      restoreSnapshot,
      refreshSnapshots,
    }),
    [
      state,
      loading,
      error,
      postCommitIssue,
      persistenceStatus,
      snapshots,
      dispatchEventCommand,
      requestPersistentStorage,
      importEventJson,
      previewSnapshot,
      restoreSnapshot,
      refreshSnapshots,
    ],
  );

  return <EventContext.Provider value={value}>{children}</EventContext.Provider>;
}

export function useEventState(): EventContextValue {
  const context = useContext(EventContext);
  if (!context) throw new Error("useEventState must be used within EventProvider");
  return context;
}

export function useOptionalEventState(): EventContextValue | null {
  return useContext(EventContext);
}

function toSafeErrorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "The local event operation failed";
}
