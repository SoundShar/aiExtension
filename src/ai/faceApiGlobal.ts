/**
 * Offscreen 通过 script 注入 face-api，webpack external 可能拿不到 nets
 */

import { ensureExtensionTfReady } from './tfGlobal'

export type FaceApiNamespace = typeof import('@vladmandic/face-api')

var faceApiTfBound = false

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

function buildFaceApiEnvPatch(tfApi: ReturnType<typeof ensureExtensionTfReady>): Record<string, unknown> {
  var patch: Record<string, unknown> = { tf: tfApi }

  if (typeof ImageData !== 'undefined') {
    patch.ImageData = ImageData
  }

  // Offscreen 文档禁止 new HTMLCanvasElement()，须与 Worker 一致改用 OffscreenCanvas
  if (typeof OffscreenCanvas !== 'undefined') {
    patch.Canvas = OffscreenCanvas
    if (typeof OffscreenCanvasRenderingContext2D !== 'undefined') {
      patch.CanvasRenderingContext2D = OffscreenCanvasRenderingContext2D
    }
    patch.createCanvasElement = function() {
      return new OffscreenCanvas(1, 1)
    }
    return patch
  }

  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    patch.createCanvasElement = function() {
      return document.createElement('canvas')
    }
  }

  return patch
}

/**
 * Offscreen 环境初始化 face-api：
 * 1. 绑定 tf-webgpu-bundle 的 globalThis.tf（避免 portrait 挂起超时）
 * 2. 替换 Canvas 工厂（避免 Illegal constructor: HTMLCanvasElement）
 */
export function bindFaceApiToExtensionTf(): void {
  if (faceApiTfBound) {
    return
  }
  const tfApi = ensureExtensionTfReady()
  const faceApi = getFaceApiGlobal()
  const envPatch = buildFaceApiEnvPatch(tfApi)
  faceApi.env.monkeyPatch(envPatch)
  console.info(
    '[canvas-ai][face-api] 环境已适配 Offscreen' +
    (envPatch.Canvas === OffscreenCanvas ? '（OffscreenCanvas）' : '（document.createElement）') +
    (faceApi.tf === tfApi ? '，TensorFlow 已对齐' : '，TensorFlow 已绑定')
  )
  faceApiTfBound = true
}

type FaceDetectImageSource = HTMLCanvasElement | HTMLImageElement | ImageBitmap | OffscreenCanvas

/** 与 Worker bitmapToCanvas 一致：face-api 输入须为 OffscreenCanvas */
export function createOffscreenFaceInput(source: FaceDetectImageSource): OffscreenCanvas {
  var width = source.width
  var height = source.height
  var canvas = new OffscreenCanvas(width, height)
  var context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    throw new Error('OffscreenCanvas 2d context unavailable')
  }
  context.drawImage(source as CanvasImageSource, 0, 0, width, height)
  return canvas
}
