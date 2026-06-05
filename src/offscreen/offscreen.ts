import { CanvasProctorEngine } from '../ai/canvasProctorEngine'
import { EXT_PERFORMANCE } from '../ai/extensionModelConfig'
import { installExtensionGlobalFetch } from '../ai/extensionAssets'
import { bindFaceApiToExtensionTf } from '../ai/faceApiGlobal'
import { assertExtensionTfCoreReady, ensureExtensionTfReady } from '../ai/tfGlobal'
import {
  buildAnalysisLogText,
  hasAnyDetectionAlert,
  MSG,
  type DetectFramePayload,
  type DetectResultPayload,
  type EngineStatusPayload
} from '../shared/messages'

var proctorEngine = new CanvasProctorEngine()
var latestPendingFrame: DetectFramePayload | null = null
var isDrainRunning = false
var modelsReady = false
var modelsWarmupPromise: Promise<void> | null = null
var DETECT_FRAME_TIMEOUT_MS = EXT_PERFORMANCE.detectFrameTimeoutMs || 12000

var emptyDetectFlags: DetectResultPayload['flags'] = {
  not_person: false,
  multi_person: false,
  has_book: false,
  has_phone: false,
  has_pitch: false,
  has_yaw: false,
  has_change_face: false,
  has_out_bounds: false
}

function sendEngineStatus(ready: boolean, message: string): void {
  var payload: EngineStatusPayload = {
    type: MSG.ENGINE_STATUS,
    ready: ready,
    message: message
  }
  chrome.runtime.sendMessage(payload).catch(function() {
    // popup 可能未打开
  })
}

function publishDetectResult(
  frame: DetectFramePayload,
  detectResult: {
    phase: string
    flags: DetectResultPayload['flags']
    success: boolean
    errorMessage?: string
  }
): void {
  var resultPayload: DetectResultPayload = {
    type: MSG.DETECT_RESULT,
    tabId: frame.tabId,
    phase: detectResult.phase,
    flags: detectResult.flags,
    timestamp: frame.timestamp,
    success: detectResult.success,
    errorMessage: detectResult.errorMessage
  }

  var logText = buildAnalysisLogText(
    detectResult.phase,
    detectResult.flags,
    detectResult.errorMessage
  )
  var hasAlert = hasAnyDetectionAlert(detectResult.flags)
  var resultSummary =
    logText ||
    (detectResult.success ? '无命中项' : detectResult.errorMessage || '检测失败')

  if (logText) {
    console.info('[canvas-ai][DETECT]', logText)
  } else if (detectResult.success) {
    console.info('[canvas-ai][DETECT]', resultSummary)
  } else {
    console.error('[canvas-ai][DETECT]', detectResult.errorMessage || '检测失败')
  }

  chrome.runtime.sendMessage(resultPayload, function() {
    if (chrome.runtime.lastError) {
      console.error(
        '[canvas-ai][offscreen] DETECT_RESULT 发送失败',
        chrome.runtime.lastError.message
      )
    }
  })
}

async function runDetectFrameCore(
  message: DetectFramePayload,
  abortToken: { superseded: boolean }
): Promise<void> {
  var startedAt = Date.now()
  var detectResult = await proctorEngine.detectFrame(
    message.jpeg,
    message.width,
    message.height
  )

  if (abortToken.superseded) {
    console.warn(
      '[canvas-ai][offscreen] 滞后帧已丢弃 tabId=' + message.tabId +
      '，耗时 ' + (Date.now() - startedAt) + 'ms'
    )
    return
  }

  console.info(
    '[canvas-ai][offscreen] 检测完成 tabId=' + message.tabId +
    ' phase=' + detectResult.phase +
    '，耗时 ' + (Date.now() - startedAt) + 'ms'
  )
  publishDetectResult(message, detectResult)
}

async function runDetectFrameWithTimeout(message: DetectFramePayload): Promise<void> {
  var phaseHint = proctorEngine.getUpcomingDetectPhase()
  console.info(
    '[canvas-ai][offscreen] 开始检测 tabId=' + message.tabId + ' phase=' + phaseHint
  )

  var abortToken = { superseded: false }
  var detectPromise = runDetectFrameCore(message, abortToken)
  var timeoutId: ReturnType<typeof setTimeout> | null = null
  var timeoutPromise = new Promise<never>(function(_resolve, reject) {
    timeoutId = setTimeout(function() {
      abortToken.superseded = true
      reject(new Error('单帧检测超时（' + DETECT_FRAME_TIMEOUT_MS / 1000 + 's）'))
    }, DETECT_FRAME_TIMEOUT_MS)
  })

  try {
    await Promise.race([detectPromise, timeoutPromise])
  } catch (error) {
    var errorMessage = (error as Error).message || String(error)
    if (abortToken.superseded) {
      console.error(
        '[canvas-ai][offscreen] 检测超时 tabId=' + message.tabId + ' phase=' + phaseHint
      )
      publishDetectResult(message, {
        phase: 'error',
        flags: emptyDetectFlags,
        success: false,
        errorMessage: errorMessage + '，phase=' + phaseHint
      })
      try {
        await detectPromise
      } catch (lateError) {
        console.warn(
          '[canvas-ai][offscreen] 超时帧推理异常结束',
          (lateError as Error).message || String(lateError)
        )
      }
      return
    }
    console.error('[canvas-ai][offscreen] detect failed', errorMessage)
    publishDetectResult(message, {
      phase: 'error',
      flags: emptyDetectFlags,
      success: false,
      errorMessage: errorMessage
    })
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
    }
  }
}

async function drainDetectQueue(): Promise<void> {
  if (isDrainRunning) {
    return
  }
  isDrainRunning = true
  while (latestPendingFrame) {
    var frame = latestPendingFrame
    latestPendingFrame = null
    await runDetectFrameWithTimeout(frame)
  }
  isDrainRunning = false
}

function enqueueDetectFrame(message: DetectFramePayload): void {
  latestPendingFrame = message
  drainDetectQueue().catch(function(error) {
    console.error('[canvas-ai][offscreen] drain queue failed', error)
  })
}

function ensureModelsReady(): Promise<void> {
  if (modelsReady) {
    return Promise.resolve()
  }
  if (modelsWarmupPromise) {
    return modelsWarmupPromise
  }

  modelsWarmupPromise = proctorEngine.warmupModels().then(function() {
    modelsReady = true
    sendEngineStatus(true, 'AI 模型已预加载')
  }).catch(function(error) {
    modelsWarmupPromise = null
    var message = (error as Error).message || String(error)
    console.error('[canvas-ai][offscreen] 模型预加载失败', message)
    sendEngineStatus(false, '模型预加载失败: ' + message)
    throw error
  })

  return modelsWarmupPromise
}

chrome.runtime.onMessage.addListener(function(message, _sender, sendResponse) {
  if (message.type === MSG.DETECT_FRAME) {
    ensureModelsReady().then(function() {
      enqueueDetectFrame(message as DetectFramePayload)
      sendResponse({ success: true })
    }).catch(function(error) {
      sendResponse({ success: false, message: String(error) })
    })
    return true
  }

  if (message.type === MSG.SET_MASTER_FACE && message.jpeg) {
    proctorEngine.setMasterFace(message.jpeg).then(function(result) {
      sendEngineStatus(result.success, result.message)
      sendResponse({ success: result.success, message: result.message })
    }).catch(function(error) {
      var errorMessage = (error as Error).message || String(error)
      sendEngineStatus(false, '基准人脸设置失败: ' + errorMessage)
      sendResponse({ success: false, message: errorMessage })
    })
    return true
  }

  return false
})

try {
  installExtensionGlobalFetch()
  assertExtensionTfCoreReady()
  ensureExtensionTfReady()
  bindFaceApiToExtensionTf()
  console.info('[canvas-ai][offscreen] TensorFlow 与扩展 fetch 已就绪')
  ensureModelsReady().catch(function() {
    // 预加载失败时首帧会再次尝试并输出错误
  })
} catch (error) {
  console.error('[canvas-ai][offscreen] TensorFlow 预初始化失败', error)
}

sendEngineStatus(false, 'Offscreen 文档已加载，正在预加载模型…')

export {}
