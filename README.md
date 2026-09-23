# History3D

一个基于 Vite、React、TypeScript 和 Three.js 的 3D 历史项目。

## 开发

```bash
pnpm install
pnpm dev
```

## 构建与预览

```bash
pnpm build
pnpm preview
```

## 协作约定

- `main` 分支只接收通过 Pull Request 合并的变更。
- 新功能请使用 `feature/xxx` 分支。
- 修复问题请使用 `fix/xxx` 分支。
- 提交信息使用英文祈使句，例如 `feat: add historical map viewer`。

## AI PR 审查

每个 Pull Request 都会运行 `.github/workflows/ai-review.yml`。工作流用 PR 的 base sha（`git diff <base>...HEAD`）获取本次变更——不是 `HEAD~1`，否则多提交的 PR 只会审到最后一个提交——并通过 AI Ping 的 OpenAI-compatible API 生成审查意见，再自动评论到 PR 中。

使用前需要在仓库 Secrets 中配置 `OPENAI_API_KEY`，值填写 AI Ping 平台的 API Key。默认使用 `GLM-5.3-Flash` 和 `https://aiping.cn/api/v1`，也可以通过仓库 Variables 修改 `AI_API_BASE_URL` 和 `AI_MODEL`。**模型 id 区分大小写**：写错时网关通常既不报错也不返回，会一直挂到超时；脚本会先用 `/models` 预检并直接指出正确写法。

可选仓库 Variables（都有默认值，不配也能跑）：`AI_TIMEOUT_MS`（默认 180000）、`AI_MAX_DIFF_CHARS`（默认 100000，按字符数截断并注明丢弃量）、`AI_PREFLIGHT`（设 `0` 关闭模型预检）、`AI_REVIEW_STRICT`（设 `1` 时审查失败会让 job 变红）。

如果审查结果包含 `critical` 或 `blocking` 级别的问题，工作流会输出 warning，并要求人工确认后再合并。上游超时或返回异常时，脚本会评论一份「AI Review 未运行」的说明并输出 warning，但**不会**让 PR 变红——外部服务的不稳定不应该拦住代码合并。
