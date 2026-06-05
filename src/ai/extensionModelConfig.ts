import { YOLOV_PERFORMANCE } from '@/yolo/model'

/** 扩展 TensorFlow 后端：仅 webgpu，禁止 webgl */
export const EXT_TF_BACKEND = 'webgpu' as const

export const EXT_PERFORMANCE = Object.assign({}, YOLOV_PERFORMANCE, {
  detectIntervalMs: 1000,
  /** Offscreen 单 tick 超时（每 tick 仅 object 或 portrait 之一，对齐 aiIdentification 分阶段） */
  detectFrameTimeoutMs: 12000,
  // 与 aiIdentification 一致：object/portrait 分 tick 调度
  staggerYoloAndFace: true,
  bootYoloOnlyDurationMs: 15000,
  faceDetectEveryYoloCycles: 3,
  changeFaceDetectEveryPortraitCycles: 2,
  faceInputSize: 160,
  /** object 阶段不再重复跑 face-api fallback，由 portrait tick 负责人脸 */
  skipYoloFaceFallback: true,
  enableDetectUiLog: true,
  /** 与 Web 一致：Worker 跑 portrait（bitmap→OffscreenCanvas）；失败时降级主线程 */
  useRecognitionWorker: true,
  recognitionWorkerTimeoutMs: 120000,
  recognitionWorkerScriptUrl:
    typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL
      ? chrome.runtime.getURL('worker.js')
      : './worker.js'
})

export function getExtensionModelsBaseUrl(): string {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
    return chrome.runtime.getURL('models/').replace(/\/$/, '')
  }
  return location.origin + '/models'
}
