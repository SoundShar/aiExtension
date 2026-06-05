/**
 * 扩展环境内加载 YOLO GraphModel（显式 fetchFunc，不依赖 TF 默认 http 路由）
 */

import {
  extensionFetch,
  getExtensionYoloModelJsonUrl
} from './extensionAssets'
import type { TfNamespace } from './tfGlobal'
export async function loadYoloGraphModelInExtension(
  tfApi: TfNamespace,
  modelDir: string,
  onLog?: (message: string) => void
): Promise<TfNamespace['GraphModel']> {
  var modelUrl = getExtensionYoloModelJsonUrl(modelDir)
  var weightBase = modelUrl.replace(/model\.json$/, '')

  onLog?.('加载 YOLO GraphModel: ' + modelUrl)

  var handler = tfApi.io.browserHTTPRequest(modelUrl, {
    fetchFunc: extensionFetch,
    weightUrlConverter: function(weightFile: string) {
      return weightBase + weightFile
    }
  })

  return tfApi.loadGraphModel(handler)
}
