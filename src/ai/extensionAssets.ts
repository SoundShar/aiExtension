/**
 * Chrome 扩展内模型/静态资源 URL 与 fetch 封装
 */

var nativeFetch: typeof fetch | null = null

export function bindExtensionNativeFetch(): void {
  if (!nativeFetch) {
    nativeFetch = globalThis.fetch.bind(globalThis)
  }
}

/** 将全局 fetch 指向 extensionFetch，供 face-api 等库加载权重 */
export function installExtensionGlobalFetch(): void {
  bindExtensionNativeFetch()
  globalThis.fetch = function(input, init) {
    return extensionFetch(input, init)
  } as typeof fetch
}

export function getExtensionAssetUrl(relativePath: string): string {
  var normalized = relativePath.replace(/^\//, '')
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
    return chrome.runtime.getURL(normalized)
  }
  return location.origin + '/' + normalized
}

/** YOLO model.json 父目录（无末尾斜杠，便于拼接 /yolo11/model.json） */
export function getExtensionModelsBaseUrl(): string {
  return getExtensionAssetUrl('models/').replace(/\/$/, '')
}

/**
 * face-api loadFromUri 基址（须以 / 开头、以 / 结尾）
 * 不可用 chrome-extension://：getModelUris 只识别 http(s)，会把扩展 ID 拼进相对路径导致 404
 */
export function getExtensionFaceModelsBaseUrl(): string {
  return '/models/face-api/'
}

export function getExtensionYoloModelJsonUrl(modelDir: string): string {
  return getExtensionModelsBaseUrl() + '/' + modelDir + '/model.json'
}

/**
 * 扩展内 fetch：失败时带上 URL 与 HTTP 状态，便于区分 404 / CSP
 */
export async function extensionFetch(
  input: RequestInfo,
  init?: RequestInit
): Promise<Response> {
  bindExtensionNativeFetch()
  var url = typeof input === 'string' ? input : (input as Request).url
  try {
    var response = await nativeFetch!(input, init)
    if (!response.ok) {
      throw new Error(
        'Failed to fetch ' + url + ': HTTP ' + response.status + ' ' + response.statusText
      )
    }
    return response
  } catch (error) {
    var message = (error as Error).message || String(error)
    if (message.indexOf('Failed to fetch') >= 0 && message.indexOf('HTTP') < 0) {
      throw new Error(
        'Failed to fetch ' + url + '（网络或 CSP 拦截，请确认 dist/models 已打包且扩展已重新加载）'
      )
    }
    throw error
  }
}
