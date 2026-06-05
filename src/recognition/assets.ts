/**
 * Chrome 扩展内模型/静态资源 URL
 */

export function getExtensionAssetUrl(relativePath: string): string {
  var normalized = relativePath.replace(/^\//, '')
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
    return chrome.runtime.getURL(normalized)
  }
  return location.origin + '/' + normalized
}

export function getExtensionModelsBaseUrl(): string {
  return getExtensionAssetUrl('models/').replace(/\/$/, '')
}

/** face-api loadFromUri 基址（须以 / 开头、以 / 结尾） */
export function getExtensionFaceModelsBaseUrl(): string {
  return '/models/face-api/'
}

export function getYoloModelJsonUrl(modelDir: string): string {
  return getExtensionModelsBaseUrl() + '/' + modelDir + '/model.json'
}
