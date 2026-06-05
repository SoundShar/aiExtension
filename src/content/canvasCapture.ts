import { CAPTURE_ERROR_MESSAGES, MSG, type CaptureErrorCode } from '../shared/messages'

var captureTimerId: number | null = null
var isCapturing = false

function sendCaptureError(code: CaptureErrorCode): void {
  var message = CAPTURE_ERROR_MESSAGES[code]
  console.error('[canvas-ai][capture]', code, message)
  chrome.runtime.sendMessage({
    type: MSG.CAPTURE_ERROR,
    tabId: -1,
    code: code,
    message: message
  })
}

function getVisibleCanvasScore(canvasElement: HTMLCanvasElement): number {
  if (canvasElement.width <= 0 || canvasElement.height <= 0) {
    return 0
  }

  var rect = canvasElement.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) {
    return 0
  }

  var style = window.getComputedStyle(canvasElement)
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
    return 0
  }

  var viewportWidth = window.innerWidth || document.documentElement.clientWidth
  var viewportHeight = window.innerHeight || document.documentElement.clientHeight
  var intersectsViewport =
    rect.right > 0 &&
    rect.bottom > 0 &&
    rect.left < viewportWidth &&
    rect.top < viewportHeight

  return intersectsViewport ? rect.width * rect.height : (rect.width * rect.height) / 10
}

function selectCanvasForCapture(): HTMLCanvasElement | null {
  var canvasElements = Array.prototype.slice.call(
    document.querySelectorAll('canvas')
  ) as HTMLCanvasElement[]
  var bestCanvas: HTMLCanvasElement | null = null
  var bestScore = 0

  canvasElements.forEach(function(canvasElement) {
    var score = getVisibleCanvasScore(canvasElement)
    if (score > bestScore) {
      bestScore = score
      bestCanvas = canvasElement
    }
  })

  return bestCanvas
}

function captureCanvasFrame(): void {
  var canvasElement = selectCanvasForCapture()
  if (!canvasElement) {
    sendCaptureError('NO_CANVAS')
    return
  }

  if (canvasElement.width <= 0 || canvasElement.height <= 0) {
    sendCaptureError('ZERO_SIZE')
    return
  }

  try {
    var jpeg = canvasElement.toDataURL('image/jpeg', 0.8)
    chrome.runtime.sendMessage({
      type: MSG.CANVAS_FRAME,
      tabId: -1,
      jpeg: jpeg,
      width: canvasElement.width,
      height: canvasElement.height,
      timestamp: Date.now()
    })
  } catch (error) {
    sendCaptureError('TAINTED')
  }
}

function startCaptureLoop(): void {
  if (isCapturing) {
    return
  }
  isCapturing = true
  captureCanvasFrame()
  captureTimerId = window.setInterval(captureCanvasFrame, 1000)
}

function stopCaptureLoop(): void {
  isCapturing = false
  if (captureTimerId !== null) {
    window.clearInterval(captureTimerId)
    captureTimerId = null
  }
}

chrome.runtime.onMessage.addListener(function(message, _sender, sendResponse) {
  if (message.type === MSG.START_CAPTURE) {
    startCaptureLoop()
    sendResponse({ success: true })
    return true
  }

  if (message.type === MSG.STOP_CAPTURE) {
    stopCaptureLoop()
    sendResponse({ success: true })
    return true
  }

  return false
})
