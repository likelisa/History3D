# 本地壁画与文物讲解 Agent

输入壁画或文物照片、故事主题与史料摘录，网页会调用所填模型产生受合同约束的故事计划，再自动生成真实 Tripo 资产、固定公开男声、逐句字幕与桌面讲解网页。故事优先，原图和 3D 用来说明故事。结构通过与预览就绪不等于史实、视觉、听感或最终交付通过；完整录屏与源码 ZIP 仍需另验。

当前 Agent 场景切换直接开始旁白，不加固定观察期或阅读等待；字幕继续跟随真实媒体时钟。静态 3D 观察不套用早期张骞动画“3D先放完再叙述”的等待要求，需要查看细节时可以主动暂停。

## 启动与打开

先按 [公开声音环境说明](public-voice-r13.md) 启动独立公开男声服务。使用支持 `--use-env-proxy` 的 Node.js 24、npm 与仓库已有的 `node_modules`，在项目根目录运行 Windows 启动器：

```powershell
powershell -NoProfile -File scripts/start-heritage-agent.ps1
```

终端显示地址后打开 [http://127.0.0.1:5210](http://127.0.0.1:5210)。启动器仅把现有 Windows 代理配置转换为本子进程的 `HTTP_PROXY/HTTPS_PROXY`；不修改系统代理，保留 loopback 直连和 TLS 验证。已有环境代理优先。Node 原生 fetch 不自动继承 Windows Internet Settings，直接执行 `npm run agent:dev` 只适合网络已配置的环境。

需要自定义状态目录和端口时，使用绝对目录，例如：

```powershell
powershell -NoProfile -File scripts/start-heritage-agent.ps1 -DataDir C:/Users/ASUS/Documents/Codex/heritage-agent-data -Port 5211
```

服务只监听 `127.0.0.1`，写请求必须来自同一地址和端口；`localhost`、其他端口或远程 Origin 会被拒绝。端口被占用时先确认原进程，不盲目重启正在工作的项目。正常退出使用启动终端的 Ctrl+C。接力机器以 `HISTORY3D_PUBLIC_VOICE_ROOT` 指向独立公开声音环境，不能指向原私人安装。

`GET /api/health` 返回服务版本；它不能证明模型配置有效，也不能证明资产或画面已通过验收。`npm run check` 和 `npm run build` 执行现有项目检查与构建，其中 Agent 测试注入离线 fetch fixture，不读取真实 Key、不调用收费 API。

## 输入与自动生成授权

| 字段 | 要求与用途 |
| --- | --- |
| 主题 | 非空纯文本，最多 800 字符；优先说明人物、动机、行动和结果。 |
| 输入类型 | 壁画或文物；文物可补充名称、年代、材质、尺寸与收藏机构。 |
| 原图 | PNG/JPEG，解码后不超过 8 MiB；服务核对魔数与 SHA。文物主资产必须使用这次原图图生。 |
| 史料 | 1–12 条，每条含唯一 ID、标题和非空原文摘录；链接可空。摘录最多 12000 字符。 |
| 模型配置 | OpenAI-compatible 视觉接口的 base URL、模型名与 API Key；远程地址必须 HTTPS，本机 HTTP 只允许 loopback。官方 DeepSeek 先查 `/models` 的当前图片能力，不能凭旧模型名猜测。 |
| Tripo Key | 与模型 Key 分开输入；仅向固定 Tripo API 发送。 |
| 最大资产数 | 1–8 个，限制本次故事计划范围，不作为节省 credits 的质量取舍。 |
| 可选 credits 停止上限 | 默认不启用，协议填写 `Number.MAX_SAFE_INTEGER`。用户勾选后才采用至少 50 的具体安全整数；预计文生 50、图生 60 credits，提交前查余额。模型 API 费用另计，实际 Tripo 积分由提供方决定。 |

用户在 2026-10-03 已授权填入 API 后自动生成、3D 效果优先、无需逐件确认费用。网页新提交携带 `autoGenerate:true`：计划通过合同与账户余额检查后继续 Tripo、旁白和整合。默认不加人为 credits 停止边界；用户主动勾选才采用具体边界。模型仅输出 JSON 候选，没有文件、shell 或工具权限。允许为不合格效果建立新的明确尝试，保留原件与拒绝理由；这不允许把结果未知的同一请求再投一次，也不把自动生成登记为人工认可。

来源的 `evidence.quote` 必须逐字匹配提供摘录，旁白可以自然改写。这只证明摘录匹配，不能证明史料已认证；链接只供回查，服务不自动抓取并认证来源。完整已知候选合同失败时，网页允许一次绑定原候选 SHA 的明确修正，保留首候选、修正意图、回执和新候选。未知提交不修正重投。

旧项目或 API 调用省略 `autoGenerate` 时保留 `story_review` 闸门；生成入口仍绑定 `planSha256`。超预算或余额不足时停止新任务，已知 task ID 复用。服务保存 `credits_consumed`，预计积分检查不能代替提供方账单。预算边界可在非活动状态更新并追加记录，不覆盖最初输入预算。

## 凭据与保存范围

模型与 Tripo Key 在浏览器输入框/页面内存和本地服务进程内存中使用。应用不把它们写入 localStorage、sessionStorage、状态 JSON、事件日志、导出网页或质量报告，也不从环境或旧文件自动恢复。服务拒绝包含当前凭据字节的输入或模型/资产输出；错误只返回固定安全代码与提示，不保存上游错误正文或签名下载 URL。

项目状态位于 `.processing-data/mural-agent/runs/<runId>/`：原图、冻结规则副本、状态快照、追加事件、模型请求哈希/意图/回执、Tripo 请求/意图/任务回执及原始 GLB。这里包含用户提供的内容与资产，应按自己的项目资料保管。不要把整个状态目录当作公开网页目录。HTTP 只开放审核后的包内白名单文件，并检查真实路径以阻止目录穿越与符号链接逃逸。

## 重启恢复

记录页面显示的项目 ID。服务重启时只读取文件，不自动调用模型或 Tripo；进程内 Key 已丢失。

1. 在配置页输入项目 ID，读取现有项目与事件。
2. 重新填写模型/Tripo 凭据，执行“恢复本项目凭据”。此请求只恢复 RAM，不规划、不提交、不轮询。
3. 若为 `story_review`，恢复已保存故事并继续同一 `planSha256`；若为 `recoverable`，点击“继续已有任务”，已知任务只轮询，旁白失败只补未完成音轨，尚未提交的资产仍检查预算和余额。资产提交前的余额读取失败可以恢复，不需要再次规划。
4. 若为 `unknown`，保留项目与回执，人工向提供方核对提交结果。服务不提供重新提交按钮，也不能凭错误响应推定任务未创建。

不可解析响应、网络中断或 HTTP 错误等未带有效 Tripo task 回执的 POST 均视为未知。恢复先核对不可变 intent/receipt/candidate 的请求和候选指纹，再恢复快照；已知成功候选在快照中断时可本地恢复，不能再调用模型。只有 intent 的请求保守视为未知。失败资产不能用灰盒顶替；质量迭代应建立新的明确尝试。`preview_ready` 与 `visual_reviewed` 包无需恢复 Key 即可打开。

## 本地 API

写请求需 `Content-Type: application/json` 和精确的本地 Origin，JSON 请求最多 12 MiB。凭据字段的值必须由用户在本地输入；不要把真实 Key 放进命令历史、工单或共享示例。

| 方法与路径 | 请求或结果 |
| --- | --- |
| `GET /api/health` | `{ok:true,version:"1.0.0"}`，仅表示监听进程可用。 |
| `GET /api/policy` | 项目规则与当前规则文件 SHA256。 |
| `GET /api/baseline` | 已确认张骞对照网页及项目规则文档指针；不执行 API 请求。 |
| `POST /api/runs` | `{subjectType,subjectMetadata?,autoGenerate?,topic,imageDataUrl,sources,model:{baseUrl,model,apiKey},tripo:{apiKey},budget:{maxAssets,maxCredits}}`；202 返回项目；网页默认自动推进。来源为 `{id,title,excerpt,url?}`。 |
| `GET /api/runs/<id>` | `{id,status,stage,sources,events,errors,assets,plan?,planSha256?,packageUrl?,quality?}`，不含凭据或签名 URL。 |
| `POST /api/runs/<id>/credentials` | `{model:{baseUrl,model,apiKey},tripo:{apiKey}}`；200，仅恢复 RAM，状态不自动推进。 |
| `POST /api/runs/<id>/generate` | `{planSha256}`；202；接受当前故事版本或人工继续已知任务。重复/并发请求不重复提交。 |
| `POST /api/runs/<id>/repair-plan` | `{candidateSha256,feedback}`；仅允许一次明确的已知候选修正；结果仍由合同校验。 |
| `POST /api/runs/<id>/budget` | `{maxAssets,maxCredits}`；仅非活动项目，保留最初预算与追加更新证据。 |
| `POST /api/runs/<id>/asset-candidates` | `{planSha256,assetId,prompt,reason,operationId}`；为效果不合格的资产建立独立候选，同 UUID 操作幂等；可另传 `seed/faceLimit`。原预览、raw 和任务回执保留。 |
| `POST /api/runs/<id>/review` | `{approved:boolean,notes:string}`，仅允许 `preview_ready`；记录人工视觉判断。 |
| `GET /runs/<id>/viewer.html` | 待审预览网页；`packageUrl` 是该预览链接，不是 ZIP 下载。 |

事件为 `{at,type,assetId?,code?}`；错误为固定 `{code,message}`。资产状态为 `pending/submitting/task_known/ready/failed/unknown`，可带 task ID、请求哈希、原始文件哈希、bytes、积分和结构统计。状态 API 不开放私有快照文件。

## 阶段产物与验收边界

| 阶段 | 当前实现与产物 |
| --- | --- |
| A：采集与初版资产 | 原图/摘录、因果故事 JSON、模型候选/修正链、提供方 intent/receipt、原始自包含 UV/PBR GLB；文物主资产的图片/上传/token 指纹明确绑定。 |
| B：审核与整合 | task/request/raw SHA 链、场景绑定、固定公开男声 manifest 与真实字幕时点；高度、中心与接地属于展示归一化，不冒充测量模型。 |
| C：桌面网页 | `viewer.html/js/css`、importmap、Three vendor、故事/场景/资产清单、原图、GLB、旁白、冻结政策与质量报告。HTTP 加载实际媒体，不能以 `file://` 运行。 |
| D：真实验收 | 铜奔马真实链路已产生待审预览；还需逐项检查形态、镜头、图像标注、全篇听感、自然播放样本、录屏、完整封包和新目录解压启动。 |

原始 GLB 保留提供方交付字节与 SHA256，不用代理几何替代。结构校验检查 GLB 头/chunk/BIN 边界、实际 POSITION/UV accessor、三角形索引范围、使用材质的嵌入 baseColor/normal/metallicRoughness 纹理与文件魔数，并拒绝外部/data URI。网页加载实际 GLB 并核对清单哈希/字节；结构通过仍不证明脸、衣饰、比例、前轴、史实或听感正确。

文物观察场景可使用 `ScenePlan.cameraFraming:{region:"whole"|"upper"|"lower",magnification:1..2.5}`。页面先按实际模型包围盒构图，再选择整体、上部或下部区域和放大程度；`camera` 表示观察方向。它只选择整体空间区域，原图的二维标注没有绑定到具体三维纹饰坐标，不能把这种构图称为考古扫描热点或准确表面定位。

新运行默认冻结 [r14 政策](../../agent/quality-policy-r14.json) 的 38 条规则，报告绑定 run ID、政策身份与 SHA；旧 r10 的 26 条、r13 的 33 条冻结副本保持原字节和原证据。规则缺省 `pending`，自动检查只进入 `coveredChecks`。视觉批准只记录这次人工判断，不自动完成其他混合规则，也不把 `releaseReady` 改为真。固定旁白实现及测试夹具分别记载；未配置的人物动画仍不能冒充步态动画。

新增执行规则与证据界限见 [workflow-lessons-r14.md](workflow-lessons-r14.md)，历史经验见 [mural-case-lessons-r10.md](mural-case-lessons-r10.md)。回归位于 [mural-agent-server.test.ts](../../tests/mural-agent-server.test.ts) 与 [heritage-agent-web.test.ts](../../tests/heritage-agent-web.test.ts)。规则文档、离线测试和旧项目认可均不能替代当前运行的视觉、故事及听感验收。
