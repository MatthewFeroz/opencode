import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { getDirectory, getFilename } from "@opencode-ai/core/util/path"
import { createStore } from "solid-js/store"
import { For, Show, type ComponentProps, type JSX } from "solid-js"
import type { Project } from "@/types"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { useSettingsDialog } from "@/components/settings-dialog"
import { pathKey } from "@/utils/path-key"
import { Worktree } from "@/utils/worktree"
import { WorkspaceOperation } from "@/utils/workspace-operation"
import { showToast } from "@/utils/toast"
import type { ServerScope } from "@/utils/server-scope"
import { workspaceDirectories } from "@/utils/workspace"
import {
  WORKSPACE_PLACEMENT_REFRESH_TIMEOUT_MS,
  WORKSPACE_PREPARATION_TIMEOUT_MS,
  workspaceRequestWithTimeout,
} from "@/utils/workspace-request"

export function SessionWorkspaceMenu(props: {
  eligible?: boolean
  sessionID: string
  project: Project
  directory: string
  messageID?: string
  placement?: ComponentProps<typeof MenuV2>["placement"]
  gutter?: number
  class?: string
  contentClass?: string
  children: JSX.Element
  onOpenChange?: (open: boolean) => void
}) {
  const language = useLanguage()
  const serverSDK = useServerSDK()
  const serverSync = useServerSync()
  const openWorkspaces = useSettingsDialog("workspaces")
  const [store, setStore] = createStore({ selected: undefined as string | undefined })
  const operationPending = () => WorkspaceOperation.get(serverSDK().scope, props.sessionID)?.status === "pending"
  const blocked = () =>
    props.eligible === false || operationPending() || serverSync().session.data.session_working(props.sessionID)
  const workspaces = () =>
    workspaceDirectories(props.project).filter((workspace) => pathKey(workspace) !== pathKey(props.directory))

  const fail = (scope: ServerScope, sessionID: string, message: string) => {
    if (WorkspaceOperation.get(scope, sessionID)?.status === "complete") return
    WorkspaceOperation.fail(scope, sessionID)
    showToast({ variant: "error", title: language.t("workspace.move.failed"), description: message })
  }
  const move = async (selection: "create" | string) => {
    if (store.selected || blocked()) return
    const sdk = serverSDK()
    const sync = serverSync()
    const scope = sdk.scope
    const sessionID = props.sessionID
    const messageID = props.messageID
    const source = props.directory
    setStore("selected", selection)

    try {
      const destination =
        selection === "create"
          ? await createWorkspace(
              props.project,
              source,
              sessionID,
              messageID,
              sdk,
              (message) => fail(scope, sessionID, message),
              {
                createFailed: language.t("prompt.toast.worktreeCreateFailed.title"),
              },
            )
          : selection
      if (!destination) return

      WorkspaceOperation.start(scope, sessionID, selection === "create" ? "create" : "move", destination, messageID)
      if (sync.session.data.session_working(sessionID)) throw new Error(language.t("workspace.move.failed"))
      await workspaceRequestWithTimeout(
        (signal) => sdk.api.session.move({ sessionID, directory: destination }, { signal }),
        language.t("workspace.move.failed"),
        WORKSPACE_PREPARATION_TIMEOUT_MS,
      )
      const session = await workspaceRequestWithTimeout(
        (signal) => sync.session.resolve(sessionID, { force: true, signal }),
        language.t("workspace.move.failed"),
        WORKSPACE_PLACEMENT_REFRESH_TIMEOUT_MS,
      )
      if (!session || pathKey(session.location.directory) !== pathKey(destination))
        throw new Error(language.t("workspace.move.failed"))
      WorkspaceOperation.complete(scope, sessionID, destination)
      sync.reindexSession(sessionID, source)
    } catch (error) {
      fail(scope, sessionID, error instanceof Error ? error.message : language.t("common.requestFailed"))
    } finally {
      setStore("selected", undefined)
    }
  }

  return (
    <MenuV2
      placement={props.placement ?? "bottom-end"}
      gutter={props.gutter ?? 4}
      modal={false}
      onOpenChange={props.onOpenChange}
    >
      <MenuV2.Trigger class={props.class} disabled={blocked()}>
        {props.children}
      </MenuV2.Trigger>
      <MenuV2.Portal>
        <MenuV2.Content class={`w-[200px] ${props.contentClass ?? ""}`}>
          <MenuV2.Group>
            <MenuV2.GroupLabel>{language.t("workspace.move.menu.title")}</MenuV2.GroupLabel>
            <Show when={pathKey(props.directory) !== pathKey(props.project.worktree)}>
              <MenuV2.Item disabled={!!store.selected || blocked()} onSelect={() => void move(props.project.worktree)}>
                <Icon name="monitor" />
                {language.t("session.new.workspace.local")}
              </MenuV2.Item>
            </Show>
            <MenuV2.Item disabled={!!store.selected || blocked()} onSelect={() => void move("create")}>
              <Icon name="workspace-new" />
              {language.t("workspace.new")}
            </MenuV2.Item>
            <Show when={workspaces().length > 0}>
              <MenuV2.Sub gutter={0} overlap overflowPadding={8}>
                <MenuV2.SubTrigger>
                  <Icon name="workspace-isolated" />
                  {language.t("session.new.workspace.existing").replace(/(…|\.{3})$/, "")}
                </MenuV2.SubTrigger>
                <MenuV2.Portal>
                  <MenuV2.SubContent class="max-h-[calc(100dvh-16px)] w-[200px] overflow-y-auto">
                    <For each={workspaces()}>
                      {(workspace) => (
                        <MenuV2.Item disabled={!!store.selected || blocked()} onSelect={() => void move(workspace)}>
                          <Icon name="workspace-isolated" />
                          <span class="min-w-0 flex-1 truncate">{getFilename(workspace)}</span>
                        </MenuV2.Item>
                      )}
                    </For>
                  </MenuV2.SubContent>
                </MenuV2.Portal>
              </MenuV2.Sub>
            </Show>
          </MenuV2.Group>
          <MenuV2.Separator class="h-[0.5px] bg-v2-border-border-base" />
          <MenuV2.Item onSelect={() => openWorkspaces()}>
            <span class="min-w-0 flex-1 truncate">{language.t("common.viewAll")}</span>
          </MenuV2.Item>
        </MenuV2.Content>
      </MenuV2.Portal>
    </MenuV2>
  )
}

async function createWorkspace(
  project: Project,
  source: string,
  sessionID: string,
  messageID: string | undefined,
  serverSDK: ReturnType<ReturnType<typeof useServerSDK>>,
  fail: (message: string) => void,
  messages: { createFailed: string },
) {
  WorkspaceOperation.start(serverSDK.scope, sessionID, "create", project.worktree, messageID)
  const created = await workspaceRequestWithTimeout(
    (signal) =>
      serverSDK.api.projectCopy.create(
        {
          projectID: project.id,
          strategy: "git_worktree",
          directory: getDirectory(source),
          location: { directory: source },
        },
        { signal },
      ),
    messages.createFailed,
    WORKSPACE_PREPARATION_TIMEOUT_MS,
  )
    .catch((error) => {
      fail(error instanceof Error ? error.message : messages.createFailed)
      return undefined
    })
  if (!created?.directory) return
  WorkspaceOperation.start(serverSDK.scope, sessionID, "create", created.directory, messageID)
  Worktree.ready(serverSDK.scope, created.directory)
  return created.directory
}
