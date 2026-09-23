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

每个 Pull Request 都会运行 `.github/workflows/ai-review.yml`。工作流会使用 `git diff HEAD~1` 获取本次变更，并通过 OpenAI-compatible API 生成审查意见，再自动评论到 PR 中。

使用前需要在仓库 Secrets 中配置 `OPENAI_API_KEY`。默认使用 `gpt-4o-mini` 和 `https://api.openai.com/v1`。如果要使用智谱 GLM，需要在仓库 Variables 中配置 `AI_API_BASE_URL=https://open.bigmodel.cn/api/paas/v4` 和 `AI_MODEL=glm-5.3-flash`。如果审查结果包含 `critical` 或 `blocking` 级别的问题，CI 会输出 warning，并要求人工确认后再合并。
