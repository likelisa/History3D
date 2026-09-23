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

每个 Pull Request 都会运行 `.github/workflows/ai-review.yml`。工作流会使用 PR 的 base/head SHA 差异 获取本次变更，并通过 AI Ping 的 OpenAI-compatible API 生成审查意见，再自动评论到 PR 中。

使用前需要在仓库 Secrets 中配置 `OPENAI_API_KEY`，值填写 AI Ping 平台的 API Key。默认使用 `glm-5.3-flash` 和 `https://aiping.cn/api/v1`，也可以通过仓库 Variables 修改 `AI_API_BASE_URL` 和 `AI_MODEL`。如果审查结果包含 `critical` 或 `blocking` 级别的问题，CI 会输出 warning，并要求人工确认后再合并。

## 历史处理层

`processing/` 是独立的 Python 文件交接与 Tripo 文生模型任务链。无需安装前端依赖即可验证占位场景：

```bash
python3 processing/pipeline.py validate processing/sample
python3 -m unittest discover -s processing/tests -v
```

生成需要在本机设置 `TRIPO_API_KEY`。接入说明见 [processing/README.md](processing/README.md)，分层约定见 [docs/layer-handoff.md](docs/layer-handoff.md)，完成度与待办见 [processing/REVIEW.md](processing/REVIEW.md)。首页现在提供四个可交互的三层验收案例，实际读取场景 JSON，支持视角切换、物件来源检查、故障降级与本地 GLB 预览。测试步骤见 [docs/testing-cases.md](docs/testing-cases.md)。
