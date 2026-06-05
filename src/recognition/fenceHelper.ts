import { RECOGNITION_CONFIG } from './config'
import type { FenceRect } from './types'

export type FenceLayout = FenceRect & {
  canvasWidth: number
  canvasHeight: number
}

export function computeFenceLayout(canvasWidth: number, canvasHeight: number): FenceLayout {
  var fenceWidth = Math.round(canvasWidth * RECOGNITION_CONFIG.fenceWidthRatio)
  var fenceHeight = Math.round(canvasHeight * RECOGNITION_CONFIG.fenceHeightRatio)
  var fenceX = Math.round((canvasWidth - fenceWidth) / 2)
  var fenceY = Math.round((canvasHeight - fenceHeight) / 2)

  return {
    canvasWidth: canvasWidth,
    canvasHeight: canvasHeight,
    x: fenceX,
    y: fenceY,
    width: fenceWidth,
    height: fenceHeight
  }
}

export function toFenceRect(layout: FenceLayout): FenceRect {
  return {
    x: layout.x,
    y: layout.y,
    width: layout.width,
    height: layout.height
  }
}
