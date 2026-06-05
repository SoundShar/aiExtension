/**
 * 从 aiIdentification 复制模型与 JS 到 extension/public
 * worker.js 由扩展仓库 public/worker.js 维护，不再从 aiIdentification 覆盖
 * 兼容 Node 12.7.0
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

function copyJsFromAiIdentification(destJsDir) {
  var jsSrc = path.join(AI_PUBLIC, 'js')
  if (!fs.existsSync(jsSrc)) {
    console.warn('[copy-assets] js source not found, skip')
    return
  }
  ensureDir(destJsDir)
  var legacyFiles = ['tf.min.js', 'tf-backend-webgpu.min.js', 'tf-backend-webgpu.min.js.map']
  legacyFiles.forEach(function(fileName) {
    var filePath = path.join(destJsDir, fileName)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
      console.log('[copy-assets] removed legacy js\\' + fileName)
    }
  })
  var jsEntries = fs.readdirSync(jsSrc, { withFileTypes: true })
  jsEntries.forEach(function(entry) {
    if (!entry.isFile()) {
      return
    }
    if (legacyFiles.indexOf(entry.name) >= 0) {
      return
    }
    if (entry.name === 'tf-webgpu-bundle.js') {
      return
    }
    copyFile(path.join(jsSrc, entry.name), path.join(destJsDir, entry.name))
  })
}

function main() {
  if (!fs.existsSync(AI_PUBLIC)) {
    console.error('[copy-assets] aiIdentification public folder not found:', AI_PUBLIC)
    process.exit(1)
  }

  ensureDir(EXT_PUBLIC)

  if (!fs.existsSync(path.join(EXT_PUBLIC, 'worker.js'))) {
    console.error('[copy-assets] public/worker.js missing — 请在扩展仓库维护 Worker 脚本')
    process.exit(1)
  }
  console.log('[copy-assets] keep public/worker.js (extension-owned)')

  copyJsFromAiIdentification(path.join(EXT_PUBLIC, 'js'))

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
