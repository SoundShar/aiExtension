# 构建与运行

## 环境要求

- **Node = 12.7.0**（建议使用 nvm 切换）
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

1. `yarn sync-ai` — 从 aiIdentification 同步 AI 推理源码到 `src/ai/`
2. `yarn copy-assets` — 复制 worker.js、js/、models/yolo11/、models/face-api/
3. `webpack` — 打包到 `dist/`

## 加载扩展

1. 打开 Chrome → `chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `d:\dev\extension\dist`

## 使用步骤

1. 打开包含 `<canvas>` 的网页（需同源绘制，避免跨域污染）
2. 点击扩展图标打开 Popup
3. 点击「开始分析」
4. 观察 JPEG 预览与下方分析日志
5. 可选：点击「设当前帧为基准人脸」启用换人检测

## 模型体积与按需复制

默认仅复制 `models/yolo11/`（约 20–40MB，视 shard 数量而定）。

如需其他模型，手动从 aiIdentification 复制到 `public/models/`：

| 模型目录 | 说明 |
| ---------- | ------ |
| `yolo11/` | 默认，已自动复制 |
| `yolo26/` | 按需手动复制 |
| `yolov8/` | 按需手动复制 |
| `face-api/` | 人脸检测必需，已自动复制 |

复制后重新执行 `yarn build`。

## 开发模式

```bash
yarn dev
```

修改源码后刷新扩展并重新加载 Popup。

## 常见问题

### 模型加载 Failed to fetch

Offscreen 加载顺序：`js/tf-csp-prelude.js` → `js/tf-webgpu-bundle.js` → `js/face-api.js`。`tf-webgpu-bundle.js` 由 webpack 将 `tfjs-core + tfjs-converter + tfjs-backend-webgpu` 打成同一个产物，避免 UMD 脚本出现 `t.env is not a function`。

**扩展约定：仅使用 WebGPU，禁止 WebGL 回退**（`initWebGpuBackend` 只调用 `tf.setBackend('webgpu')`）。

若报错：

1. 执行 `yarn build` 后确认 `dist/js/tf-webgpu-bundle.js`、`dist/models/yolo11/` 存在
2. 在 `chrome://extensions` 重新加载扩展
3. Offscreen 控制台必须为 `[yolo-model] TensorFlow backend: webgpu`（若为 `webgl` 说明未加载本构建产物）
4. 在 `chrome://gpu` 确认 WebGPU 已启用；未启用时扩展会报错，不会降级 WebGL

### canvas 跨域污染

目标页 canvas 若加载跨域图片且未设置 `crossOrigin`，`toDataURL` 会失败。Popup 会显示红色错误提示 `TAINTED`。

### WebGPU 后端失败

扩展**禁止** WebGL。若出现 `TensorFlow WebGPU 后端初始化失败`，请查看 Offscreen 控制台 `[yolo-model] TF backend webgpu failed` 的完整错误，并在 `chrome://gpu` 检查 WebGPU 状态与硬件加速。

### 模型 Failed to fetch

1. 必须加载 **`dist/`** 目录（含 `models/yolo11`、`models/face-api`），修改后执行 `yarn build` 并在扩展页 **重新加载**。
2. Offscreen 控制台应出现 `[canvas-ai][offscreen] TensorFlow 与扩展 fetch 已就绪`；`bootstrapModels` 阶段应有 `[canvas-ai][MODEL] 加载 YOLO GraphModel: chrome-extension://...`。
3. **face-api** 权重基址须为扩展根路径 **`/models/face-api/`**（勿用 `chrome.runtime.getURL` 整 URL，否则 `getModelUris` 会把扩展 ID 拼进路径，控制台出现 `ERR_FILE_NOT_FOUND` 且路径像 `扩展ID/models/face-api/...`）。
4. **CSP**：`manifest.json` 仅使用 `'wasm-unsafe-eval'`；TensorFlow 通过 `tf-webgpu-bundle.js` 加载，**不会**因此改用 WebGL。
5. 扩展默认 `EXT_PERFORMANCE.useRecognitionWorker: false`（主线程加载模型）。
6. 若仍失败，查看 `[canvas-ai][detectFrame]` 的完整错误；勿仅看 Popup 短文案。

### TensorFlow WebGPU bundle 未加载

若出现 `缺少 tf.env`、`t.env is not a function` 或 `Backend name 'webgpu' not found in registry`：

1. 确认 `dist/js/tf-webgpu-bundle.js` 是最新构建产物。
2. 在 `chrome://extensions` 重新加载 `dist/`。
3. Offscreen 控制台应先出现 `[canvas-ai][tf-webgpu] TensorFlow WebGPU bundle loaded`，随后出现 `[yolo-model] TensorFlow backend: webgpu`。

### 检测越跑越卡 / 120s 超时卡住

**现象**：前几帧 700ms 左右，随后偶发 5–11s，最终 Background 报 `检测超时` 且 Offscreen 无 `检测完成`。

**根因**：Background 超时后会继续派发新帧，而 Offscreen 旧版 `detectChain` 会把新帧排在挂起帧之后，队列越积越长。

**当前策略**（`EXT_PERFORMANCE`）：

- Offscreen **只保留最新一帧**，慢帧不会无限排队
- 单帧 **45s** 超时（`detectFrameTimeoutMs`），超时立即回 `DETECT_RESULT`，滞后完成的推理结果丢弃
- Background 超时 **50s**，略长于 Offscreen，避免双端竞态
- 扩展 `detectFrame` 固定 **`mode=object`**（仅 YOLO），不进入 portrait（face-api），避免约 60s 后 `bootYoloOnlyDurationMs` 结束触发 portrait 挂起 WebGPU

Offscreen 日志应出现 `开始检测 tabId=… phase=object|portrait`；进入 portrait 时有 `[canvas-ai][portrait] 开始 portrait 检测`。

另请检查是否重复出现 `加载 YOLO GraphModel`（重复加载会占满 WebGPU）。`YoloModelService` 会复用同一 `modelId` 的加载 Promise；`detectVideo` 在 `finally` 释放临时 Tensor。

### aiIdentification 升级后同步

```bash
yarn sync-ai
yarn build
```

## Node 12.7.0 构建约束

- 构建脚本不使用可选链 `?.`、空值合并 `??`
- webpack 4.x + ts-loader 8.x
- TypeScript target: ES2018
- Node 17+ 构建通过 `scripts/run-webpack.js` 以命令行参数传入 `--openssl-legacy-provider`（不使用 `NODE_OPTIONS`，避免 Node 22+ 报错）
