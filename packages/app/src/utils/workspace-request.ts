export const WORKSPACE_PREPARATION_TIMEOUT_MS = 5 * 60 * 1000
export const WORKSPACE_PLACEMENT_REFRESH_TIMEOUT_MS = 30_000

export async function workspaceRequestWithTimeout<T>(
  request: (signal: AbortSignal) => Promise<T>,
  message: string,
  timeoutMs: number,
) {
  const controller = new AbortController()
  const timer = { id: undefined as ReturnType<typeof setTimeout> | undefined }
  const timeout = new Promise<never>((_, reject) => {
    timer.id = setTimeout(() => {
      controller.abort()
      reject(new Error(message))
    }, timeoutMs)
  })
  return Promise.race([request(controller.signal), timeout])
    .catch((error) => {
      if (controller.signal.aborted) throw new Error(message)
      throw error
    })
    .finally(() => {
      if (timer.id !== undefined) clearTimeout(timer.id)
    })
}
