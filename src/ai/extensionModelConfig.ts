import { YOLOV_PERFORMANCE } from '@/yolo/model'

/** 扩展 TensorFlow 后端：仅 webgpu，禁止 webgl */
export const EXT_TF_BACKEND = 'webgpu' as const

export const EXT_PERFORMANCE = Object.assign({}, YOLOV_PERFORMANCE, {
  detectIntervalMs: 1000,
  /** Offscreen 单帧推理超时；超时后丢弃滞后结果并继续下一帧 */
  detectFrameTimeoutMs: 45000,
  // 扩展 detectFrame 固定 mode=object，下列 portrait 调度仅作兜底（不应触发）。
  staggerYoloAndFace: true,
  bootYoloOnlyDurationMs: 86400000,
  faceDetectEveryYoloCycles: 9999,
  changeFaceDetectEveryPortraitCycles: 3,
  enableDetectUiLog: true,
  /** 扩展 Offscreen 内 Worker 加载 chrome-extension:// 模型易 Failed to fetch，默认主线程 */
  useRecognitionWorker: false,
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
