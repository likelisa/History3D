# 采集层双审核清单（工程验收 ≠ 历史真实性验收）

当前分支：`codex/collector-stage-0`。本清单供**独立 agent 先审、用户再审**，逐项填写“通过/未通过/待外部验证”和证据。合成数据的 91 项测试仅验证工程门槛；不能替代真实史料、版权或 B 层联调。独立审查发现的 Jev Choice 一致性、澄清后去重、并发重复排队、已拒反馈口径、排队失败不可重试及重启恢复问题，主 agent 均补失败测试后修复。独立 agent 最终只读结论：**在本机单服务实例范围，未发现仍可复现、影响工程交付的 P1**；它独立复验 `typecheck`/`git diff --check` 为 0，`check/build` 因其权限审核超时未能独立重跑；主 agent 最新输出为 91/91 与构建通过。详细逐项结果见 `collector/REVIEW_REPORT.md`。

**后续试点更新**：上段是阶段 0 的历史记录，不是当前总测试数。张骞使月氏真实题材草案与检索快照补丁的双审核、**主 agent 98/98** 和独立 agent 沙箱测试限制，见 [`experiments/zhang-qian-yuezhi-pilot-audit.md`](experiments/zhang-qian-yuezhi-pilot-audit.md)；面向用户的原文核对八步操作见 [`experiments/zhang-qian-yuezhi-pilot.md`](experiments/zhang-qian-yuezhi-pilot.md)。草案仍不可正式交接 B。

| 顺序 | 指标与通过阈值 | 当前可用证据 | 还须人工核验 |
| --- | --- | --- | --- |
| 1 契约 | 两份 JSON 都是 `0.1.0`、同 `storyId/contentRevision`；所有引用文件存在；校验阻断错误数 = 0 | `npm run validate:collection -- contracts/fixtures/collection/silk-road-demo` 与 `tests/collection-handoff.test.ts` | 用真实候选目录重跑，不把示例当史实 |
| 2 反馈 | 用户含糊话术必须追问；旧/错对象 ID 可恢复；重复反馈不重复排队；旧版未人工确认不得重跑 | `tests/collector-api.test.ts`、`tests/collector.test.ts`、`tests/collector-coordinator.test.ts` | 用户现场按下文操作，检查提问是否自然、是否定位正确 |
| 3 搜索 | 未批准的公共搜索调用 = 0；查询和接收方变更后须重新批准；每个配置源有成功/空/失败轨迹；馆藏/地图缺口明示 | `tests/collector.test.ts`、`collector/src/search.ts` | 真实题目逐语种/时期/地点补词，馆藏与地图源尚需配置 |
| 4 证据/Jev | 候选摘录逐条有原文位置、独立核对；每条反证都核对并比较，低置信度不得自动保留 | `tests/collector.test.ts`、`tests/collector-jev.test.ts`；一次合成数据 Jev 冒烟成功 | 用真实中文史料做盲测、人工复核；不得把 Jev 判定当历史结论 |
| 5 筛选 | 七维逐项 0–3，单项 <2、缺出处/版权/校准/签名都不得 `retain`；不平均分 | `tests/collector-policy.test.ts`、`collector/RUBRIC_DRAFT.md` | 两名独立史料评审用真实正反例校准并批准政策 |
| 6 候选/发布 | 仅有 `story.json + sources.json + references/`；候选无批准不能发布；摘要、基线、版本错配或夹带文件均阻断；B 每文件锁定 `contentRevision` | `tests/collector-publish.test.ts`、`tests/collector-api.test.ts` | 真实候选须负责人逐条签署并由 B 实际下载验证 |
| 7 安全 | API key 不出现在仓库、反馈日志、三件套；公网默认调用 0；本地接口不对外网开放；非法路径/版本不返回文件 | `.gitignore`、`collector/src/server.ts`、测试及敏感字符串扫描 | 正式部署前补身份认证、权限、审计、保留期；不得把本机原型直接公网部署 |

## 用户可亲手复核：反馈界面（不需要理解 JSON）

1. 在仓库根目录运行 `npm run collector:dev`；看到“采集反馈页面：http://127.0.0.1:5188/”。浏览器打开该地址。**只在自己的电脑本机访问**。
2. 故事列表应出现“丝路商队出发前（技术占位）（技术演示）”。这是测试内容，不是真实史料。先不选故事，在问题框写“这个不对”并提交。**预期：页面不直接宣布修正完成，而是追问哪个故事、画面或物件。**
3. 在追问框写“行囊”，点“补充说明”。**预期：追问框消失，提示已收到、需要重新核对和人工评审；不会立即生成正式资料包。**若定位的不是行囊、提问别扭或补充后仍无限追问，请记下原话和页面现象，算未通过。
4. 再提交同一句具体问题两次，例如“行囊看起来太高，应该更扁长”。**预期：第二次提示关联已有反馈，不重复修订。**不要在演示机输入姓名、邮箱或真正未公开史料。
5. 用浏览器打开 `http://127.0.0.1:5188/api/collector/handoff/silk-road-demo/manifest`。**预期：404/没有可交接的已发布资料包**；技术演示内容不能伪装成正式交接。这个结果不说明接口坏了，而是当前尚未发布真实候选。

## 用户和队友复核：图片与真实交接

- 打开 `collector/experiments/tripo/brief-pack-concept-v2.png` 与 v1 对比。用户已确认 v2“达到，保留作概念参考”；复核它是否确实是一件扁长行囊。**预期：只作为 B 建模概念，不进入正式史料来源或尺寸证明。**不用再调用 Tripo。
- 真实候选产生后，A 负责人先核对每条断言、原文位置、七维评分、反证与版权，并批准 `collector/RUBRIC_DRAFT.md` 的正式版本；若缺任何一项，**预期：停在 `needs_human/blocked`，不得发布。**
- 完成批准后运行 `npm run validate:collection -- collector/candidates/<本次 ID>/<storyId>`，期望“未发现问题”；再按 `contracts/COLLECTOR_HANDOFF.md` 计算摘要、签署包外批准并发布。B 负责人读取 manifest 的版本，依次下载两份 JSON 和 `references/`，每次请求附 `?contentRevision=<清单版本>`；任一文件返回 `409` 就必须全部重下。B 的实际读取日志和 C 的修订回传是**尚待队友提供的外部证据**。

## 记录格式

每一项留：日期、审查者、使用的故事/版本、实际操作、预期与实际、截图或命令输出指针、结论。不要在记录里粘贴 API key、完整私密反馈或带签名的素材 URL。
