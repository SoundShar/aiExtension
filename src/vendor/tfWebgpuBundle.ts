import * as tfCore from '@tensorflow/tfjs-core'
import { loadGraphModel } from '@tensorflow/tfjs-converter'
import '@tensorflow/tfjs-backend-webgpu'

type TfCoreNamespace = typeof tfCore & {
  loadGraphModel: typeof loadGraphModel
}

const tfNamespace = {} as TfCoreNamespace

Object.keys(tfCore).forEach(function(key) {
  Object.defineProperty(tfNamespace, key, {
    enumerable: true,
    get: function() {
      return (tfCore as unknown as Record<string, unknown>)[key]
    }
  })
})

tfNamespace.loadGraphModel = loadGraphModel

;(globalThis as typeof globalThis & { tf?: TfCoreNamespace }).tf = tfNamespace

console.info('[canvas-ai][tf-webgpu] TensorFlow WebGPU bundle loaded')
