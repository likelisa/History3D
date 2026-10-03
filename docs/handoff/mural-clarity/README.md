# 张骞故事现有成果接力 · r5 · 2026-10-03

> **这是现有成果的接力快照，不是用户已认可的最终故事稿。** 用户最后明确要求：先把张骞的故事讲明白，壁画、图片和3D为故事服务，只在适当处穿插解释。当前24句仍以读画为主，用户已指出看不懂并否定这一组织方式。技术验证通过不代表故事表达验收通过。请先读 ZIP 根部 `下一步接力.md`（源码中为 `docs/handoff/mural-clarity/NEXT-STEPS.md`），优先重写完整故事稿，交用户审阅后再同步场景和重新录音。

这次应保留已有字幕底置、公开音色、3D资产、动作和运行工具，不要以当前画面顺序限制新故事。不要将“山石连接下方辞行和左上城池”继续作为正文主线，也不要在3D中讲不存在的原画位置。当前 GitHub/ZIP 的实际状态请以交付者最后提供的提交和包校验记录为准。

本次电脑端入口是 `mural.html`，分支 `codex/mural-clarity`，开发基线 `3f36ec5ff3ba3d2a143ab6b561b320d1ed629221`。讲解围绕初唐莫高窟第323窟《张骞出使西域图》，八章24句、17处注释已做过r5来源审校，但尚未通过用户的故事表达验收；旁白采用同一批准的公开音色，重录到独立v4。旧月氏页面、旧v2/v3音轨、r3/r4原始记录保留，当前验收以r5证据为准。

## 当前预览的实际组织方式（下一轮要重写）

沿宫殿礼拜、辞行、山间行进和大夏城池读画。每句先观看对应画面/立体镜头，再听完整旁白；阅读下限与实测语音共同决定停留，不用固定章节长度截断句子。暂停、逐句回看、章节跳转、开关旁白、0.8×/1×/1.15×速度、原画与对应3D切换，以及17处注释帮助继续理解。

字幕在画布下方独立的一行区域，与canvas平行分区；原画和3D场景都不会被正文字幕覆盖。字幕区固定预留高度，显示/隐藏不会压动镜头；较长句子可在字幕区内滚动。右侧讲解栏保持可读，内容与句子列表可滚动。本项目只交付电脑布局。

讲解词按敦煌研究院对第323窟及张骞图的说明组织观画顺序，同时结合《史记》《汉书》《魏书》的来源。先提问，再引导找人物和建筑，随后解释画面与史书的差异，最后回到两层历史记忆。来源类型不是免责声明标签，而是帮助观者辨认“画上画了什么、史书记了什么、后人如何解释”。原画与图像来源文件未改。

## 资产与动作

11份GLB由两份清单共同加载：基础 `viewer/public/mural-assets/manifest.json` 保持6项（张骞、随从、马、汉节、僧人、塔），`scene-assets-r4.json` 保留5项补充（匈奴人物、市场、精化环境、拘留营地、接见王庭）。这五项仍是r4资产版本，不能为了文稿r5而改写其来源或hash。页面逐项验证实际bytes/SHA后使用，失败会报错。已保存的Tripo人物/物件在场景中真实使用；营地/王庭由Blender原创构建，未新增收费Tripo任务。普通查看不需要provider密钥。

拘留与接见分别使用营地、正式王庭。营地守卫用灰发短披肩/木杖、年轻装束/携弓等特征区分。王庭按主客、持节随从与王庭侍从组织，不安排街边路人；衣着、年龄、具体站位与建筑均是有来源边界的展示补全，不声称已知制服或某位国王的肖像。

人物采用已保存的CMU 07_01真实捕获下肢周期，按移动距离推进，上肢保持稳定，汉节跟随持节手。运行时绑定保留纹理的实际网格，源GLB不覆盖。随从依据带纹理整体正面实施整人-60°校正；旧只调头颈或按无纹理轮廓猜方向的方案作废。脚尖、左右脚间距、支撑脚和连通衣料需同时经几何测试、近景及连续动作查看，测试不能独自证明自然。

## 当前24轨旁白

`viewer/public/mural-assets/narration-v4/`使用官方公开Kokoro `zm_010`，用户已试听采用；离线原始速度0.92，24kHz单声道96kbps MP3。当前24轨共268.23秒、3,243,384字节，每轨9.71–12.44秒。清单 `formatVersion=4.0.0`，记录每句精确正文、实测时长、bytes和SHA。原v3全部文件hash保持原样，当前页面只读取v4。

独立原导出脚本确认v4的24个id/text与冻结正文一致；FFprobe、FFmpeg独立解码、有限值与零削波检查全部通过，最大解码峰值0.823904。身毒读 `juan1 du2`，按教育部官方词典覆盖；显示正文未为读音改字。公开来源、许可、配方与复现细节见 `narration-v4.md`。普通build不下载模型、不合成声音，也不调用付费生成服务。

## 在新电脑运行

在新的解压目录进入 `History3D/`。使用Node.js 22.12+（或依赖支持的更高版本）与Python 3，按锁文件安装依赖。

```powershell
npm ci
npm run check
npm run build
npm run preview -- --host 127.0.0.1 --port 5194 --strictPort
```

打开 `http://127.0.0.1:5194/mural.html`。开发时使用 `npm run dev -- --host 127.0.0.1 --port 5194 --strictPort`。查看已交付GLB/MP3不需要Blender、FFmpeg或语音推理环境；只有重建布景或重录才配置相应作者工具。若Windows构建报告占用，正常停止自己持有生成目录的开发watcher，再保留失败/重试日志并重试。

真实Blender集成检查依赖有效 `BLENDER_BIN` 或项目默认可执行路径；新电脑未部署时相关用例skip，skip不代表已审查通过。可用已核验的便携版配置 `BLENDER_BIN`，不必改全局PATH。安装Blender也不会自动采用新资产或绕过原审核流程。

ZIP附源码、测试、11资产、24轨当前旁白、保留的旧版本、原画、来源与许可、交付工具。`.git`、node_modules、dist、构建复制的public/packages、缓存、环境变量/凭据、语音权重/声向量/环境、原始WAV和私人参考音频不进入包。npm脚本重建依赖及复制物；请在新目录接力，避免覆盖未保存修改。

## 来源边界

正文/注释的sourceIds在 `viewer/src/mural/story.ts`；实际阅读的讲解文稿、借鉴方法与事实取舍见 `docs/historical/narration-writing-r5.md`，叙事来源核对见 `docs/historical/mural-narrative-audit.md`，王庭依据见 `docs/historical/yuezhi-reception-r4.md`，动作来源与提取验证见 `docs/historical/motion-cmu-07-01/`。独立审校 `independent-narration-review-r5.json`绑定同一冻结正文，核对7个来源、24句与17处注释；最终代码审查见 `final-code-review-r5.json`。

初唐壁画距汉代张骞七八百年。画中从金人问名号引出辞行；史书中的首次出使是外交求盟。敦煌研究院还指出，若按获金人的先后对应，应涉及第二次出使。不能把两个目的或时间直接混为一次事件。营地、月氏接见和市场是独立史书背景的空间示意；僧人、佛塔及“见僧问佛”表现后世佛教记忆，不当作首次出使的现场证据。

原画来源、原文件hash和权利边界见 `viewer/public/yuezhi/murals/provenance.json`。图像来源为敦煌研究院，公开/商业许可未确认；生成资产的公开使用权、历史与视觉接受仍由负责人复核。复用背景音乐时保留 `MUSIC-CREDITS.txt` 的CC BY 4.0署名。

## 最终验证与接力

最终命令结果从 `验收证据/final-r5-handoff-command-results.json`及其引用的 `npm-check-final-r5-handoff.log`、`npm-build-final-r5-handoff.log`核对；真实退出值与动态测试计数在 `verification-final-commands-r5.json`。源码、media与dist一致性快照为 `delivery-source-snapshot-r5.json`。不使用旧测试数量或预计数量宣称本版完成。

场景：`scene-r5-final-checks.json`。控件：`browser-validation-r5.json`。连续步态：`walking-validation-r5.json`。完整八章24句：`natural-playback-r5.json`及其trace字段实际引用的JSONL，本次为 `natural-playback-r5-attempt2-trace.jsonl`。字幕位置：`subtitles-layout-r5.json`，应核对字幕行位于canvas下方且两种视图均不覆盖画面。最终图片只取这些r5记录真实引用的文件。旁白独立审计为 `narration-delivery-verification-r5.json`。

新解压目录的ci/check/build结果为 `clean-install-validation-r5.json`及配套日志；只代表本机新目录，不声称第二台实体电脑已实测。GitHub提交/PR、最终ZIP与hash由负责人按实际结果记录。最终冻结前必须把文稿、音轨、布局和证据一起核对；任何再改正文都需重新导出/录音，不混用新字幕和旧声音。

ZIP根部 `ZIP-MANIFEST.json`记录全部载荷bytes/SHA，外置`.sha256`记录整包hash。pack默认只plan，正式build需 `--evidence-frozen`且所有来源与最终证据齐全；封包还逐项比对当前源码与已冻结快照，拒绝旧ZIP覆写或冻结后源码变化。freeze/新目录验收同样默认只plan，由负责人显式触发。

```powershell
python '交付工具/make-mural-handoff.py' --verify 'History3D-故事成果接力-r5-2026-10-03.zip'
```

简洁复盘：旧正文冻结已废弃，r5虽已审校和录音，但用户进一步指出应以故事为主，当前读画优先方案也已作废；原画/旧音轨保留，公开音色继续采用。人物朝向、拓扑与专名纠音归为项目failure_record，当前产物/验证为no_persist，不改全局memory或active skill。最终状态依当前命令、近景、连续画面与自然播放证据共同判断。
