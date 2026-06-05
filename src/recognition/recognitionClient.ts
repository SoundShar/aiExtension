/**
 * Recognition Worker RPC（public/worker.js）
 */

import { getExtensionFaceModelsBaseUrl, getYoloModelJsonUrl } from './assets'
import { RECOGNITION_CONFIG } from './config'
import type {
  DetectionResultFlags,
  FenceRect,
  RecognitionDetectPhase,
  RecognitionWorkerDetectResultMessage,
  RecognitionWorkerInboundPayload,
  RecognitionWorkerInitPayload,
  RecognitionWorkerOutboundMessage,
  RecognitionWorkerSetMasterFacePayload,
  YoloDetectionFlags,
  YoloModelId
} from './types'
import { PROCTOR_WORKER_BUSY } from './types'

type PendingWorkerRequest = {
  resolve: (value: RecognitionWorkerOutboundMessage) => void
  reject: (error: Error) => void
  timeoutId: number
}

export interface RecognitionClientOptions {
  onLog?: (tag: string, message: string) => void
}

export class RecognitionClient {
  private worker: Worker | null = null
  private workerReady = false
  private workerBusy = false
  private workerRequestId = 0
  private workerSessionId = 0
  private initPromise: Promise<void> | null = null
  private pendingMap = new Map<number, PendingWorkerRequest>()

  constructor(private clientOptions: RecognitionClientOptions = {}) {}

  get isActive(): boolean {
    return this.workerReady
  }

  async init(modelId: YoloModelId): Promise<void> {
    if (this.initPromise) {
      return this.initPromise
    }
    this.initPromise = this.doInit(modelId)
    try {
      await this.initPromise
    } finally {
      this.initPromise = null
    }
  }

  async setMasterFace(params: {
    clear?: boolean
    imageBase64?: string
  }): Promise<void> {
    if (!this.isActive) {
      throw new Error('Recognition Worker 未就绪')
    }
    var requestId = this.nextRequestId()
    var payload: RecognitionWorkerSetMasterFacePayload = {
      type: 'set-master-face',
      requestId: requestId,
      clear: params.clear
    }
    if (params.imageBase64) {
      payload.imageBase64 = params.imageBase64
    }
    var message = await this.postRequest(payload)
    if (message.type !== 'set-master-face-done' || message.requestId !== requestId) {
      throw new Error('set-master-face 响应类型不匹配')
    }
    if (!message.success) {
      throw new Error(message.error || 'set-master-face failed')
    }
  }

  async detectObject(bitmap: ImageBitmap): Promise<YoloDetectionFlags> {
    var payload = {
      type: 'detect-object' as const,
      requestId: this.nextRequestId(),
      bitmap: bitmap
    }
    var result = await this.detect('object', payload, [bitmap])
    if (!result.yolo_flags) {
      throw new Error('Worker 未返回 yolo_flags')
    }
    return result.yolo_flags
  }

  async detectFull(params: {
    bitmap: ImageBitmap
    fence: FenceRect
    canvasWidth: number
    canvasHeight: number
    enableChangeFace: boolean
    runChangeFaceDescriptor: boolean
  }): Promise<DetectionResultFlags> {
    var payload = {
      type: 'detect-full' as const,
      requestId: this.nextRequestId(),
      bitmap: params.bitmap,
      fence: params.fence,
      canvasWidth: params.canvasWidth,
      canvasHeight: params.canvasHeight,
      enableChangeFace: params.enableChangeFace,
      runChangeFaceDescriptor: params.runChangeFaceDescriptor
    }
    var result = await this.detect('full', payload, [params.bitmap])
    if (!result.detection_result) {
      throw new Error('Worker 未返回 detection_result')
    }
    return result.detection_result
  }

  dispose(): void {
    this.pendingMap.forEach(function(pending) {
      window.clearTimeout(pending.timeoutId)
      pending.reject(new Error('Recognition Worker 已销毁'))
    })
    this.pendingMap.clear()
    if (this.worker) {
      try {
        this.worker.postMessage({ type: 'dispose' })
      } catch (disposeError) {
        console.warn('[recognition-worker] dispose', disposeError)
      }
      this.worker.terminate()
      this.worker = null
    }
    this.workerReady = false
    this.workerBusy = false
    this.workerSessionId += 1
  }

  private nextRequestId(): number {
    this.workerRequestId += 1
    return this.workerRequestId
  }

  private doInit(modelId: YoloModelId): Promise<void> {
    var self = this
    return new Promise(function(resolve, reject) {
      self.dispose()
      var sessionId = self.workerSessionId + 1
      self.workerSessionId = sessionId
      var worker = new Worker(RECOGNITION_CONFIG.recognitionWorkerScriptUrl)
      self.worker = worker
      var requestId = self.nextRequestId()

      var failInit = function(message: string): void {
        window.clearTimeout(initTimeoutId)
        self.dispose()
        reject(new Error(message))
      }

      var initTimeoutId = window.setTimeout(function() {
        failInit('Recognition Worker 初始化超时 ' + RECOGNITION_CONFIG.recognitionWorkerTimeoutMs + 'ms')
      }, RECOGNITION_CONFIG.recognitionWorkerTimeoutMs)

      var handleInitMessage = function(event: MessageEvent): void {
        if (sessionId !== self.workerSessionId) {
          return
        }
        var payload = event.data as RecognitionWorkerOutboundMessage
        if (payload && payload.type === 'init-done' && payload.requestId === requestId) {
          window.clearTimeout(initTimeoutId)
          self.workerReady = true
          worker.onmessage = function(messageEvent) {
            self.handleMessage(messageEvent, sessionId)
          }
          self.clientOptions.onLog?.('MODEL', 'Recognition Worker 已启用（YOLO + face-api）')
          resolve()
        } else if (payload && payload.type === 'init-error' && payload.requestId === requestId) {
          failInit(payload.message || 'Recognition Worker 初始化失败')
        }
      }

      worker.onmessage = handleInitMessage
      worker.onerror = function(event: ErrorEvent) {
        var detail = [event.message, event.filename, String(event.lineno || '')]
          .filter(Boolean)
          .join(' ')
        failInit('Recognition Worker 脚本错误: ' + (detail || 'unknown'))
      }

      var initPayload: RecognitionWorkerInitPayload = {
        type: 'init',
        requestId: requestId,
        modelUrl: getYoloModelJsonUrl(RECOGNITION_CONFIG.defaultModelDir),
        inputSize: RECOGNITION_CONFIG.yoloInputSize,
        nmsMaxBoxes: RECOGNITION_CONFIG.nmsMaxBoxes,
        faceModelsBaseUrl: getExtensionFaceModelsBaseUrl(),
        faceDetectorType: RECOGNITION_CONFIG.faceDetectorType,
        faceScoreThreshold: RECOGNITION_CONFIG.faceScoreThreshold,
        faceInputSize: RECOGNITION_CONFIG.faceInputSize
      }
      worker.postMessage(initPayload)
    })
  }

  private handleMessage(event: MessageEvent, sessionId: number): void {
    if (sessionId !== this.workerSessionId) {
      return
    }
    var data = event.data as RecognitionWorkerOutboundMessage
    if (!data || typeof data.requestId !== 'number') {
      return
    }
    var pending = this.pendingMap.get(data.requestId)
    if (!pending) {
      return
    }
    if (data.type === 'detect-result' || data.type === 'set-master-face-done') {
      window.clearTimeout(pending.timeoutId)
      this.pendingMap.delete(data.requestId)
      pending.resolve(data)
    }
  }

  private async detect(
    phase: RecognitionDetectPhase,
    payload: RecognitionWorkerInboundPayload,
    transfer?: Transferable[]
  ): Promise<RecognitionWorkerDetectResultMessage> {
    if (!this.worker || !this.workerReady) {
      throw new Error('Recognition Worker 未就绪')
    }
    if (this.workerBusy) {
      throw new Error(PROCTOR_WORKER_BUSY)
    }
    this.workerBusy = true
    try {
      var message = await this.postRequest(payload, transfer)
      if (message.type !== 'detect-result') {
        throw new Error('detect 响应类型不匹配')
      }
      var detectMessage = message as RecognitionWorkerDetectResultMessage
      if (detectMessage.error === PROCTOR_WORKER_BUSY) {
        throw new Error(PROCTOR_WORKER_BUSY)
      }
      if (!detectMessage.success || detectMessage.error) {
        throw new Error(detectMessage.error || 'detect failed')
      }
      if (detectMessage.phase !== phase) {
        throw new Error('detect phase 不匹配: ' + detectMessage.phase)
      }
      return detectMessage
    } finally {
      this.workerBusy = false
    }
  }

  private postRequest(
    payload: RecognitionWorkerInboundPayload,
    transfer?: Transferable[]
  ): Promise<RecognitionWorkerOutboundMessage> {
    if (!this.worker) {
      return Promise.reject(new Error('Recognition Worker 未创建'))
    }
    var requestId = 'requestId' in payload ? payload.requestId : this.nextRequestId()
    var self = this

    return new Promise(function(resolve, reject) {
      var timeoutId = window.setTimeout(function() {
        self.pendingMap.delete(requestId)
        reject(new Error('Recognition Worker 请求超时 ' + RECOGNITION_CONFIG.recognitionWorkerTimeoutMs + 'ms'))
      }, RECOGNITION_CONFIG.recognitionWorkerTimeoutMs)

      self.pendingMap.set(requestId, {
        resolve: resolve,
        reject: reject,
        timeoutId: timeoutId
      })

      try {
        if (transfer && transfer.length) {
          self.worker!.postMessage(payload, transfer)
        } else {
          self.worker!.postMessage(payload)
        }
      } catch (postError) {
        self.pendingMap.delete(requestId)
        window.clearTimeout(timeoutId)
        reject(postError as Error)
      }
    })
  }
}
