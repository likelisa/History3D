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

## 可体验史实：张骞南缘归途单场景

`pnpm dev` 后打开首页，进入一段山前路。可以在总览中看远山与砾坡，也可以切到 1.7 米视角，用 W/A/S/D 或屏幕方向键沿路移动；右侧依次讲归途、沿南山绕行、后来再次被俘，并提供《史记》《汉书》的来源链接。

这个路段的长度、地形、人物和天气是概念表达，不是古道测绘或考古复原；再次被俘地点没有定位。[研究与表达边界](docs/zhangqian-south-detour-research.md)和[资产/场景验收记录](docs/zhangqian-south-detour-qa.md)说明每项判断。优化后的 Tripo 岩体作为 0.8 MB **候选**纳入场景包，未自动成为正式历史资产。

[六站路线索引](/journey)保留前一轮的内容顺序原型；[技术验收案例](/cases)可独立检查来源缺失、模型失败等交接问题。单场景分工与门槛见 [制作计划](docs/zhangqian-one-scene-plan.md)。

## 历史处理层

`processing/` 是独立的 Python 文件交接与 Tripo 文生模型任务链，无需安装前端依赖即可验证场景包：

```bash
python3 processing/pipeline.py validate public/story/zhangqian-return
python3 -m unittest discover -s processing/tests -v
```

生成需要在本机设置 `TRIPO_API_KEY`。接入说明见 [processing/README.md](processing/README.md)，分层约定见 [docs/layer-handoff.md](docs/layer-handoff.md)，完成度与待办见 [processing/REVIEW.md](processing/REVIEW.md)。
