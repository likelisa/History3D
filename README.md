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

## 可体验史实：张骞归途

`pnpm dev` 后打开首页，按六个节点体验元朔元年（前128年）张骞归汉时的南缘绕行。点击节点或“下一站”查看场景、叙述和对应来源；可切换路线总览与 1.7 米人尺度视角。历史依据与非比例场景的边界见 [docs/zhangqian-return.md](docs/zhangqian-return.md)。下一轮聚焦南缘绕行的一个精细场景，分工与验收见 [docs/zhangqian-one-scene-plan.md](docs/zhangqian-one-scene-plan.md)。

三层交接仍可通过 [技术验收案例](/cases) 检查：来源缺失、模型失败、真实 GLB 候选等放在该入口。操作步骤见 [docs/testing-cases.md](docs/testing-cases.md)。

## 历史处理层

`processing/` 是独立的 Python 文件交接与 Tripo 文生模型任务链，无需安装前端依赖即可验证场景包：

```bash
python3 processing/pipeline.py validate public/story/zhangqian-return
python3 -m unittest discover -s processing/tests -v
```

生成需要在本机设置 `TRIPO_API_KEY`。接入说明见 [processing/README.md](processing/README.md)，分层约定见 [docs/layer-handoff.md](docs/layer-handoff.md)，完成度与待办见 [processing/REVIEW.md](processing/REVIEW.md)。
