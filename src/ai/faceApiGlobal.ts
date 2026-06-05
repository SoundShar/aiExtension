/**
 * Offscreen 通过 script 注入 face-api，webpack external 可能拿不到 nets
 */

export type FaceApiNamespace = typeof import('@vladmandic/face-api')

function pickFaceApiNamespace(candidate: unknown): FaceApiNamespace | null {
  if (!candidate || typeof candidate !== 'object') {
    return null
  }
  const record = candidate as FaceApiNamespace & { default?: FaceApiNamespace }
  if (record.nets && record.nets.tinyFaceDetector) {
    return record
  }
  if (record.default && record.default.nets && record.default.nets.tinyFaceDetector) {
    return record.default
  }
  return null
}

export function getFaceApiGlobal(): FaceApiNamespace {
  const root = globalThis as typeof globalThis & { faceapi?: unknown }

  const resolved =
    pickFaceApiNamespace(root.faceapi) ||
    (typeof faceapi !== 'undefined' ? pickFaceApiNamespace(faceapi) : null)

  if (!resolved) {
    throw new Error('face-api 未就绪：请确认已加载 js/face-api.js')
  }

  return resolved
}
