# 处理层交接接口（开发中）

目标是傅老师提交来源、初步 GLB 与规划，由处理层审核、生成、优化、组装，再交给靳老师的正式 `viewer/`。本文件只描述已落地的部分；HTTP 路由、DeepSeek 真调用、生成策略和三方往返仍待实现。

## 当前可运行的 A→B 文件入口

`contracts/fixtures/handoff/collection/` 是技术 fixture，故事与历史形制未获傅老师确认。目录必须有 `handoff.json`、`story.json`、`sources.json`、`plan.md`、`plan.json`、`assets/asset-manifest.json` 和清单列出的 GLB/参考文件。`story.json` 与 `sources.json` 复用 v0.1 协议；原规划文本逐字保留在 `plan.md`。所有路径相对包根，文件清单含 SHA-256 和字节数。

本地检验：`npm run validate:handoff -- /absolute/path/to/collection-package`。当前校验文件散列、路径越界、故事版本、来源/brief/claim 引用、必需资产存在和 GLB 几何结构。它尚未把视觉或史实判断当作通过。

本地导入：`npm run processing -- import /absolute/path/to/collection-package fu-submission-001`。最后一个参数是幂等键。导入会冻结原包到忽略 Git 的 `.processing-data/imports/<importId>/source/`，并在 `feedback/` 生成 `feedback.json`、`feedback.md`、原始 GLB 副本和规划副本。回执的 `needs_input` 表示确定性检查发现资料缺口；`needs_review` 表示仍需必经 AI 审核，均不是可发布状态。同一幂等键和同一包返回原回执；同一键不同包报冲突。

补交包可带 `supersedesSubmissionId` 和 `resolvesIssueIds` / `resolvesRequestIds`。仅当新包不再触发相同问题、明确声明解决该项且关联证据文件确实变化时，确定性问题才标为 resolved；AI 问题仍须 AI 重审。

导入命令会自动尝试输入 AI 审核。有 `DEEPSEEK_API_KEY` 时，处理层使用 Blender 的六视角固定渲染和 `deepseek-flash`；没有凭据时记录 `unavailable`，不计为审核通过。`npm run processing -- review-input <importId>` 可继续同一快照；最多两次调用，失败报告和成功报告存于对应 `reviews/`。原始模型响应留在忽略 Git 的本机工作目录，不进入交接包。`needs_information` 等模型结论先作为建议，B 裁定后才写入正式问题队列。

四类稳定消息名是 `CollectionPackage`（A→B）、`ProcessingFeedback`（B→A）、`WorldRelease`（B→C）、`WorldFeedback`（C→B），版本 `1.0.0`。共享类型在 `contracts/src/handoff-types.ts`。拟定 HTTP 前缀 `/api/processing/v1`；当前没有可调用的 HTTP 服务，不能把文件样例视为接口联调。

## B→C 静态候选

处理层可用 B 编写的世界规划编译固定候选：

```sh
npm run processing -- build-release <importId> processing/fixtures/silk-road-world-plan.json
npm run validate:package -- .processing-data/releases/<storyId>/<releaseId>
npm run processing -- preview-release <storyId> <releaseId>
npm run dev -- --host 127.0.0.1
```

预览入口是 `http://127.0.0.1:5173/?story=<storyId>&candidate=<releaseId>`。正式 `viewer/` 从只读候选副本加载 `scene.json` 与真实 GLB；候选目录在 `viewer/public/candidates/`，由 `preview-release` 从不可变本地 release 校验哈希后复制，且被 Git 忽略。`packages/<storyId>/` 仍是旧版固定展示包，候选预览不会覆盖它。

当前编译器要求 B 给出兼容现有 v0.1 `scene.json` 的布局模板、资产绑定、摆放和组装关系。它检查父子对象存在、垂直接触和水平投影重叠；静态接触检查不等于运动挂接。候选状态始终 `needs_review`，世界 AI 审核、动态能力及 C 的正式验收未完成时不能提升为 current。

世界复审命令：`npm run processing -- review-world <storyId> <releaseId> <world-plan.json>`。它核对不可变 release 的所有文件哈希，以 Blender 从正式 `scene.json` 渲染全景、主镜头和尺度参照，连同原规划、修订规划、质量指标交给 DeepSeek。正式 viewer 截图、三幕关键帧和连续动作未提供时，证据覆盖标为 `unassessed`，报告不可判 pass。每次输入图、文本、模型参数形成审查缓存键；图像改变会留下新报告，不覆盖旧报告。

### 对接待办

- 傅老师：给一个真实 `storyId` 的来源、主 GLB、资产对应关系和原规划；对 fixture 中的历史未知项补证据或明确演示设定。
- 靳老师：确认正式 viewer 对动作、挂接、音乐和压缩扩展的能力；后续按固定 releaseId 读取正式包，并回传加载与视觉问题。
- 处理层：补发布/展示回传协议校验、HTTP、AI 资产候选与世界复审、自主生成和正式 viewer 验收；当前持久化覆盖导入回执、确定性反馈与输入 AI 审查。

对接说明尚未发给两位老师，也没有收到兼容反馈。
