/**
 * The one API key this plugin owns: validation, in-process activation, and
 * persistence into the Windows user environment.
 *
 * The retrieval side is a separate bundle (`@wxg-prc-cpg/dsh-weknora`) whose
 * default config reads `process.env.WEKNORA_API_KEY` and
 * `process.env.WEKNORA_BASE_URL` at load time. Saving the key therefore means
 * two independent things: make it true for the running host process (this
 * plugin can use it immediately) and make it true for the next launch through
 * `setx` (the retrieval bundle reads it then). Nothing is written to a profile.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Environment variable names the retrieval bundle reads by default. */
export const ENV_API_KEY = 'WEKNORA_API_KEY'
export const ENV_BASE_URL = 'WEKNORA_BASE_URL'

/** The REST surface of one WeKnora server: the retrieval bundle expects `/api/v1`. */
export function apiBaseUrl(host, port) {
  return `http://${host}:${port}/api/v1`
}

/** A key short enough to show in the card: `sk-****3f2a`. Never the full value. */
export function maskKey(key) {
  if (typeof key !== 'string' || key.trim() === '') return ''
  const trimmed = key.trim()
  if (trimmed.length <= 8) return '****'
  return `${trimmed.slice(0, 3)}****${trimmed.slice(-4)}`
}

/** Whether a key is configured for this process right now. */
export function isConfigured(env = process.env) {
  return typeof env[ENV_API_KEY] === 'string' && env[ENV_API_KEY].trim() !== ''
}

/**
 * Prove the key works before persisting it.
 *
 * A key that fails here would leave the user with a "saved" state that never
 * retrieves anything, so the validation request is the price of the button
 * doing something real. `knowledge-bases` needs the `retrieve` capability and
 * answers 200 for any usable key; an empty list is still a success.
 */
export async function validateApiKey({ apiKey, baseUrl, fetchImpl = globalThis.fetch, timeoutMs = 8_000 }) {
  if (typeof fetchImpl !== 'function') throw new Error('当前环境没有 fetch，无法校验 API Key')
  const url = `${String(baseUrl).replace(/\/+$/, '')}/knowledge-bases`
  let response
  try {
    response = await fetchImpl(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json', 'X-API-Key': apiKey }
    })
  } catch (error) {
    throw new Error(`无法连接 WeKnora（${url}）：${String(error?.message ?? error)}`)
  }
  if (response.ok) return
  let detail = ''
  try {
    const body = await response.json()
    detail = typeof body?.error?.message === 'string' ? `：${body.error.message}` : ''
  } catch {
    /* a non-JSON error body still carries the status */
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error(`API Key 无效或没有检索能力（HTTP ${response.status}）${detail}`)
  }
  throw new Error(`校验 API Key 失败（HTTP ${response.status}）${detail}`)
}

/**
 * Persist one variable in the Windows user environment.
 *
 * `setx` is the store a later `dsh web` launch inherits without this plugin
 * running first. Values travel as argv, never through a shell, and a key never
 * reaches setx's 1024-character limit.
 */
export async function persistEnv(name, value) {
  if (process.platform !== 'win32') {
    throw new Error('当前平台不支持写入用户环境变量（仅 Windows）')
  }
  try {
    await execFileAsync('setx', [name, value], { windowsHide: true })
  } catch (error) {
    const detail = String(error?.stderr ?? '').trim() || String(error?.message ?? error)
    throw new Error(`写入环境变量 ${name} 失败：${detail}`)
  }
}

/**
 * Save a validated key for this process and the next launch.
 *
 * `env` and `persist` are injectable so the unit test never touches the real
 * user environment. Both variables are written together: a key without the
 * matching base URL would make the retrieval bundle talk to port 8080 while
 * this plugin serves 18080.
 */
export async function saveApiKey({
  apiKey,
  host,
  port,
  env = process.env,
  persist = persistEnv,
  fetchImpl = globalThis.fetch
}) {
  const key = String(apiKey ?? '').trim()
  if (key === '') throw new Error('请先填写 API Key')
  if (key.length < 8) throw new Error('API Key 太短，请检查是否复制完整')
  if (key.length > 512) throw new Error('API Key 太长，请检查是否粘贴了多余内容')

  const baseUrl = apiBaseUrl(host, port)
  await validateApiKey({ apiKey: key, baseUrl, fetchImpl })

  env[ENV_API_KEY] = key
  env[ENV_BASE_URL] = baseUrl
  await persist(ENV_API_KEY, key)
  await persist(ENV_BASE_URL, baseUrl)

  return { ok: true, configured: true, hint: maskKey(key), baseUrl }
}