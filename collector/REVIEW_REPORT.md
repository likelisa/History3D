# 采集层独立审查与双审核记录（2026-09-26）

审查范围：`codex/collector-stage-0` 的工程原型，**不是**真实历史内容发布资格。独立 agent 使用 `gpt-6-sol`，只读审查、合成故障注入，不读取密钥、不调用真实 Jev/Tripo。它逐项发现问题，主 agent 均用失败测试复现、修补、重新运行。最终 agent 结论：本机单服务实例范围，未发现仍可复现的交付 P1。主 agent 最新 `npm run check` 为 **11 文件/91 测试、退出 0**，`npm run build` **退出 0**，`git diff --check` **退出 0**；独立 agent 最后一轮只独立确认 `typecheck` 和 `diff --check`，`check/build` 因权限审核超时未能重跑，不能误写为双重独立运行。

| 顺序与指标（通过阈值） | 实际证据 | 结果 |
| --- | --- | --- |
| 1 契约：JSON 同版本/故事 ID，引用文件 100% 存在，阻断诊断 0；B 取文件不混版本 | `tests/collection-handoff.test.ts` 5 项；`tests/collector-api.test.ts` 的 handoff 版本锁定；`npm run validate:collection` 样例通过 | **工程通过**；真实 B 读取待验证 |
| 2 反馈：含糊必追问；旧/错对象可恢复；顺序/并发重复只排队一次；排队失败可重试；重启恢复 queued/running | `tests/collector-api.test.ts` 10 项、`tests/collector-coordinator.test.ts` 3 项；独立 agent 逐次提出并复验故障路径 | **本机单实例工程通过**；多进程/公网服务不在范围 |
| 3 搜索：未批准公网查询 = 0；计划/接收方改变阻断；错误脱敏、空结果与覆盖缺口留痕 | `tests/collector.test.ts` 搜索反例，`collector/src/search.ts` | **门槛通过**；馆藏、地图专用搜索源缺失，搜索广度**待补** |
| 4 原文/Jev：支持与每条反证都先核对；Jev 每条窄问；Choice 必须与唯一最高概率一致；低置信度转人工 | `tests/collector-jev.test.ts` 4 项、`tests/collector.test.ts` 多反证用例；官方 [API 文档](https://docs.typesafe.ai/api)；合成英文实时冒烟收到 `jev-1.13.0/unclear/0.28` | **协议工程通过**；真实中文历史判断准确率、阈值**未校准**；默认抽取器仍是阻断占位 |
| 5 七维筛选：每维有证据且 ≥2；任一维不足、政策草案或权利未知不得 retain | `tests/collector-policy.test.ts` 13 项；`collector/RUBRIC_DRAFT.md` | **规则门槛通过**；需真实材料与两名独立史料评审校准、负责人批准 |
| 6 输出/发布：仅完整三件套；未签批、摘要/版本不符、夹带文件拒绝；旧包不因失败覆盖 | `tests/collector-publish.test.ts` 3 项；`collector/src/output.ts`；`contracts/COLLECTOR_HANDOFF.md` | **工程通过**；批准文件非身份认证；无正式真实候选发布 |
| 7 安全：密钥不入仓库/包/日志；路径越界拒绝；服务本机绑定 | `.gitignore`；`contracts/src/node-reader.ts`；`collector/src/server.ts`；28 个相关文件的只读敏感模式扫描命中 0（有限扫描，不是全面安全证明） | **本机原型范围通过**；公网部署需鉴权、授权审计、限流与资料保留期 |
| 8 Tripo：每次调用有实际概念审查，不作为史料证据 | `collector/experiments/tripo/brief-pack-concept-v1/v2.json`；用户对 v2 明确“达到，保留作概念参考” | **用户概念审核通过**；非历史真实性或正式发布批准 |

## 不可被 91 项测试代替的验收

1. 史料负责人选定真实故事范围，核对原文、来源版本、反证、尺寸/数量/位置和使用权，至少两名独立评审校准七维政策并记录分歧仲裁。
2. 检索负责人补馆藏、地图与目标语种覆盖，记录查不到时的边界；目前“搜索全面”未达成。
3. B 负责人在真实已发布包上实际读取 `manifest + story.json + sources.json + references/`，保存版本和读取结果；C 负责人按同版回传错误或遗漏，再检查 A 是否完整重走流程。当前仓库没有 B 生成器和消费记录。
4. Jev 用已授权、已核对的中文史料盲测其窄判断准确率及 0.8 工程阈值，不能以合成英文冒烟替代。
5. 若开放公网或多进程，重新设计跨进程幂等、鉴权、权限和事务；当前内存锁只保证单服务实例。

用户可操作的界面步骤和预期结果见 `collector/REVIEW_CHECKLIST.md`。若任一预期不符，请把截图、操作顺序和故事/内容版本发回 A；不要贴 API key、完整私密反馈或带签名 URL。
