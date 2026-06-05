export const MSG = {
  START_SESSION: 'START_SESSION',
  STOP_SESSION: 'STOP_SESSION',
  START_CAPTURE: 'START_CAPTURE',
  STOP_CAPTURE: 'STOP_CAPTURE',
  CANVAS_FRAME: 'CANVAS_FRAME',
  CAPTURE_ERROR: 'CAPTURE_ERROR',
  FRAME_PREVIEW: 'FRAME_PREVIEW',
  DETECT_FRAME: 'DETECT_FRAME',
  DETECT_RESULT: 'DETECT_RESULT',
  ANALYSIS_LOG: 'ANALYSIS_LOG',
  SET_MASTER_FACE: 'SET_MASTER_FACE',
  ENGINE_STATUS: 'ENGINE_STATUS',
  SESSION_ERROR: 'SESSION_ERROR',
  SESSION_STATE: 'SESSION_STATE'
} as const

export type CaptureErrorCode = 'NO_CANVAS' | 'TAINTED' | 'ZERO_SIZE'

export interface CanvasFramePayload {
  type: typeof MSG.CANVAS_FRAME
  tabId: number
  jpeg: string
  width: number
  height: number
  timestamp: number
}

export interface CaptureErrorPayload {
  type: typeof MSG.CAPTURE_ERROR
  tabId: number
  code: CaptureErrorCode
  message: string
}

export interface DetectFramePayload {
  type: typeof MSG.DETECT_FRAME
  tabId: number
  jpeg: string
  width: number
  height: number
  timestamp: number
}

export interface DetectionResultFlags {
  not_person: boolean
  multi_person: boolean
  has_book: boolean
  has_phone: boolean
  has_pitch: boolean
  has_yaw: boolean
  has_change_face: boolean
  has_out_bounds: boolean
}

export interface DetectResultPayload {
  type: typeof MSG.DETECT_RESULT
  tabId: number
  phase: string
  flags: DetectionResultFlags
  timestamp: number
  success: boolean
  errorMessage?: string
}

export interface AnalysisLogPayload {
  type: typeof MSG.ANALYSIS_LOG
  tabId: number
  phase: string
  flags: DetectionResultFlags
  timestamp: number
  text: string
  hasAlert: boolean
  /** 仅更新常驻结果区，不写入滚动日志 */
  summaryOnly?: boolean
}

export interface FramePreviewPayload {
  type: typeof MSG.FRAME_PREVIEW
  tabId: number
  jpeg: string
  width: number
  height: number
  timestamp: number
}

export interface SessionErrorPayload {
  type: typeof MSG.SESSION_ERROR
  tabId: number
  message: string
}

export interface SessionStatePayload {
  type: typeof MSG.SESSION_STATE
  tabId: number
  running: boolean
  engineReady: boolean
  message: string
}

export interface EngineStatusPayload {
  type: typeof MSG.ENGINE_STATUS
  ready: boolean
  message: string
}

export const CAPTURE_ERROR_MESSAGES: Record<CaptureErrorCode, string> = {
  NO_CANVAS: '页面上未找到 canvas 元素',
  TAINTED: 'canvas 已被跨域污染，无法导出 JPEG',
  ZERO_SIZE: 'canvas 宽高为 0，无法抓取'
}

/** 推理字段 → 中文（输出格式：not_person=无人） */
export const DETECTION_FLAG_LABELS: Record<keyof DetectionResultFlags, string> = {
  not_person: '无人',
  multi_person: '多人',
  has_book: '疑似书籍',
  has_phone: '疑似手机',
  has_pitch: '低头',
  has_yaw: '转头',
  has_change_face: '换人',
  has_out_bounds: '越界'
}

const DETECTION_FLAG_ORDER: Array<keyof DetectionResultFlags> = [
  'not_person',
  'multi_person',
  'has_book',
  'has_phone',
  'has_pitch',
  'has_yaw',
  'has_change_face',
  'has_out_bounds'
]

export function formatDetectionFlagsChinese(flags: DetectionResultFlags): string {
  var parts: string[] = []
  DETECTION_FLAG_ORDER.forEach(function(flagKey) {
    if (flags[flagKey]) {
      parts.push(flagKey + '=' + DETECTION_FLAG_LABELS[flagKey])
    }
  })
  return parts.join('；')
}

export function buildAnalysisLogText(
  phase: string,
  flags: DetectionResultFlags,
  errorMessage?: string
): string {
  if (!flags && errorMessage) {
    return '[canvas-ai][' + phase + '] ' + errorMessage
  }
  if (phase === 'error' && errorMessage) {
    return '[canvas-ai][' + phase + '] ' + errorMessage
  }
  var chineseText = formatDetectionFlagsChinese(flags)
  if (!chineseText) {
    return ''
  }
  return '[canvas-ai][' + phase + '] ' + chineseText
}

export function hasAnyDetectionAlert(flags: DetectionResultFlags): boolean {
  return DETECTION_FLAG_ORDER.some(function(flagKey) {
    return Boolean(flags[flagKey])
  })
}

export const STORAGE_KEYS = {
  LAST_PREVIEW: 'canvas_ai_last_preview',
  LAST_RESULT: 'canvas_ai_last_result'
}
