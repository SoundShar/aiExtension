/**
 * 从 aiIdentification 复制静态资源到 extension/public
 * 兼容 Node 12.7.0：不使用可选链、空值合并
 */
var fs = require('fs')
var path = require('path')

var AI_PUBLIC = path.resolve(__dirname, '../../aiIdentification/public')
var EXT_PUBLIC = path.resolve(__dirname, '../public')

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest))
  fs.copyFileSync(src, dest)
  console.log('[copy-assets] copied', path.relative(EXT_PUBLIC, dest))
}

function copyDirRecursive(srcDir, destDir) {
  ensureDir(destDir)
  var entries = fs.readdirSync(srcDir, { withFileTypes: true })
  entries.forEach(function(entry) {
    var srcPath = path.join(srcDir, entry.name)
    var destPath = path.join(destDir, entry.name)
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath)
    } else {
      copyFile(srcPath, destPath)
    }
  })
}

function patchWorkerJs(workerPath) {
  var content = fs.readFileSync(workerPath, 'utf8')
  var changed = false
  // face-api 必须先加载并完成 Canvas monkeyPatch，再加载 tf-webgpu 并绑定 tf
  var workerFaceApiImport = "importScripts('./js/face-api.js')"
  var workerTfWebgpuImport = "importScripts('./js/tf-webgpu-bundle.js')"
  var workerFaceApiEnvBootstrap = [
    '',
    '// Chrome 扩展 Dedicated Worker 无 window/document，face-api 内置 Pk() 无法识别环境',
    '// 必须在任何 getEnv / monkeyPatch 之前直接 setEnv，否则 getEnv 会抛 "environment is not defined"',
    '// OffscreenCanvas 构造函数必须传 (width, height)，不能 new OffscreenCanvas()，否则报 "2 arguments required"',
    'function createSafeOffscreenCanvas(width, height) {',
    '  if (arguments.length < 2) {',
    '    width = width || 1',
    '    height = height || 1',
    '  }',
    '  return new OffscreenCanvas(width, height)',
    '}',
    'function initRecognitionWorkerFaceApiEnv() {',
    "  if (typeof faceapi === 'undefined' || !faceapi.env || typeof faceapi.env.setEnv !== 'function') {",
    "    throw new Error('Worker: face-api env API 不可用')",
    '  }',
    '  faceapi.env.setEnv({',
    '    Canvas: createSafeOffscreenCanvas,',
    "    CanvasRenderingContext2D: typeof OffscreenCanvasRenderingContext2D !== 'undefined'",
    '      ? OffscreenCanvasRenderingContext2D',
    '      : function () {},',
    "    Image: typeof ImageBitmap !== 'undefined' ? ImageBitmap : function () {},",
    "    ImageData: typeof ImageData !== 'undefined' ? ImageData : function () {},",
    '    Video: function () {},',
    '    createCanvasElement: function () {',
    '      return createSafeOffscreenCanvas(1, 1)',
    '    },',
    '    createImageElement: function () {',
    "      throw new Error('createImageElement - not available in recognition worker')",
    '    },',
    '    createVideoElement: function () {',
    "      throw new Error('createVideoElement - not available in recognition worker')",
    '    },',
    "    fetch: typeof fetch !== 'undefined' ? fetch : function () {",
    "      throw new Error('fetch - not available in recognition worker')",
    '    },',
    '    readFile: function () {',
    "      throw new Error('readFile - not available in recognition worker')",
    '    }',
    '  })',
    '}',
    'initRecognitionWorkerFaceApiEnv()',
    ''
  ].join('\n')

  var workerImportBlock = /importScripts\('\.\/js\/tf\.min\.js'\)\s*\n(?:importScripts\('\.\/js\/tf-backend-webgpu\.min\.js'\)\s*\n)?importScripts\('\.\/js\/face-api\.js'\)/
  if (workerImportBlock.test(content)) {
    content = content.replace(workerImportBlock, workerFaceApiImport)
    changed = true
  }

  if (content.indexOf("importScripts('./js/tf-webgpu-bundle.js')\nimportScripts('./js/face-api.js')") >= 0) {
    content = content.replace(
      "importScripts('./js/tf-webgpu-bundle.js')\nimportScripts('./js/face-api.js')",
      workerFaceApiImport
    )
    changed = true
  }

  if (content.indexOf(workerTfWebgpuImport) < 0 && content.indexOf(workerFaceApiImport) >= 0) {
    content = content.replace(
      /importScripts\('\.\/js\/face-api\.js'\)\s*\n/,
      workerFaceApiImport + '\n'
    )
    changed = true
  }

  if (content.indexOf('function initRecognitionWorkerFaceApiEnv') < 0 && content.indexOf(workerFaceApiImport) >= 0) {
    content = content.replace(
      /importScripts\('\.\/js\/face-api\.js'\)\s*\n/,
      workerFaceApiImport + workerFaceApiEnvBootstrap
    )
    changed = true
  }

  var workerTfExtras = [
    'function extensionWorkerFetch(url, init) {',
    '  return fetch(url, init).then(function(res) {',
    '    if (!res.ok) {',
    "      throw new Error('Failed to fetch ' + url + ': HTTP ' + res.status)",
    '    }',
    '    return res',
    '  })',
    '}',
    'function registerWorkerExtensionTfIo() {',
    '  tf.io.registerLoadRouter(function(url, loadOptions) {',
    '    var path = Array.isArray(url) ? url[0] : url',
    "    if (typeof path !== 'string' || path.indexOf('chrome-extension://') !== 0) {",
    '      return null',
    '    }',
    '    return tf.io.browserHTTPRequest(url, Object.assign({}, loadOptions || {}, {',
    '      fetchFunc: extensionWorkerFetch',
    '    }))',
    '  })',
    '}',
    ''
  ].join('\n')

  var workerTfResolve = [
    'function resolveWorkerTf() {',
    '  var candidates = []',
    "  if (typeof self.tf !== 'undefined') candidates.push(self.tf)",
    "  if (typeof faceapi !== 'undefined' && faceapi.tf) candidates.push(faceapi.tf)",
    '  for (var ci = 0; ci < candidates.length; ci++) {',
    '    var item = candidates[ci]',
    "    if (item && typeof item.setBackend === 'function') return item",
    "    if (item && item.default && typeof item.default.setBackend === 'function') return item.default",
    '  }',
    "  throw new Error('Worker: tf.setBackend 不可用，请检查 js/tf-webgpu-bundle.js 是否加载成功')",
    '}',
    'var tf = resolveWorkerTf()',
    'registerWorkerExtensionTfIo()',
    'faceapi.env.monkeyPatch({ tf: tf })',
    ''
  ].join('\n')

  var workerTfBootstrap = [
    workerTfWebgpuImport,
    '',
    workerTfExtras,
    workerTfResolve
  ].join('\n')

  if (content.indexOf('faceapi.env.monkeyPatch({ tf: tf })') < 0) {
    if (content.indexOf('function resolveWorkerTf') >= 0) {
      content = content.replace(
        /registerWorkerExtensionTfIo\(\)\s*\n/,
        "registerWorkerExtensionTfIo()\nfaceapi.env.monkeyPatch({ tf: tf })\n"
      )
      changed = true
    }
  }

  if (content.indexOf(workerTfWebgpuImport) < 0) {
    var canvasMonkeyPatchAnchor =
      /faceapi\.env\.monkeyPatch\(\{\r?\n  Canvas: (?:OffscreenCanvas|createSafeOffscreenCanvas)[\s\S]*?\}\)\s*\n/
    if (canvasMonkeyPatchAnchor.test(content)) {
      content = content.replace(canvasMonkeyPatchAnchor, function(match) {
        return match + '\n' + workerTfBootstrap
      })
      changed = true
    }
  }

  if (content.indexOf('var tf = faceapi.tf') >= 0) {
    content = content.replace(/\r?\nvar tf = faceapi\.tf\r?\n/, '\n')
    changed = true
  }

  if (content.indexOf('tf: tf,\n  Canvas: OffscreenCanvas') >= 0) {
    content = content.replace(
      /faceapi\.env\.monkeyPatch\(\{\r?\n  tf: tf,\r?\n  Canvas: OffscreenCanvas/,
      'faceapi.env.monkeyPatch({\n  Canvas: OffscreenCanvas'
    )
    changed = true
  }

  if (content.indexOf('Canvas: OffscreenCanvas') >= 0) {
    content = content.replace(/Canvas: OffscreenCanvas/g, 'Canvas: createSafeOffscreenCanvas')
    changed = true
  }

  if (content.indexOf('return new OffscreenCanvas(1, 1)') >= 0) {
    content = content.replace(/return new OffscreenCanvas\(1, 1\)/g, 'return createSafeOffscreenCanvas(1, 1)')
    changed = true
  }

  var legacyTfLine = /var tf = typeof self\.tf !== 'undefined' \? self\.tf : faceapi\.tf\s*\n/
  if (legacyTfLine.test(content)) {
    content = content.replace(legacyTfLine, '')
    changed = true
  }

  if (content.indexOf('function resolveWorkerTf') >= 0 && content.indexOf(workerTfWebgpuImport) < 0) {
    content = content.replace(
      /function extensionWorkerFetch/,
      workerTfWebgpuImport + '\n\nfunction extensionWorkerFetch'
    )
    changed = true
  }

  if (
    content.indexOf('function resolveWorkerTf') >= 0 &&
    content.indexOf(workerTfWebgpuImport) >= 0 &&
    content.indexOf('function extensionWorkerFetch') >= 0 &&
    content.indexOf(workerTfWebgpuImport) > content.indexOf('function extensionWorkerFetch')
  ) {
    content = content.replace(workerTfBootstrap, '')
    content = content.replace(
      /faceapi\.env\.monkeyPatch\(\{\r?\n  Canvas: (?:OffscreenCanvas|createSafeOffscreenCanvas)[\s\S]*?\}\)\s*\n/,
      function(match) {
        return match + '\n' + workerTfBootstrap
      }
    )
    changed = true
  }

  var newDetectFull = [
    "async function handleDetectFull(data) {",
    "  var requestId = data.requestId",
    "  if (detectBusy) {",
    "    postDetectError(requestId, 'full', PROCTOR_WORKER_BUSY)",
    "    closeBitmap(data.bitmap)",
    "    return",
    "  }",
    "  detectBusy = true",
    "  var yoloFlags = null",
    "  try {",
    "    yoloFlags = await detectYoloFromBitmap(data.bitmap, false)",
    "    var portraitFlags = null",
    "    try {",
    "      portraitFlags = await runPortraitPipeline({",
    "        bitmap: data.bitmap,",
    "        lastYoloFlags: yoloFlags,",
    "        fence: data.fence,",
    "        canvasWidth: data.canvasWidth,",
    "        canvasHeight: data.canvasHeight,",
    "        enableChangeFace: data.enableChangeFace,",
    "        runChangeFaceDescriptor: data.runChangeFaceDescriptor",
    "      })",
    "    } catch (portraitError) {",
    "      console.warn('[recognition-worker] portrait pipeline failed, keep yolo flags', portraitError)",
    "      portraitFlags = {",
    "        has_pitch: false,",
    "        has_yaw: false,",
    "        has_change_face: false,",
    "        has_out_bounds: false",
    "      }",
    "    }",
    "    closeBitmap(data.bitmap)",
    "    var merged = mergeYoloAndPortrait(yoloFlags, portraitFlags)",
    "    postDetectResult(requestId, 'full', {",
    "      detection_result: merged,",
    "      yolo_flags: yoloFlags",
    "    })",
    "  } catch (error) {",
    "    postDetectError(requestId, 'full', (error && error.message) || String(error))",
    "    closeBitmap(data.bitmap)",
    "  } finally {",
    "    detectBusy = false",
    "  }",
    "}"
  ].join('\n')

  var legacyBase64ToCanvasPattern = /async function base64ToCanvas\(imageBase64\) \{[\s\S]*?\n\}\s*\n/
  var newBase64ToFaceTensor = [
    'async function base64ToFaceTensor(imageBase64) {',
    '  var response = await fetch(imageBase64)',
    '  var blob = await response.blob()',
    '  var bitmap = await createImageBitmap(blob)',
    '  var canvas = bitmapToCanvas(bitmap)',
    '  var tensor = tf.browser.fromPixels(canvas)',
    '  closeBitmap(bitmap)',
    '  return tensor',
    '}',
    ''
  ].join('\n')
  if (legacyBase64ToCanvasPattern.test(content)) {
    content = content.replace(legacyBase64ToCanvasPattern, newBase64ToFaceTensor)
    changed = true
  }

  if (content.indexOf('detectAllFaces(canvas, options)') >= 0) {
    content = content.replace(
      /var canvas = bitmapToCanvas\(params\.bitmap\)\s*\n\s*var options = getFaceDetectorOptions\(\)\s*\n\s*var needDescriptors = Boolean\(params\.enableChangeFace && params\.runChangeFaceDescriptor && masterDescriptor\)\s*\n\s*var detections = \[\]\s*\n\s*\n\s*try \{\s*\n\s*var landmarkChain = faceapi\.detectAllFaces\(canvas, options\)\.withFaceLandmarks\(\)\s*\n\s*detections = needDescriptors \? await landmarkChain\.withFaceDescriptors\(\) : await landmarkChain\s*\n\s*\} catch \(faceError\) \{\s*\n\s*console\.warn\('\[recognition-worker\] face detect failed', faceError\)\s*\n\s*return flags\s*\n\s*\}/,
      [
        'var canvas = bitmapToCanvas(params.bitmap)',
        '  var faceTensor = tf.browser.fromPixels(canvas)',
        '  var options = getFaceDetectorOptions()',
        '  var needDescriptors = Boolean(params.enableChangeFace && params.runChangeFaceDescriptor && masterDescriptor)',
        '  var detections = []',
        '',
        '  try {',
        '    var landmarkChain = faceapi.detectAllFaces(faceTensor, options).withFaceLandmarks()',
        '    detections = needDescriptors ? await landmarkChain.withFaceDescriptors() : await landmarkChain',
        '  } catch (faceError) {',
        "    console.warn('[recognition-worker] face detect failed', faceError)",
        '    return flags',
        '  } finally {',
        '    tf.dispose(faceTensor)',
        '  }'
      ].join('\n')
    )
    changed = true
  }

  if (content.indexOf('detectSingleFace(canvas, options)') >= 0 || content.indexOf('base64ToCanvas(data.imageBase64)') >= 0) {
    content = content.replace(
      /var canvas = await base64ToCanvas\(data\.imageBase64\)\s*\n\s*var options = getFaceDetectorOptions\(\)\s*\n\s*var singleResult = await faceapi\s*\n\s*\.detectSingleFace\(canvas, options\)\s*\n\s*\.withFaceLandmarks\(\)\s*\n\s*\.withFaceDescriptor\(\)/,
      [
        'var faceTensor = await base64ToFaceTensor(data.imageBase64)',
        '      var options = getFaceDetectorOptions()',
        '      var singleResult = null',
        '      try {',
        '        singleResult = await faceapi',
        '          .detectSingleFace(faceTensor, options)',
        '          .withFaceLandmarks()',
        '          .withFaceDescriptor()',
        '      } finally {',
        '        tf.dispose(faceTensor)',
        '      }'
      ].join('\n')
    )
    changed = true
  }

  var detectFullPattern = /async function handleDetectFull\(data\) \{[\s\S]*?\n\}\s*\nfunction handleDispose/
  if (detectFullPattern.test(content)) {
    content = content.replace(detectFullPattern, newDetectFull + '\n\nfunction handleDispose')
    changed = true
  } else {
    console.warn('[copy-assets] worker.js detect-full block not found, skip full patch')
  }

  if (content.indexOf('function extensionWorkerFetch') < 0 && content.indexOf('function resolveWorkerTf') >= 0) {
    content = content.replace(/function resolveWorkerTf\(\) \{/, workerTfExtras + 'function resolveWorkerTf() {')
    changed = true
  }

  var workerBackendInit = [
    'async function initWorkerTfBackend() {',
    "  await tf.setBackend('webgpu')",
    '  await tf.ready()',
    "  if (tf.getBackend() !== 'webgpu') {",
    "    throw new Error('Worker WebGPU 不可用: ' + tf.getBackend() + '（禁止使用 WebGL）')",
    '  }',
    "  console.info('[recognition-worker] TF backend:', tf.getBackend())",
    '}',
    ''
  ].join('\n')

  if (content.indexOf('function initWorkerTfBackend') < 0) {
    content = content.replace(
      /async function handleInit\(data\) \{/,
      workerBackendInit + 'async function handleInit(data) {'
    )
    changed = true
  }

  var strictWebGpuBlock =
    /    await tf\.setBackend\('webgpu'\)\s+await tf\.ready\(\)\s+if \(tf\.getBackend\(\) !== 'webgpu'\) \{\s+throw new Error\('Worker WebGPU backend unavailable: ' \+ tf\.getBackend\(\)\)\s+\}/
  if (strictWebGpuBlock.test(content)) {
    content = content.replace(strictWebGpuBlock, '    await initWorkerTfBackend()')
    changed = true
  }

  if (content.indexOf("var backends = ['webgl'") >= 0) {
    content = content.replace(
      /async function initWorkerTfBackend\(\) \{[\s\S]*?\}\r?\n\r?\nasync function handleInit/,
      workerBackendInit + 'async function handleInit'
    )
    changed = true
  }

  if (content.indexOf('registerWorkerExtensionTfIo()') < 0 && content.indexOf('var tf = resolveWorkerTf()') >= 0) {
    content = content.replace(
      /var tf = resolveWorkerTf\(\)\s*\n/,
      "var tf = resolveWorkerTf()\nregisterWorkerExtensionTfIo()\n"
    )
    changed = true
  }

  if (content.indexOf('faceBase.charAt') < 0) {
    content = content.replace(
      /var faceBase = data\.faceModelsBaseUrl \|\| ''\s*\n\s*await Promise\.all\(\[/,
      [
        "var faceBase = data.faceModelsBaseUrl || ''",
        "    if (faceBase && faceBase.charAt(faceBase.length - 1) !== '/') {",
        "      faceBase = faceBase + '/'",
        '    }',
        '    await Promise.all(['
      ].join('\n')
    )
    changed = true
  }

  if (changed) {
    fs.writeFileSync(workerPath, content)
    console.log('[copy-assets] patched worker.js')
  }
}

function copyTensorFlowBundle(destJsDir) {
  var legacyFiles = [
    'tf.min.js',
    'tf-backend-webgpu.min.js',
    'tf-backend-webgpu.min.js.map'
  ]
  ensureDir(destJsDir)
  legacyFiles.forEach(function(fileName) {
    var filePath = path.join(destJsDir, fileName)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
      console.log('[copy-assets] removed legacy js\\' + fileName)
    }
  })
}

function main() {
  if (!fs.existsSync(AI_PUBLIC)) {
    console.error('[copy-assets] aiIdentification public folder not found:', AI_PUBLIC)
    process.exit(1)
  }

  ensureDir(EXT_PUBLIC)

  var workerDest = path.join(EXT_PUBLIC, 'worker.js')
  copyFile(path.join(AI_PUBLIC, 'worker.js'), workerDest)
  patchWorkerJs(workerDest)

  var destJsDir = path.join(EXT_PUBLIC, 'js')
  var jsSrc = path.join(AI_PUBLIC, 'js')
  if (fs.existsSync(jsSrc)) {
    ensureDir(destJsDir)
    var jsEntries = fs.readdirSync(jsSrc, { withFileTypes: true })
    jsEntries.forEach(function(entry) {
      if (!entry.isFile()) {
        return
      }
      if (
        entry.name === 'tf.min.js' ||
        entry.name === 'tf-backend-webgpu.min.js' ||
        entry.name === 'tf-backend-webgpu.min.js.map'
      ) {
        return
      }
      copyFile(path.join(jsSrc, entry.name), path.join(destJsDir, entry.name))
    })
  }
  copyTensorFlowBundle(destJsDir)

  var yolo11Src = path.join(AI_PUBLIC, 'models', 'yolo11')
  if (!fs.existsSync(yolo11Src)) {
    console.error('[copy-assets] yolo11 model not found:', yolo11Src)
    process.exit(1)
  }
  copyDirRecursive(yolo11Src, path.join(EXT_PUBLIC, 'models', 'yolo11'))

  var faceApiSrc = path.join(AI_PUBLIC, 'models', 'face-api')
  if (fs.existsSync(faceApiSrc)) {
    copyDirRecursive(faceApiSrc, path.join(EXT_PUBLIC, 'models', 'face-api'))
  } else {
    console.warn('[copy-assets] face-api models not found, portrait detection may fail')
  }

  console.log('[copy-assets] done')
}

main()
