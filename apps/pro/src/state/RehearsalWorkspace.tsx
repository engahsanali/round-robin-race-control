import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { validateEventState, type EventStateV1 } from "@rr3/domain";
import { prepareEventCommand, type CommandReceipt, type EventCommand } from "./commands";

type RehearsalWorkspaceValue = {
  state: EventStateV1 | null;
  begin(candidate: EventStateV1): void;
  exit(): void;
  dispatch(command: EventCommand): Promise<CommandReceipt>;
};

const RehearsalWorkspaceContext = createContext<RehearsalWorkspaceValue | null>(null);

let fallbackCommandSequence = 0;

function createRehearsalCommandId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `rehearsal-command-${crypto.randomUUID()}`;
  }
  fallbackCommandSequence += 1;
  return `rehearsal-command-${Date.now().toString(36)}-${fallbackCommandSequence.toString(36)}`;
}

export function RehearsalWorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<EventStateV1 | null>(null);
  const stateRef = useRef<EventStateV1 | null>(null);

  const publish = useCallback((next: EventStateV1 | null) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const begin = useCallback((candidate: EventStateV1) => {
    const validated = validateEventState(candidate);
    if (!validated.success) throw new Error("Rehearsal event is invalid");
    publish(structuredClone(validated.data));
  }, [publish]);

  const exit = useCallback(() => publish(null), [publish]);

  const dispatch = useCallback(async (command: EventCommand) => {
    const current = stateRef.current;
    if (!current) throw new Error("No rehearsal event is active");
    const prepared = prepareEventCommand(
      current,
      command,
      createRehearsalCommandId(),
      new Date().toISOString(),
    );
    publish(prepared.event);
    return prepared.receipt;
  }, [publish]);

  return (
    <RehearsalWorkspaceContext.Provider value={{ state, begin, exit, dispatch }}>
      {children}
    </RehearsalWorkspaceContext.Provider>
  );
}

export function useOptionalRehearsalWorkspace(): RehearsalWorkspaceValue | null {
  return useContext(RehearsalWorkspaceContext);
}

export function useRehearsalWorkspace(): RehearsalWorkspaceValue {
  const workspace = useOptionalRehearsalWorkspace();
  if (!workspace) throw new Error("useRehearsalWorkspace must be used within RehearsalWorkspaceProvider");
  return workspace;
}
