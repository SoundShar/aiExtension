# 扩展开发约定

## TensorFlow 后端（硬性）

- **仅允许 `webgpu`**，**禁止** `webgl` 作为运行时后端或失败回退。
- `src/ai/yolo/model.ts` 中 `initWebGpuBackend` 只调用 `tf.setBackend('webgpu')`；非 webgpu 时抛错。
- `src/ai/extensionModelConfig.ts`：`EXT_TF_BACKEND = 'webgpu'`。
- Offscreen 脚本顺序：`tf-csp-prelude` → `tf-webgpu-bundle` → `face-api`；`tf-webgpu-bundle.js` 由 webpack 打包 `tfjs-core + tfjs-converter + tfjs-backend-webgpu`；**不要**引入 `tf-backend-webgl.min.js`。
- Worker：`copy-assets.js` 补丁 `worker.js`，`setBackend('webgpu')` 且校验 `getBackend() === 'webgpu'`。
- `scripts/sync-ai-engine.js` 同步 aiIdentification 后会对 `model.ts` 打补丁，避免恢复 `webgl` 回退逻辑。

新增或同步 AI 代码时，全文检索 `webgl` / `setBackend`，确保无静默降级。

## 验证

构建后 Offscreen 控制台应出现：

```text
[yolo-model] TensorFlow backend: webgpu
```

若为 `webgl` 或 CPU，说明构建/加载链路错误，应修复而非接受降级。
