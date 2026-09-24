# 处理层交接接口（开发中）

目标是傅老师提交来源、初步 GLB 与规划，由处理层审核、生成、优化、组装，再交给靳老师的正式 `viewer/`。本文件区分已实现的本机接口和仍待接入的生成、资产采用及三方往返。

## 当前可运行的 A→B 文件入口

`contracts/fixtures/handoff/collection/` 是技术 fixture，故事与历史形制未获傅老师确认。目录必须有 `handoff.json`、`story.json`、`sources.json`、`plan.md`、`plan.json`、`assets/asset-manifest.json` 和清单列出的 GLB/参考文件。`story.json` 与 `sources.json` 复用 v0.1 协议；原规划文本逐字保留在 `plan.md`。所有路径相对包根，文件清单含 SHA-256 和字节数。

本地检验：`npm run validate:handoff -- /absolute/path/to/collection-package`。当前校验文件散列、路径越界、故事版本、来源/brief/claim 引用、必需资产存在和 GLB 几何结构。它尚未把视觉或史实判断当作通过。

已知尺度的 GLB 必须已转为米制、Y-up，声明的三轴尺寸与 GLB 包围盒核对；标记 `bottom-center` 时还核对底部与水平中心。GLB 自身通常不携带可证实史实尺寸的元数据，`forwardAxis` 及历史尺度依据仍需 B 的多视图与来源审核，不能靠结构检查确认。

本地导入：`npm run processing -- import /absolute/path/to/collection-package fu-submission-001`。最后一个参数是幂等键。导入会冻结原包到忽略 Git 的 `.processing-data/imports/<importId>/source/`，并在 `feedback/` 生成 `feedback.json`、`feedback.md`、原始 GLB 副本和规划副本。回执的 `needs_input` 表示确定性检查发现资料缺口；`needs_review` 表示仍需必经 AI 审核，均不是可发布状态。同一幂等键和同一包返回原回执；同一键不同包报冲突。

补交包可带 `supersedesSubmissionId` 和 `resolvesIssueIds` / `resolvesRequestIds`。仅当新包不再触发相同问题、明确声明解决该项且关联证据文件确实变化时，确定性问题才标为 resolved；AI 问题仍须 AI 重审。

导入命令会自动尝试输入 AI 审核。有 `DEEPSEEK_API_KEY` 时，处理层使用 Blender 的六视角固定渲染和 `deepseek-flash`；没有凭据时记录 `unavailable`，不计为审核通过。`npm run processing -- review-input <importId>` 可继续同一快照；最多两次调用，失败报告和成功报告存于对应 `reviews/`。原始模型响应留在忽略 Git 的本机工作目录，不进入交接包。`needs_information` 等模型结论先作为建议，B 裁定后才写入正式问题队列。

四类稳定消息名是 `CollectionPackage`（A→B）、`ProcessingFeedback`（B→A）、`WorldRelease`（B→C）、`WorldFeedback`（C→B），版本 `1.0.0`。共享类型在 `contracts/src/handoff-types.ts`。本机 HTTP 前缀 `/api/processing/v1`；服务默认只监听 `127.0.0.1:8798`，Vite 的 `127.0.0.1:5173` 将该前缀代理过去。

## 本机 HTTP 交接

另开终端运行 `npm run processing:server`。下面的 `bundleId`、`importId`、`releaseId` 均来自上一步回执；路径只是调用范例，不能把示例值当作已验收内容。

```sh
curl --noproxy '*' -F 'file=@/absolute/path/to/collection.zip' http://127.0.0.1:8798/api/processing/v1/bundles
curl --noproxy '*' -H 'Content-Type: application/json' -H 'Idempotency-Key: fu-001' \
  -d '{"bundleId":"<bundleId>","submissionId":"<submissionId>","storyId":"<storyId>","sourceContentRevision":1,"profileId":"desktop-demo-v1"}' \
  http://127.0.0.1:8798/api/processing/v1/imports
curl --noproxy '*' http://127.0.0.1:8798/api/processing/v1/jobs/<jobId>
curl --noproxy '*' http://127.0.0.1:8798/api/processing/v1/imports/<importId>/feedback
curl --noproxy '*' http://127.0.0.1:8798/api/processing/v1/worlds/<storyId>/releases/<releaseId>
curl --noproxy '*' -H 'Content-Type: application/json' --data-binary @/absolute/path/to/viewer-feedback.json \
  http://127.0.0.1:8798/api/processing/v1/worlds/<storyId>/feedback
```

`/bundles` 只接 multipart `file` ZIP；检查越界路径、重复项、符号链接、超大解压和外部 GLB 引用。`POST /imports` 只引用已上传的 bundleId，不接受本机任意绝对路径；202 回执与 `/jobs` 是接收/处理状态，绝不代表 ready。`GET /imports/{importId}/feedback` 返回反馈内容、markdown/修订规划和原始 GLB 的只读 artifact URL。`GET /worlds/{storyId}/releases/{releaseId}` 返回固定包的 `packageBaseUrl`；正式页面可用 `http://127.0.0.1:5173/?story=<storyId>&release=<releaseId>` 直接从 API 加载，无需物化到 `viewer/public/candidates`。

`POST /worlds/{storyId}/feedback` 保存 C 的逐项问题和 GLB 候选。候选须先经 `/bundles` 上传，再用 `baseAssetRevision` 和 `baseSha256` 指向固定 release 的 `asset-lineage.json`；过期基底返回该候选的 `ASSET_REVISION_CONFLICT`，候选原件仍保留。`accepted` 只记录 C 对该版本的页面意见，不自动采用 GLB、不切换 `currentReleaseId`。`GET /feedback/{feedbackId}` 可取回处理回执。`GET /worlds/{storyId}/releases` 列版本与当前指针；未经 B/C 门槛，当前指针为 null。

B 可用 `npm run processing -- review-patch /absolute/path/to/decision.json` 裁定一个 C 候选。决策文件至少写 `decisionId`、`action: integrate/reject`、`operator`、`reason`、`storyId`、`feedbackId`、`assetId`、`candidateHash`、`baseReleaseId`、`baseAssetRevision`、`baseSha256`。`integrate` 只接受底部原点和三轴尺寸与父资产兼容的 GLB，产生新的不可变 `needs_review` release 和递增的候选资产 revision；原包、旧 release 与当前指针不变。新 release 必须重新做 asset/world review 和 C 页面验收。另一个候选若仍指向同一旧父版本，B 再整合会得到 `ASSET_REVISION_CONFLICT`，二进制不会自动合并。

`GET /capabilities` 与 `GET /strategies` 公开本机支持情况和 `processing/config/strategy-policy.json` 的生效预算。`POST /asset-tasks` 与 `GET /asset-tasks/{taskId}` 可保存固定 release/资产快照上的修复任务；字段包括 `strategyId`、`storyId`、`releaseId`、`assetId`、`expectedBaseSha256`、`issueIds`、`repairGoal`、`parameters`、`maxCostUsd`，POST 还要求 `Idempotency-Key`。默认外部生成预算为 0 美元，`generate-3d` / `prompt-variants` 返回 `needs_budget`、`attemptCount:0`、无产物，不会调用付费提供方。

本机有 Blender 时，`strategyId:"blender-refine"` 支持一个受控操作：`parameters:{"operation":"material_tint","color":"#49748f"}`。HTTP task 从 `queued` 经 Blender GLB 导入/材质修整/导出到 `candidate_ready`；结果保留输入/输出 SHA-256、前后尺寸、工具版本和 0 美元 API 成本。候选通过 `/artifacts/<taskId>/<outputPath>` 读取；动画 GLB 不在该适配器支持范围。`candidate_ready` 仍是待 AI 资产复审的候选，**没有采用或切换 current**。

`npm run processing -- review-asset <taskId>` 对 task 中固定输入/输出 GLB 各渲染六视角，附规划、来源、几何指标与修整参数，执行必需的 `asset_review`。报告和原始模型响应保存在该 task 的 `reviews/`；失败或无效输出不会变成 pass。已保存的完整响应可用 `revalidate-asset <taskId> <reviewId> <attempt>` 在修正校验器后重新核验，不重复付费调用。模型结论是 B 裁定依据，`needs_information` 或未评估范围不能自动采用资产。

Blender 的一般网格/绑定/UV 修整与外部生成执行适配尚未接通，`/strategies` 列出限制或 unavailable。`POST /reviews`、付费资产任务执行/恢复、候选提升为 current 的发布/回退命令仍待实现。本服务没有跨机器身份认证，只用于本机联调。Python 解包解释器默认 `/usr/bin/python3`，可通过 `PROCESSING_PYTHON` 指定团队机器上的解释器。

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

动态候选另带 `experience.json`（版本 `1.0.0`），三幕、对象变换、显隐、父子挂接、镜头提示和环境关键帧均是独立数据。`sampleExperience(scene, experience, timeSeconds)` 可直接计算任意时刻的完整对象状态，跳章不需要先从头播放。正式 viewer 以同一个采样器驱动播放、暂停、跳章、归零和剧情镜头；用户切回第一人称或俯视后，跳章不会抢回镜头。候选的 `requiredCapabilities` 明确要求对应动态能力，不支持的查看器必须拒绝完整体验。

`processing/fixtures/assets/` 的行者与手杖由 B 的 Blender 脚本程序化生成，已标为技术演示和 `illustrative`；这证明 GLB 制作、装配与页面往返，不计入计划所要求的外部 3D 服务真实生成或历史素材验收。当前 `audio` 为空，未交付音乐。

### 对接待办

- 傅老师：给一个真实 `storyId` 的来源、主 GLB、资产对应关系和原规划；对 fixture 中的历史未知项补证据或明确演示设定。
- 靳老师：确认正式 viewer 对动作、挂接、音乐和压缩扩展的能力；后续按固定 releaseId 读取正式包，并回传加载与视觉问题。
- 处理层：补审核触发与资产任务 API、策略预算/真实生成、正式 C 修改资产的再次验收、发布/回退门槛；当前持久化覆盖 ZIP、导入回执、反馈、固定 release、C 候选整合与输入 AI 审核任务。

对接说明尚未发给两位老师，也没有收到兼容反馈。
