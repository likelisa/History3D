# 处理层候选世界验收记录

日期：2026-09-25。本记录仅是 B 本机技术 fixture 验证，未经过傅老师/靳老师联调。

- 基线：`origin/dev@52721c8b064710958c8744681976826eb57428bb`；功能分支 `feature/processing-end-to-end-20260925`。
- 输入：`import-1fd814aa0802d410efc6`，仓库内占位货包 GLB。原始资料仍是技术样例，驮兽还是灰盒。
- B 世界计划：`processing/fixtures/silk-road-world-plan.json`。`obj-pack-a` 摆在 `obj-beast` 顶部，静态接触与水平重叠检查通过；`obj-pack-b` 保留原展示位置。动态父子挂接未实现。
- 固定候选：`release-efecbcecfaceae4a3023`，`scene.json` SHA-256 `16251cfac722ed182e5829a38f28b8a8a8fc7adadaa8992c2c641dd0d581ef89`，`qualityStatus=needs_review`。正式包校验 0 错误、1 条预期的货包高于地面警告。
- 正式 viewer 本机入口：`http://127.0.0.1:5173/?story=silk-road-demo&candidate=release-efecbcecfaceae4a3023`。2026-09-25 在 Codex 浏览器实际打开，页面显示“可体验”，第一人称看到一个货包放在灰色载体顶部；切到俯视也能看到布局。候选 scene 与货包 GLB HTTP 均为 200，分别返回 9,658 与 1,632 字节。浏览器测试窗口是窄屏，尚未在计划要求的 1440×900 固定环境测性能或录制动态场景。
- 质量边界：这证明 B 输出被正式 C 代码读取并渲染，尚不证明 C 本人验收、历史准确性、完整世界复审、人物/道具、运动承载、音乐或性能门槛。

## 2026-09-25 世界审核与修订

- 对上述固定候选做真实 `deepseek-flash` 世界复审，报告 `world-review-ff9357edb66f7114b50a` 判 `needs_revision`：10 条发现，静态 Blender 镜头不足以评估 C 正式画面和三幕动作。
- 改进离线渲染材质节点与尺度参照镜头后，第二次请求在 16,384 输出 token 截断，被拒绝；提高输出上限后响应完整。经扩展结构化 `unassessed`/`suggestedStrategies` 校验并复核已保存响应，报告 `world-review-1c3df38c2e314aa4ba58` 判 `needs_revision`，14 条发现、8 个未评估范围、5 条策略建议。该次请求 ID `506f926f-9e0a-46a1-bb79-611b18e0fd3e`，输入 12,659 token、输出 22,367 token；原调用耗时在失败路径未保存。AI 建议尚未自动派单。
- B 根据报告修复 `illustrative` 的 `claim-pack-layout` 与实际摆放冲突，原 A 输入保持不变；编译后的 story/sources/scene `contentRevision` 同升为 2，provenance 记录修改原因。前路示意带调整为从补给点边界向前延伸。新的固定候选是 `release-b80cdc125e3893a14a69`，`scene.json` SHA-256 `b20ddc7e6c8a08ad13f880e191a3a197f29912df84f6af1fe46a667be3034ef8`，`qualityStatus=needs_review`。包校验 0 错误、1 条货包悬置警告。
- 新候选在正式 viewer 打开显示“可体验”，主镜头能看见货包置于载体顶部，前路示意带接到边界。这只验证静态修订；新候选尚未重新做完整世界复审或动态验收。

## 2026-09-25 动态候选本机验收

- B 使用 Blender 5.2 制作行者与手杖两个原创技术 GLB，实测包围盒分别约 `[0.72,1.89,0.5]` 与 `[0.11,1.47,0.11]` 米。六视角渲染并人工查看行者三分之四视角。两件均是 `illustrative`，不视为历史人物或器物复原，也不算外部生成服务实测。
- `experience.json` 三幕 0—30 秒分别驱动载体/货物、行者/手杖、环境与物件显隐。纯采样器能任意跳转并拒绝重复轨道、挂接环；正式 viewer 使用同一逻辑。`generation-report.json` 记录程序化资产来源与零 API 成本，明确 `realProviderGenerationPerformed=false`。
- 固定候选 `release-ade1e111435e28dd95d3`，`scene.json` SHA-256 `d784a1d070c49a585fee9e27e0fa7687a86cdf14f63b74fbe1d6edfb36a61427`。`requiredCapabilities` 包含静态 GLB、变换、挂接、显隐和环境。包校验 0 错误、1 条货包位于载体顶部而非地面的预期警告。
- 正式 viewer 本机入口：`http://127.0.0.1:5173/?story=silk-road-demo&candidate=release-ade1e111435e28dd95d3`。在浏览器实际完成播放/暂停、直接跳第二幕和第三幕、拉到 30 秒后归零。画面中货包随载体移动，手杖随行者移动；剧情镜头切到第二幕近景，用户切回第一人称后再跳第三幕未夺回镜头。旧静态候选也复测可加载；修复了 Vite 缺失 `experience.json` 返回 HTML 的回退误判。
- 仍缺：C 本人的页面验收、三幕录屏与可共享截图、90 秒性能实测、音乐文件/听感、真实 A 素材和外部生成服务。此候选仍为 `needs_review`，不能提升为 current。
- 对同一 release 的 `requiredCapabilities` 明确要求变换、挂接、显隐和环境；正式 viewer 加载为“可体验”。另用独立、已清理的测试副本声明 `gltf-clips-v1`，页面实际显示“查看器不支持：gltf-clips-v1”并拒绝进入。该能力目前确实未接入，不在本次已通过范围。
- 在正式 viewer 增加剧情镜头及第一人称接管后，最终本机动态候选更新为 `release-0a7a5bf517c0e98df79a`，scene SHA-256 仍为 `d784a1d070c49a585fee9e27e0fa7687a86cdf14f63b74fbe1d6edfb36a61427`。新增必需能力 `camera-cues-v1`，页面已按该固定 ID 加载到“可体验”。正式包校验仍为 0 错误、1 条载物悬置警告；世界 AI 复审尚未针对这个新固定快照重跑。

## 2026-09-25 HTTP 本机交接

- `/api/processing/v1` 已在 `127.0.0.1:8798` 实现 ZIP 上传、导入/job、A 反馈附件下载、固定 release 资源、版本列表和 C 页面反馈。8788 已由另一个 in-note 服务监听，处理层没有占用或修改它。服务只监听 loopback，并拒绝非本机 Host/未允许 Origin。
- 自动化端到端测试用仓库技术 fixture 做 ZIP 上传→导入→轮询→反馈 GLB 下载→固定 release 读取→C 问题回传；未配置模型 Key 的测试 job 结束为 `needs_input`/审核不可用，而非 ready。越界 ZIP/符号链接和编码路径被拒绝。B 的资产父版本清单 `asset-lineage.json` 使旧基底补丁返回 `ASSET_REVISION_CONFLICT`，候选仍保存且不会自动成为当前版本。
- 本机固定 API 候选 `release-99334eec9b6e22026a93`。正式 viewer 从 API 的 `packageBaseUrl` 加载，页面为“可体验”；在 1280×720 浏览器画面中进入第二幕剧情镜头，真实行者、手杖、货包和载体均显示。它仍是技术 fixture `needs_review`，当前采用指针为 null。没有傅老师或靳老师实际回传。

## 2026-09-25 C→B→C 本地模拟

- 用仓库货包 GLB 只改材质常量，构造**模拟 C** 的候选；经 `/bundles` 上传并向 `/worlds/silk-road-demo/feedback` 提交 `fixture-jin-material-001`。它并非靳老师提供的文件或验收意见。
- B 通过决策 `fixture-b-integrate-material-001` 选择候选，输出新固定 `release-d714e9ed11894823728a`，货包在 `asset-lineage.json` 中从 revision 1 升为 2，scene/experience 同步为 sceneRevision 3。全部 release manifest 文件哈希复核一致；正式包校验 0 错误、1 条货包悬置警告。旧 release 和原始 GLB 保持不变，`currentReleaseId` 仍为空。
- 正式 viewer 经 API 打开新 release 的第二幕剧情镜头，页面显示“可体验”，人物、手杖、载体和修改后货包都加载。此步骤证明候选回流与再加载机制，**不算真实 C 往返、asset_review 或最终采用**。
- 并行旧基底测试：另一份不同材质候选同样可以先被保存，但 B 尝试在已选择第一份候选后整合它时返回 `ASSET_REVISION_CONFLICT`；两个候选均保留，没有覆盖。
- PR #7 的 Python 3.9/3.12 与构建检查通过；AI Review workflow 绿色，但评论明确称模型输出无效 JSON、自动审查未运行。该评论指出的中间目录 symlink 与 TS 解压体积复核问题已在后续分支修复并加测，待推送后重新检查。

## 2026-09-25 策略预算闸门

- 生效政策位于 `processing/config/strategy-policy.json`：每资产最多两次尝试、世界最多三轮审核、候选数 2；本轮付费生成上限 0 美元、0 次。没有来自用户的正预算与 Tripo 凭据位置时，`generate-3d` 和 `prompt-variants` 不可执行。
- `/strategies` 明确列可用/不可用原因；`POST /asset-tasks` 在固定 release 与父资产 hash 上保存修复提案，随后可按 taskId 取回。技术 fixture 的生成任务返回 `needs_budget`、`attemptCount=0`、无产物；没有实际 Tripo 提交。该接口仍未提供付费执行或 Blender 通用修整适配。
- 后续已接入 Blender **仅材质改色**适配，并在 Mac Blender 5.2.0 LTS 实测：货包任务 `task-22a6e73658eceb9e0993` 用 `#49748f` 输出 SHA-256 `12f512c694d7aa3d901607157488b04841835611bf46396d3f61e9e2cf2eb371` 的候选 GLB；前后包围盒相同，1 次尝试、API 成本 0，artifact HTTP 200。状态是 `candidate_ready`、`reviewStatus=pending`、`adopted=false`；尚未将它接进正式世界或完成资产 AI review。

## 2026-09-25 资产候选 DeepSeek 复审

- 对 `task-22a6e73658eceb9e0993` 的原版和蓝色 Blender 候选各取六张固定视角，连同几何指标、规划与修整记录发给真实 `deepseek-flash`。请求 ID `b443ffe4-2833-44da-b377-842fa53f472d`，输入 13,904 token、输出 12,899 token。首次完整响应的 `unassessed`/`suggestedStrategies` 使用了带引用的另一种结构，先被校验器拒绝；校验器核对其 subject/evidence 引用后，只重验已保存响应，没有第二次模型调用。
- 报告 `asset-review-2e2c2901c1cd7b9f55e7` 判 `needs_information`：5 条发现、4 项未评估范围。它确认 GLB 尺寸和底部原点不变；也指出蓝灰货包在侧视图里可能更接近中性灰背景，当前证据不足以证明材质对比改善，且没有载体组装/运行画面。B 暂不采用该候选，`reviewStatus=needs_information`、`adopted=false`，旧固定 release 与当前采用指针不变。模型调用费用未知，不从 token 数推算成已核实美元成本。
- B 已把上述判断写成固定决策 `b-reject-blue-cargo-001`，引用对应 reviewId/snapshotHash、操作者和理由；asset task 变为 `rejected`，候选 GLB、审查图及模型原响应仍留在忽略 Git 的本机数据目录。无新 release、无 current 切换。

## 2026-09-25 固定快照补审接口

- 新 release `release-66bb03f28024e5f620e6` 将 `world-plan.json` 封进不可变文件清单，正式包校验 0 错误、1 条载物悬置警告。正式 viewer 从本机 API 打开后显示“可体验”，原三幕控件仍在。
- `/reviews` 用该 release 的服务端 `snapshotHash` 提交 world_review，返回 `job-review-05c134310410109ed5e8`。本机 API 进程没有配置 DeepSeek Key，因此该 job 明确结束为 failed/review unavailable、无报告 URL；没有把缺模型推理当成 world pass。自动化测试还证明旧 snapshotHash 返回 409，asset task 的补审完成后可通过 reviewId 索引读取报告。
