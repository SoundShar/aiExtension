export const DEFAULT_MASTER_FACE_PATH = 'image/123213123.png'

export function getDefaultMasterFaceUrl(): string | null {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
    return chrome.runtime.getURL(DEFAULT_MASTER_FACE_PATH)
  }
  return null
}
