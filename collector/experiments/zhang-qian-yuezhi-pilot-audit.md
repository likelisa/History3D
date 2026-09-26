# 张骞使月氏试点：独立 agent 与主 agent 双审核记录

时间：2026-09-26 UTC。审查对象是**草案试点与离线检索快照工程**，不是历史真实性或发布批准。独立审查者为一名 `gpt-6-sol` 只读 agent；未读密钥文档、未调用 Jev/Tripo、未执行公共搜索 provider，也未写入/发布资料包。主 agent 自行验证动态结果；独立 agent 的模型结论不单独算测试证据。

| 指标 / 通过阈值 | 独立 agent 结果 | 主 agent 复核证据 | 最终状态 |
| --- | --- | --- | --- |
| 1 快照绑定批准计划、反馈 ID、接收方，查询×接收方轨迹完整，篡改阻断 | 静态 PASS；摘要非身份认证 | `collector/src/search.ts`；`tests/collector.test.ts` 快照篡改/缺轨迹用例通过 | **工程通过**；身份真实性另审 |
| 2 离线快照与在线 provider 互斥；研究只用校验副本，公网调用 0 | 静态 PASS | `collector/src/pipeline.ts`；零调用和 P 回调篡改用例通过 | **工程通过** |
| 3 恶意/不完整快照在 P 阶段返回 `blocked`，不抛未处理异常 | 初审 FAIL：循环引用导致 `JSON.stringify` 抛错；补丁后静态复核可关闭 | 失败测试先复现 `Converting circular structure to JSON`；`validateSearchSnapshot` 改为异常转阻断，approval 比较也 fail-closed；`tests/collector.test.ts` 23/23 | **已修补并由主 agent 动态验证**；独立动态测试受沙箱阻断 |
| 4 试点包目录、版本与本地引用结构错误 0；状态 `draft`、未发布 | PASS | `npm run validate:collection -- collector/experiments/zhang-qian-yuezhi-pilot` 退出 0；`story.json` 为 `draft` | **结构通过，发布未获准** |
| 5 四条短摘录可定位；“太子/夫人”异文明示 | PASS（数字文本） | 维基文库页面四条 `excerpt` 的浏览器正文逐字命中 4/4；中哲电子化计划两页交叉查词 | **数字文本核对通过**；影印底本/校勘未审 |
| 6 断言不超原文；无伪独立来源和未经核实的王庭/服饰/尺寸 | PASS（草案范围） | `story.json` 4 条可追断言、1 条未知断言，`objectBriefs=[]`；SVG 明写非地图 | **草案边界通过**；不足以建真实 3D 场景 |
| 7 权利、馆藏/地图覆盖、七维政策缺口明确阻断 | PASS（默认流程） | `collector/RUBRIC_DRAFT.md` 仍为 draft；`sources.json` 权利待确认；试点无公共搜索 trace | **正式 R/O 不通过** |
| 8 非开发者有具体操作与预期结果 | PASS | `zhang-qian-yuezhi-pilot.md` 的八步双审核清单 | **说明已备；用户复核待做** |

## 命令与限度

- 主 agent 在本机运行目标草案包 `validate:collection`：退出 0，`✓ 未发现问题`；`npm run check`：**11 文件、98/98 测试通过**；`npm run build`：退出 0；`git diff --check`：退出 0。构建有 Vite 大包体积警告，不是本次采集校验失败。
- 独立 agent 单独运行 `npm run typecheck` 与目标草案包 `validate:collection` 均退出 0；其 `npx vitest run tests/collector.test.ts` 在加载配置时遇到 Windows 沙箱 `spawn EPERM`，未运行到测试体，**不能算独立 23/23**。主 agent 获本地子进程权限后取得上述 98/98，不替代独立测试结果。
- 主 agent 对 `collector/`、`contracts/`、`tests/`、`scripts/` 做了有限模式的**文件名级**密钥扫描，未命中；此扫描不构成全面泄露证明。本轮未读取密钥文档，不在报告中复制凭据。

## 失败记录候选与剩余验收

- `failure_record`（项目级，不升级全局规则）：**触发**为独立审查指出 `SearchSnapshot` 循环属性；**根因**是 P 阶段把外部对象直接送入 `JSON.stringify`，未给不可序列化结构设置阻断分支；**最小补丁**是校验/批准比较异常转 `blocked`，且不向日志输出异常正文；**验证**为 RED（1/23 失败，循环结构异常）→ GREEN（23/23）→ 全量 98/98 与构建通过。**回滚条件**：若合法 JSON 快照被误阻断，应添加具体合法样本复现并修正，不删除安全反例。
- 仍缺：用户批准确切脱敏查询和接收方后才运行公共搜索，补馆藏/地图与跨语种覆盖；史料负责人核对《汉书》未校对提示、影印/校勘底本、版权和七维评分；两名独立史料评审校准政策并签字；B 层真实读取 `manifest + story.json + sources.json + references/` 的记录。**这些未完成时不得把试点升为 `reviewed` 或正式交接。**
- 复盘分类：本次循环引用问题归 `failure_record` 候选；脱敏检索快照和真实试点是项目阶段产物 `no_persist`，尚无经验证的长期 `memory/skill/bottom_rule` 修改。未改全局配置或规则。

## 后续增量：逐查询接收方与真实目的地（2026-09-27 本地时间）

本节是上述 98/98 阶段的**后续增量**，不回写或冒充当时独立审查结论。

- 主 agent 新增两个失败用例，确认旧逻辑会把每条检索词发给整批所有 provider，且逐查询接收方缺失时仍能外发。现 `SearchQuery.providerIds` 默认为空；准确配对纳入批准计划摘要，`runSearch` 只执行获批配对，快照只接受这些配对的完整轨迹。计划和传给 provider 的单条查询在调用前独立复制，防止前次回调改写后续词或路由。
- 一名独立 `gpt-6-sol` agent 在只读审查中用模拟 `fetch` **复现**新的 TOCTOU：`wikipedia-en` 的实例语言属性被前次回调改成 `zh`，实际请求 `zh.wikipedia.org`，轨迹仍记英文站。主 agent 加失败用例得到同一结果；随后把三个内建 provider 的目的地相关配置改为 JS `#private` 并冻结实例，模拟测试由失败转通过。另加 `redirect: 'error'`，模拟重定向测试也先失败后通过，防止内建 `fetch` 自动把词带向第三方站点。
- 主 agent 最新验证：目标草案 `validate:collection` 退出 0；`npm run check` **12 文件、105/105 测试通过**；`npm run build` 与 `git diff --check` 退出 0。独立 agent 后续只读复核认为原内建 provider 目的地错配 finding **可关闭**，依据为当前 `#private` 目的地配置、实例冻结、`redirect: 'error'` 与模拟回归用例；其最后一轮**未独立重跑** 105 项测试，故动态测试结果仅由主 agent 提供。
- 本轮**真实公共检索仍为 0**。确切三条词/五个查询-接收方配对记录在 `zhang-qian-yuezhi-search-plan.proposed.json`，状态是 `proposed` 而非 `approved`；已向用户单独询问，不得用本节替代批准。`tests/collector-search-proposal.test.ts` 验证无批准记录时调用数为 0。
- 信任边界：上述测试覆盖内建 OpenAlex/Crossref/Wikipedia 和模拟 `fetch`；自定义 `SearchProvider` 代码及注入的 `fetch` 仍需目的地审查，`provider.id` 不是网络权限隔离。外部网站的结果真实性、版权、馆藏/地图覆盖和七维评分依然未达发布门槛。

本增量的复盘分类为项目级 `failure_record` 候选：此前只绑定 provider ID，未绑定实际构造 URL 的可变运行时状态；最小补丁是私有目的地配置、冻结实例和禁止重定向，并以模拟 URL 与 trace 一致性回归。未申请任何全局规则变更。
