# 处理层交接接口（开发中）

目标是傅老师提交来源、初步 GLB 与规划，由处理层审核、生成、优化、组装，再交给靳老师的正式 `viewer/`。本文件区分已实现的本机接口和仍待接入的生成、资产采用及三方往返。

## 当前可运行的 A→B 文件入口

`contracts/fixtures/handoff/collection/` 是技术 fixture，故事与历史形制未获傅老师确认。目录必须有 `handoff.json`、`story.json`、`sources.json`、`plan.md`、`plan.json`、`assets/asset-manifest.json` 和清单列出的 GLB/参考文件。`story.json` 与 `sources.json` 复用 v0.1 协议；原规划文本逐字保留在 `plan.md`。所有路径相对包根，文件清单含 SHA-256 和字节数。

本地检验：`npm run validate:handoff -- /absolute/path/to/collection-package`。当前校验文件散列、路径越界、故事版本、来源/brief/claim 引用、必需资产存在和 GLB 几何结构。它尚未把视觉或史实判断当作通过。

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

`GET /capabilities` 与 `GET /strategies` 公开本机支持情况；Blender 修整和外部付费生成适配尚未接通，明确返回 unavailable。`POST /reviews`、`POST /asset-tasks`、资产采用与发布/回退命令仍待实现。本服务没有跨机器身份认证，只用于本机联调。

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
- 处理层：补审核触发与资产任务 API、策略预算/真实生成、C 候选裁定与采用、发布/回退门槛；当前持久化覆盖 ZIP、导入回执、反馈、固定 release 和输入 AI 审核任务。

对接说明尚未发给两位老师，也没有收到兼容反馈。
