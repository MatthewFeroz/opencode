import { describe, expect, test } from "bun:test"
import type { OpenCodeEvent } from "@opencode-ai/client/promise"
import {
  adaptServerEvent,
  applyWorkspaceOperationEvent,
  coalesceServerEvents,
  enqueueServerEvent,
  resumeStreamAfterPageShow,
} from "./server-sdk"
import { ServerScope } from "@/utils/server-scope"
import { WorkspaceOperation } from "@/utils/workspace-operation"

test("a moved event completes the matching workspace operation", () => {
  WorkspaceOperation.start(ServerScope.local, "current", "move", "/workspace")
  applyWorkspaceOperationEvent(ServerScope.local, {
    directory: "/workspace",
    payload: adaptServerEvent({
      id: "moved-current",
      created: Date.now(),
      type: "session.moved",
      durable: { aggregateID: "current", seq: 1, version: 1 },
      data: { sessionID: "current", location: { directory: "/workspace" } },
    } satisfies Extract<OpenCodeEvent, { type: "session.moved" }>),
  })
  expect(WorkspaceOperation.get(ServerScope.local, "current")?.status).toBe("complete")
})

describe("resumeStreamAfterPageShow", () => {
  test("restarts a stream only after a back-forward cache restore", () => {
    let starts = 0
    const start = () => starts++

    resumeStreamAfterPageShow({ persisted: false } as PageTransitionEvent, start)
    resumeStreamAfterPageShow({ persisted: true } as PageTransitionEvent, start)

    expect(starts).toBe(1)
  })
})

describe("adaptServerEvent", () => {
  test("preserves current permission requests", () => {
    const current = {
      id: "evt_1",
      created: 1,
      type: "permission.asked",
      data: {
        id: "perm_1",
        sessionID: "ses_1",
        action: "read",
        resources: ["src/**"],
        source: { type: "tool", messageID: "msg_1", id: "call_1" },
      },
    } as OpenCodeEvent

    expect(adaptServerEvent(current)).toMatchObject({
      id: "evt_1",
      type: "permission.asked",
      properties: {
        id: "perm_1",
        sessionID: "ses_1",
        action: "read",
        resources: ["src/**"],
        source: { type: "tool", messageID: "msg_1", id: "call_1" },
      },
      current,
    })
  })
})

describe("current event buffering", () => {
  const delta = (id: string, value: string, ordinal = 0) => ({
    directory: "/repo",
    payload: adaptServerEvent({
      id,
      created: 1,
      type: "session.text.delta",
      location: { directory: "/repo" },
      data: { sessionID: "ses", assistantMessageID: "msg", ordinal, delta: value },
    } as OpenCodeEvent),
  })

  test("merges adjacent text deltas for the same message and ordinal", () => {
    const result = coalesceServerEvents([delta("evt_1", "hello "), delta("evt_2", "world")])

    expect(result).toHaveLength(1)
    expect(result[0]?.payload.current).toMatchObject({ id: "evt_2", data: { delta: "hello world" } })
    expect(result[0]?.payload.properties).toMatchObject({ delta: "hello world" })
  })

  test("coalesces current tool input deltas by tool ID", () => {
    const current = (eventID: string, id: string, delta: string) =>
      adaptServerEvent({
        id: eventID,
        created: 1,
        type: "session.tool.input.delta",
        location: { directory: "/repo" },
        data: { sessionID: "ses", assistantMessageID: "msg", id, delta },
      } satisfies Extract<OpenCodeEvent, { type: "session.tool.input.delta" }>)
    const result = coalesceServerEvents([
      { directory: "/repo", payload: current("evt_1", "call_1", "{") },
      { directory: "/repo", payload: current("evt_2", "call_1", "}") },
      { directory: "/repo", payload: current("evt_3", "call_2", "[]") },
    ])

    expect(result).toHaveLength(2)
    expect(result[0]?.payload.current).toMatchObject({ id: "evt_2", data: { id: "call_1", delta: "{}" } })
    expect(result[1]?.payload.current).toMatchObject({ id: "evt_3", data: { id: "call_2", delta: "[]" } })
  })

  test("preserves boundaries between distinct delta streams", () => {
    const events = [delta("evt_1", "a"), delta("evt_2", "b", 1), delta("evt_3", "c")]

    expect(coalesceServerEvents(events).map((event) => event.payload.current?.id)).toEqual(["evt_1", "evt_2", "evt_3"])
  })

  test("preserves current event order when enqueuing", () => {
    const events: Parameters<typeof enqueueServerEvent>[0] = []
    ;[delta("evt_1", "a"), delta("evt_2", "b", 1)].forEach((event) => enqueueServerEvent(events, event))

    expect(events.map((event) => event.payload.current?.id)).toEqual(["evt_1", "evt_2"])
  })
})
