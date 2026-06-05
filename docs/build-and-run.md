# 构建与运行

实现细节与各文件逻辑见 [recognition-implementation.md](./recognition-implementation.md)。

## 环境要求

- **Node = 12.7.0**
- yarn
- Chrome / Edge 113+ 且启用 WebGPU
- 参考项目 `d:\dev\aiIdentification` 中已存在模型文件

## 首次构建

```bash
cd d:\dev\extension
yarn
yarn build
```

构建流程：

1. `yarn copy-assets` — 从 aiIdentification 复制 `models/`、`js/face-api.js`、`js/tf-csp-prelude.js`（**不覆盖** `public/worker.js`）
2. `webpack` — 打包到 `dist/`（含 `js/tf-webgpu-bundle.js`）

## 加载扩展

1. Chrome → `chrome://extensions/`
2. 开启「开发者模式」
3. 加载已解压的扩展程序 → 选择 `d:\dev\extension\dist`

## 使用步骤

1. 打开含 `<canvas>` 的网页（同源绘制，避免 `TAINTED`）
2. 打开 Popup →「开始分析」
3. 观察预览与日志；换人默认基准图 `public/image/123213123.png`

## 识别节奏

- 启动后 **15s**：`phase=object`（仅 YOLO）
- **15s 后**：`phase=full`（同 tick YOLO + face）
- 单 tick 超时 **12s**（`RECOGNITION_CONFIG.detectFrameTimeoutMs`）

## 开发模式

```bash
yarn dev
```

修改 `src/` 或 `public/worker.js` 后执行 `yarn build` 并重新加载扩展。

## 常见问题

### Worker 初始化失败

扩展 **仅 Worker 路径**，无主线程降级。日志不应出现「降级主线程」。

检查：

1. `dist/worker.js`、`dist/js/tf-webgpu-bundle.js`、`dist/models/` 存在
2. Offscreen 日志：`[recognition-worker] TF backend: webgpu`
3. `chrome://gpu` 确认 WebGPU 可用

### Worker face-api 环境

`public/worker.js` 须在 `monkeyPatch` 前 `faceapi.env.setEnv(...)`，且 `Canvas` 使用 `createSafeOffscreenCanvas` wrapper。portrait 输入使用 `tf.Tensor3D`（`tf.browser.fromPixels`）。

### 模型 Failed to fetch

1. 执行 `yarn build`，重新加载 `dist/`
2. face-api 权重基址为 `/models/face-api/`

### 检测超时

`detect-full` 单 tick 较重；若频繁 12s 超时，可在 `src/recognition/config.ts` 增大 `detectFrameTimeoutMs`。

## Node 12.7.0 构建约束

- 构建脚本不使用可选链、空值合并
- webpack 4 + ts-loader 8
- TypeScript target: ES2018
