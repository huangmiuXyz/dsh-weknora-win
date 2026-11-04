/**
 * Hand a loopback URL to the operating system's default browser.
 *
 * The card cannot do this itself: a `window.open` inside the DSH shell opens an
 * in-app window (or is blocked), not the browser the user actually browses in.
 * The URL is never supplied by the client — the caller passes the supervisor's
 * own address — so this cannot be used to open arbitrary targets.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Fire-and-forget: the browser's lifetime is not the caller's business. */
export async function openExternal(url) {
  const target = String(url)
  if (process.platform === 'win32') {
    // `start` treats its first quoted argument as the window title; the empty
    // argument keeps the URL from being consumed as that title.
    await execFileAsync('cmd.exe', ['/c', 'start', '', target], { windowsHide: true })
    return
  }
  if (process.platform === 'darwin') {
    await execFileAsync('open', [target])
    return
  }
  await execFileAsync('xdg-open', [target])
}