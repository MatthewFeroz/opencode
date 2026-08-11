import { base64Encode } from "@opencode-ai/core/util/encode"
import type { OpenCodeEvent, SessionInfo } from "@opencode-ai/client/promise"
import { expect, test, type Page, type Route } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"
import { installSseTransport } from "../utils/sse-transport"

const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const root = "C:/OpenCode/WorkspaceProject"
const workspace = "C:/OpenCode/worktree/project/feature"
const createdWorkspace = "C:/OpenCode/worktree/project/quick-contrast-fix"
const project = {
  id: "proj_workspaces",
  canonical: root,
  vcs: "git" as const,
  name: "workspace-project",
  time: { created: 1, updated: 1 },
  sandboxes: [workspace],
}
const provider = {
  all: [
    {
      id: "opencode",
      name: "OpenCode",
      models: { test: { id: "test", name: "Test model", limit: { context: 200_000 } } },
    },
  ],
  connected: ["opencode"],
  default: { providerID: "opencode", modelID: "test" },
}
const diff = {
  file: "src/workspace.ts",
  additions: 3,
  deletions: 1,
  status: "modified" as const,
  patch: "@@ -1 +1 @@\n-export const workspace = false\n+export const workspace = true",
}
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type",
}

function session(id: string, directory: string, title?: string): SessionInfo {
  return {
    id,
    projectID: project.id,
    agent: "build",
    model: { providerID: "opencode", id: "test" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    title,
    location: { directory },
    subpath: "",
    time: { created: 1, updated: 2 },
  }
}

function userMessage(id: string, text: string) {
  return { id, type: "user" as const, time: { created: 1 }, text }
}

async function json(route: Route, body: unknown) {
  await route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(body) })
}

async function init(page: Page, tab: Record<string, unknown>) {
  await page.addInitScript(
    ({ root, server, tab }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({ projects: { local: [{ worktree: root, expanded: true }] }, lastProject: { local: root } }),
      )
      localStorage.setItem("opencode.window.browser.dat:tabs", JSON.stringify([{ server, ...tab }]))
    },
    { root, server, tab },
  )
}

test("selects an existing workspace from the start menu", async ({ page }) => {
  const draftID = "draft_workspaces"
  await mockOpenCodeServer(page, {
    protocol: "v2",
    directory: root,
    project,
    provider,
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })
  await init(page, { type: "draft", draftID, directory: root })
  const directories = page.waitForRequest(
    (request) =>
      request.method() === "GET" &&
      new URL(request.url()).pathname === `/api/project/${project.id}/directories`,
  )

  await page.goto(`/new-session?draftId=${draftID}`)
  await directories
  await expectAppVisible(page.getByRole("textbox", { name: "Prompt" }))

  await page.getByRole("button", { name: "Local", exact: true }).click()
  await page.getByRole("menuitem", { name: "Workspace" }).hover()
  await page.getByRole("menuitem", { name: "feature", exact: true }).click()
  await expect(page.getByRole("button", { name: "feature", exact: true })).toBeVisible()
})

test("lists and manually deletes workspaces from settings", async ({ page }) => {
  const draftID = "draft_workspace_settings"
  const cleanWorkspace = `${workspace}-clean`
  const inventory = { ...project, sandboxes: [cleanWorkspace] }
  let releaseSessions = () => {}
  const sessionsReady = new Promise<void>((resolve) => {
    releaseSessions = resolve
  })

  await mockOpenCodeServer(page, {
    protocol: "v2",
    directory: root,
    project: inventory,
    provider,
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })
  await page.route("**/api/session**", async (route) => {
    const url = new URL(route.request().url())
    if (
      route.request().method() !== "GET" ||
      url.pathname !== "/api/session" ||
      url.searchParams.get("limit") !== "100" ||
      url.searchParams.get("order") !== "desc"
    )
      return route.fallback()
    await sessionsReady
    await json(route, { data: [], cursor: {} })
  })
  await init(page, { type: "draft", draftID, directory: root })
  const directories = page.waitForRequest(
    (request) =>
      request.method() === "GET" &&
      new URL(request.url()).pathname === `/api/project/${project.id}/directories`,
  )

  await page.goto(`/new-session?draftId=${draftID}`)
  await directories
  await expectAppVisible(page.getByRole("textbox", { name: "Prompt" }))

  await page.getByRole("button", { name: "Local", exact: true }).click()
  await page.getByRole("menuitem", { name: "Workspace" }).hover()
  const sessions = page.waitForRequest(
    (request) =>
      request.method() === "GET" &&
      new URL(request.url()).pathname === "/api/session" &&
      new URL(request.url()).searchParams.get("limit") === "100",
  )
  await page.getByRole("menuitem", { name: "View all", exact: true }).click()
  await sessions

  const settings = page.getByRole("dialog")
  await expect(settings.getByRole("tab", { name: "Workspaces" })).toHaveAttribute("data-selected")
  await expect(page.locator('[data-component="session-new-design"]')).toBeAttached()
  releaseSessions()
  await expect(settings.getByLabel(cleanWorkspace, { exact: true })).toBeVisible()

  await settings.getByRole("button", { name: 'Delete workspace "feature-clean"?' }).click()
  const confirmation = page.getByRole("dialog").filter({ hasText: 'Delete workspace "feature-clean"?' })
  const removed = page.waitForRequest(
    (request) =>
      request.method() === "DELETE" &&
      new URL(request.url()).pathname === `/experimental/project/${project.id}/copy`,
  )
  await confirmation.getByRole("button", { name: "Delete workspace", exact: true }).click()
  const request = await removed
  expect(new URL(request.url()).searchParams.get("location[directory]")).toBe(root)
  expect(request.postDataJSON()).toEqual({ directory: cleanWorkspace, force: true })
  await expect(settings.getByLabel(cleanWorkspace, { exact: true })).toHaveCount(0)
})

test("submits the owning prompt after a new workspace is created", async ({ page }) => {
  const draftID = "draft_workspace_submit"
  const sessionID = "ses_workspace_submit"
  const createdSession = session(sessionID, createdWorkspace)
  let releaseCopy = () => {}
  const copyReady = new Promise<void>((resolve) => {
    releaseCopy = resolve
  })

  await mockOpenCodeServer(page, {
    protocol: "v2",
    directory: root,
    project,
    provider,
    sessions: [],
    pageMessages: () => ({ items: [] }),
  })
  await page.route(`**/experimental/project/${project.id}/copy**`, async (route) => {
    const request = route.request()
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors })
    if (request.method() !== "POST") return route.fallback()
    await copyReady
    await json(route, { directory: createdWorkspace })
  })
  await page.route("**/api/session**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const promptPath = `/api/session/${sessionID}/prompt`
    if (request.method() === "OPTIONS" && (url.pathname === "/api/session" || url.pathname === promptPath))
      return route.fulfill({ status: 204, headers: cors })
    if (request.method() === "POST" && url.pathname === "/api/session")
      return json(route, { data: createdSession })
    if (request.method() === "GET" && url.pathname === `/api/session/${sessionID}`)
      return json(route, { data: createdSession })
    if (request.method() !== "POST" || url.pathname !== promptPath) return route.fallback()
    const input = request.postDataJSON() as { id: string; text: string }
    await json(route, {
      data: {
        id: input.id,
        sessionID,
        timeCreated: 3,
        type: "user",
        data: { text: input.text },
        delivery: "steer",
      },
    })
  })
  await init(page, { type: "draft", draftID, directory: root })

  await page.goto(`/new-session?draftId=${draftID}`)
  const editor = page.getByRole("textbox", { name: "Prompt" })
  await expectAppVisible(editor)
  await page.getByRole("button", { name: "Local", exact: true }).click()
  await page.getByRole("menuitem", { name: "New workspace", exact: true }).click()
  await editor.fill("Build workspace support")

  const copied = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === `/experimental/project/${project.id}/copy`,
  )
  const created = page.waitForRequest(
    (request) => request.method() === "POST" && new URL(request.url()).pathname === "/api/session",
  )
  const sent = page.waitForRequest(
    (request) => request.method() === "POST" && new URL(request.url()).pathname === `/api/session/${sessionID}/prompt`,
  )
  await page.getByRole("button", { name: "Send", exact: true }).click()

  const copyRequest = await copied
  expect(new URL(copyRequest.url()).searchParams.get("location[directory]")).toBe(root)
  expect(copyRequest.postDataJSON()).toEqual({ strategy: "git_worktree", directory: "C:/OpenCode" })
  releaseCopy()

  expect((await created).postDataJSON()).toEqual({
    agent: "build",
    model: { id: "test", providerID: "opencode" },
    location: { directory: createdWorkspace },
  })
  const promptRequest = await sent
  expect(promptRequest.postDataJSON()).toEqual({
    id: expect.stringMatching(/^msg_/),
    text: "Build workspace support",
    files: [],
    agents: [],
  })
  await expect(page.getByText("Workspace created", { exact: true })).toBeVisible()
})

test("moves a changed local session through workspace creation without changing lifecycle semantics", async ({
  page,
}) => {
  const sessionID = "ses_workspace_move_new"
  const messageID = "msg_workspace_move_new"
  const currentSession = session(sessionID, root, "Create a workspace")
  const transport = await installSseTransport<OpenCodeEvent>(page, { server })
  let releaseCopy = () => {}
  const copyReady = new Promise<void>((resolve) => {
    releaseCopy = resolve
  })
  let releaseMove = () => {}
  const moveReady = new Promise<void>((resolve) => {
    releaseMove = resolve
  })

  await mockOpenCodeServer(page, {
    protocol: "v2",
    directory: root,
    project,
    provider,
    sessions: [currentSession],
    pageMessages: () => ({ items: [userMessage(messageID, "Create isolated workspace")] }),
    vcsDiff: [diff],
  })
  await page.route(`**/experimental/project/${project.id}/copy**`, async (route) => {
    const request = route.request()
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors })
    if (request.method() !== "POST") return route.fallback()
    await copyReady
    await json(route, { directory: createdWorkspace })
  })
  await page.route(`**/api/session/${sessionID}**`, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === "OPTIONS" && url.pathname === `/api/session/${sessionID}/move`)
      return route.fulfill({ status: 204, headers: cors })
    if (request.method() === "GET" && url.pathname === `/api/session/${sessionID}`)
      return json(route, { data: currentSession })
    if (request.method() !== "POST" || url.pathname !== `/api/session/${sessionID}/move`)
      return route.fallback()
    await moveReady
    currentSession.location.directory = createdWorkspace
    await route.fulfill({ status: 204, headers: cors })
  })
  await init(page, { type: "session", sessionId: sessionID })

  await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
  await transport.waitForConnection()
  await page.getByRole("button", { name: "Session details", exact: true }).click()
  await page.getByRole("button", { name: "Local repository", exact: true }).click()

  const copied = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === `/experimental/project/${project.id}/copy`,
  )
  const moved = page.waitForRequest(
    (request) =>
      request.method() === "POST" && new URL(request.url()).pathname === `/api/session/${sessionID}/move`,
  )
  await page.getByRole("menuitem", { name: "New workspace", exact: true }).click()

  await copied
  await expect(page.getByText("Creating workspace", { exact: true })).toBeVisible()
  releaseCopy()

  const moveRequest = await moved
  expect(moveRequest.postDataJSON()).toEqual({ directory: createdWorkspace })
  await transport.send({
    id: "evt_workspace_created",
    created: 3,
    type: "session.moved",
    durable: { aggregateID: sessionID, seq: 1, version: 1 },
    location: { directory: root },
    data: {
      sessionID,
      location: { directory: createdWorkspace },
      subpath: "",
    },
  })
  releaseMove()
  await expect(page.getByText("Workspace created", { exact: true })).toBeVisible()
})
