# 网页真实实测后固定的工作流规则 r14

适用于壁画和文物本地网页。只修改本项目，不改变全局 memory、skill 或安全边界。2026-10-03 用户追加授权：填入 API 后自动生成；3D 以效果为先，不逐笔请示，质量不理想可继续做新的明确生成；未知请求先核查，同一请求不得误投两次。旧 r13 冻结文件和旧运行保留。

## A09 精确证据与受控纠正

旁白允许自然改写，`evidence.quote` 必须是提供原文中的完整连续子串，逐字保留标点与小词。不能替模型改原史料来使引用通过。完整、已知响应的候选若合同失败，网页显示段落与来源诊断，允许一次绑定候选 SHA 的明确修正；保留原候选、修正意图、响应、候选及冻结政策指纹。未知响应不能重投。成功候选落盘但快照中断时，从匹配的 receipt/intent/candidate 本地恢复，不重新调用。

执行：`agent/contracts.ts` 的 `parseModelPlan/validatePlan`；`agent/server.ts` 的 `candidateDiagnostics/repairInfo/planRun` 与恢复块。测试：`mural-agent-server.test.ts` 中 single repair、torn snapshot、unknown repair、changed fingerprint 四组。

## A10 讲解与证据分工

先讲清对象、背景、关键变化与结果，再插入图像/3D细节。来源标题与精确引文放证据栏，旁白不逐句念“馆方说、讲座说”。未知事项只在会影响理解时简要交代，不让工程说明挤占故事。相近器物的工艺不能冒充本件内部结构；不能把造型解释写成已经证实的匠人个人心理。

执行：`modelSystemPrompt` 注入自然讲解要求；JSON 和回源审核分开。铜奔马第一次 DeepSeek 候选有正确类型但引文改写、讲解机械；修正后 3 章 9 句保留两次原始候选，史实与最终听感仍分别待验。

## C06 真正载入媒体

对已核验音频和 GLB 内嵌纹理允许同源与 `blob:`；外网仍由后端代理，不开放浏览器任意网络。独立 LoadingManager 捕获 Three 吞掉的纹理错误，不能用灰白模型或静音代替成功。正式旁白只能固定公开男声，字节、正文、音轨 SHA 与逐词时点逐条匹配。

执行：服务器 CSP、`viewer.js loadAsset/loadNarration`；测试：CSP response 与真实 GLTF parser texture failure。

## C07 正确进度与自动推进

新网页提交 `autoGenerate:true`，故事合同通过后自动进入详细几何/PBR 图生或文生、旁白和网页整合；不伪称人工批准。旧项目可继续既有计划。余额读取失败且尚无资产提交意图时可恢复，不重新规划。收到较旧的状态响应必须忽略，不能让“生成中”倒退成“恢复凭据”并停掉轮询。

默认不启用人为 credits 停止边界，协议值为 `Number.MAX_SAFE_INTEGER`；仅用户勾选可选边界后才使用具体值。资产数量界定计划范围，不作为压低效果的理由。新质量候选必须有独立操作身份、原因、seed/参数与回执；同一操作幂等，结果未知不能换操作 ID 重投。

执行：`RunInput.autoGenerate`、`planRun → generateRun`、安全 preflight recovery、前端 `refreshSequence`。测试：automatic delivery、invalid evidence、balance read recovery、out of order refresh。

## C08 Windows 网络接入

Node fetch 不自动继承 Windows Internet Settings。Windows 启动器只读取已有代理，转换为该子进程的 HTTP_PROXY/HTTPS_PROXY 和 Node 官方代理支持；本地服务直连。不得修改系统代理、关闭 TLS 检查或把网络超时当额度不足。运行需要支持 `--use-env-proxy` 的 Node 24。

执行：`scripts/start-heritage-agent.ps1`。真实证据：Node 直连 `UND_ERR_CONNECT_TIMEOUT`；同一余额 GET 经已配置代理返回 HTTP 200，之后原照片上传和 task receipt 成功。诊断不得输出 key、鉴权头、签名 URL 或响应全文。

## B09 最新旁白推进约束

用户已取消当前 Agent 的“先观察场景与原图再讲解”以及所有固定观察、阅读等待。场景切换立即讲下去，静态 3D 观察不沿用早期张骞动画“3D先放完再叙述”的等待要求。音频字节、正文与字幕时点仍严格绑定，按真实媒体 `currentTime` 推进；不能为了取消等待截断正在播放的旁白。原照片细节可以随讲解显示，用户主动暂停时再观察。

执行：当前 `viewer.js` 的旁白时间线与真实音频时钟；验证：对应网页回归和当前浏览器自然跨句播放。旧运行原政策副本不改写；旧等待要求仅作为历史失败边界保留，不作为新 Agent 体验标准。

文物镜头的 `ScenePlan.cameraFraming` 使用通用 `whole/upper/lower` 区域和 `magnification:1..2.5`，先测实际模型包围盒再构图；相同视点重复不能代替配合不同句子的观察。原照片二维标注未绑定具体三维纹饰位置，区域镜头不冒充精确表面坐标或扫描热点。

## 验收边界

自动生成只证明工作流推进。发布前仍须实际查看形态/纹理、镜头与原图标注，听专名及全文，采集至少三个自然播放样本，完成录屏和独立 ZIP 解包。通用模型、旧夹具或单张截图都不能认证新文物质量。质量不理想的新尝试要独立记录 seed/参考与原因，保留拒绝资产；不能覆盖 raw 或原失败证据。

本轮证据位于任务根 `outputs/story-r8/real-artifact-bronze-horse-r14-v1/agent-data/runs/run-4382d4f9-c5fc-49a3-9b5e-1e464d935ccd`，网页截图位于 `outputs/story-r8/heritage-agent-browser-r14-v3`。账户余额、DOCX、运行凭据和签名信息均不得进入公共交接 ZIP。

## 政策版本与可审计复盘

新运行默认采用 `agent/quality-policy-r14.json` 的 38 条规则，并把此文档 SHA 与运行政策副本一起冻结。旧 r10 的 26 条、r13 的 33 条政策不改写；恢复和修正使用该运行原副本，不能借新规则默认值重新认证旧成果。`provided-to-planner-not-verified` 和 `pending` 仍是未验收状态。

项目级结构化记录位于 [failures/workflow-quality-r14.json](failures/workflow-quality-r14.json)；模型候选与强审分工记录追加到 [routing/routing_log.jsonl](routing/routing_log.jsonl)。这些记录只解释当前项目的失败、最小补丁、证据范围与下一步验证，不升级全局 memory 或 active skill。

Node 直连超时与代理 HTTP 200 是 root 的历史工具观测，原探针日志未独立保存，记录为 `historical-tool-observation`，不能伪称可回读原始日志。旧响应倒退有确定性网页 fixture 回归；其成功只证明乱序保护，不替代当前浏览器全程观察。政策默认与旧冻结恢复有离线 HTTP 回归；结果另存验证回执，不能扩大成新故事听感或视觉验收。
