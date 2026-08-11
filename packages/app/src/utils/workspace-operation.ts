import { createSignal } from "solid-js"
import { ScopedKey, type ServerScope } from "@/utils/server-scope"
import { pathKey } from "@/utils/path-key"

export type WorkspaceOperationType = "create" | "move"
export type WorkspaceOperationState = {
  type: WorkspaceOperationType
  status: "pending" | "complete" | "failed"
  directory: string
  messageID?: string
}

export function canMoveSessionToWorkspace(input: {
  queued: number
  failed: boolean
  paused: boolean
  editing: boolean
}) {
  return input.queued === 0 && !input.failed && !input.paused && !input.editing
}

const state = new Map<string, WorkspaceOperationState>()
const [version, setVersion] = createSignal(0)
const key = (scope: ServerScope, sessionID: string) => ScopedKey.from(scope, sessionID)
const write = (scope: ServerScope, sessionID: string, value: WorkspaceOperationState) => {
  if (!state.has(key(scope, sessionID)) && state.size >= 100) {
    const terminal = [...state].find(([, item]) => item.status !== "pending")?.[0] ?? state.keys().next().value
    if (terminal) state.delete(terminal)
  }
  state.set(key(scope, sessionID), value)
  setVersion((current) => current + 1)
}
export const WorkspaceOperation = {
  get(scope: ServerScope, sessionID: string) {
    version()
    return state.get(key(scope, sessionID))
  },
  start(scope: ServerScope, sessionID: string, type: WorkspaceOperationType, directory: string, messageID?: string) {
    write(scope, sessionID, { type, directory, messageID, status: "pending" })
  },
  complete(scope: ServerScope, sessionID: string, directory?: string) {
    const current = state.get(key(scope, sessionID))
    if (!current) return
    if (directory && pathKey(directory) !== pathKey(current.directory)) return
    write(scope, sessionID, { ...current, status: "complete" })
  },
  fail(scope: ServerScope, sessionID: string) {
    const current = state.get(key(scope, sessionID))
    if (!current || current.status === "complete") return
    write(scope, sessionID, { ...current, status: "failed" })
  },
}
