# 视觉资产看板使用与制作说明

看板入口：`/asset-board-r8.html`。它在 `viewer/public` 中，Vite构建时会复制到产物，开发或preview服务均可访问。当前接力预览为 `http://127.0.0.1:5197/asset-board-r8.html`。

## 怎么看

- “现用资产”展示 `viewer/src/mural/cinema-world.ts` 真正加载的15个GLB；包括汉使出发关口，以及r9新增独立张骞、甘父和细竹杖。旧envoy保留为匿名大夏商旅。细竹杖继续作为市场货物，并按用户最新选择复用为持节道具杖身，取代原staff-b粗杖。它们已接入demo；静态模型检查和运行时动作验收分别记录。
- “A/B试验”展示四个已落地Tripo结果。仅gate-b也用于现用场景，复用同一文件，不重复计算为新资产；staff-b保留为独立对照，当前故事已停用。
- “未采用”保留壁画张骞图生3D试验。生成任务完成了，但形体和人体辨识未通过，所以没有替换故事主角。
- 总共20张卡片、19个不同GLB。点击缩略图查看大图；“查看故事3D”“查看月氏场景”进入已有场景，“查看3D A/B”进入对照查看器，“查看人物试验”进入失败形体的独立查看器。“下载GLB”取得当前独立资产文件；r9原始下载另行保留。
- 当前看板使用已有3D入口，没有额外复制一套模型查看器；“查看故事3D”不会自动定位某个单独模型，需在故事中查看对应段落。
- 用状态按钮、搜索框筛选；来源折叠区域保留文件路径、SHA、任务和记录入口。可以打印当前筛选结果或保存PDF。

每卡片列出来源、真实大小与面数、故事用途、历史边界和改进优先级。Tripo生成与Blender作者场景明确区分，运行时程序城墙、服装变体、市场补充货物与人物动画不额外冒算成新GLB。

## 文件与重现

```
viewer/public/asset-board-r8.html
viewer/public/asset-board-r8/inventory.json
viewer/public/asset-board-r8/thumbnail-jobs.json
viewer/public/asset-board-r8/thumbnail-provenance.json
viewer/public/asset-board-r8/thumbs/*.png
scripts/build-asset-board-r8.py
scripts/render-asset-board-r8.py
```

1. 用Python3执行 `python scripts/build-asset-board-r8.py`。它从真实cinema定义和现存manifest/result记录读取路径，核对每个GLB的SHA与大小，解析三角面、材质、图像和法线贴图。缺文件、SHA不符、外部GLB资源或现用列表变化都会明确失败，需先复核。
2. 用既有Blender执行 `blender --background --python-exit-code 1 --python scripts/render-asset-board-r8.py`。本机实测版本4.5.14 LTS / EEVEE_NEXT，缩略图为640×420透明PNG；只居中、按显示尺寸归一化、设置正交相机和柔和灯光，不改GLB。新增或更新单个资产时使用 `-- --only departure-outpost`，保留其他缩略图与制作记录。
3. 再运行清单脚本，把最终PNG的SHA绑定到inventory。随后正常构建viewer并打开看板。

缩略图每件独立取景，不能凭看板缩略图对比A/B相对尺寸或声明细节普遍提升。A/B结论请进入既有同灯光、同比例查看器。现有低清壁画图源的深度、背面和隐蔽结构都是生成推演；模型的精细度不证明历史真实性。

## 本阶段核验

原12现用＋4对照＋1未采用的17卡证据保留；加入出发关口后13现用＋4对照＋1未采用的18卡证据也保留。r9新增三资产且仍用staff-b时的16现用＋4对照＋1未采用、21卡证据保留在 `asset-board-r9-file-verification.json` 与 `*-pre-slender-credential-r9.json` 快照中。该21卡描述属于替换前阶段，不作为当前状态。出发关口的独立manifest保留 `{asset:{id,path,bytes,sha256}}`。本轮从15个实际cinema定义动态计算为15现用＋4对照＋1未采用，20卡、19个不同GLB、19张独立缩略图；staff-b虽退出故事，仍在A/B对照中，所以不同GLB数保持19。源码ID集合、文件SHA/bytes和计数不符会明确失败。root统一执行真实浏览器筛选、截图和HTTP链接验证，记录与文件检查分开。

原版项目证据位于任务根 `outputs/story-r8/asset-board-file-verification-r8.json`、`asset-board-check-log-r8.json` 与 `asset-board-thumbnails-r8-final.jpg`；加入关口后的最新证据位于 `asset-board-file-verification-r8-departure.json`、`asset-board-check-log-r8-departure.json` 与 `asset-board-thumbnails-r8-departure.jpg`。初版取景余量不足，发现部分脚和长杖被截后已按实际相机投影取景并重渲染；初版联系表保留在 `asset-board-thumbnails-r8.jpg` 作过程证据，不应作为最终看板图。

随从卡片的缩略图展示保留的匿名基础GLB；当前行进使团只采用1.72米灰蓝持节者这一随从身份。赭色甘父已使用独立r9人物，携囊为可拆附件，不再把甘父描述为随从换色。接见与市场中的其他attendant保持匿名。旧变体过程说明在 `attendant-variants-r8.md`，其中双变体描述属于r8阶段；以当前源码与看板为准。

## r9新增资产与可编辑交接

计划、官方下载记录和加工记录位于 `viewer/public/mural-assets/tripo-story-r9/{plan,manifest,normalized-manifest}.json`。三项实际消耗共150 credits；生成由root统一执行，校准与看板脚本不提交收费任务。原始 `zhangqian-raw.glb`、`ganfu-raw.glb`、`qiong-bamboo-raw.glb` 均保留，SHA与下载记录一致。当前独立GLB为同目录 `zhangqian.glb`、`ganfu.glb`、`qiong-bamboo.glb`；两个人物前面已校准为+Z、高度1.75/1.69米，竹杖1.55米、最大横径本地校准至3.2厘米。

每件的可编辑文件为 `viewer/public/mural-assets/tripo-story-r9/<id>-normalized.blend`；原始与加工后的真实5向PNG分别在 `review/raw/<id>-*.png`、`review/normalized/<id>-*.png`，对应带相机灯光的可编辑工作场景为 `review/raw/<id>-raw.blend`、`review/normalized/<id>-normalized.blend`。`<id>`是 `zhangqian`、`ganfu`或 `qiong-bamboo`；manifest逐项列出完整路径、视图SHA、旋转和竹杖横向缩放参数，方便继续近景审查。两个基础人物均已低垂空手，本轮未做arm-down加工。

看板本轮只运行 `render-asset-board-r8.py -- --only envoy`、`--only ganfu`、`--only qiong-bamboo` 三个新缩略图任务；其他原有缩略图没有重渲染。旧envoy PNG保留为 `asset-board-r8/thumbs/envoy-pre-tripo-r9.png`，逐字节复制为 `thumbs/visitor.png`；旧清单与制作记录另存 `inventory-pre-tripo-r9.json`、`thumbnail-jobs-pre-tripo-r9.json`、`thumbnail-provenance-pre-tripo-r9.json`。原17/18卡片的外部任务证据仍保留，不能把新清单回写成旧阶段证据。

持节道具替换不重新渲染缩略图。原 `thumbs/staff.png` 继续用于staff-b对照卡；当前制作记录将旧 `id:staff` 来源迁移为 `id:staff-b`，保留PNG哈希、原GLB哈希与旧用途指针。替换前21卡清单、缩略图任务和制作记录保存为 `inventory-pre-slender-credential-r9.json`、`thumbnail-jobs-pre-slender-credential-r9.json`、`thumbnail-provenance-pre-slender-credential-r9.json`。当前文件核验另存 `asset-board-r9-slender-credential-file-verification.json`，不覆盖旧核验。

历史边界见 `docs/historical/tripo-story-r9.md`：人物面容、年龄、帽袍是艺术设定，不能称精确汉制肖像；甘父的胡人称谓不能武断认定匈奴族属。竹杖市场用途继续讲货物流通，不作武器；用户最新选择另采用竹质杖身作持节道具的艺术载体。史书“持汉节”的叙事语义仍保留，不表示汉节与大夏邛竹杖器制相同，也不认定汉节材质或考古形制。旧的“邛竹杖仅用于市场、不能替换使团汉节”制作限制已被当前选择取代。静态前轴与PBR/UV核对不等于骨骼步态验收；运行时效果仍由root与专门测试核查。

## 与视频交接的关系

原视频 `0c7a3c660ca7947562f9bf84c46ba87f.mp4` 本轮只读，前后SHA一致；不删除项目起念录音，不上传私人声音，不安装或调用新模型/API。视频审核报告在任务根 `outputs/story-r8/video-review.md`、`video-review.json`；97关键帧SHA在 `video-review/frame-sha256.json`。离线机器转写仅是待核对候选，不能直接用作正式字幕。

必交的可运行完整demo、完整自然播放录屏、剪辑演示片与视觉资产看板各自保留。看板不能代替完整录屏；3分40秒的传输版演示片也不能证明8分钟原demo完整自然播放。稿子和demo更新后再补录母版，不对低码率传输视频强行放大来宣称恢复画质。

此次看板与校准产物分类为项目证据与 `no_persist`；竹杖生成比例不符合prompt记录为项目内 `failure_record` 候选。没有写全局memory或改active skill。校准/看板步骤没有额外收费请求，三项r9生成由root按授权提交并保留官方记录。
