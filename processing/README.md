# 历史处理层 · 最小开发链

本目录按 [`历史3D工具_Demo计划与团队分工.md`](../docs/layer-handoff.md) 的文件交接约定工作。故事与史实仍是占位；`sample/` 可让现场层先接灰盒。

## 交接格式

- 采集器提供 `story.md`、`sources.json`、`references/`；对象的 `source_ids` 指向其中的稳定资料 ID。
- 处理层维护 `entities.json`、`scene.json`、`experiments.csv` 和 `assets/`。坐标为米，Y 向上，旋转为 XYZ 弧度，模型底部中心为原点。
- `recorded` 是有来源的记载，`inferred` 是推测复原，`demo` 是演示设定。尺寸依据保存在 `dimensions_basis`。生成候选不会自动覆盖 `asset`；人工检查轮廓、背面、贴图、尺度与接地后，再把 `candidate_asset` 填入 `asset`。

## 本地使用

```sh
python3 processing/pipeline.py validate processing/sample
export TRIPO_API_KEY='你的 Tripo Platform API 密钥'
python3 processing/pipeline.py submit processing/sample --entity object_01 --confirm-cost
python3 processing/pipeline.py sync processing/sample
unset TRIPO_API_KEY
```

`submit` 每次只提交一个付费任务，返回 task ID 并写入 `experiments.csv`。`sync` 查询未完成任务；成功时下载 GLB 并记为候选。再次运行可恢复轮询。Tripo 下载链接有效时间短，应及时运行 `sync`。不使用密钥时，`validate` 可离线运行。

当前只接 text-to-model；参考图、批量队列、自动尺度校准和史实判断待真实素材与现场层接入后实现。Tripo Platform API 与网页积分分别计费。

## 2026-09-23 接口验收

`sample/object_01` 已实际提交一次 text-to-model。任务 ID 为 `471fb12e-1fcc-4bc5-b243-1c1b905874e9`，状态 `success`；原始本机工作目录中的下载文件位于 `sample/assets/object_01-471fb12e-1fcc-4bc5-b243-1c1b905874e9.glb`（14,981,956 字节）。已核对 GLB v2 文件头，包含 1 个 mesh、1 个材质、3 个纹理、1 个 scene。它仍只是演示候选：尚未完成视觉、历史依据、尺度、朝向、接地或现场层加载验收，因此 `scene.json` 的 `asset` 保持为空。

接口依据：[Tripo Quick Start](https://platform.tripo3d.ai/docs/quick-start)、[OpenAPI Schema](https://platform.tripo3d.ai/docs/schema)、[FAQ](https://platform.tripo3d.ai/docs/faq)。

## 审查后的恢复操作

同一个场景包的命令通过本地文件锁串行执行。任务提交前保存 `submitting`，POST 结果不明确时保存 `submit_unknown`，避免重跑命令重复付费。先在 Tripo 控制台核实任务，再关联它：

```sh
python3 processing/pipeline.py recover processing/sample --entity object_01 --task-id 已存在的任务ID
python3 processing/pipeline.py sync processing/sample
```

远端成功但缺下载链接、下载中断或写场景失败，可以再次 `sync`，无需创建新任务。JSON/CSV 和 GLB 使用临时文件、校验及原子替换；候选不会自动成为正式 asset。完整完成度见 [REVIEW.md](REVIEW.md)。

本脚本使用 Python 3.9+ 和 Unix `fcntl` 文件锁（macOS/Linux）。仓库样例已清空候选路径与实验记录，可离线校验。真实生成记录与模型保留在原始本机工作目录，不包含在此仓库中。

## dev 分支集成

团队从 `dev` 拉取新分支并合回 `dev`；`main` 暂不作为后续开发目标。
本目录的 Python 管线和 `processing/sample/` 是处理层交接实现。已有的三幕张骞演示页面放在 `processing/demo/`，以独立的 pnpm/React 工程运行；它不是 `viewer/` 的正式场景包。正式展示层仍从根目录 `npm run dev` 启动，使用 `packages/` v0.1 协议。后续处理层资产要进入正式展示层时，先转换并校验为 `packages/<storyId>/`，不要直接复制演示包的旧 JSON 结构。

```sh
cd processing/demo
pnpm install --frozen-lockfile
pnpm dev
```
