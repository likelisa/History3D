# History3D（Triple S）

给今天的人，一份来自历史世界的礼物。项目包含两个可直接观看的作品，以及制作新讲解网页的通用工具。

## 直接体验：两个作品与一个工具

在源码根目录使用 Node.js 22+（新生成推荐 Node 24；Windows 启动器要求 Node 24），首次安装依赖后启动：

```bash
npm ci
npm run demo
```

打开 **[统一体验入口](http://127.0.0.1:5210/experience.html)**。这个命令先校验并构建壁画作品，再启动本地服务；构建和观看已有作品不调用付费生成。已有服务占用 5210 时，先确认其用途，勿重启正在制作的项目。

| 入口 | 体验内容 | 是否需要 Key |
| --- | --- | --- |
| [丝绸之路壁画 · 张骞](http://127.0.0.1:5210/mural.html) | 原画、路线、人物、持节西行与市场故事；按页面开始入口进入 | 不需要 |
| [铜奔马](http://127.0.0.1:5210/examples/bronze-horse/viewer.html) | 照片对照、旋转/缩放真实 Tripo GLB、三章九句讲解和保存的旁白 | 不需要 |
| [制作工具](http://127.0.0.1:5210/) | 上传壁画或文物，填写主题与史料，生成新的独立讲解网页 | 需要故事模型和 Tripo Key |
| [使用指南](http://127.0.0.1:5210/guide.html) | 四步填写说明、第39窟与文物资料示例、结果与恢复方式 | 不需要 |

已构建时可直接 `npm run agent:dev`，无需再次构建。已有作品的模型和音轨保存在仓库内；新项目未配置公开声音服务时使用阅读模式。网页需 HTTP 服务，不能直接双击作品 HTML。地址仅在运行服务的电脑上有效。

张骞是定制故事作品，铜奔马是通用工具的实际生成案例。工具目前不会自动完成联网史料认证，也不会复制张骞作品全部定制动作。第323窟张骞壁画、第39窟工具测试素材分别管理；生成模型是艺术示意或重建，不是文物扫描。

- [项目地图与演示顺序](docs/demo/PROJECT-GUIDE.md)
- [2026-10-04 更新梳理](docs/demo/2026-10-04-UPDATES.md)
- [工具运行、输入限制与恢复](docs/agent/local-agent-README.md)

## 团队分支与处理层演示

当前交接基线为 `main`（r14 已合入）。新改动从最新 `main` 开功能分支，通过 PR 审查后集成。处理层 Python 管线位于 [`processing/`](processing/README.md)，张骞三幕交互演示位于 `processing/demo/`，可独立运行；根目录 `npm run dev` 仍运行展示层 C 的正式 `viewer/`。演示包使用旧格式，不应当作 `packages/` v0.1 正式协议包。

## 运行环境

本仓库在以下版本实测通过（演示机为 macOS + Chrome）：

| 项目 | 版本 |
| --- | --- |
| Node.js | 本次实测 24.18.0；已有 CI 使用 20，新生成推荐 24 |
| npm | 10.8.2 |
| 浏览器 | Chrome（桌面，支持 WebGL2 与 Pointer Lock） |

依赖与锁文件由集成负责人统一维护，请使用 npm，不要引入第二套包管理器。

## 开发命令与旧协议查看器

```bash
npm ci          # 从干净环境安装主应用
npm run dev     # 校验并准备资源，启动开发页面，打印可访问地址
npm run build   # 校验并准备资源，构建可演示站点
npm run preview # 启动构建后的站点，用于最终运行验收
```

命令约定：

| 命令 | 行为 |
| --- | --- |
| `npm ci` | 按 `package-lock.json` 从干净环境安装 |
| `npm run validate:collection -- collector/output/<storyId>` | 检查资料包格式、引用与本地素材；有错返回非零退出码 |
| `npm run collector:dev` | 在本机运行采集反馈原型与技术样例；默认只做本地检索规划，不自动外发用户原话 |
| `npm run collector:publish -- hash/publish ...` | 对已人工审核的候选包计算摘要或执行受控发布；不替代史料审核 |
| `npm run validate:package -- packages/<storyId>` | 检查场景包格式、版本、引用、尺寸声明与文件存在性 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | `vitest run`（协议、查看器、采集层及安全门槛测试；数量以当前运行结果为准） |
| `npm run check` | 固定样例 + 正式包校验 + 类型检查 + 测试，任一步失败则整体失败 |
| `npm run prepare:assets` | 把 `packages/` 复制到 `viewer/public/packages/` |
| `npm run dev` / `build` | 自动先跑校验与资源准备 |
| `npm run preview` | 预览 `dist/` 构建产物 |

以下描述适用于旧协议查看器 `/index.html`（Vite 开发服务），不适用于工坊和两个作品。预期页面：打开后先经过 `idle → loading_manifest → validating → loading_assets → ready`，
进入「可体验」后可用顶部五个入口：开始体验、俯视/第一人称、测距、故事列表、回到起点。

**直接双击 HTML 文件不作为演示方式**，必须通过本地静态服务以 HTTP 加载包内资源。

## 旧协议查看器环境变量

复制 `.env.example` 为 `.env` 可覆盖默认场景包（默认 `silk-road-demo`）：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `VITE_DEFAULT_STORY_ID` | `silk-road-demo` | 查看器默认加载的 `packages/<storyId>/` |

第三方生成服务的密钥只放在本地脚本或服务端环境里，**不得**进入 `scene.json`、GLB、前端构建产物或版本库。

## 目录结构

```text
history-demo/
  agent/                        # 通用制作工坊、统一入口与使用指南
  artifacts/bronze-horse-r14/     # 已生成铜奔马网页、模型与旁白
  collector/                    # A 层原型；候选/正式输出按公共契约交接
  contracts/                    # 协议、JSON Schema、校验实现与固定样例（C 维护入口，三方审核规则）
  packages/<storyId>/           # 唯一正式场景包输出区（B 输出；查看器的入口是 scene.json）
  viewer/                       # 浏览器查看器（C）
    public/packages/            # 生成物：npm run prepare:assets 从 packages/ 复制
  scripts/                      # 校验、资源准备与样例生成脚本
  tests/                        # 协议与几何单元测试
  records/                      # 验收、问题与实验记录
  dist/                         # 构建产物（npm run build）
```

资源发布路径固定为 `/packages/<storyId>/scene.json`，所有包内资源都以该 `scene.json` 所在目录为基准解析；
代码中不出现开发者电脑的绝对路径。`viewer/public/packages/` 是复制生成物，不手工维护。

## 技术协议速览（v0.1）

- 米制、Y 轴向上、右手系；`position` 含义为**包围盒底部中心**。
- `schemaVersion` 固定 `"0.1.0"`；三个 JSON 的 `storyId` 与 `contentRevision` 必须一致。
- 路径一律相对场景包根目录，不允许绝对路径、`..` 或远程模型地址。
- 证据分三类：`documented` 史料记载 / `inferred` 推测复原 / `illustrative` 演示设定；
  `unknown` 是信息完整性状态，不是第四种证据类型。展示层按属性分别标注，不给整个对象贴「真实复原」。
- 灰盒按 `dimensionsM` 建 Box 并把几何中心上移 `h/2`；加载 GLB **不做**这次平移。
- 相机眼高 = 脚下位置 + 1.7 米；yaw=0 看向 -Z，yaw=π/2 看向 -X。
- 缺失主模型**不静默降级**为灰盒，直接报 `ASSET_LOAD_FAILED`。

诊断码见 `contracts/src/diagnostics.ts`：`PACKAGE_FETCH_FAILED`、`SCHEMA_UNSUPPORTED`、
`VALIDATION_FAILED`、`REVISION_MISMATCH`、`REFERENCE_MISSING`、`ASSET_LOAD_FAILED`（error），
`OPTIONAL_IMAGE_FAILED`、`SOURCE_OFFLINE`（warning）。

## 旧协议查看器操作说明

| 操作 | 按键 |
| --- | --- |
| 移动 | `W A S D` 或方向键 |
| 看向 | 鼠标（第一人称，需先「进入场景」） |
| 释放鼠标 / 暂停 | `Esc` |
| 打开故事点 | 准星对准编号标记后点击，或从「故事列表」进入 |
| 俯视 / 第一人称 | 顶部「俯视」按钮切换，切回时恢复原位置与朝向 |
| 测距 | 顶部「测距」进入，点击两个点得到两点直线距离；第三次点击清空重设 A |
| 回到起点 | 顶部「回到起点」，恢复出生位置、朝向与第一人称，并清空面板与测距点 |

测距显示的是**两点直线距离**，不是沿路步行距离，也不是区域路线里程。

## 旧协议查看器性能基准（`?bench=`）

查看器内置采样器，按 1 秒窗口统计帧率，用于复核文档 12.4 的口径。

```
http://localhost:4173/?bench=1&benchSeconds=90
```

`benchSeconds` 缺省 90 秒；采样期间请持续移动，结束后页面右上角打印报告并写入
`window.__benchReport`，包含 `loadMs`、每个窗口的 `fps`、`windowsAtOrAbove30Fps` 与
`ratioAtOrAbove30Fps`。验收口径：`loadMs ≤ 10000`，且 `ratioAtOrAbove30Fps ≥ 0.8`。

首次加载计时口径：从请求 `scene.json` 起，到主模型、故事文本和必要交互均可用为止；
清除站点缓存后测三次并保留每次结果。本地表现不能推广成公网或手机性能。

## 协作约定

采集层的协议与当前实现边界见 `contracts/COLLECTOR_HANDOFF.md` 和 `collector/RUBRIC_DRAFT.md`；独立审查的逐项指标、结果与用户复核步骤见 `collector/REVIEW_REPORT.md`、`collector/REVIEW_CHECKLIST.md`。
Tripo 生成的行囊图保存在 `collector/experiments/tripo/`，只获用户批准作为 B 层**概念参考**，
不是史料来源、已发布素材或正式三件套的一部分。

- 三层是「资料 → 场景 → 展示」的单向生产依赖；浏览器运行时只需要完整场景包。
- `main` 只接收通过 Pull Request 的变更：`feature/xxx` 新功能、`fix/xxx` 修问题、
  `chore/xxx` 杂项；提交信息用英文祈使句，例如 `feat: add hotspot anchors`。
- 每个 PR 只做一项明确改动，至少一名非作者审核，并由集成负责人准备
  「当前主分支 + 本 PR 改动」的候选版本跑 `check` / `build` 后再合并。
- 发布场景包时在新目录完成导出与校验后整体替换，不能边运行边覆盖其中一个 JSON。
- 联调问题记录完整的 `(schemaVersion, storyId, contentRevision, sceneRevision)`。

验收与问题记录见 `records/`。

## AI PR 审查

每个 Pull Request 都会运行 `.github/workflows/ai-review.yml`。工作流用 PR 的 base sha（`git diff <base>...HEAD`）获取本次变更——不是 `HEAD~1`，否则多提交的 PR 只会审到最后一个提交——并通过 AI Ping 的 OpenAI-compatible API 生成审查意见，再自动评论到 PR 中。

使用前需要在仓库 Secrets 中配置 `OPENAI_API_KEY`，值填写 AI Ping 平台的 API Key。默认使用 `DeepSeek-V4.1-Flash` 和 `https://aiping.cn/api/v1`，也可以通过仓库 Variables 修改 `AI_API_BASE_URL` 和 `AI_MODEL`。**模型 id 区分大小写**：写错时网关通常既不报错也不返回，会一直挂到超时；脚本会先用 `/models` 预检并直接指出正确写法。

这个网关上的模型多是**推理模型**：先输出一段思考，再输出正文。因此必须给足输出上限，否则会只剩思考、没有正文（`AI_MAX_TOKENS` 默认 32000；实测审查一份 10 万字符的 diff 输出约 2 万 token）。报错信息里会写明实际拿到多少字思考，便于判断该调多大。

可选仓库 Variables（都有默认值，不配也能跑）：`AI_TIMEOUT_MS`（默认 300000）、`AI_MAX_TOKENS`（默认 32000，必须容得下推理模型的思考）、`AI_MAX_DIFF_CHARS`（默认 100000，按字符数截断并注明丢弃量）、`AI_PREFLIGHT`（设 `0` 关闭模型预检）、`AI_REVIEW_STRICT`（设 `1` 时审查失败会让 job 变红，而不是只评论一条「未运行」的说明）。

如果审查结果包含 `critical` 或 `blocking` 级别的问题，工作流会输出 warning，并要求人工确认后再合并。上游超时或返回异常时，脚本会评论一份「AI Review 未运行」的说明并输出 warning，但**不会**让 PR 变红——外部服务的不稳定不应该拦住代码合并。

另有 `.github/workflows/ci.yml` 负责 `npm ci` + `npm run check` + `npm run build`。
