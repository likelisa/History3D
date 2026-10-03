# 张骞案例：壁画到讲解网页 Agent 候选规则与证据

状态：`candidate / project-only / root-review-required`。本文件提取项目经验，供主代理审查后固定正式 Agent 规则；不是已激活的skill、全局memory或已经实现的通用Agent。仅新增此项目文档，不修改现有故事、3D、代码、测试、看板或旧证据。

核读截点：2026-10-03。当前故事与3D已形成可运行版本，细竹杖已按用户选择接入；公开Qwen `Uncle_fu` 的8.616875秒短试听已获用户认可并保存原话与样本SHA（E24）。在线生成完成c0-0/c0-1/c0-2/c1-0四轨，c1-1返回原因未明的SSE错误后停止，完整24轨尚未形成新manifest（E30）。不能把旧Kokoro阶段认可、v8文件检查或短试听认可当成当前完整音轨验收。

## 当前需求与作废约束

唯一目标是将本次实证经验提炼为以后“采集→整合→网页→真机验收”的制作规则。正式层次采用当前用户纠正后的契约：**A采集史料、故事、参考，并交付主资产Tripo初版GLB；B审核、归一化、布景、分镜、动作和音轨；C制作网页；D做真实浏览器与交付验收。** 这是当前任务要求，不声称此四层通用Agent已经全部实现。

`docs/layer-handoff.md` 的旧分工将生成主要放在B层，只作为历史导航；不能覆盖上述新契约。A层的2D概念PNG不是初版3D交付。原始人类触发反馈可在聊天 `01a0cf0a-c996-7942-9c33-9c6126dd15e3` 的用户消息 `01a0f32d-abd5-7c21-bf3a-13ecb634375a` 找到：“完全不行……全是简单的方形的组合……tripo的3D资产完全没有用进去”。此反馈经 `read_thread` 直接核读，不来自模型自述。

作废项包括：以画面上下左右或金人之谜组织整个外交故事；把概念图、GLB存在或单件Tripo岩体当成主要3D资产已接入；把精细生成形象称为汉代考古复原；把邛竹杖限制为市场唯一用途；把正在播放标志或测试通过当成真实自然播放证明；把38419字节录像称为严格单帧；把核心资产小包称为当前完整源码工程；沿用旧Kokoro认可替代当前Qwen审核；把所有声音处理一概标为“无克隆”。最新用户明确授权“你把声音导入我本地的gpt-sovits看看能不能复刻出来”，范围是刚认可的公开合成样本做本地参考推理，不包括私人声音、训练或未经验证的成功声明。

## 证据等级与门槛

每项结论分别标记 `implemented`、`tested`、`static-asset-verified`、`browser-observed`、`user-confirmed`、`pending` 或 `failed-evidence`。这些状态不能互相替代。测试代码只说明检查了什么；命令日志才证明该次测试运行结果。来源ID存在只证明可追溯结构，史料内容仍要回原文。manifest与模型声明不能独立证明实际发音、真实手掌接触或真实浏览器效果。

最新细竹杖阶段的check/build日志为48个测试文件、333项测试通过与构建退出0，保留大bundle提示（E14）。这是当时版本的工程结果。旧浏览器v2冻结证据已被拒绝（E15）；v3的3个IAB样本只证明可见页面、assets15与UI-seek结果，均 `playing=false`（E16）。完整自然播放、全部真实听感、最终录屏和本轮完整源码ZIP仍分别待验收。

## A：采集、故事与真实主资产

| ID | 候选规则与验收要求 | 本例证据、当前证明范围 |
|---|---|---|
| A01 | 先冻结观众应理解的人物、目的、事件、原因与结果，再安排图像。外交故事按因果与时间展开，壁画作为辅助和后记；不能要求观众先学会读画才能听懂故事。 | E01中8章24句按使命、扣留、脱身、拒盟、贸易、返汉、后续往来、壁画记忆排序；测试拒绝前七章出现画面方位、金人或佛像主线。E20保存原视频中主线迟到、时间倒跳和史书/壁画交叉的问题；不是完整逐帧观看证据。 |
| A02 | 每个叙事claim与图像解释保留source ID、原文/机构解读、稳定来源指针及具体边界；区分 `history`、`mural`、`interpretation`。来源列表和模型意见不能代替回读原文。 | E01检查source引用存在；E02保存中文原文缓存与审校指针。《史记》《汉书》与初唐佛教叙事年代、目的不同。缓存及审校属于既有证据，本次未重新联网核读全部史料。 |
| A03 | 将史料支持的角色与艺术补全分开。十余年扣留不等于十三年全程；身毒是转述与推想，不画作张骞亲至；后续副使路线不算本人首次行程；乌孙未立即答应；接见不能表现成功盟约。争议与未知保留，不用精确肖像、统一民族服装或明确君主性别填空。 | E01的故事测试、E02的chapterReview、E03的角色边界以及E12路线说明。甘父“胡人、善射”不能武断认定匈奴族属；妻子与甘父返汉有对应记载，不虚构妻儿所有结局。 |
| A04 | A层必须交付真实主资产初版GLB及task/request/费用/原始文件证据。2D概念图可作为参考，不能登记为3D完成。要事先列明人物、关键道具、建筑等主资产及页面采用位置。 | E04保存三个独立Tripo任务及原始GLB；E05记录实际runtime加载链。当前A→B契约来自本轮用户纠正，旧layer-handoff不是当前合同；通用Agent的自动A层交付尚待实现与验收。 |
| A05 | Tripo任务冻结输入、参数、seed、预算与授权范围；保留task ID、raw下载、实耗、请求摘要和失败状态。未知POST结果先查已有任务，禁止盲目重复付费。model API和Tripo API独立配置、独立请求类型、独立日志及成本边界，不能把文本/概念图API成功算作3D任务成功。 | E21的脚本和7项离线harness检查覆盖显式 `--run`、重复提交复用task ID、请求不符拒绝、未知提交不重试、外部签名纹理拒绝；离线harness没有收费。E04的三项实际实耗为150 credits。model/Tripo独立是新Agent契约候选，不声称已做完新统一界面。 |
| A06 | 参考质量不足时先拒绝角色候选，不能以放大图片或生成任务成功补足丢失结构。确认可读参考/概念形象，再做新的受控生成。失败raw与审核保留。 | E06：62×147原生壁画裁图输出薄浮雕，面部、手臂和跪姿不可读；状态 `not_accepted_for_story_character`。保留原任务，没有替换行走张骞。 |

## B：资产整合、动作、分镜与音轨

| ID | 候选规则与验收要求 | 本例证据、当前证明范围 |
|---|---|---|
| B01 | raw不可改写；归一化另存派生GLB、可编辑工程和真实多向图。重导入实测比例、前轴、落地、mesh/材质、嵌入图像、UV及PBR通道。prompt数字不能当作实际尺寸。 | E04、E07：张骞/甘父/竹杖独立文件，人物前轴+Z、高1.75/1.69m；竹杖1.55m。原竹杖等比后宽约11.32cm，未服从2.8cm约束，本地横向缩放至3.2cm。这是加工结果，不是provider原尺寸正确。 |
| B02 | 页面必须实际请求、校验并导入被采用的GLB；将生成原件、派生件、匿名复用、A/B与拒绝件区分。禁止用数据标签或看板文件存在代替当前场景采用证据。 | E05的 `fetch→SHA/bytes→GLTFLoader.parseAsync` 与实际definitions；E08的15 current、4 A/B、1 rejected、20卡、19不同GLB核验。E16是当前页面assets15的只读前置证据；不能由此单独认定所有镜头视觉合格。 |
| B03 | 人物辨识采用独立形象、体型与轮廓，明确艺术设定。附件独立，避免融合武器/行囊/长杖破坏骨骼选区。复用资产允许不同展示角色，但角色语义和史料边界必须分别标明。 | E03、E04和E05：张骞/甘父是独立资产，旧envoy作为匿名市场商旅；细竹杖继续作市场货物，并按用户选择作持节道具杖身。E09明确不表示汉节与大夏邛竹杖器制相同，不能称汉节考古复原。 |
| B04 | 步态依据真实位移/路程，测试实际模型的脚底、独立腿轨迹、接地、抬脚、袍摆连续性与材质/UV；不能仅让整个静态人物上下摆动。停步/seek应确定性重建。动作参考要记录来源与提取验证。 | E10的CMU 07_01提取验证及mural-walking测试；E11直接测试r9 GLB脚/手、UV和PBR。数值通过仍需真实镜头检查穿插、摆动自然度和轮廓。 |
| B05 | 停臂/抓握检查须选取原模型上已实看位置的真实手指/前臂顶点，独立于现有skin weights；不能以骨骼旋转固定或“已分配手权重”的选区自证。保持同一坐标系、更新祖先world matrix，地面用真实场景平面。 | E17记录手顶点混入腿权重及旧诊断覆盖；E18记录测试用了过期父变换、误把actor origin当地面的假阳性。E09的竹杖定位来自真实手部网格，E11保留严格抓握、UV/PBR与非零父变换检查。这里只证明几何位置/稳定性，不能独立证明视觉上五指确实包握或手掌体积碰撞。 |
| B06 | 拦截、停步、转身、护送分别编排；转向朝真实路径切线，避免倒退、整圈旋转、站立滑步。支撑脚在pivot期间固定，起停位置、yaw、步态权重和膝角连续；营地路径用真实障碍网格核查。 | E19记录IK近接触阈值造成膝角跳变，修复后保留22项数值验证；E11与mural-detention-motion测试检查三次转身、支撑点、路向和营地三角形障碍。真实观感仍需D层录像，而非模型自述。 |
| B07 | 场景过渡键应包含实际场景身份，不能只比较spatial/map模式。旧场景冻结到遮罩完全覆盖后再切；连续接见/市场句保留终态，ambient clock不按每句归零；拖动/重播重建状态。 | E13的presentation-state函数和测试检查同为spatial的departure→detention、spatial→map、market/goods连续、手动切换取消/重定向与seek确定性。 |
| B08 | 地图按叙事段落连续前进，句子切换不能重新播放扣留→月氏。大小地图使用同一cue时钟；国家区域与现代参考路线都需示意边界。 | E12测试大宛→康居→月氏顺序、相邻cue接续、不重启返程、不把副使路线算为本人；E13统一 `cueRouteProgress`；E05/main实际使用同一函数。 |
| B09 | 先完成该句对应视觉动作再开始完整旁白。时间线用实测clip时长，加换句余量，并保持阅读下限；真实音频尚未播完不能因固定cue时钟截句。换声音只重算音轨与时间线，不擅改已确认故事或3D。 | E22的playback严格匹配24条id/text、保留visualSeconds、audioSeconds+1.5与reading floor；main对未结束音频保留cue尾。E01的逐句阅读下限与E23的11个对应3D cue/视觉边界检查。 |
| B10 | 先选有来源和使用权的公开音色短试听，再制作完整音轨；用户当前音色选择优先于旧阶段认可。manifest记录真实模型/preset或参考来源、实测时长、文本、SHA/bytes和实际克隆方式；禁止使用未授权私人音声。用户可明确授权公开合成样本做本地参考推理，此时应标 `privateReferenceUsed=false`、`voiceCloningUsed=true`、`referenceKind=synthetic_public`，保留授权与参考SHA，不能沿用“无克隆”。不把试听认可扩为全篇认可，不交付权重；发音元数据不能代替人耳校对专名。 | E24：官方DOM显示CustomVoice、Uncle_fu、1.7B；真实首cue WAV为8.616875s、24kHz单声道；`user-acceptance.json`逐字保存当前用户原话、sample SHA和 `fullNarrationAcceptance=false`。本地GPT-SoVITS参考推理授权来自本轮用户新指令，执行/试听结果尚待root提供稳定记录。E25旧v8独立审核明确 `userListeningAcceptance=false`，不能当新Qwen音色认可或新24轨通过。 |
| B11 | 在线TTS把provider错误、明确配额错误、网络中断和未知提交分开；保存原始request、event ID、append-only receipt、原始SSE及已下载文件SHA。未知提交先查询，不盲重发。允许复用已核验部分轨，但全部cue成功、文本/音色/解码/时长/权利验证通过后才生成新manifest、切runtime，禁止混新旧音色充数。fallback保留已确认原稿及授权声音范围，分别记录模型/参考、隐私、费用与恢复边界；未经实跑不能声称fallback成功。 | E30：c0-0/c0-1/c0-2/c1-0四轨成功，c1-1 receipt记 `generation_failed`、`error=SSE error`；root核读原始SSE仅 `event:error`/`data:null`，不能确定为额度耗尽。当前新manifest不存在，runtime保持旧v8。本代理对该SSE单文件直接读取遇自动审批服务429失败，未绕过审批；其内容核读范围属于root。 |

## C：网页呈现与可接力产品

| ID | 候选规则与验收要求 | 本例证据、当前证明范围 |
|---|---|---|
| C01 | 字幕在画布下方独立区域，中文/英文与cue绑定；要有阅读面积、滚动/高度调节，按Unicode字符显示。动作期与旁白期同步，讲图像方位时显示对应原画，缺失3D时使用匹配地图。 | E26的caption-row DOM和grid rows、E12的Unicode/reduced-motion测试、E23的cueView匹配。结构实现不等于所有桌面/移动端都已视觉通过。 |
| C02 | 控件提供开始、暂停/继续、章节跳转、拖动重建与明确错误。加载时校验实际将播放的音频和模型字节；来源按钮从当前manifest显示真实音色/版本，避免旧文案。前台/后台状态须记录，不能伪造。 | E05与E22/main；E16保存页面hidden/visibility/assets。新音色目录若沿用 `/mural-assets/narration-v9/<cue-id>.mp3`，现有播放逻辑可接入；当前v8路径和zm_010测试断言仍未切换，等待完整新manifest。 |
| C03 | model API与Tripo API分别接入；浏览器和交付包只读已落地资产及有权使用的公开/获授权音轨，不携带服务密钥。运行构建不得顺带重新生成收费资产、下载权重或训练。日志仅保留安全请求/结果摘要。 | E21的环境凭据与受控提交；E25的 `normalBuildSynthesizes=false`；E27针对当时授权Tripo密钥的1347文件扫描为0匹配。该结果范围有限，不能声称覆盖所有秘密种类或未来新ZIP。 |
| C04 | 交接必须是完整源码工程：锁文件、实际资产/音轨、许可证、入口命令、修改清单、待办和版本化验证。核心GLB小包或4份源码不能替代完整工程。排除.env/密钥、私人音声、权重、venv和缓存；ZIP载荷清单记录bytes/SHA，并验证安全解包。 | E28的当前计划明确完整工程要求；E29的hash/穿越/未列文件检查和旧REV4干净目录做法可作方法参考。`docs/handoff/2026-10-03/asset-package.json` 只证明旧71文件/12 GLB核心资产包，不证明当前完整源码ZIP。 |

## D：真实验收与拒绝条件

| ID | 候选规则与验收要求 | 本例证据、当前证明范围 |
|---|---|---|
| D01 | 分开验收工程、资产、动作数值、浏览器画面、听感、用户确认、录屏和封包；每次结论绑定版本、命令、原始日志/文件SHA及验收范围。禁止把模型“完成”或agent报告作为结果证据。 | E14、E11、E08分别证明各自范围；E15/E16证明浏览器证据的局限。原始人类反馈优先于“测试都过了”的抽象判断。 |
| D02 | 浏览器必须实际可见且故事time自然推进。记录只读hidden=false/visible、URL、当前assets/version、至少3个带真实时钟的自然播放采样；期间不seek或改状态。同步实看动作、路线、字幕和音轨。 | E15：32个连续播放样本time=58.79、displayBeat=departure、opacity=.985；14张turn图相同、route 01–17图相同。旧观察未保存hidden，root当时hidden=true报告不能升级为文件证据。E16仅UI-seek前置检查，尚未自然播放通过。 |
| D03 | 录屏必须解码核查帧时间戳覆盖目标窗口和实际画面变化，完整自然播放单独验收；传输版短视频、截图组或seek片段不能替代完整播放。保留原视频/人的项目动机录音，新剪辑采用独立文件。ASR候选不直接作为正式字幕。 | E15的38419字节录像实测7个不同解码帧，PTS仅0–166ms，“严格单帧”已作废。E20原视频220.46s、960×544，未完整逐帧观看/未人工校对ASR，不证明新demo完整录屏。 |
| D04 | 最终ZIP须在独立新目录安全解包后执行锁文件安装、check、build和真实浏览器走读，并核对采用资产/音轨。旧包、旧日志和旧人工认可不得验收新版本；遇隐藏、冻结、错版本、缺文件或秘密则拒绝交付。 | E29提供旧REV4方法和日志，E14是当前工作树工程验证；两者都不能合成“当前Qwen+r9资产完整ZIP已经验证”。本轮新ZIP、完整录屏与自然播放仍pending。 |
| D05 | 失败证据使用独占新路径/时间戳，保存失败→最小补丁→新运行结果；不得覆盖原始诊断、降低阈值或删失败来制造通过。复盘区分事实、根因假设、已作废假设、残余风险和回退条件。 | E17记载旧固定诊断文件被覆盖及原数字只能回session；E18保留测试坐标系假阳性及未放宽1e-5m门槛；E19保留pivot失败与修复数值；E15保留旧冻结目录及新反证记录。 |

## 失败条目与最小修补候选

| 失败 | 根因/最小补丁候选 | 验证与回退条件 |
|---|---|---|
| 主线与用户目标错位 | 壁画方位和后世问佛抢先，外交目的迟到；改为因果时间线，后记再解释壁画。 | E01/E20。用户换目标时废弃旧假设；逐句回源、实际画面与字幕重新绑定，不复用旧“通过”。 |
| 生成存在但网页未采用 | 初版概念PNG/fixture低模被当成交付；A交付真实GLB，B/C用采用表与runtime请求链对应。 | A04/B02；页面主资产采用与真实画面缺一不可，灰盒只能标草案。 |
| 低清裁图图生人体失败 | 残损/邻人被带入浮雕，放大未补细节；拒绝该角色、保留raw，审清楚参考后再考虑生成。 | E06。不能为了满足“生成完成”替换可读主角。 |
| 细杖比例不服prompt | 11.32cm实测横径与2.8cm请求不符；保持raw与UV/PBR，另存可审计横向校准。底层生成机制未确证。 | E07。若新角度竹节畸变，回到raw重新校准，不回写raw或声称provider尺寸正确。 |
| 手骨固定而真实手仍动 | 低手/前臂顶点带腿权重；从原模型独立选实看顶点，跨完整步态相位量测。 | E17/E11。若旧人物、脚底、UV/PBR退化，回退该加工；不靠现有权重选区自证。 |
| pivot膝角不连续 | IK极近接触仍有小屈膝，零lift直接切站立；近接触渐退姿态并保持支撑点。 | E19的原约.032rad跳变及修复后约2.2–2.7e-5rad数值；真实视频仍需看，支持脚漂移即拒绝。 |
| 抓握测试假阳性 | 父变换未更新、actor origin误当terrain；统一世界矩阵时序与实际地面。 | E18。保留阈值，按当前放置复验；数值稳定不能代替肉眼抓握检查。 |
| 浏览器冻结证据误用 | workflow只ready门槛；playing=true与等待秒数未证明time前进。增加真实可见性、自然时钟、解码覆盖及视觉门槛。隐藏因果未落盘，不称唯一已证根因。 | E15/E16。禁止改document.hidden、dataset、合成可见性或强制状态冒充自然播放。 |
| 同名诊断覆盖原证据 | 复跑输出仍写固定文件；改独占/版本化路径、source hash和失败保留。 | E17/D05；无法回原证据的数字标“session摘录”，不包装成原日志。 |
| 在线TTS部分完成后SSE失败 | 已完成四轨后第五轨返回generic SSE error，具体provider原因未明；保存receipt/event/SSE，不冒称额度耗尽，不反复提交。候选最小补丁是逐轨可恢复与全量manifest门槛；用户另授权公开合成样本做本地GPT-SoVITS参考推理，尚不等于fallback已成功。 | E30/B10/B11。保留v8运行版本；完整24轨、实际声音一致性与专名确认通过前不切换，不以拼混音色完成交付。 |

## 截点状态与未完成项

| 项目 | 可证状态 | 不能据此宣称 |
|---|---|---|
| 故事与工程 | 当前源码8章24句，E14的48文件/333测试与build退出0 | 新Qwen接入后的全部检查已经通过，或所有历史细节均新近独立回源 |
| Tripo静态与细竹杖 | E04/E08原始与派生链，15现用/20卡/19不同GLB；E11动作与抓握数值运行证据 | 汉节考古复原、所有镜头视觉/手掌体积碰撞已合格 |
| 可见浏览器 | E16的3个hidden=false、visible、assets15样本 | 完整自然播放、当前全部动作视听已验收 |
| 当前Qwen短试听 | 首cue真实文件及官方公开preset DOM可核，WAV 8.616875s；E24保存用户原话、SHA与仅短试听认可范围 | 24轨完整产出、自然音色全篇一致、专名全部读对 |
| Qwen完整音轨 | 四轨成功，c1-1原因未明的SSE错误后停止（E30）；本次检查尚无 `viewer/public/mural-assets/narration-v9/manifest.json` | 全部错误均为配额、可用旧v8审计补足新音轨验收，或改故事来迎合新声音 |
| 本地公开样本参考推理 | 用户已明确授权将认可的公开合成样本导入本地GPT-SoVITS进行参考推理；root在执行，非训练 | 已复刻成功、全篇音轨已完成、获准使用私人声音或分发模型权重 |
| 原片与新交付 | 原片技术/关键帧审计保留；已有旧r5 ZIP与核心资产包记录 | 本轮完整录屏、剪辑片、Qwen+r9完整源码ZIP及独立新目录运行已完成 |

## 稳定source pointer目录

下列路径以本仓库为基准；`../../../../outputs/` 指向本聊天任务根的outputs。源码/测试指针说明实现与断言；结果日志另列，不能互换。当前用户试听原话已保存E24；正式固定前由root补齐本地参考推理授权/执行记录与最终版本指纹。

| ID | 来源与定位 |
|---|---|
| E01 | [story.ts](../../viewer/src/mural/story.ts)，`chapterDefinitions/sources/compileChapters`；[mural-story.test.ts](../../tests/mural-story.test.ts)，`finishes the diplomatic story before interpreting the later painting` 与可追溯检查。 |
| E02 | [story-fact-review.json](../../../../outputs/story-r8/story-fact-review.json)，sourceRecords/chapterReview，明确仅章序审校；[中文《史记》缓存](../../../../outputs/mural-clarity/reception-primary-web-r4-followup.json)、[《汉书》缓存](../../../../outputs/mural-clarity/reception-research-r6.json)、[机构图像解读缓存](../../../../outputs/mural-clarity/narration-research-r5-part2.json)；[mural-narrative-audit.md](../historical/mural-narrative-audit.md)的史料入口仅导航，其中旧开场描述以E01当前故事为准。 |
| E03 | [tripo-story-r9.md](../historical/tripo-story-r9.md)，角色表、区分与接入、最新竹质持节道具边界。 |
| E04 | [manifest.json](../../viewer/public/mural-assets/tripo-story-r9/manifest.json)、[normalized-manifest.json](../../viewer/public/mural-assets/tripo-story-r9/normalized-manifest.json)、[raw-inspection.json](../../viewer/public/mural-assets/tripo-story-r9/raw-inspection.json)及同目录raw/derived GLB、review/raw与review/normalized五向图。 |
| E05 | [cinema-world.ts](../../viewer/src/mural/cinema-world.ts)，definitions、manifest核对、`parseAsync`、细杖市场/持节两用途；[tripo-story-assets.ts](../../viewer/src/mural/tripo-story-assets.ts)，task/raw/path/height链核对。 |
| E06 | [visual-review.json](../../viewer/public/mural-assets/zhangqian-mural-trial/visual-review.json)，`not_accepted_for_story_character`；同目录reference-native.png、原GLB/provenance。 |
| E07 | [tripo-story-r9-review.json](../historical/tripo-story-r9-review.json)，`generated_geometry_proportion_constraint_not_met`；E04中竹杖diameterCorrection。该review的16-current计数属替换前阶段，当前计数以E08为准。 |
| E08 | [asset-board-r9-slender-credential-file-verification.json](../handoff/2026-10-03/asset-board-r9-slender-credential-file-verification.json)；[当前inventory](../../viewer/public/asset-board-r8/inventory.json)及替换前独立快照；[看板交接](../handoff/2026-10-03/visual-asset-board-r8.md)。 |
| E09 | [held-credential.ts](../../viewer/src/mural/held-credential.ts)，`attachSlenderCredential`真实手顶点/竖直杖身/非考古角色；E03最新用户选择。 |
| E10 | [motion-extraction-validation.json](../historical/motion-cmu-07-01/motion-extraction-validation.json)，241样本、循环与原T姿势排除、无arm channels；[mural-walking.test.ts](../../tests/mural-walking.test.ts)，真实靴/袍/UV测试；[walking.ts](../../viewer/src/mural/walking.ts)。 |
| E11 | [mural-tripo-story-r9.test.ts](../../tests/mural-tripo-story-r9.test.ts)，真实GLB/PBR/UV、独立手顶点、脚底、pivot/grip测试；[实际结果JSON](../../output/tripo-r9-test-2026-10-03T03-06-37-588Z.json)、[原日志](../../output/tripo-r9-test-2026-10-03T03-06-37-588Z.log)及同名前缀typecheck.log，26项相关检查退出0、sourceStableDuringRun。 |
| E12 | [presentation.ts](../../viewer/src/mural/presentation.ts)，`routePosition/subtitleText`；[mural-presentation.test.ts](../../tests/mural-presentation.test.ts)，路线连续、国别顺序、seek与Unicode测试。 |
| E13 | [presentation-state.ts](../../viewer/src/mural/presentation-state.ts)，`presentationFrame/advancePresentation/cueRouteProgress`；[mural-presentation-state.test.ts](../../tests/mural-presentation-state.test.ts)，同模式切场、连续ambient与重建。 |
| E14 | [command-results-r9-slender-final-v1.json](../../../../outputs/story-r8/command-results-r9-slender-final-v1.json)及同目录[npm-check日志](../../../../outputs/story-r8/npm-check-r9-slender-final-v1.log)、[npm-build日志](../../../../outputs/story-r8/npm-build-r9-slender-final-v1.log)。 |
| E15 | [冻结failure_record.json](../../../../outputs/story-r8/failure-record-browser-turn-route-r9-v2-frozen-v1/failure_record.json)、[原observations](../../../../outputs/story-r8/browser-turn-route-r9-v2/observations.json)、[原workflow](../../../../outputs/story-r8/browser-turn-route-r9-v2/workflow.js)、[原录像](../../../../outputs/story-r8/browser-turn-route-r9-v2/turn-natural.webm)；failure目录内ffprobe.json、decoded-frames.framemd5与verification.json。 |
| E16 | [IAB observations.json](../../../../outputs/story-r8/browser-slender-r9-v3/observations.json)，scope明确UI-seek而非完整动作；[冻结关键字段](../../../../outputs/story-r8/failure-record-browser-turn-route-r9-v2-frozen-v1/new-run-checkpoint.json)。 |
| E17 | [tripo-r9-before-arm-fix-evidence.json](../../output/tripo-r9-before-arm-fix-evidence.json)，原手混权重及诊断覆盖教训；[修复后arm诊断](../../output/tripo-r9-arm-diagnosis.json)。前者注明原失败数字来自session工具摘录，不冒称完整原诊断JSON。 |
| E18 | [credential-test-frame-failure.json](../../output/credential-test-frame-failure-2026-10-03T03-06-37-588Z.json)，两种坐标系假阳性、严格阈值保留、视觉剩余项。 |
| E19 | [guard-pivot-boundary-failure.json](../../output/guard-pivot-boundary-failure-2026-10-03.json)，原失败/修复及回退条件；[mural-detention-motion.test.ts](../../tests/mural-detention-motion.test.ts)与[detention-motion.ts](../../viewer/src/mural/detention-motion.ts)。 |
| E20 | [video-review.json](../../../../outputs/story-r8/video-review.json)及[video-review.md](../../../../outputs/story-r8/video-review.md)，原片范围/主线/遮挡/ASR未审核/完整录屏未证；原片不改写。 |
| E21 | [generate-story-tripo-r9.mjs](../../scripts/generate-story-tripo-r9.mjs)，显式run、task恢复、私密环境、unknown提交与外部资源拒绝；[离线脚本harness报告](../../output/tripo-r9-script-tests-1790992338230/report.json)，7项、0收费、非真实网络。 |
| E22 | [playback.ts](../../viewer/src/mural/playback.ts)，`buildPlaybackTimeline/locateMoment`；[main.ts](../../viewer/src/mural/main.ts)，loadScene、startAudio、audio-tail guard；[mural-playback.test.ts](../../tests/mural-playback.test.ts)。 |
| E23 | [scene-beats.ts](../../viewer/src/mural/scene-beats.ts)，对应事件与视觉边界；[mural-scene-beats.test.ts](../../tests/mural-scene-beats.test.ts)、[mural-cue-presentation.test.ts](../../tests/mural-cue-presentation.test.ts)，11个场景cue与缺失场景fallback。 |
| E24 | [official-api-dom.md](../../../../outputs/story-r8/voice-r10-uncle-fu/official-api-dom.md)，公开CustomVoice/Uncle_fu/1.7B；[c0-0-official-demo.wav](../../../../outputs/story-r8/voice-r10-uncle-fu/c0-0-official-demo.wav)，SHA `f47d4c2e50cdbc2dee165d7cd2415c5e667c9af68863127701344c20b6f73e37`；[c0-0-preview.mp3](../../../../outputs/story-r8/voice-r10-uncle-fu/c0-0-preview.mp3)，SHA `fcffaf77082fbcb402f11e4122585275cb5805c0fc8c4a1d06642fdc99b66da5`；[user-acceptance.json](../../../../outputs/story-r8/voice-r10-uncle-fu/user-acceptance.json)保存人类原话、首cue SHA与认可范围，不以DOM或模型句子作为人类认可证据。 |
| E25 | [narration-v8-independent-review-r8.json](../../../../outputs/story-r8/narration-v8-independent-review-r8.json)，24轨SHA/bytes/解码数值，scopeLimit与userListeningAcceptance=false；[旧v8 manifest](../../viewer/public/mural-assets/narration-v8/manifest.json)。 |
| E26 | [main.ts](../../viewer/src/mural/main.ts)，caption-row与双语cue文本；[style.css](../../viewer/src/mural/style.css)，presentation grid、caption高度与滚动。 |
| E27 | [r9-key-safety-slender-final.json](../../../../outputs/story-r8/r9-key-safety-slender-final.json)，限定授权Tripo密钥字节扫描、1347文件、0匹配。 |
| E28 | [story-first-demo计划](../plans/2026-10-03-story-first-demo.md)，完整录屏/视频/完整源码要求；旧公开Kokoro认可与narration-v8状态只属历史，当前Qwen需求优先。 |
| E29 | [handoff.test.ts](../../tests/handoff.test.ts)，hash不符、路径穿越、未列文件拒绝；[旧REV4交接README](../handoff/yuezhi/README.md)，干净目录与ZIP清单方法；[旧核心资产包记录](../handoff/2026-10-03/asset-package.json)，71文件/12 GLB，非当前完整工程。 |
| E30 | [production-v9/session.json](../../../../outputs/story-r8/voice-r10-uncle-fu/production-v9/session.json)、[c0-0 receipt](../../../../outputs/story-r8/voice-r10-uncle-fu/production-v9/c0-0-receipt.jsonl)、[c0-1 complete](../../../../outputs/story-r8/voice-r10-uncle-fu/production-v9/c0-1-complete.json)、[c0-2 complete](../../../../outputs/story-r8/voice-r10-uncle-fu/production-v9/c0-2-complete.json)、[c1-0 complete](../../../../outputs/story-r8/voice-r10-uncle-fu/production-v9/c1-0-complete.json)、[c1-1 receipt](../../../../outputs/story-r8/voice-r10-uncle-fu/production-v9/c1-1-receipt.jsonl)、[失败原始SSE](../../../../outputs/story-r8/voice-r10-uncle-fu/production-v9/sse-5557d2b21b0b4020a073d51386831cfc.txt)及各cue同名request/receipt。SSE内容由root直接核读；本代理直接读取该文件因自动审批服务429未执行，其他列出complete与试听认可记录已核读。 |

## 给root的固定建议与项目复盘

把上述规则转为四层交接schema和拒绝条件时，先冻结输入/输出/证据等级，再决定工具实现；modelAPI与TripoAPI分开的选择界面、权限、费用和恢复策略应在正式Agent计划里明确；在线TTS失败需逐轨恢复及全量切换门槛，声音字段必须反映公开preset或获授权参考推理的真实方式。不得因本文件存在就把候选规则自动active。便宜模型只能提取/标签/摘要，强模型负责史料冲突、文件写入、运行时验证与最终决定。

本例有效的做法是故事与形制边界分开、raw与派生链保留、真实GLB顶点/UV/PBR检查、逐句音轨字节校验、确定性seek、保存失败反证，以及试听认可绑定人类原话与样本SHA。主要不足是旧故事目标错位、初期资产采用不实、低清图生人体失败、尺寸约束未服从、真实手混权重、IK起停边界、测试坐标系误差、同名诊断覆盖、浏览器冻结门槛缺失和在线音轨部分生成失败。在线失败具体provider原因仍未知，本地参考推理正在执行，不能把推断或授权冒作成功。已废弃假设均在对应规则/记录中注明，不复用旧通过覆盖新版本。

产物分类：项目 `skill_candidate`、`failure_record` 索引与 `no_persist`。成功规则须经root逐项审查、绑定当前用户指令和最终运行证据后才固定到正式项目Agent规则；不写全局memory、不修改active skill、安全边界或底层规则。剩余验证集中在Qwen完整音轨/实际发音、真实自然播放和动作观感、完整新录屏、当前完整源码ZIP干净解包运行及素材再分发权利。
