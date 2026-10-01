# 验收记录

- **验收日期**：2026-09-23
- **被测包**：`packages/silk-road-demo/`
- **包版本**：`(schemaVersion, storyId, contentRevision, sceneRevision) = (0.1.0, silk-road-demo, 1, 1)`
- **被测提交**：`main` 工作区（本轮 C 展示层 + `contracts/` 首次实现，尚未合并为 PR）
- **演示环境**：macOS + Chrome 153.0.8010.53（本地 `npm run preview`，`http://localhost:4173`）
- **构建环境**：Node.js 20.18.0 / npm 10.8.2
- **结论**：Demo C（体验、性能、复用）**通过**；Demo A（空间价值）**未执行**；Demo B（资产链路）**不适用，明确未验证**。

> 本轮包恒为 `status = draft`，全部造型与尺寸为 `illustrative`（演示设定）。
> 下面的「通过」指的是**工具链路与协议行为通过**，不构成任何历史结论。

## 1. 协议与集成的必要检查（文档 12.1）

| 检查 | 方法 | 结果 |
| --- | --- | --- |
| 包结构及引用 | 正常样例 + 5 个缺字段/缺引用/版本冲突样例 | **通过**，见下方 1.1 |
| 米制与原点 | 1 米基准立方体 `asset-unit-cube` 与灰盒 `obj-meter-graybox` 并排 | **通过**，两者等高接地（`04-overview.png` 右下角） |
| GLB 尺寸 | 导入后量包围盒 | **通过**，`tests/glb.test.ts` 断言 1×1×1 与 1.2×0.8×0.6 |
| 眼高 | 出生点旁放基准尺对比 | **通过**（结构校验）；真实目视比例需人工复核 |
| 测距 | 3-4-5 固定点 + 人工表面拾取 | **数值与状态机通过**（8 项）；**鼠标拾取未自动化验证**，见第 4 节 |
| 引用保真 | 打开每个对象与故事点 | **通过**，三个故事点均显示属性级证据标注 |
| 边界与碰撞 | 走到边界和主资产 | **未自动化验证**（需要按住方向键持续移动），见第 4 节 |
| 加载失败 | 删除主模型 / 破坏 JSON / 断外网 | **部分通过**：缺包与坏引用已验证；断外网未测 |
| 可复用性 | 改位置或替换资产后重导出 | **通过**，见 1.2 |
| 重复演示 | 关闭并重启本地服务、刷新页面 | **通过**，多次硬刷新后均从出生点重新进入 |

### 1.1 五个定向失败样例

每个样例都报出文档指定的诊断码，并且**退出码为 1**（有效包为 0）。

| 样例 | 实测输出 | 退出码 |
| --- | --- | --- |
| `invalid/schema-unsupported` | `✗ [SCHEMA_UNSUPPORTED] story.json#schemaVersion` | 1 |
| `invalid/unknown-field` | `✗ [VALIDATION_FAILED] story.json#draftNotes` | 1 |
| `invalid/revision-mismatch` | `✗ [REVISION_MISMATCH] scene.json#contentRevision` | 1 |
| `invalid/missing-reference` | `✗ [REFERENCE_MISSING] story.json#hotspots[0].claimIds` | 1 |
| `invalid/missing-asset` | `✗ [REFERENCE_MISSING] scene.json#assets[0].path` | 1 |
| `packages/silk-road-demo`（有效） | `✓ 未发现问题` | 0 |

运行期失败路径另测：`?story=nope` 时页面进入 `error`，显示
`PACKAGE_FETCH_FAILED` 与两条 `REFERENCE_MISSING`，并提供「重试加载」（`05-error-missing-package.png`）。
缺失主模型**不静默降级**成灰盒。

### 1.2 复用性实验（替换 / 改配置不改代码）

1. 只改 `packages/silk-road-demo/scene.json`：把 `obj-crate` 从 `position [1.8, 0, 2.2]`、`rotation [0,0,0]`
   改为 `position [-8, 0, 10]`、`rotation [0, 0.9, 0]`。
2. 跑 `npm run build`（内含 `prepare:assets` + 校验），**没有改动 `viewer/` 下任何文件**。
3. 硬刷新页面：木箱出现在左前方（更近、带旋转），其余场景不变。

证据：`07-before-replace.png`（改前）与 `08-after-replace.png`（改后）。
辅助证据：`viewer/src` 与 `viewer/index.html` 里不存在任何包内对象/资产/故事点 ID，
唯一出现的 `silk-road-demo` 是 `app.ts:91` 的**默认故事 id**，可被 `VITE_DEFAULT_STORY_ID` 或 `?story=` 覆盖。

## 2. Demo A：空间价值 —— 未执行

文档要求「交付灰盒、30 秒录屏、三条观察记录，至少三位未参与制作的人先看图文再进场景，
至少两位在无提示的情况下说出一项新增空间认识」。

- 灰盒场景：**已交付**（`04-overview.png`、`07-before-replace.png`）。
- 30 秒录屏：**未录制**（需要人工操作鼠标行走，本轮未做）。
- 三位非制作人观察记录：**未执行**（本轮只有制作者本人在测）。

**结论：未通过 —— 不是失败，而是尚未执行。** 这是方向判断，必须有真人参与，不能由制作者自评替代。

## 3. Demo B：资产链路 —— 明确未验证

本仓库只含 C 展示层与 `contracts/`；生成层 `generator/` 归 B 队友，本轮**不存在**，
因此没有任何 Tripo 生成实验：**没有候选模型、没有同角度对比图、没有「三次生成尝试」记录**。

包内两个 GLB（`unit-cube.glb`、`pack-bundle.glb`）是
`scripts/make-fixture-glb.mjs` 生成的几何占位体（各 12 个三角面、无贴图），
用途是打通「协议 → 资产加载 → 底部原点 → 米制尺寸」这条链路，**不是历史资产，也不代表生成链路可用**。

**结论：Demo B 未验证。** 用占位体跑通 Demo C 不等于 Demo B 成功。

## 4. Demo C：体验、性能与复用 —— 通过

| 检查项 | 结果 |
| --- | --- |
| 三个故事点可找到 | **通过**：`hotspot-departure` / `hotspot-load` / `hotspot-road`，可从场景编号标记或「故事列表」打开 |
| 正文与来源可查看 | **通过**：含证据类型徽标（史料记载 / 推测复原 / 演示设定）、来源标题与定位、`unknown` 显示「暂无依据」 |
| 按说明独立完成约 90 秒流程 | **通过**：一屏五个入口（开始体验 / 俯视-第一人称 / 测距 / 故事列表 / 回到起点） |
| 测距与坐标一致 | **数值与状态机通过**，真实鼠标拾取待人工确认（见下） |
| 刷新可进入 | **通过**：连续 4 次硬刷新均回到出生点，可重复体验 |
| 替换实验通过 | **通过**，见 1.2 |
| 首次加载 ≤ 10 秒 | **通过**：4 次实测 95.0 ~ 646.3 ms（见 4.2） |
| ≥80% 的一秒窗口达到 30 FPS | **通过**：4 次实测均为 12/12 窗口，`ratio = 1.0`（见 4.2） |
| draft 包持续显示技术占位 | **通过**：页面常驻「技术占位，未经历史核验」横幅 |
| 路线面板提示 | **通过**：常驻「区域路线示意（不可测量历史里程）」 |

### 4.1 交互实测（AX 驱动，已确认）

| 操作 | 实测结果 |
| --- | --- |
| 进入「测距」 | 按钮文案变「退出测距」，准星出现，提示「测距模式：点击地面或物体表面选点」（`03-measure-mode.png`） |
| 退出「测距」 | 按钮恢复「测距」，提示与准星消失 |
| 切「俯视」 | 按钮变「第一人称」，相机切为俯视（`04-overview.png`） |
| 切回第一人称 | 按钮恢复「俯视」 |
| 「回到起点」 | 恢复出生位置/朝向，按钮回到「俯视」（第一人称） |
| 打开故事点 | 面板显示正文 + 属性级证据标注（`01-story-list.png`、`02-hotspot-detail.png`） |
| 损坏包 | 进入 `error` 并显示可读诊断 + 重试（`05-error-missing-package.png`） |

### 4.2 性能与加载实测原始数据

命令：`http://localhost:4173/?bench=1&benchSeconds=12`。口径为 `ready` 之后按 1 秒窗口采样。

| # | 刷新方式 | `loadMs` | 窗口数 | ≥30FPS 窗口 | `ratio` | `averageFps` | `minWindowFps` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 普通刷新 | **273.8** | 12 | 12 | 1.0 | 59.36 | 54.87 |
| 2 | 硬刷新（绕过缓存） | **646.3** | 12 | 12 | 1.0 | 59.74 | 56.86 |
| 3 | 硬刷新（绕过缓存） | **126.5** | 12 | 12 | 1.0 | 58.70 | 50.90 |
| 4 | 普通刷新 | **95.0** | 12 | 12 | 1.0 | 59.67 | 56.11 |

- 四次 `loadMs` 全部远低于 10000 ms 目标；最差 646.3 ms 仍为目标的 1/15。
- `windowsAtOrAbove30Fps / windowCount = 12 / 12`，四个样本的 `ratio` 均为 1.0，满足「≥80%」口径。
- **口径说明**：文档要求「清除站点缓存后测三次」。第 2、3 次用硬刷新（Cmd+Shift+R，绕过 HTTP 缓存）
  近似该要求；第 1、4 次为普通刷新。**没有做浏览器 DevTools 的 Clear storage**，因此这是近似而非严格复现。
- 本地表现不能推广成公网或手机性能。

### 4.3 包体积

| 项 | 大小 |
| --- | --- |
| 整个场景包 `packages/silk-road-demo/` | 44 KB |
| `story.json` / `scene.json` / `sources.json` | 18267 / 6774 / 810 B |
| 两个 GLB | 1628 + 1632 B |
| 构建产物 `dist/` | 816 KB（JS 758 KB、CSS 5.8 KB） |

JS 758 KB 主要是 three.js 本体，`vite build` 会给出「chunk > 500 kB」提示。
本地加载未受影响；**若后续公网部署需要优化，这是已知入口**。

## 5. 未通过 / 未验证项（不得用「已完成」掩盖）

| 项 | 状态 | 原因与下一步 |
| --- | --- | --- |
| Demo A 三人观察记录 | **未执行** | 需要三位非制作人。必须由真人完成，制作者自评无效 |
| Demo B 生成链路 | **未验证** | 本轮无 `generator/`。需 B 按 7.2 节交付合规 GLB 后重跑 |
| 测距的**鼠标双点拾取** | **未自动化验证** | 自动化环境只能做 AX 元素点击，无法在画布上做坐标点击。数值与状态机已由 `tests/measure.test.ts` 8 项覆盖（用真实射线求交，断言 2.0412414523 米与第三次点击重设 A）；**鼠标拾取本身仍需人工手测** |
| 第一人称 WASD 行走 + Pointer Lock | **未自动化验证** | 需要按住按键持续移动与真实鼠标移动。移动/碰撞数学已由 `tests/geometry.test.ts` 覆盖；**手感与边界体验仍需人工手测** |
| 断网时的 `SOURCE_OFFLINE` | **未测** | 本轮无网络隔离手段 |
| 手机适配 | **不在本轮范围** | 文档明确本轮只承诺桌面 |
| 30 秒 / 90 秒录屏 | **未录制** | 需要人工操作鼠标，由用户自行录制 |

## 6. 复现步骤

```bash
npm ci
npm run check          # 期望：4 个测试文件 37 项全部通过
npm run build          # 期望：校验 + 构建通过
npm run preview        # 打开 http://localhost:4173
```

性能复测：`http://localhost:4173/?bench=1&benchSeconds=90`，采样期间持续移动，
结束后页面右上角打印报告并写入 `window.__benchReport`。
