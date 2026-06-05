import {
  formatDetectionFlagsChinese,
  MSG,
  STORAGE_KEYS,
  type AnalysisLogPayload,
  type DetectionResultFlags,
  type DetectResultPayload,
  type FramePreviewPayload,
  type SessionErrorPayload,
  type SessionStatePayload,
  buildAnalysisLogText,
  hasAnyDetectionAlert
} from '../shared/messages'
import './popup.scss'

interface StoredPreview {
  tabId: number
  jpeg: string
  width: number
  height: number
  timestamp: number
}

interface StoredResult {
  tabId: number
  text: string
  hasAlert: boolean
  timestamp: number
}

class CanvasAiPopupApp {
  private activeTabId: number | null = null
  private isRunning = false
  private latestPreviewJpeg: string | null = null

  private startSessionBtn = document.getElementById('startSessionBtn') as HTMLButtonElement
  private stopSessionBtn = document.getElementById('stopSessionBtn') as HTMLButtonElement
  private setMasterFaceBtn = document.getElementById('setMasterFaceBtn') as HTMLButtonElement
  private previewImageEl = document.getElementById('previewImageEl') as HTMLImageElement
  private previewMetaText = document.getElementById('previewMetaText') as HTMLParagraphElement
  private latestResultText = document.getElementById('latestResultText') as HTMLParagraphElement
  private analysisLogList = document.getElementById('analysisLogList') as HTMLUListElement
  private sessionStatusText = document.getElementById('sessionStatusText') as HTMLParagraphElement
  private errorBannerText = document.getElementById('errorBannerText') as HTMLParagraphElement

  constructor() {
    this.bindEvents()
    this.initActiveTab()
    this.restorePinnedPreview()
    this.bindRuntimeMessages()
  }

  private bindEvents(): void {
    this.startSessionBtn.addEventListener('click', this.handleStartSessionClick)
    this.stopSessionBtn.addEventListener('click', this.handleStopSessionClick)
    this.setMasterFaceBtn.addEventListener('click', this.handleSetMasterFaceClick)
  }

  private bindRuntimeMessages(): void {
    chrome.runtime.onMessage.addListener(function(message) {
      if (message.type === MSG.FRAME_PREVIEW) {
        popupApp.handleFramePreview(message as FramePreviewPayload)
      }
      if (message.type === MSG.ANALYSIS_LOG) {
        popupApp.handleAnalysisLog(message as AnalysisLogPayload)
      }
      if (message.type === MSG.SESSION_ERROR) {
        popupApp.handleSessionError(message as SessionErrorPayload)
      }
      if (message.type === MSG.SESSION_STATE) {
        popupApp.handleSessionState(message as SessionStatePayload)
      }
      if (message.type === MSG.DETECT_RESULT) {
        popupApp.handleDetectResult(message as DetectResultPayload)
      }
    })
  }

  private async restorePinnedPreview(): Promise<void> {
    try {
      var stored = await chrome.storage.local.get([
        STORAGE_KEYS.LAST_PREVIEW,
        STORAGE_KEYS.LAST_RESULT
      ])
      var preview = stored[STORAGE_KEYS.LAST_PREVIEW] as StoredPreview | undefined
      var result = stored[STORAGE_KEYS.LAST_RESULT] as StoredResult | undefined

      if (preview && preview.jpeg) {
        this.latestPreviewJpeg = preview.jpeg
        this.previewImageEl.src = preview.jpeg
        this.previewMetaText.textContent =
          preview.width + ' x ' + preview.height + ' · ' + new Date(preview.timestamp).toLocaleTimeString()
      }

      if (result && result.text && result.text.indexOf('Failed to fetch') < 0 &&
        result.text.indexOf('模型或权重加载失败') < 0) {
        this.updateLatestResultText(result.text, result.hasAlert)
      }
    } catch (error) {
      console.warn('[canvas-ai][popup] restore pinned preview failed', error)
    }
  }

  private async initActiveTab(): Promise<void> {
    try {
      var tabs = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tabs[0] && tabs[0].id) {
        this.activeTabId = tabs[0].id
        this.sessionStatusText.textContent = '当前标签页 ID: ' + String(this.activeTabId)
      }
    } catch (error) {
      this.showErrorBanner('无法获取当前标签页')
    }
  }

  private updateRunningUi(running: boolean): void {
    this.isRunning = running
    this.startSessionBtn.disabled = running
    this.stopSessionBtn.disabled = !running
    this.setMasterFaceBtn.disabled = !running || !this.latestPreviewJpeg
    this.sessionStatusText.textContent = running ? '分析进行中' : '已停止'
  }

  private showErrorBanner(message: string): void {
    console.error('[canvas-ai][popup]', message)
    this.errorBannerText.hidden = false
    this.errorBannerText.textContent = message
  }

  private hideErrorBanner(): void {
    this.errorBannerText.hidden = true
    this.errorBannerText.textContent = ''
  }

  private updateLatestResultText(text: string, hasAlert: boolean): void {
    this.latestResultText.textContent = '最新结果：' + text
    this.latestResultText.className = hasAlert
      ? 'latest-result-text latest-result-text-alert'
      : 'latest-result-text latest-result-text-normal'
  }

  private appendLogItem(payload: AnalysisLogPayload): void {
    if (payload.summaryOnly) {
      this.updateLatestResultText(payload.text, payload.hasAlert)
      return
    }

    var listItem = document.createElement('li')
    listItem.className = payload.hasAlert ? 'log-list-item log-list-item-alert' : 'log-list-item log-list-item-normal'

    var timeText = document.createElement('span')
    timeText.className = 'log-list-time'
    timeText.textContent = new Date(payload.timestamp).toLocaleTimeString()

    var contentText = document.createElement('span')
    contentText.className = 'log-list-content'
    contentText.textContent = payload.text

    listItem.appendChild(timeText)
    listItem.appendChild(contentText)

    this.analysisLogList.prepend(listItem)

    while (this.analysisLogList.children.length > 100) {
      var lastChild = this.analysisLogList.lastElementChild
      if (lastChild) {
        this.analysisLogList.removeChild(lastChild)
      }
    }
  }

  private handleFramePreview(payload: FramePreviewPayload): void {
    if (this.activeTabId && payload.tabId !== this.activeTabId) {
      return
    }
    this.latestPreviewJpeg = payload.jpeg
    this.previewImageEl.src = payload.jpeg
    this.previewMetaText.textContent =
      payload.width + ' x ' + payload.height + ' · ' + new Date(payload.timestamp).toLocaleTimeString()
    this.setMasterFaceBtn.disabled = !this.isRunning || !this.latestPreviewJpeg

    chrome.storage.local.set({
      [STORAGE_KEYS.LAST_PREVIEW]: {
        tabId: payload.tabId,
        jpeg: payload.jpeg,
        width: payload.width,
        height: payload.height,
        timestamp: payload.timestamp
      }
    })
  }

  private handleAnalysisLog(payload: AnalysisLogPayload): void {
    if (this.activeTabId && payload.tabId !== this.activeTabId) {
      return
    }

    if (payload.phase !== 'error') {
      this.hideErrorBanner()
    }

    var displayText = payload.text
    if (!displayText && !payload.summaryOnly) {
      var chineseText = formatDetectionFlagsChinese(payload.flags)
      if (chineseText) {
        displayText = '[canvas-ai][' + payload.phase + '] ' + chineseText
      }
    }

    if (displayText) {
      this.updateLatestResultText(displayText.replace(/^\[canvas-ai\]\[[^\]]+\]\s*/, ''), payload.hasAlert)
      chrome.storage.local.set({
        [STORAGE_KEYS.LAST_RESULT]: {
          tabId: payload.tabId,
          text: displayText.replace(/^\[canvas-ai\]\[[^\]]+\]\s*/, ''),
          hasAlert: payload.hasAlert,
          timestamp: payload.timestamp
        }
      })
    }

    if (payload.summaryOnly) {
      return
    }

    if (!displayText) {
      return
    }

    this.appendLogItem(Object.assign({}, payload, { text: displayText }))
    console.info('[canvas-ai][popup]', displayText)
  }

  private handleSessionError(payload: SessionErrorPayload): void {
    if (this.activeTabId && payload.tabId !== this.activeTabId) {
      return
    }
    this.showErrorBanner(payload.message)
    this.updateLatestResultText(payload.message, true)
  }

  private handleSessionState(payload: SessionStatePayload): void {
    if (this.activeTabId && payload.tabId !== this.activeTabId) {
      return
    }
    this.updateRunningUi(payload.running)
  }

  private handleDetectResult(payload: DetectResultPayload): void {
    if (this.activeTabId && payload.tabId !== this.activeTabId) {
      return
    }

    var logText = buildAnalysisLogText(
      payload.phase,
      payload.flags,
      payload.errorMessage
    )
    var hasAlert = hasAnyDetectionAlert(payload.flags)
    var resultSummary =
      logText ||
      (payload.success ? '无命中项' : payload.errorMessage || '检测失败')

    if (payload.phase !== 'error' && payload.success) {
      this.hideErrorBanner()
    }

    var displayText = (logText || resultSummary).replace(
      /^\[canvas-ai\]\[[^\]]+\]\s*/,
      ''
    )
    this.updateLatestResultText(displayText, hasAlert || !payload.success)

    chrome.storage.local.set({
      [STORAGE_KEYS.LAST_RESULT]: {
        tabId: payload.tabId,
        text: displayText,
        hasAlert: hasAlert || !payload.success,
        timestamp: payload.timestamp
      }
    })
  }

  private handleStartSessionClick = async (): Promise<void> => {
    this.hideErrorBanner()
    if (!this.activeTabId) {
      this.showErrorBanner('无法获取当前标签页')
      return
    }

    try {
      var response = await chrome.runtime.sendMessage({
        type: MSG.START_SESSION,
        tabId: this.activeTabId
      })
      if (!response || !response.success) {
        this.showErrorBanner((response && response.message) || '启动失败')
        return
      }
      this.updateRunningUi(true)
      this.updateLatestResultText('分析中…', false)
    } catch (error) {
      this.showErrorBanner('启动失败: ' + String(error))
    }
  }

  private handleStopSessionClick = async (): Promise<void> => {
    if (!this.activeTabId) {
      return
    }
    try {
      await chrome.runtime.sendMessage({
        type: MSG.STOP_SESSION,
        tabId: this.activeTabId
      })
      this.updateRunningUi(false)
    } catch (error) {
      this.showErrorBanner('停止失败: ' + String(error))
    }
  }

  private handleSetMasterFaceClick = async (): Promise<void> => {
    if (!this.latestPreviewJpeg) {
      this.showErrorBanner('当前没有可用预览帧')
      return
    }
    try {
      var response = await chrome.runtime.sendMessage({
        type: MSG.SET_MASTER_FACE,
        jpeg: this.latestPreviewJpeg
      }) as { success?: boolean; message?: string }
      if (!response || response.success === false) {
        this.showErrorBanner(response && response.message
          ? response.message
          : '设置基准人脸失败')
        return
      }
      this.hideErrorBanner()
      this.sessionStatusText.textContent = response.message || '基准人脸已更新'
    } catch (error) {
      this.showErrorBanner('设置基准人脸失败: ' + String(error))
    }
  }
}

var popupApp = new CanvasAiPopupApp()

export {}
