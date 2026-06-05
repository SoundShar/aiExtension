/**
 * 从 aiIdentification 同步 AI 推理核心源码到 extension/src/ai
 * 兼容 Node 12.7.0：不使用可选链、空值合并
 */
var fs = require('fs')
var path = require('path')

var AI_SRC = path.resolve(__dirname, '../../aiIdentification/src')
var EXT_AI = path.resolve(__dirname, '../src/ai')

var YOLO_FILES = [
  'yolo/meta.ts',
  'yolo/types.ts',
  'yolo/model.ts',
  'yolo/engine/index.ts',
  'yolo/engine/yksAiProctorEngine.ts',
  'yolo/engine/recognitionWorkerClient.ts',
  'yolo/engine/inferenceRunner.ts',
  'yolo/engine/detectionDefaults.ts',
  'yolo/engine/timeCheck.ts'
]

var PROCTOR_FILES = [
  'proctor/fenceHelper.ts',
  'proctor/inferenceCanvasHelper.ts',
  'proctor/snapshotHelper.ts'
]

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

function copyAndPatch(relativePath, patchFn) {
  var srcPath = path.join(AI_SRC, relativePath)
  var destPath = path.join(EXT_AI, relativePath)

  if (!fs.existsSync(srcPath)) {
    console.error('[sync-ai-engine] missing source file:', srcPath)
    process.exit(1)
  }

  ensureDir(path.dirname(destPath))
  var content = fs.readFileSync(srcPath, 'utf8')
  content = patchFn(content)
  fs.writeFileSync(destPath, content)
  console.log('[sync-ai-engine] synced', relativePath)
}

function patchProctorImports(content) {
  return content
    .replace(/from '@\/yolo\/model'/g, "from '../yolo/model'")
    .replace(/from '@\/yolo\/types'/g, "from '../yolo/types'")
    .replace(/from '@\/yolo\/engine'/g, "from '../yolo/engine'")
    .replace(/from '@\/yolo\/meta'/g, "from '../yolo/meta'")
}

function patchModelTs(content) {
  var modelsBasePatch = [
    "const getModelsBaseUrl = (): string => {",
    "  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {",
    "    return chrome.runtime.getURL('models/').replace(/\\/$/, '')",
    "  }",
    "  return `${location.origin}/models`",
    "}"
  ].join('\n')

  content = content.replace(
    /const getModelsBaseUrl = \(\): string => `\$\{location\.origin\}\/models`/,
    modelsBasePatch
  )

  content = content.replace(
    /detectIntervalMs: 1500,/,
    'detectIntervalMs: 1000,'
  )

  content = content.replace(
    /yoloInputSize: 640,/,
    'yoloInputSize: 640,'
  )

  content = content.replace(
    /nmsMaxBoxes: 100,/,
    'nmsMaxBoxes: 50,'
  )

  content = content.replace(
    /inferenceSourceMaxWidth: 640,/,
    'inferenceSourceMaxWidth: 640,'
  )

  content = content.replace(
    /staggerYoloAndFace: true,/,
    'staggerYoloAndFace: false,'
  )

  if (content.indexOf("labelName === 'person'") < 0) {
    content = content.replace(
      /    \} else if \(\['book'\]\.includes\(labelName\) && scoresData\[index\] > 0\.2\) \{\r?\n      klasses\.push\(labelName\)\r?\n    \} else if \(scoresData\[index\] > classThreshold\) \{/,
      [
        "    } else if (['book'].includes(labelName) && scoresData[index] > 0.2) {",
        '      klasses.push(labelName)',
        "    } else if (labelName === 'person' && scoresData[index] > 0.35) {",
        '      klasses.push(labelName)',
        '    } else if (scoresData[index] > classThreshold) {'
      ].join('\n')
    )
  }

  content = content.replace(
    /recognitionWorkerScriptUrl: '\.\/worker\.js',/,
    "recognitionWorkerScriptUrl: (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)\n    ? chrome.runtime.getURL('worker.js')\n    : './worker.js',"
  )

  content = content.replace(
    /import '@tensorflow\/tfjs-backend-webgpu'\r?\n/,
    ''
  )

  content = content.replace(
    /import \* as tf from '@tensorflow\/tfjs'\r?\nimport \* as faceApis from '@vladmandic\/face-api'\r?\n/,
    [
      "import type * as tf from '@tensorflow/tfjs'",
      "import {",
      '  getExtensionFaceModelsBaseUrl,',
      '  getExtensionModelsBaseUrl',
      "} from '../extensionAssets'",
      "import { getFaceApiGlobal } from '../faceApiGlobal'",
      "import { ensureExtensionTfReady, getTfGlobal } from '../tfGlobal'",
      ''
    ].join('\n')
  )

  content = content.replace(
    /import \* as tf from '@tensorflow\/tfjs'\r?\n/,
    [
      "import type * as tf from '@tensorflow/tfjs'",
      "import {",
      '  getExtensionFaceModelsBaseUrl,',
      '  getExtensionModelsBaseUrl',
      "} from '../extensionAssets'",
      "import { getFaceApiGlobal } from '../faceApiGlobal'",
      "import { ensureExtensionTfReady, getTfGlobal } from '../tfGlobal'",
      ''
    ].join('\n')
  )

  content = content.replace(
    /const getModelsBaseUrl = \(\): string => \{[\s\S]*?\}\r?\n\r?\n/,
    "const getModelsBaseUrl = (): string => getExtensionModelsBaseUrl()\n\n"
  )

  content = content.replace(
    /\): \[tf\.Tensor4D, number, number\] => \{\r?\n  let xRatio = 1/,
    '): [tf.Tensor4D, number, number] => {\n  const tf = getTfGlobal()\n  let xRatio = 1'
  )

  content = content.replace(
    /return new Promise\(async \(resolve\) => \{\r?\n    try \{/,
    'return new Promise(async (resolve) => {\n    const tf = getTfGlobal()\n    try {'
  )

  content = content.replace(
    /export const warmupYoloGraphModel = async \(\r?\n  model: tf\.GraphModel,\r?\n  source\?: HTMLCanvasElement\r?\n\): Promise<void> => \{\r?\n  if \(source\)/,
    'export const warmupYoloGraphModel = async (\n  model: tf.GraphModel,\n  source?: HTMLCanvasElement\n): Promise<void> => {\n  const tf = getTfGlobal()\n  if (source)'
  )

  content = content.replace(
    /export const detectVideo = \(\r?\n  source: YoloDetectSource,\r?\n  model: tf\.GraphModel,\r?\n  onError\?: \(error: unknown\) => void,\r?\n  options\?: YoloDetectOptions\r?\n\): Promise<string\[]> => \{\r?\n  return new Promise\(async \(resolve\) => \{[\s\S]*?\r?\n  \}\)\r?\n\}\r?\n\r?\n\/\*\* 加载模型后预热 GPU 图；可传入 inferenceCanvas 做真数据 warmup \*\//,
    [
      'export const detectVideo = (',
      '  source: YoloDetectSource,',
      '  model: tf.GraphModel,',
      '  onError?: (error: unknown) => void,',
      '  options?: YoloDetectOptions',
      '): Promise<string[]> => {',
      '  return new Promise(async (resolve) => {',
      '    const tf = getTfGlobal()',
      '    let input: tf.Tensor4D | null = null',
      '    let res: tf.Tensor | null = null',
      '    let transRes: tf.Tensor | null = null',
      '    let boxes: tf.Tensor | null = null',
      '    let scores: tf.Tensor | null = null',
      '    let classes: tf.Tensor | null = null',
      '    let nms: tf.Tensor | null = null',
      '    let pickedBoxes: tf.Tensor | null = null',
      '    let pickedScores: tf.Tensor | null = null',
      '    let pickedClasses: tf.Tensor | null = null',
      '',
      '    try {',
      '      const modelWidth = options?.inputSize ?? YOLOV_PERFORMANCE.yoloInputSize',
      '      const modelHeight = modelWidth',
      '      const nmsMaxBoxes = options?.nmsMaxBoxes ?? YOLOV_PERFORMANCE.nmsMaxBoxes',
      '',
      '      const preprocessResult = preprocess(source, modelWidth, modelHeight)',
      '      input = preprocessResult[0]',
      '      res = model.execute(input) as tf.Tensor',
      '      transRes = res.transpose([0, 2, 1])',
      '      boxes = tf.tidy(() => {',
      '        const w = transRes!.slice([0, 0, 2], [-1, -1, 1])',
      '        const h = transRes!.slice([0, 0, 3], [-1, -1, 1])',
      '        const x1 = tf.sub(transRes!.slice([0, 0, 0], [-1, -1, 1]), tf.div(w, 2))',
      '        const y1 = tf.sub(transRes!.slice([0, 0, 1], [-1, -1, 1]), tf.div(h, 2))',
      '        return tf',
      '          .concat([y1, x1, tf.add(y1, h), tf.add(x1, w)], 2)',
      '          .squeeze()',
      '      })',
      '',
      '      const scoreTensors = tf.tidy(() => {',
      '        const rawScores = transRes!.slice([0, 0, 4], [-1, -1, numClass]).squeeze([0])',
      '        return [rawScores.max(1), rawScores.argMax(1)]',
      '      })',
      '      scores = scoreTensors[0]',
      '      classes = scoreTensors[1]',
      '',
      '      nms = await tf.image.nonMaxSuppressionAsync(',
      '        boxes as tf.Tensor2D,',
      '        scores as tf.Tensor1D,',
      '        nmsMaxBoxes,',
      '        0.45,',
      '        0.2',
      '      )',
      '      pickedBoxes = boxes.gather(nms, 0)',
      '      pickedScores = scores.gather(nms, 0)',
      '      pickedClasses = classes.gather(nms, 0)',
      '      const [boxesData, scoresData, classesData] = await Promise.all([',
      '        pickedBoxes.data(),',
      '        pickedScores.data(),',
      '        pickedClasses.data()',
      '      ])',
      '      const names = renderBoxes(0.2, boxesData, scoresData, classesData)',
      '      resolve(names)',
      '    } catch (error) {',
      '      onError?.(error)',
      '      resolve([])',
      '    } finally {',
      '      tf.dispose([',
      '        pickedBoxes,',
      '        pickedScores,',
      '        pickedClasses,',
      '        nms,',
      '        classes,',
      '        scores,',
      '        boxes,',
      '        transRes,',
      '        res,',
      '        input',
      '      ].filter(Boolean) as tf.Tensor[])',
      '    }',
      '  })',
      '}',
      '',
      '/** 加载模型后预热 GPU 图；可传入 inferenceCanvas 做真数据 warmup */'
    ].join('\n')
  )

  content = content.replace(
    /const runLoad = async \(targetId: YoloModelId\): Promise<tf\.GraphModel> => \{\r?\n      await initWebGpuBackend\(\)/,
    'const runLoad = async (targetId: YoloModelId): Promise<tf.GraphModel> => {\n      const tf = ensureExtensionTfReady()\n      await initWebGpuBackend()'
  )

  content = content.replace(
    /  \/\*\* 同 modelId 并发 loadModel 时复用同一 Promise \*\/\r?\n  private loadingPromise: Promise<tf\.GraphModel> \| null = null/,
    [
      '  /** 同 modelId 并发 loadModel 时复用同一 Promise */',
      '  private loadingPromise: Promise<tf.GraphModel> | null = null',
      '  private loadingModelId: YoloModelId | null = null'
    ].join('\n')
  )

  content = content.replace(
    /    if \(this\.loadingPromise && this\.loadedModelId === modelId\) \{\r?\n      return this\.loadingPromise\r?\n    \}/,
    [
      '    if (this.yoloModel && this.loadedModelId === modelId) {',
      '      return this.yoloModel',
      '    }',
      '    if (this.loadingPromise && this.loadingModelId === modelId) {',
      '      return this.loadingPromise',
      '    }'
    ].join('\n')
  )

  content = content.replace(
    /    this\.loadingPromise = \(async \(\) => \{/,
    [
      '    this.loadingModelId = modelId',
      '    this.loadingPromise = (async () => {'
    ].join('\n')
  )

  content = content.replace(
    /      \} finally \{\r?\n        this\.loadingPromise = null\r?\n      \}/,
    [
      '      } finally {',
      '        this.loadingPromise = null',
      '        this.loadingModelId = null',
      '      }'
    ].join('\n')
  )

  content = content.replace(
    /const modelOption = getYoloModelOption\(targetId\)\r?\n      return loadYoloGraphModelInExtension\(tf, modelOption\.modelDir, options\?\.onLog\)/,
    [
      'const modelOption = getYoloModelOption(targetId)',
      '      return loadYoloGraphModelInExtension(tf, modelOption.modelDir, options?.onLog)'
    ].join('\n')
  ).replace(
    /const modelOption = getYoloModelOption\(targetId\)\r?\n      const modelUrl = `\$\{getModelsBaseUrl\(\)\}\/\$\{modelOption\.modelDir\}\/model\.json`\r?\n      options\?\.onLog\?\.\(`加载 YOLO 模型: \$\{modelOption\.label\} \(\$\{modelUrl\}\)`\)\r?\n      return tf\.loadGraphModel\(modelUrl\)/,
    [
      'const modelOption = getYoloModelOption(targetId)',
      '      return loadYoloGraphModelInExtension(tf, modelOption.modelDir, options?.onLog)'
    ].join('\n')
  )

  if (content.indexOf('extensionModelLoader') < 0) {
    content = content.replace(
      /import \{ ensureExtensionTfReady, getTfGlobal \} from '\.\.\/tfGlobal'/,
      "import { loadYoloGraphModelInExtension } from '../extensionModelLoader'\nimport { ensureExtensionTfReady, getTfGlobal } from '../tfGlobal'"
    )
  }

  content = content.replace(
    /async ensureFaceModels\(\): Promise<void> \{\r?\n    if \(faceModelsReady\) return\r?\n    await initWebGpuBackend\(\)\r?\n    const baseUrl = `\$\{getModelsBaseUrl\(\)\}\/face-api`\r?\n    await Promise\.all\(\[\r?\n      faceApis\.nets\.faceRecognitionNet/,
    [
      'async ensureFaceModels(): Promise<void> {',
      '    if (faceModelsReady) return',
      '    await initWebGpuBackend()',
      '    const faceApi = getFaceApiGlobal()',
      '    const baseUrl = getExtensionFaceModelsBaseUrl()',
      '    await Promise.all([',
      '      faceApi.nets.faceRecognitionNet'
    ].join('\n')
  )

  content = content.replace(
    /faceApis\.nets\.faceLandmark68Net/g,
    'faceApi.nets.faceLandmark68Net'
  )
  content = content.replace(
    /faceApis\.nets\.ssdMobilenetv1/g,
    'faceApi.nets.ssdMobilenetv1'
  )
  content = content.replace(
    /faceApis\.nets\.tinyFaceDetector/g,
    'faceApi.nets.tinyFaceDetector'
  )

  content = content.replace(/export \{ faceApis \}/, 'export { getFaceApiGlobal }')

  content = content.replace(
    /\/\*\* 主线程与 YoloModelService 共用[\s\S]+return backendReadyPromise\r?\n\}\r?\n\r?\nexport const getSelectedModelId/,
    [
      '/** 扩展内仅允许 WebGPU，禁止回退 WebGL */',
      'export const initWebGpuBackend = async (): Promise<void> => {',
      '  if (backendReadyPromise) {',
      '    return backendReadyPromise',
      '  }',
      '',
      '  backendReadyPromise = (async () => {',
      '    const tf = ensureExtensionTfReady()',
      '    try {',
      "      await tf.setBackend('webgpu')",
      '      await tf.ready()',
      '      const current = tf.getBackend()',
      "      if (current === 'webgpu') {",
      "        console.info('[yolo-model] TensorFlow backend:', current)",
      '        return',
      '      }',
      "      throw new Error('WebGPU 后端未就绪，当前: ' + current + '（扩展禁止使用 WebGL）')",
      '    } catch (error) {',
      '      const message = (error as Error).message || String(error)',
      "      console.error('[yolo-model] TF backend webgpu failed:', message)",
      '      throw new Error(',
      "        'TensorFlow WebGPU 后端初始化失败: ' + message + '。请在 chrome://gpu 确认 WebGPU 已启用，扩展不使用 WebGL。'",
      '      )',
      '    }',
      '  })()',
      '',
      '  return backendReadyPromise',
      '}',
      '',
      'export const getSelectedModelId'
    ].join('\n')
  )

  return content
}

function patchInferenceRunner(content) {
  content = content.replace(
    /import \* as tf from '@tensorflow\/tfjs'\r?\nimport \{\r?\n  detectVideo,\r?\n  faceApis,/,
    "import {\n  detectVideo,\n  getFaceApiGlobal,"
  )

  content = content.replace(
    /from '\.\.\/model'\r?\nimport type \{/,
    "from '../model'\nimport { getTfGlobal } from '../../tfGlobal'\nimport type * as faceApis from '@vladmandic/face-api'\nimport type {"
  )

  content = content.replace(/faceApis\.detectSingleFace/g, 'getFaceApiGlobal().detectSingleFace')
  content = content.replace(/new faceApis\.LabeledFaceDescriptors/g, 'new (getFaceApiGlobal().LabeledFaceDescriptors)')
  content = content.replace(/faceApis\.detectAllFaces/g, 'getFaceApiGlobal().detectAllFaces')
  content = content.replace(/faceApis\.resizeResults/g, 'getFaceApiGlobal().resizeResults')
  content = content.replace(/new faceApis\.FaceMatcher/g, 'new (getFaceApiGlobal().FaceMatcher)')
  content = content.replace(/new faceApis\.SsdMobilenetv1Options/g, 'new (getFaceApiGlobal().SsdMobilenetv1Options)')
  content = content.replace(/new faceApis\.TinyFaceDetectorOptions/g, 'new (getFaceApiGlobal().TinyFaceDetectorOptions)')

  content = content.replace(
    /    const names = await detectVideo\(inferenceCanvas, model, \(error\) => \{\r?\n      const message = \(error as Error\)\.message \|\| String\(error\)\r?\n      this\.onYoloError\?\.\(message\)\r?\n    \}\)\r?\n    const flags = yoloNamesToFlags\(names\)/,
    [
      '    const names = await detectVideo(inferenceCanvas, model, (error) => {',
      '      const message = (error as Error).message || String(error)',
      '      this.onYoloError?.(message)',
      '    })',
      "    console.info('[canvas-ai][YOLO]', names.length ? names.join(', ') : 'no objects')",
      '    const flags = yoloNamesToFlags(names)'
    ].join('\n')
  )

  content = content.replace(
    /    const flags = yoloNamesToFlags\(names\)\r?\n    this\.applyYoloDetectionState\(flags\)\r?\n    return flags\r?\n  \}\r?\n\r?\n  private async runFacePipeline/,
    [
      '    const flags = yoloNamesToFlags(names)',
      '    if (flags.not_person) {',
      '      const faceFallback = await this.detectFacePresenceFallback(inferenceCanvas)',
      '      if (faceFallback.faceCount > 0) {',
      "        console.info('[canvas-ai][YOLO]', 'face fallback count=' + faceFallback.faceCount)",
      '        flags.not_person = false',
      '        flags.multi_person = faceFallback.faceCount > 1',
      '      }',
      '    }',
      '    this.applyYoloDetectionState(flags)',
      '    return flags',
      '  }',
      '',
      '  private async detectFacePresenceFallback(',
      '    inferenceCanvas: HTMLCanvasElement',
      '  ): Promise<{ faceCount: number }> {',
      '    try {',
      '      const options = this.getFaceDetectorOptions()',
      '      const detections = await getFaceApiGlobal().detectAllFaces(inferenceCanvas, options)',
      '      return { faceCount: detections.length }',
      '    } catch (error) {',
      "      console.warn('[ai-inference] face fallback failed', error)",
      '      return { faceCount: 0 }',
      '    }',
      '  }',
      '',
      '  private async runFacePipeline'
    ].join('\n')
  )

  content = content.replace(
    /async run\(\): Promise<DetectionResultFlags> \{\r?\n    if \(!this\.videoContext\) \{\r?\n      return emptyDetectionFlags\(\)\r?\n    \}\r?\n\r?\n    const yoloFlags = await this\.runYoloOnly\(\)/,
    [
      'async run(): Promise<DetectionResultFlags> {',
      '    if (!this.videoContext) {',
      '      return emptyDetectionFlags()',
      '    }',
      '',
      '    const tf = getTfGlobal()',
      '    const yoloFlags = await this.runYoloOnly()'
    ].join('\n')
  )

  content = content.replace(
    /async runFaceAndPortrait\(\): Promise<Partial<DetectionResultFlags>> \{\r?\n    if \(!this\.videoContext\) \{\r?\n      return \{\}\r?\n    \}\r?\n\r?\n    let faceFlags: Partial<DetectionResultFlags> = \{\}/,
    [
      'async runFaceAndPortrait(): Promise<Partial<DetectionResultFlags>> {',
      '    if (!this.videoContext) {',
      '      return {}',
      '    }',
      '',
      '    const tf = getTfGlobal()',
      '    let faceFlags: Partial<DetectionResultFlags> = {}'
    ].join('\n')
  )

  return content
}

function patchRecognitionWorkerClient(content) {
  content = content.replace(
    /import \{ getYoloModelUrl, YOLOV_PERFORMANCE \} from '\.\.\/model'/,
    "import { getExtensionFaceModelsBaseUrl } from '../../extensionAssets'\nimport { getYoloModelUrl, YOLOV_PERFORMANCE } from '../model'"
  )

  var faceBasePatch = [
    'const getFaceModelsBaseUrl = (): string => getExtensionFaceModelsBaseUrl()'
  ].join('\n')

  return content.replace(
    /const getFaceModelsBaseUrl = \(\): string => \{[\s\S]*?\}\r?\n\r?\n/,
    faceBasePatch + '\n\n'
  ).replace(
    /const getFaceModelsBaseUrl = \(\): string => `\$\{location\.origin\}\/models\/face-api`/,
    faceBasePatch
  )
}

function patchYksAiProctorEngineBootstrap(content) {
  return content.replace(
    /    \} catch \(error\) \{\s+this\.disableDetection\(`WebGPU 不可用，已关闭 AI 检测: \$\{\(error as Error\)\.message\}`\)\s+return\s+\}/,
    [
      '    } catch (error) {',
      '      const message = (error as Error).message || String(error)',
      '      if (this.recognitionWorkerPreferred) {',
      '        this.detectionDisabled = false',
      "        this.detectionDisabledReason = ''",
      '        this.onLog?.(',
      "          'WARN',",
      '          `主线程 TensorFlow 预检失败，将继续尝试 Worker/主线程加载: ${message}`',
      '        )',
      '      } else {',
      '        this.disableDetection(`TensorFlow 后端不可用，已关闭 AI 检测: ${message}`)',
      '        return',
      '      }',
      '    }'
    ].join('\n')
  )
}

function patchYksAiProctorEngineSwitchModel(content) {
  return content.replace(
    /      \} catch \(workerError\) \{\s+const workerMessage = \(workerError as Error\)\.message \|\| String\(workerError\)\s+this\.recognitionClient\.markDisabled\(\)\s+if \(isWebGpuUnavailableError\(workerMessage\)\) \{\s+this\.disableDetection\(`切换模型时 WebGPU 不可用，已关闭 AI 检测: \$\{workerMessage\}`\)\s+\} else \{\s+this\.onLog\?\.\('WARN', `切换模型时 Worker 失败，降级主线程: \$\{workerMessage\}`\)\s+await this\.loadMainThreadModels\(modelId\)\s+\}\s+      \}/,
    [
      '      } catch (workerError) {',
      '        const workerMessage = (workerError as Error).message || String(workerError)',
      '        this.recognitionClient.markDisabled()',
      "        this.onLog?.('WARN', `切换模型时 Worker 失败，降级主线程: ${workerMessage}`)",
      '        try {',
      '          await this.loadMainThreadModels(modelId)',
      '        } catch (mainError) {',
      '          const mainMessage = (mainError as Error).message || String(mainError)',
      '          this.disableDetection(`切换模型失败（Worker 与主线程均不可用）: ${mainMessage}`)',
      '        }',
      '      }'
    ].join('\n')
  )
}

function patchYksAiProctorEngineInitProctorLoadSkip(content) {
  return content.replace(
    /    \} else if \(!this\.detectionDisabled\) \{\r?\n      await this\.loadMainThreadModels\(options\.modelId\)\r?\n    \}/,
    [
      '    } else if (!this.detectionDisabled) {',
      '      if (!this.yoloModelService.model) {',
      '        await this.loadMainThreadModels(options.modelId)',
      '      } else {',
      '        await this.yoloModelService.ensureFaceModels()',
      '      }',
      '    }'
    ].join('\n')
  ).replace(
    /  private async loadMainThreadModels\(modelId: YoloModelId\): Promise<void> \{\r?\n    await this\.yoloModelService\.loadModel\(modelId, \{\r?\n      onLog: \(message\) => this\.onLog\?\.\('MODEL', message\)\r?\n    \}\)\r?\n    await this\.yoloModelService\.ensureFaceModels\(\)\r?\n    const graphModel = this\.yoloModelService\.model\r?\n    if \(graphModel\) \{\r?\n      await warmupYoloGraphModel\(graphModel\)\r?\n    \}\r?\n  \}/,
    [
      '  private async loadMainThreadModels(modelId: YoloModelId): Promise<void> {',
      '    await this.yoloModelService.loadModel(modelId, {',
      "      onLog: (message) => this.onLog?.('MODEL', message)",
      '    })',
      '    await this.yoloModelService.ensureFaceModels()',
      '  }'
    ].join('\n')
  )
}

function patchYksAiProctorEngineInitProctor(content) {
  content = patchYksAiProctorEngineInitProctorLoadSkip(content)
  content = content.replace(
    /      \} catch \(workerError\) \{\s+const workerMessage = \(workerError as Error\)\.message \|\| String\(workerError\)\s+this\.recognitionClient\?\.markDisabled\(\)\s+if \(isWebGpuUnavailableError\(workerMessage\)\) \{\s+this\.disableDetection\(`Recognition Worker WebGPU 不可用，已关闭 AI 检测: \$\{workerMessage\}`\)\s+\} else \{\s+this\.onLog\?\.\(\s+'WARN',\s+`Recognition Worker 初始化失败，降级主线程: \$\{workerMessage\}`\s+\)\s+await this\.loadMainThreadModels\(options\.modelId\)\s+\}\s+      \}/,
    [
      '      } catch (workerError) {',
      '        const workerMessage = (workerError as Error).message || String(workerError)',
      '        this.recognitionClient?.markDisabled()',
      '        this.onLog?.(',
      "          'WARN',",
      '          `Recognition Worker 初始化失败，降级主线程: ${workerMessage}`',
      '        )',
      '        try {',
      '          await this.loadMainThreadModels(options.modelId)',
      '        } catch (mainError) {',
      '          const mainMessage = (mainError as Error).message || String(mainError)',
      '          this.disableDetection(`AI 检测初始化失败（Worker 与主线程均不可用）: ${mainMessage}`)',
      '        }',
      '      }'
    ].join('\n')
  )

  return content.replace(
    /    \} else if \(!this\.detectionDisabled\) \{\s+try \{\s+await this\.loadMainThreadModels\(options\.modelId\)\s+\} catch \(error\) \{\s+const message = \(error as Error\)\.message \|\| String\(error\)\s+if \(isWebGpuUnavailableError\(message\)\) \{\s+this\.disableDetection\(`WebGPU 不可用，已关闭 AI 检测: \$\{message\}`\)\s+\} else \{\s+throw error\s+\}\s+\}\s+\}/,
    [
      '    } else if (!this.detectionDisabled) {',
      '      await this.loadMainThreadModels(options.modelId)',
      '    }'
    ].join('\n')
  )
}

/** EXT_PERFORMANCE.useRecognitionWorker 须生效，不能写死读 YOLOV_PERFORMANCE */
function patchYksAiProctorEngineRecognitionConfig(content) {
  if (content.indexOf('this.recognitionWorkerPreferred = !!this.performanceConfig.useRecognitionWorker') >= 0) {
    return content
  }
  content = content.replace(
    /private recognitionWorkerPreferred = YOLOV_PERFORMANCE\.useRecognitionWorker/,
    'private recognitionWorkerPreferred = false'
  )
  return content.replace(
    /this\.performanceConfig = options\.performanceConfig/,
    [
      'this.performanceConfig = options.performanceConfig',
      '    this.recognitionWorkerPreferred = !!this.performanceConfig.useRecognitionWorker'
    ].join('\n')
  )
}

function patchYksAiProctorEngine(content) {
  content = content.replace(/import \* as tf from '@tensorflow\/tfjs'\r?\n/, '')

  content = content
    .replace(
      /YOLOV_PERFORMANCE\.staggerYoloAndFace/g,
      'this.performanceConfig.staggerYoloAndFace'
    )
    .replace(
      /YOLOV_PERFORMANCE\.bootYoloOnlyDurationMs/g,
      'this.performanceConfig.bootYoloOnlyDurationMs'
    )
    .replace(
      /YOLOV_PERFORMANCE\.faceDetectEveryYoloCycles/g,
      'this.performanceConfig.faceDetectEveryYoloCycles'
    )
    .replace(
      /YOLOV_PERFORMANCE\.changeFaceDetectEveryPortraitCycles/g,
      'this.performanceConfig.changeFaceDetectEveryPortraitCycles'
    )

  content = patchYksAiProctorEngineRecognitionConfig(content)
  content = patchYksAiProctorEngineBootstrap(content)
  content = patchYksAiProctorEngineSwitchModel(content)
  content = patchYksAiProctorEngineInitProctor(content)

  if (content.indexOf('getDetectPhase():') < 0) {
    content = content.replace(
      /  setMasterFace\(dataUrl: string \| null\): void \{/,
      [
        "  getDetectPhase(): 'object' | 'portrait' {",
        '    return this.detectPhase',
        '  }',
        '',
        '  setMasterFace(dataUrl: string | null): void {'
      ].join('\n')
    )
  }

  if (content.indexOf('[canvas-ai][portrait]') < 0) {
    content = content.replace(
      /    this\.portraitCycleCount \+= 1\r?\n\r?\n    if \(this\.recognitionClient/,
      [
        '    this.portraitCycleCount += 1',
        "    console.info('[canvas-ai][portrait] 开始 portrait 检测 cycle=' + this.portraitCycleCount)",
        '',
        '    if (this.recognitionClient'
      ].join('\n')
    )
  }

  var newSnippet = [
    "      } catch (error) {",
    "        const errorMessage = (error as Error).message || String(error)",
    "        this.recognitionClient.recordFailure(error as Error)",
    "        this.onLog?.(",
    "          'WARN',",
    "          `Worker 全量检测失败: ${errorMessage}`",
    "        )",
    "        this.closeBitmap(bitmap)",
    "        if (errorMessage === PROCTOR_WORKER_BUSY) {",
    "          return { success: true, phase: 'skipped', skipReason: 'busy' }",
    "        }",
    "        return { success: false, phase: 'skipped', skipReason: 'worker-error' }",
    "      }"
  ].join('\n')

  return content.replace(
    /      \} catch \(error\) \{\s+this\.recognitionClient\.recordFailure\(error as Error\)\s+this\.onLog\?\.\(\s+'WARN',\s+`Worker 全量检测失败，本帧跳过: \$\{\(error as Error\)\.message \|\| String\(error\)\}`\s+\)\s+this\.closeBitmap\(bitmap\)\s+return \{ success: true, phase: 'skipped', skipReason: 'busy' \}\s+      \}/,
    newSnippet
  )
}

function main() {
  if (!fs.existsSync(AI_SRC)) {
    console.error('[sync-ai-engine] aiIdentification src not found:', AI_SRC)
    process.exit(1)
  }

  YOLO_FILES.forEach(function(relativePath) {
    copyAndPatch(relativePath, function(content) {
      if (relativePath === 'yolo/model.ts') {
        return patchModelTs(content)
      }
      if (relativePath === 'yolo/engine/recognitionWorkerClient.ts') {
        return patchRecognitionWorkerClient(content)
      }
      if (relativePath === 'yolo/engine/yksAiProctorEngine.ts') {
        return patchYksAiProctorEngine(content)
      }
      if (relativePath === 'yolo/engine/inferenceRunner.ts') {
        return patchInferenceRunner(content)
      }
      return content
    })
  })

  PROCTOR_FILES.forEach(function(relativePath) {
    copyAndPatch(relativePath, patchProctorImports)
  })

  console.log('[sync-ai-engine] done')
}

main()
