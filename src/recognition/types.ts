/** 单帧推理布尔结果（8 项告警） */
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

export interface YoloDetectionFlags {
  not_person: boolean
  multi_person: boolean
  has_book: boolean
  has_phone: boolean
}

export interface FenceRect {
  x: number
  y: number
  width: number
  height: number
}

export const PROCTOR_WORKER_BUSY = 'PROCTOR_WORKER_BUSY'

export type RecognitionDetectPhase = 'object' | 'portrait' | 'full'

export interface RecognitionWorkerInitPayload {
  type: 'init'
  requestId: number
  modelUrl: string
  inputSize: number
  nmsMaxBoxes: number
  faceModelsBaseUrl: string
  faceDetectorType: 'Tiny' | 'SSD'
  faceScoreThreshold: number
  faceInputSize: number
}

export interface RecognitionWorkerSetMasterFacePayload {
  type: 'set-master-face'
  requestId: number
  clear?: boolean
  descriptor?: number[]
  imageBase64?: string
}

export interface RecognitionWorkerDetectObjectPayload {
  type: 'detect-object'
  requestId: number
  bitmap: ImageBitmap
}

export interface RecognitionWorkerDetectFullPayload {
  type: 'detect-full'
  requestId: number
  bitmap: ImageBitmap
  fence: FenceRect
  canvasWidth: number
  canvasHeight: number
  enableChangeFace: boolean
  runChangeFaceDescriptor: boolean
}

export interface RecognitionWorkerDisposePayload {
  type: 'dispose'
}

export type RecognitionWorkerInboundPayload =
  | RecognitionWorkerInitPayload
  | RecognitionWorkerSetMasterFacePayload
  | RecognitionWorkerDetectObjectPayload
  | RecognitionWorkerDetectFullPayload
  | RecognitionWorkerDisposePayload

export interface RecognitionWorkerInitDoneMessage {
  type: 'init-done'
  requestId: number
}

export interface RecognitionWorkerInitErrorMessage {
  type: 'init-error'
  requestId: number
  message: string
}

export interface RecognitionWorkerSetMasterFaceDoneMessage {
  type: 'set-master-face-done'
  requestId: number
  success: boolean
  error?: string
}

export interface RecognitionWorkerDetectResultMessage {
  type: 'detect-result'
  requestId: number
  success: boolean
  phase: RecognitionDetectPhase
  detection_result?: DetectionResultFlags
  yolo_flags?: YoloDetectionFlags
  error?: string
}

export type RecognitionWorkerOutboundMessage =
  | RecognitionWorkerInitDoneMessage
  | RecognitionWorkerInitErrorMessage
  | RecognitionWorkerSetMasterFaceDoneMessage
  | RecognitionWorkerDetectResultMessage

export interface DetectFrameResult {
  phase: string
  flags: DetectionResultFlags
  success: boolean
  errorMessage?: string
}
