/**
 * 扩展识别引擎：JPEG → Worker（object / detect-full）
 */

import { RECOGNITION_CONFIG } from './config'
import { computeFenceLayout, toFenceRect } from './fenceHelper'
import { getDefaultMasterFaceUrl } from './masterFace'
import { RecognitionClient } from './recognitionClient'
import type { DetectFrameResult, DetectionResultFlags, YoloDetectionFlags } from './types'

function emptyDetectionFlags(): DetectionResultFlags {
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

function yoloToFullFlags(yoloFlags: YoloDetectionFlags): DetectionResultFlags {
  return {
    not_person: Boolean(yoloFlags.not_person),
    multi_person: Boolean(yoloFlags.multi_person),
    has_book: Boolean(yoloFlags.has_book),
    has_phone: Boolean(yoloFlags.has_phone),
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

export class RecognitionEngine {
  private client: RecognitionClient
  private initialized = false
  private initPromise: Promise<void> | null = null
  private bootStartedAt = 0
  private portraitCycleCount = 0
  private masterFaceDataUrl: string | null = null
  private cachedFence = { x: 0, y: 0, width: 0, height: 0 }
  private cachedCanvasWidth = 0
  private cachedCanvasHeight = 0

  constructor() {
    this.client = new RecognitionClient({
      onLog: function(tag, message) {
        console.info('[canvas-ai][' + tag + ']', message)
      }
    })
  }

  getUpcomingDetectPhase(): string {
    if (!this.initialized) {
      return 'init'
    }
    if (Date.now() - this.bootStartedAt < RECOGNITION_CONFIG.bootYoloOnlyDurationMs) {
      return 'object'
    }
    return 'full'
  }

  async warmupModels(): Promise<void> {
    if (!this.client.isActive) {
      await this.client.init(RECOGNITION_CONFIG.defaultModelId)
    }
  }

  async setMasterFace(jpegDataUrl: string): Promise<{ success: boolean; message: string }> {
    this.masterFaceDataUrl = jpegDataUrl
    if (!this.initialized) {
      return { success: true, message: '基准人脸已保存，启动分析后生效' }
    }
    try {
      await this.client.setMasterFace({ imageBase64: jpegDataUrl })
      return { success: true, message: '基准人脸已更新，换人检测已启用' }
    } catch (error) {
      var errorMessage = (error as Error).message || String(error)
      return { success: false, message: '基准人脸设置失败: ' + errorMessage }
    }
  }

  async detectFrame(jpeg: string, width: number, height: number): Promise<DetectFrameResult> {
    var bitmap: ImageBitmap | null = null
    try {
      await this.ensureInitialized(width, height)
      var imageElement = await loadImageFromDataUrl(jpeg)
      bitmap = await createImageBitmap(imageElement)

      var isBootPhase = Date.now() - this.bootStartedAt < RECOGNITION_CONFIG.bootYoloOnlyDurationMs

      if (isBootPhase) {
        var yoloFlags = await this.client.detectObject(bitmap)
        bitmap = null
        var objectFlags = yoloToFullFlags(yoloFlags)
        if (RECOGNITION_CONFIG.enableDetectUiLog) {
          console.info('[canvas-ai][DETECT]', 'object', objectFlags)
        }
        return { phase: 'object', flags: objectFlags, success: true }
      }

      this.portraitCycleCount += 1
      var runChangeFaceDescriptor =
        this.portraitCycleCount === 1 ||
        this.portraitCycleCount % RECOGNITION_CONFIG.changeFaceDetectEveryPortraitCycles === 0

      var fullFlags = await this.client.detectFull({
        bitmap: bitmap,
        fence: this.cachedFence,
        canvasWidth: this.cachedCanvasWidth,
        canvasHeight: this.cachedCanvasHeight,
        enableChangeFace: true,
        runChangeFaceDescriptor: runChangeFaceDescriptor
      })
      bitmap = null

      if (RECOGNITION_CONFIG.enableDetectUiLog) {
        console.info('[canvas-ai][DETECT]', 'full', fullFlags)
      }
      return { phase: 'full', flags: fullFlags, success: true }
    } catch (error) {
      if (bitmap) {
        try {
          bitmap.close()
        } catch (closeError) {
          console.warn('[recognition-engine] close bitmap', closeError)
        }
      }
      var rawMessage = (error as Error).message || String(error)
      var errorMessage = rawMessage
      if (rawMessage.indexOf('Failed to fetch') >= 0) {
        errorMessage =
          rawMessage.indexOf('chrome-extension://') >= 0 || rawMessage.indexOf('/models/') >= 0
            ? rawMessage
            : '模型或权重加载失败（Failed to fetch），请确认已执行 yarn build、从 dist/ 加载扩展并重新加载。详情：' +
              rawMessage
      }
      console.error('[recognition-engine]', rawMessage)
      return {
        phase: 'error',
        flags: emptyDetectionFlags(),
        success: false,
        errorMessage: errorMessage
      }
    }
  }

  async dispose(): Promise<void> {
    this.client.dispose()
    this.initialized = false
    this.initPromise = null
  }

  private resolveMasterFaceSource(): string | null {
    return this.masterFaceDataUrl || getDefaultMasterFaceUrl()
  }

  private updateLayout(width: number, height: number): void {
    var fenceLayout = computeFenceLayout(width, height)
    this.cachedFence = toFenceRect(fenceLayout)
    this.cachedCanvasWidth = width
    this.cachedCanvasHeight = height
  }

  private async ensureInitialized(width: number, height: number): Promise<void> {
    this.updateLayout(width, height)
    if (this.initialized) {
      return
    }
    if (this.initPromise) {
      return this.initPromise
    }

    var self = this
    this.initPromise = (async function() {
      self.bootStartedAt = Date.now()
      self.portraitCycleCount = 0

      if (!self.client.isActive) {
        await self.client.init(RECOGNITION_CONFIG.defaultModelId)
      }

      var masterFaceSource = self.resolveMasterFaceSource()
      if (masterFaceSource) {
        await self.client.setMasterFace({ imageBase64: masterFaceSource })
        console.info('[canvas-ai][master-face] 内置基准人脸已加载')
      }

      self.initialized = true
    })()

    try {
      await this.initPromise
    } catch (initError) {
      this.initPromise = null
      throw initError
    }
  }
}
