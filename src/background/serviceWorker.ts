import {
  buildAnalysisLogText,
  hasAnyDetectionAlert,
  MSG,
  STORAGE_KEYS,
  type AnalysisLogPayload,
  type CanvasFramePayload,
  type DetectFramePayload,
  type DetectResultPayload,
  type FramePreviewPayload,
  type SessionErrorPayload,
  type SessionStatePayload
} from '../shared/messages'
import { RECOGNITION_CONFIG } from '../recognition/config'

interface TabSession {
  tabId: number
  running: boolean
  engineReady: boolean
  isDetecting: boolean
  pendingFrame: DetectFramePayload | null
}

var sessions = new Map<number, TabSession>()
var offscreenReady = false
var creatingOffscreen = false
var detectTimeoutByTab = new Map<number, number>()
var DETECT_FRAME_TIMEOUT_MS = RECOGNITION_CONFIG.detectFrameTimeoutMs + 3000

function getSession(tabId: number): TabSession {
  var existing = sessions.get(tabId)
  if (existing) {
    return existing
  }
  var session: TabSession = {
    tabId: tabId,
    running: false,
    engineReady: false,
    isDetecting: false,
    pendingFrame: null
  }
  sessions.set(tabId, session)
  return session
}

function broadcastToPopup(message: unknown): void {
  chrome.runtime.sendMessage(message).catch(function() {
    // popup 可能未打开
  })
}

function sendSessionError(tabId: number, message: string): void {
  console.error('[canvas-ai][session]', tabId, message)
  var payload: SessionErrorPayload = {
    type: MSG.SESSION_ERROR,
    tabId: tabId,
    message: message
  }
  broadcastToPopup(payload)
}

function sendSessionState(tabId: number): void {
  var session = getSession(tabId)
  var payload: SessionStatePayload = {
    type: MSG.SESSION_STATE,
    tabId: tabId,
    running: session.running,
    engineReady: session.engineReady,
    message: session.running ? '分析进行中' : '已停止'
  }
  broadcastToPopup(payload)
}

async function ensureOffscreenDocument(): Promise<void> {
  if (offscreenReady) {
    return
  }
  if (creatingOffscreen) {
    await new Promise(function(resolve) {
      setTimeout(resolve, 200)
    })
    return ensureOffscreenDocument()
  }

  creatingOffscreen = true
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.DOM_SCRAPING],
      justification: '在 Offscreen 中运行 WebGPU AI 推理分析 canvas 帧'
    })
    offscreenReady = true
  } catch (error) {
    var errorMessage = (error as Error).message || String(error)
    if (errorMessage.indexOf('Only a single offscreen') >= 0) {
      offscreenReady = true
    } else {
      throw error
    }
  } finally {
    creatingOffscreen = false
  }
}

async function closeOffscreenIfIdle(): Promise<void> {
  var hasRunning = false
  sessions.forEach(function(session) {
    if (session.running) {
      hasRunning = true
    }
  })
  if (hasRunning) {
    return
  }
  if (!offscreenReady) {
    return
  }
  try {
    await chrome.offscreen.closeDocument()
  } catch (error) {
    console.warn('[canvas-ai][offscreen] close failed', error)
  }
  offscreenReady = false
}

async function injectContentScript(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId: tabId },
    files: ['content.js']
  })
}

function clearDetectTimeout(tabId: number): void {
  var timeoutId = detectTimeoutByTab.get(tabId)
  if (timeoutId !== undefined) {
    clearTimeout(timeoutId)
    detectTimeoutByTab.delete(tabId)
  }
}

function scheduleDetectTimeout(frame: DetectFramePayload): void {
  clearDetectTimeout(frame.tabId)
  var timeoutId = setTimeout(function() {
    detectTimeoutByTab.delete(frame.tabId)
    var session = getSession(frame.tabId)
    if (!session.isDetecting) {
      return
    }
    session.isDetecting = false
    handleDetectResult({
      type: MSG.DETECT_RESULT,
      tabId: frame.tabId,
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
      timestamp: frame.timestamp,
      success: false,
      errorMessage: '检测超时（' + DETECT_FRAME_TIMEOUT_MS / 1000 + 's），请查看 Offscreen 控制台'
    })
  }, DETECT_FRAME_TIMEOUT_MS)
  detectTimeoutByTab.set(frame.tabId, timeoutId)
}

function dispatchDetectFrame(frame: DetectFramePayload): void {
  var session = getSession(frame.tabId)
  session.isDetecting = true
  scheduleDetectTimeout(frame)
  chrome.runtime.sendMessage(frame).catch(function(error) {
    clearDetectTimeout(frame.tabId)
    session.isDetecting = false
    sendSessionError(frame.tabId, 'Offscreen 检测消息发送失败: ' + String(error))
  })
}

function enqueueDetectFrame(frame: DetectFramePayload): void {
  var session = getSession(frame.tabId)
  if (session.isDetecting) {
    session.pendingFrame = frame
    return
  }
  dispatchDetectFrame(frame)
}

function handleDetectResult(payload: DetectResultPayload): void {
  var session = getSession(payload.tabId)
  clearDetectTimeout(payload.tabId)
  session.isDetecting = false
  session.engineReady = true

  var logText = buildAnalysisLogText(payload.phase, payload.flags, payload.errorMessage)
  var hasAlert = hasAnyDetectionAlert(payload.flags)
  var resultSummary = logText || (payload.success ? '无命中项' : (payload.errorMessage || '检测失败'))

  chrome.storage.local.set({
    [STORAGE_KEYS.LAST_RESULT]: {
      tabId: payload.tabId,
      text: resultSummary,
      hasAlert: hasAlert,
      timestamp: payload.timestamp
    }
  })

  if (logText || !payload.success) {
    var analysisLog: AnalysisLogPayload = {
      type: MSG.ANALYSIS_LOG,
      tabId: payload.tabId,
      phase: payload.phase,
      flags: payload.flags,
      timestamp: payload.timestamp,
      text: logText || resultSummary,
      hasAlert: hasAlert || !payload.success
    }
    broadcastToPopup(analysisLog)
  } else if (payload.success) {
    broadcastToPopup({
      type: MSG.ANALYSIS_LOG,
      tabId: payload.tabId,
      phase: payload.phase,
      flags: payload.flags,
      timestamp: payload.timestamp,
      text: '无命中项',
      hasAlert: false
    })
  }

  if (!payload.success && payload.errorMessage) {
    sendSessionError(payload.tabId, payload.errorMessage)
  }

  if (session.pendingFrame) {
    var nextFrame = session.pendingFrame
    session.pendingFrame = null
    dispatchDetectFrame(nextFrame)
  }
}

async function startSession(tabId: number): Promise<void> {
  var session = getSession(tabId)
  if (session.running) {
    sendSessionState(tabId)
    return
  }

  try {
    await ensureOffscreenDocument()
    await injectContentScript(tabId)
    await chrome.storage.local.remove(STORAGE_KEYS.LAST_RESULT)
    session.running = true
    await chrome.tabs.sendMessage(tabId, { type: MSG.START_CAPTURE })
    sendSessionState(tabId)
  } catch (error) {
    var errorMessage = (error as Error).message || String(error)
    sendSessionError(tabId, '启动失败: ' + errorMessage)
    session.running = false
    sendSessionState(tabId)
  }
}

async function stopSession(tabId: number): Promise<void> {
  var session = getSession(tabId)
  session.running = false
  session.pendingFrame = null
  session.isDetecting = false

  try {
    await chrome.tabs.sendMessage(tabId, { type: MSG.STOP_CAPTURE })
  } catch (error) {
    console.warn('[canvas-ai][session] stop capture warn', error)
  }

  sessions.delete(tabId)
  sendSessionState(tabId)
  await closeOffscreenIfIdle()
}

function handleCanvasFrame(senderTabId: number, message: CanvasFramePayload): void {
  var session = getSession(senderTabId)
  if (!session.running) {
    return
  }

  var previewPayload: FramePreviewPayload = {
    type: MSG.FRAME_PREVIEW,
    tabId: senderTabId,
    jpeg: message.jpeg,
    width: message.width,
    height: message.height,
    timestamp: message.timestamp
  }
  broadcastToPopup(previewPayload)

  chrome.storage.local.set({
    [STORAGE_KEYS.LAST_PREVIEW]: {
      tabId: senderTabId,
      jpeg: message.jpeg,
      width: message.width,
      height: message.height,
      timestamp: message.timestamp
    }
  })

  var detectPayload: DetectFramePayload = {
    type: MSG.DETECT_FRAME,
    tabId: senderTabId,
    jpeg: message.jpeg,
    width: message.width,
    height: message.height,
    timestamp: message.timestamp
  }
  enqueueDetectFrame(detectPayload)
}

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  var senderTabId = sender.tab && sender.tab.id ? sender.tab.id : message.tabId

  if (message.type === MSG.START_SESSION) {
    var startTabId = message.tabId || senderTabId
    if (!startTabId) {
      sendResponse({ success: false, message: '无法获取 tabId' })
      return true
    }
    startSession(startTabId).then(function() {
      sendResponse({ success: true })
    }).catch(function(error) {
      sendResponse({ success: false, message: String(error) })
    })
    return true
  }

  if (message.type === MSG.STOP_SESSION) {
    var stopTabId = message.tabId || senderTabId
    if (stopTabId) {
      stopSession(stopTabId).then(function() {
        sendResponse({ success: true })
      })
    } else {
      sendResponse({ success: false })
    }
    return true
  }

  if (message.type === MSG.CANVAS_FRAME && senderTabId) {
    handleCanvasFrame(senderTabId, Object.assign({}, message, { tabId: senderTabId }))
    sendResponse({ success: true })
    return true
  }

  if (message.type === MSG.CAPTURE_ERROR && senderTabId) {
    sendSessionError(senderTabId, message.message || message.code)
    sendResponse({ success: true })
    return true
  }

  if (message.type === MSG.DETECT_RESULT) {
    handleDetectResult(message as DetectResultPayload)
    sendResponse({ success: true })
    return true
  }

  if (message.type === MSG.SET_MASTER_FACE) {
    chrome.runtime.sendMessage({
      type: MSG.SET_MASTER_FACE,
      jpeg: message.jpeg
    }).then(function() {
      sendResponse({ success: true })
    }).catch(function(error) {
      sendResponse({ success: false, message: String(error) })
    })
    return true
  }

  if (message.type === MSG.SESSION_STATE && message.tabId) {
    sendSessionState(message.tabId)
    sendResponse({ success: true })
    return true
  }

  return false
})

chrome.tabs.onRemoved.addListener(function(tabId) {
  if (sessions.has(tabId)) {
    stopSession(tabId)
  }
})

export {}
