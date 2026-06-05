/**
 * 启动 webpack，兼容 Node 12.7.0 与 Node 17+（禁止 NODE_OPTIONS 传 openssl-legacy-provider）
 */
var path = require('path')
var fs = require('fs')
var spawnSync = require('child_process').spawnSync

var mode = 'production'
var watchMode = false
var rawArgs = process.argv.slice(2)
var index = 0

while (index < rawArgs.length) {
  var arg = rawArgs[index]
  if (arg === '--watch') {
    watchMode = true
    index += 1
    continue
  }
  if (arg.indexOf('--mode=') === 0) {
    mode = arg.split('=')[1]
    index += 1
    continue
  }
  if (arg === '--mode') {
    index += 1
    if (rawArgs[index]) {
      mode = rawArgs[index]
      index += 1
    }
    continue
  }
  index += 1
}

var webpackBin = path.join(__dirname, '..', 'node_modules', 'webpack', 'bin', 'webpack.js')
var distDir = path.join(__dirname, '..', 'dist')
var nodeMajor = parseInt(process.version.slice(1).split('.')[0], 10)
var nodeArgs = []

function removeDirRecursive(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return
  }
  fs.readdirSync(dirPath).forEach(function(entryName) {
    var entryPath = path.join(dirPath, entryName)
    var stat = fs.lstatSync(entryPath)
    if (stat.isDirectory()) {
      removeDirRecursive(entryPath)
    } else {
      fs.unlinkSync(entryPath)
    }
  })
  fs.rmdirSync(dirPath)
}

if (!watchMode) {
  removeDirRecursive(distDir)
  console.log('[run-webpack] cleaned dist')
}

if (nodeMajor >= 17) {
  nodeArgs.push('--openssl-legacy-provider')
}

nodeArgs.push(webpackBin)
nodeArgs.push('--mode', mode)

if (watchMode) {
  nodeArgs.push('--watch')
}

var result = spawnSync(process.execPath, nodeArgs, {
  stdio: 'inherit',
  env: process.env
})

if (result.error) {
  console.error('[run-webpack] failed:', result.error.message)
  process.exit(1)
}

process.exit(result.status === null ? 1 : result.status)
