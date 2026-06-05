/** 扩展识别配置（Worker 单路径，无主线程降级） */

export const RECOGNITION_CONFIG = {
  detectIntervalMs: 1000,
  detectFrameTimeoutMs: 12000,
  bootYoloOnlyDurationMs: 15000,
  changeFaceDetectEveryPortraitCycles: 2,
  yoloInputSize: 640,
  nmsMaxBoxes: 50,
  fenceWidthRatio: 0.8,
  fenceHeightRatio: 0.8,
  faceDetectorType: 'Tiny' as 'Tiny' | 'SSD',
  faceScoreThreshold: 0.2,
  faceInputSize: 160,
  defaultModelId: 'yolo11' as const,
  defaultModelDir: 'yolo11',
  recognitionWorkerScriptUrl:
    typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL
      ? chrome.runtime.getURL('worker.js')
      : './worker.js',
  recognitionWorkerTimeoutMs: 120000,
  enableDetectUiLog: true
}

export type YoloModelId = typeof RECOGNITION_CONFIG.defaultModelId
