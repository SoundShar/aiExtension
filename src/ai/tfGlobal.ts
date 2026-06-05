/**
 * Offscreen / Worker 通过 script 注入 TensorFlow.js，webpack external 的 import * as tf
 * 可能拿不到 setBackend。统一从此处解析 globalThis.tf。
 */

import { extensionFetch } from './extensionAssets'

export type TfNamespace = typeof import('@tensorflow/tfjs')

var extensionTfIoRegistered = false

function pickTfNamespace(candidate: unknown): TfNamespace | null {
  if (!candidate || typeof candidate !== 'object') {
    return null
  }
  const record = candidate as TfNamespace & { default?: TfNamespace }
  if (typeof record.setBackend === 'function') {
    return record
  }
  if (record.default && typeof record.default.setBackend === 'function') {
    return record.default
  }
  return null
}

function tfCoreIsReady(tfApi: TfNamespace): boolean {
  return typeof tfApi.env === 'function' && typeof tfApi.setBackend === 'function'
}

function tfHasWebgpuBackend(tfApi: TfNamespace): boolean {
  if (typeof tfApi.findBackend !== 'function') {
    return false
  }
  try {
    return Boolean(tfApi.findBackend('webgpu'))
  } catch (error) {
    return false
  }
}

function collectTfCandidates(): TfNamespace[] {
  const root = globalThis as typeof globalThis & {
    tf?: unknown
    faceapi?: { tf?: unknown }
  }
  const list: TfNamespace[] = []
  const seen = new Set<TfNamespace>()

  function pushUnique(candidate: unknown): void {
    const picked = pickTfNamespace(candidate)
    if (!picked || seen.has(picked)) {
      return
    }
    seen.add(picked)
    list.push(picked)
  }

  pushUnique(root.tf)
  pushUnique(root.faceapi && root.faceapi.tf)
  if (typeof tf !== 'undefined') {
    pushUnique(tf)
  }

  return list
}

/**
 * 解析可用的 TensorFlow.js 全局对象。
 * 优先选用已注册 webgpu 后端的实例（避免用到 face-api 内嵌 tf 而 webgpu 挂在 globalThis.tf 上）。
 */
export function getTfGlobal(): TfNamespace {
  const candidates = collectTfCandidates()

  if (!candidates.length) {
    throw new Error(
      'TensorFlow.js 未就绪：请确认已先加载 js/tf-webgpu-bundle.js，再加载 js/face-api.js'
    )
  }

  const ready = candidates.filter(tfCoreIsReady)
  const pool = ready.length ? ready : candidates

  const withWebgpu = pool.find(tfHasWebgpuBackend)
  if (withWebgpu) {
    return withWebgpu
  }

  return pool[0]
}

/** TensorFlow WebGPU bundle 是否已完整加载（供 Offscreen 启动诊断） */
export function assertExtensionTfCoreReady(): void {
  const root = globalThis as typeof globalThis & { tf?: unknown }
  const tfApi = pickTfNamespace(root.tf)
  if (!tfApi || !tfCoreIsReady(tfApi)) {
    throw new Error(
      'TensorFlow WebGPU bundle 未正确初始化（缺少 tf.env）。请重新 yarn build 并从 dist/ 加载扩展，确认 js/tf-webgpu-bundle.js 已加载。'
    )
  }
}

/** 是否已在当前解析到的 tf 上注册 webgpu 后端 */
export function isExtensionWebgpuBackendRegistered(): boolean {
  try {
    return tfHasWebgpuBackend(getTfGlobal())
  } catch (error) {
    return false
  }
}

function isExtensionAssetUrl(url: string): boolean {
  return url.indexOf('chrome-extension://') === 0
}

/**
 * 为 chrome-extension:// 注册 TF IO 路由，并统一使用 extensionFetch
 */
export function registerExtensionTfIoRouter(tfApi: TfNamespace): void {
  if (extensionTfIoRegistered) {
    return
  }
  extensionTfIoRegistered = true

  tfApi.io.registerLoadRouter(function(url, loadOptions) {
    var path = Array.isArray(url) ? url[0] : url
    if (typeof path !== 'string' || !isExtensionAssetUrl(path)) {
      return null
    }
    return tfApi.io.browserHTTPRequest(url, Object.assign({}, loadOptions || {}, {
      fetchFunc: extensionFetch
    }))
  })
}

/** 解析全局 tf 并注册扩展 IO（在 offscreen 首帧推理前调用一次） */
export function ensureExtensionTfReady(): TfNamespace {
  var tfApi = getTfGlobal()
  registerExtensionTfIoRouter(tfApi)
  return tfApi
}

