import { YOLOV_PERFORMANCE } from '@/yolo/model'

/** 扩展 TensorFlow 后端：仅 webgpu，禁止 webgl */
export const EXT_TF_BACKEND = 'webgpu' as const

export const EXT_PERFORMANCE = Object.assign({}, YOLOV_PERFORMANCE, {
  detectIntervalMs: 1000,
  /** Offscreen 单 tick 超时（full 模式同 tick 跑 YOLO+face，耗时更长） */
  detectFrameTimeoutMs: 12000,
  /** false：同 tick 全量检测（detect-full）；启动 15s 内仍仅 YOLO */
  staggerYoloAndFace: false,
  bootYoloOnlyDurationMs: 15000,
  faceDetectEveryYoloCycles: 1,
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
