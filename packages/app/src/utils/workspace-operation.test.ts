import { describe, expect, test } from "bun:test"
import { ServerScope } from "./server-scope"
import { canMoveSessionToWorkspace, WorkspaceOperation } from "./workspace-operation"

test("workspace moves require settled followup state", () => {
  expect(canMoveSessionToWorkspace({ queued: 0, failed: false, paused: false, editing: false })).toBe(true)
  expect(canMoveSessionToWorkspace({ queued: 1, failed: false, paused: false, editing: false })).toBe(false)
  expect(canMoveSessionToWorkspace({ queued: 0, failed: true, paused: false, editing: false })).toBe(false)
  expect(canMoveSessionToWorkspace({ queued: 0, failed: false, paused: true, editing: false })).toBe(false)
  expect(canMoveSessionToWorkspace({ queued: 0, failed: false, paused: false, editing: true })).toBe(false)
})

describe("WorkspaceOperation", () => {
  test("settles only the matching pending operation", () => {
    WorkspaceOperation.start(ServerScope.local, "session", "move", "/workspace")
    expect(WorkspaceOperation.get(ServerScope.local, "session")?.status).toBe("pending")
    WorkspaceOperation.complete(ServerScope.local, "session", "/other")
    expect(WorkspaceOperation.get(ServerScope.local, "session")?.status).toBe("pending")
    WorkspaceOperation.complete(ServerScope.local, "session", "/workspace")
    WorkspaceOperation.fail(ServerScope.local, "session")
    expect(WorkspaceOperation.get(ServerScope.local, "session")?.status).toBe("complete")
  })
})
