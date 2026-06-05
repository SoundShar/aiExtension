import { YksAiProctorEngine } from '@/yolo/engine'
import { YoloModelService, YOLOV_PERFORMANCE } from '@/yolo/model'
import type { DetectionResultFlags, ProctorDetectFrameResult, YoloModelId } from '@/yolo/types'
import { computeFenceLayout, toFenceRect } from '@/proctor/fenceHelper'
import { EXT_PERFORMANCE } from './extensionModelConfig'
import { getDefaultMasterFaceUrl } from './extensionMasterFace'

export type DetectCallback = (payload: {
  phase: string
  flags: DetectionResultFlags
  success: boolean
  errorMessage?: string
}) => void

var emptyDetectionFlags = function(): DetectionResultFlags {
  return {
    not_person: false,
    multi_person: false,
    has_book: false,
    has_phone: false,
    has_pitch: false,
    has_yaw: false,
    has_change_face: false,
    has_out_bounds: false
  }
}

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

  async setMasterFace(jpegDataUrl: string): Promise<{ success: boolean; message: string }> {
    this.masterFaceDataUrl = jpegDataUrl
    if (!this.engine) {
      return { success: true, message: '基准人脸已保存，启动分析后生效' }
    }

    this.engine.setMasterFace(jpegDataUrl)
    if (!this.initialized) {
      return { success: true, message: '基准人脸已保存，启动分析后生效' }
    }

    var registered = await this.engine.reloadMasterFaceDescriptor()
    if (registered) {
      return { success: true, message: '基准人脸已更新，换人检测已启用' }
    }
    return {
      success: false,
      message: '基准人脸已保存，但未能提取人脸特征，请换一张正脸清晰的帧'
    }
  }

  private resolveMasterFaceSource(): string | null {
    return this.masterFaceDataUrl || getDefaultMasterFaceUrl()
  }

  getUpcomingDetectPhase(): string {
    if (!this.engine) {
      return 'init'
    }
    return this.engine.getDetectPhase()
  }

  private async drawInferenceCanvasFromImage(
    imageElement: HTMLImageElement,
    width: number,
    height: number
  ): Promise<void> {
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

        var imageElement = await loadImageFromDataUrl(jpeg)
        await self.drawInferenceCanvasFromImage(imageElement, width, height)

        var fenceLayout = computeFenceLayout(width, height)
        var fenceRect = toFenceRect(fenceLayout)

        var masterFaceSource = self.resolveMasterFaceSource()
        var initResult = await self.engine.initProctor({
          modelId: self.modelId,
          fence: fenceRect,
          canvasWidth: width,
          canvasHeight: height,
          video: self.dummyVideo,
          inferenceCanvas: self.inferenceCanvas,
          masterFace: masterFaceSource || undefined
        })

        if (!initResult.success) {
          throw new Error('AI 引擎 initProctor 失败')
        }
        if (self.engine.isDetectionDisabled) {
          throw new Error(self.engine.detectionDisabledMessage || 'AI 检测已关闭')
        }

        if (masterFaceSource) {
          self.engine.setMasterFace(masterFaceSource)
          var registered = await self.engine.reloadMasterFaceDescriptor()
          if (registered) {
            console.info('[canvas-ai][master-face] 内置基准人脸已加载')
          } else {
            console.warn('[canvas-ai][master-face] 内置基准人脸特征提取失败')
          }
        }

        self.initialized = true
      } catch (initError) {
        self.initPromise = null
        throw initError
      }
    })()

    return this.initPromise
  }

  private mapDetectFrameResult(
    detectResult: ProctorDetectFrameResult
  ): {
    phase: string
    flags: DetectionResultFlags
    success: boolean
    errorMessage?: string
  } | null {
    if (detectResult.detection_result) {
      return {
        phase: detectResult.phase || 'object',
        flags: detectResult.detection_result,
        success: detectResult.success
      }
    }

    if (detectResult.skipReason === 'disabled' && this.engine && this.engine.isDetectionDisabled) {
      throw new Error(this.engine.detectionDisabledMessage || 'AI 检测已关闭')
    }

    if (
      detectResult.skipReason === 'busy' ||
      detectResult.skipReason === 'schedule' ||
      detectResult.skipReason === 'boot-yolo-only'
    ) {
      return {
        phase: detectResult.phase || 'skipped',
        flags: emptyDetectionFlags(),
        success: true
      }
    }

    return null
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

      var imageElement = await loadImageFromDataUrl(jpeg)
      await this.drawInferenceCanvasFromImage(imageElement, width, height)

      bitmap = await createImageBitmap(imageElement)
      var detectResult = await this.engine.detectFrame({
        bitmap: bitmap,
        imageData: jpeg,
        mode: 'auto'
      })
      bitmap = null

      var mapped = this.mapDetectFrameResult(detectResult)
      if (!mapped) {
        var skipReason = detectResult.skipReason ? '，原因：' + detectResult.skipReason : ''
        throw new Error('本帧未返回检测结果，phase=' + detectResult.phase + skipReason)
      }

      if (YOLOV_PERFORMANCE.enableDetectUiLog) {
        console.info('[canvas-ai][DETECT]', mapped.phase, mapped.flags)
      }

      return mapped
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
        flags: emptyDetectionFlags(),
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
