import { YksAiProctorEngine } from '@/yolo/engine'
import { YoloModelService, YOLOV_PERFORMANCE } from '@/yolo/model'
import type { DetectionResultFlags, YoloModelId } from '@/yolo/types'
import { computeFenceLayout, toFenceRect } from '@/proctor/fenceHelper'
import { EXT_PERFORMANCE } from './extensionModelConfig'

export type DetectCallback = (payload: {
  phase: string
  flags: DetectionResultFlags
  success: boolean
  errorMessage?: string
}) => void

function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise(function(resolve, reject) {
    var imageElement = new Image()
    imageElement.onload = function() {
      resolve(imageElement)
    }
    imageElement.onerror = function() {
      reject(new Error('JPEG 解码失败'))
    }
    imageElement.src = dataUrl
  })
}

export class CanvasProctorEngine {
  private engine: YksAiProctorEngine | null = null
  private initialized = false
  private initPromise: Promise<void> | null = null
  private masterFaceDataUrl: string | null = null
  private modelId: YoloModelId = 'yolo11'
  private dummyVideo: HTMLVideoElement
  private inferenceCanvas: HTMLCanvasElement

  constructor() {
    this.dummyVideo = document.createElement('video')
    this.dummyVideo.muted = true
    this.inferenceCanvas = document.createElement('canvas')
  }

  /** Offscreen 启动时预加载模型，避免首帧与 initProctor 并发拉权重 */
  async warmupModels(): Promise<void> {
    await this.bootstrap()
  }

  async bootstrap(): Promise<void> {
    if (this.engine) {
      return
    }

    var yoloModelService = new YoloModelService()
    this.engine = new YksAiProctorEngine({
      yoloModelService: yoloModelService,
      performanceConfig: EXT_PERFORMANCE,
      onLog: function(tag, message) {
        console.info('[canvas-ai][' + tag + ']', message)
      },
      getTrtcIsAnswer: function() {
        return true
      }
    })

    await this.engine.bootstrapModels(this.modelId)
    if (this.engine.isDetectionDisabled) {
      throw new Error(this.engine.detectionDisabledMessage || 'AI 检测已关闭')
    }
  }

  setMasterFace(jpegDataUrl: string): void {
    this.masterFaceDataUrl = jpegDataUrl
    if (this.engine && this.initialized) {
      this.engine.setMasterFace(jpegDataUrl)
    }
  }

  getUpcomingDetectPhase(): string {
    if (!this.engine) {
      return 'init'
    }
    return this.engine.getDetectPhase()
  }

  private async drawInferenceCanvas(jpeg: string, width: number, height: number): Promise<void> {
    var imageElement = await loadImageFromDataUrl(jpeg)
    this.inferenceCanvas.width = width
    this.inferenceCanvas.height = height
    var inferenceContext = this.inferenceCanvas.getContext('2d')
    if (!inferenceContext) {
      throw new Error('无法创建 inference canvas 上下文')
    }
    inferenceContext.drawImage(imageElement, 0, 0, width, height)
  }

  private async ensureInitialized(jpeg: string, width: number, height: number): Promise<void> {
    if (this.initialized) {
      return
    }
    if (this.initPromise) {
      return this.initPromise
    }

    var self = this
    this.initPromise = (async function() {
      try {
      await self.bootstrap()
      if (!self.engine) {
        throw new Error('AI 引擎未创建')
      }

      await self.drawInferenceCanvas(jpeg, width, height)

      var fenceLayout = computeFenceLayout(width, height)
      var fenceRect = toFenceRect(fenceLayout)

      var initResult = await self.engine.initProctor({
        modelId: self.modelId,
        fence: fenceRect,
        canvasWidth: width,
        canvasHeight: height,
        video: self.dummyVideo,
        inferenceCanvas: self.inferenceCanvas,
        masterFace: self.masterFaceDataUrl || undefined
      })

      if (!initResult.success) {
        throw new Error('AI 引擎 initProctor 失败')
      }
      if (self.engine.isDetectionDisabled) {
        throw new Error(self.engine.detectionDisabledMessage || 'AI 检测已关闭')
      }

      self.initialized = true
      } catch (initError) {
        self.initPromise = null
        throw initError
      }
    })()

    return this.initPromise
  }

  async detectFrame(jpeg: string, width: number, height: number): Promise<{
    phase: string
    flags: DetectionResultFlags
    success: boolean
    errorMessage?: string
  }> {
    var bitmap: ImageBitmap | null = null
    try {
      await this.ensureInitialized(jpeg, width, height)
      if (!this.engine) {
        throw new Error('AI 引擎未就绪')
      }

      await this.drawInferenceCanvas(jpeg, width, height)

      var imageElement = await loadImageFromDataUrl(jpeg)
      bitmap = await createImageBitmap(imageElement)
      // 扩展 Popup 仅需 YOLO 目标检测；auto 在 boot 结束后会进 portrait（face-api）易挂起 WebGPU
      var detectResult = await this.engine.detectFrame({
        bitmap: bitmap,
        imageData: jpeg,
        mode: 'object'
      })
      bitmap = null

      if (!detectResult.detection_result) {
        if (detectResult.skipReason === 'disabled' && this.engine.isDetectionDisabled) {
          throw new Error(this.engine.detectionDisabledMessage || 'AI 检测已关闭')
        }
        if (detectResult.skipReason === 'busy' || detectResult.skipReason === 'schedule' ||
          detectResult.skipReason === 'boot-yolo-only') {
          return {
            phase: detectResult.phase,
            flags: {
              not_person: false,
              multi_person: false,
              has_book: false,
              has_phone: false,
              has_pitch: false,
              has_yaw: false,
              has_change_face: false,
              has_out_bounds: false
            },
            success: true
          }
        }
        var skipReason = detectResult.skipReason ? '，原因：' + detectResult.skipReason : ''
        throw new Error('本帧未返回检测结果，phase=' + detectResult.phase + skipReason)
      }

      var flags: DetectionResultFlags = detectResult.detection_result

      if (YOLOV_PERFORMANCE.enableDetectUiLog) {
        console.info('[canvas-ai][DETECT]', detectResult.phase, flags)
      }

      return {
        phase: detectResult.phase,
        flags: flags,
        success: detectResult.success
      }
    } catch (error) {
      if (bitmap) {
        try {
          bitmap.close()
        } catch (closeError) {
          console.warn('[canvas-ai][detectFrame] close bitmap failed', closeError)
        }
      }
      var rawMessage = (error as Error).message || String(error)
      var errorMessage = rawMessage
      if (rawMessage.indexOf('Failed to fetch') >= 0) {
        errorMessage = rawMessage.indexOf('chrome-extension://') >= 0 || rawMessage.indexOf('/models/') >= 0
          ? rawMessage
          : '模型或权重加载失败（Failed to fetch），请确认已执行 yarn build、从 dist/ 加载扩展并重新加载。详情：' + rawMessage
      }
      console.error('[canvas-ai][detectFrame]', rawMessage)
      return {
        phase: 'error',
        flags: {
          not_person: false,
          multi_person: false,
          has_book: false,
          has_phone: false,
          has_pitch: false,
          has_yaw: false,
          has_change_face: false,
          has_out_bounds: false
        },
        success: false,
        errorMessage: errorMessage
      }
    }
  }

  async dispose(): Promise<void> {
    if (this.engine) {
      await this.engine.disposeProctor()
      await this.engine.disposeModels()
      this.engine = null
    }
    this.initialized = false
    this.initPromise = null
  }
}
