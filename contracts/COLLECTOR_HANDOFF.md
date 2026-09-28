# 采集层 → 生成层交接（协议 0.1.0）

采集层交付一个完整目录，目录名为 `storyId`：

```text
collector/output/<storyId>/
  story.json
  sources.json
  references/
    <story.json 或 sources.json 实际引用的文件>
```

两个 JSON 的 `schemaVersion` 均为 `0.1.0`，`storyId` 和 `contentRevision` 必须一致。目录名也须等于 `storyId`。包内路径只写相对路径，引用的本地文件必须随包交付。内部评分、反馈原话、修订差异和未解决项另存，不增加到这两个 JSON；两份 schema 禁止额外字段。采集层不生成 `scene.json` 或 `entities.json`。

交付前执行：

```bash
npm run validate:collection -- collector/output/<storyId>
```

只有命令退出码为 0、使用的是目标包目录，并且被引用文件均已交付，才算通过**结构与引用检查**。此命令不验证 URL 是否可访问、史料真伪、摘录准确性或素材版权；这些要由采集评审另行核对。`status=reviewed` 不能由命令通过自动推定，必须有史料负责人审核。

`contracts/fixtures/collection/silk-road-demo/` 是演示用三件套，里面的历史叙述、尺寸、引用与素材均不构成生产史实。运行上述命令并将路径换为该目录，可以验证 B 将收到的文件形状。

## B 层读取与回传

B 层应按完整目录读取两个 JSON 和被引用的素材，以 `(schemaVersion, storyId, contentRevision)` 标识输入版本。B 生成 `scene.json` 后，下游 C 的场景包仍须带相同版本的 `story.json` 和 `sources.json`，由 `npm run validate:package -- packages/<storyId>` 检查三文件一致性。B 反馈错漏时带回其输入版本、对象/断言 ID、观察到的问题和证据指针；自然语言反馈由采集层负责理解与澄清。

当前仓库有公共契约、C 查看器及演示场景包，**没有 B 层生成器源码或真实读取记录**。因此本文件说明预期交接，不代表 B 已实际消费采集输出。正式联调还需 B 负责人使用候选包运行并保存命令或程序输出。

修订版须完整重跑采集流程并使用新的 `contentRevision`。候选包验证失败时保留已发布包；发布前再次核对当前基线版本。版本差异与未解决项通过包外记录交接，不修改公共 JSON 的字段。

## 当前功能分支的 API 与边界

- 反馈入口：`POST /api/collector/feedback`。用户可直接写自然语言；B/C 可附 `origin=generator|viewer` 和 `context` 中的 `storyId`、`contentRevision`、`sceneRevision`、`subjectId`/`claimId`/`hotspotId`。缺对象、错误 ID 或定位不明时，返回 `needs_clarification` 和提问；用 `POST /api/collector/feedback/{id}/clarify` 补充自然语言。旧版反馈不能自动重跑，需研究人员确认问题在当前版本仍适用。同一服务实例内反馈查重、保存、排队串行化；已拒绝反馈可重提。排队失败时尽力保留 `queue_failed` 记录，HTTP 返回 500，调用方应稍后重提；若失败状态本身无法写入，具有修订状态存储的正式服务会在重复提交时尝试重新排队原反馈 ID。本机服务重启会扫描并恢复 `queued/running` 修订；基线变化则转人工，不静默沿旧版执行。
- 状态入口：`GET /api/collector/revisions/{id}` 返回内部修订状态；默认服务仅绑定 `127.0.0.1`，不作为已加认证的公网接口。
- B 层只读取已发布资料包：`GET /api/collector/handoff/{storyId}/manifest` 返回版本与文件列表，然后依次取 `story.json`、`sources.json` 和列表里的 `references/...`。未发布候选目录不经该接口暴露；B/C 提出问题后走上面的反馈入口，再由 A 完整重走 P→S→D→E→J→R→O。
- B 下载清单后，每个文件 URL 都应附 `?contentRevision=<清单中的 contentRevision>`；若发布在下载期间变化，接口返回 `409`，须重新下载完整包，不得拼接新旧版。清单的 `status` 只是资料包字段，不替代史料人工审核。
- 当前默认流程在 P 形成**本地**查询草案，每条 `providerIds=[]`，不把用户原文发送给第三方。人工脱敏并批准每条查询的准确 `providerIds` 后才允许配置 OpenAlex、Crossref、中文/英文维基百科搜索源；未分配/越权接收方或批准后修改均阻断，执行时只发给该条指定来源。它们只提供发现候选，**不是**原文摘录、独立史实证明或素材使用许可。无馆藏/地图搜索源的缺口必须记录；不可把现有源称为全面覆盖。
- 内建 OpenAlex、Crossref、维基百科 provider 的请求目的地在实例私有状态中固定，且 `fetch` 使用 `redirect: 'error'`，不自动把检索词带往未批准的跳转域名。`provider.id` 仍是审计标签而非网络沙箱；新增/自定义 provider 及注入的 `fetch` 实现必须先独立审核真实目的地、重定向与日志行为，不可仅凭 ID 相同认定安全。此限制不等于公网部署的身份认证。
- 对已经按确切批准计划执行并由研究人员核查的搜索结果，可在**包外**用 `createSearchSnapshot` 保存完整 `SearchApproval + SearchRun + 审核人/时间/证据指针`。`runRevision` 在 `searchSnapshot` 模式只允许 `providers=[]`，P 阶段校验计划、反馈 ID、**获批的逐查询接收方配对**、轨迹、命中数和摘要；随后 S 阶段离线复跑，公网搜索源调用应为 0。快照内容或审查记录变化即阻断；SHA-256 仅检测意外改动，**不是身份认证/防伪签名**。快照不进 `story.json + sources.json + references/`，也不能代替原文和权利复核。
- `collector/RUBRIC_DRAFT.md` 是七维筛选政策草案；没有史料负责人批准和真实校准记录时，不能宣称资料包经过历史审核。Jev 仅处理已核对两侧摘录的窄比较题。Tripo 行囊图只获用户批准为概念参考，不进入正式史料来源。
- `collector/experiments/zhang-qian-yuezhi-pilot/` 是“张骞首次使月氏、未得月氏要领”的**真实题材结构试点**，仍为 `status=draft`，不是经过完整检索、筛选或发布的正式包；原文核对、异文、禁画边界和双审核步骤见 `collector/experiments/zhang-qian-yuezhi-pilot.md`。不得因为 `validate:collection` 通过就将它接给 B 作正式历史场景。

## 发布操作与批准边界

`runRevision` 最多写到 `collector/candidates/`，不会自动交接 B。候选目录必须仅含两份 JSON 与引用的 `references/` 文件。史料负责人逐项核对后，技术操作员可用 `npm run collector:publish -- hash <候选目录>` 获取候选摘要，再由负责人签署**包外**批准记录：`reviewer`、`reviewedAt`（ISO 时间）、`storyId`、`candidateRevision`、`expectedBaseRevision`、`candidateSha256`、`evidenceRef`。批准记录不得包含 API key，也不放进三件套。执行 `npm run collector:publish -- publish <候选目录> <基线版本> <批准文件.json>` 才会在锁内核对摘要、版本和当前发布基线，归档旧版并整体替换。若交接包已经有 `contentRevision=1` 的基线，下一次候选应为 2，`expectedBaseRevision=1`；首版才用 0→1。发布失败不得覆盖旧包。

这里的批准字段是**审计门槛，不是身份认证或电子签名**；本地操作者仍须按团队流程核实负责人身份。公开部署前必须补鉴权、权限和审计。真正的历史内容还需真实来源、原文/版权复核和 B 层实际读取记录；目前合成测试与演示样例均不满足这些条件。

## Jev 官方协议核对

[TypeSafe API reference](https://docs.typesafe.ai/api) 规定 `POST https://api.typesafe.ai/v1/systemone`、`Authorization: Bearer`、`state/model/questions`；Choice 响应含选项、概率分布与置信度。[模型页](https://docs.typesafe.ai/models) 说明 `jev-latest` 是可变别名，中文能力需单独评估。适配器见 `collector/src/jev.ts`：只发送已独立核对的窄问题和两侧摘录，低于工程暂定置信度门槛转人工；不把 Jev 的选择当史实，也不保存原始响应或密钥。2026-09-26 已用**合成英文句子**完成一次真实协议冒烟，响应模型 `jev-1.13.0`，结论 `unclear`；这不等于真实中文史料准确率已验证。不要把密钥写进仓库或命令行参数。
