/** 扩展内置换人基准人脸（public/image/123213123.png） */
export const EXTENSION_DEFAULT_MASTER_FACE_PATH = 'image/123213123.png'

export function getDefaultMasterFaceUrl(): string | null {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
    return chrome.runtime.getURL(EXTENSION_DEFAULT_MASTER_FACE_PATH)
  }
  return null
}
