# 壁画故事r5 · 交付核对与复盘

> 2026-10-03紧急接力补充：当前技术成果保存，但用户未认可故事表达；用户要求故事优先，当前读画优先方案已废弃。以下是旧r5技术证据，不能宣称故事已完成。下一轮按NEXT-STEPS.md先重写讲稿再同步画面与公开音轨。

## 当前有效范围

电脑端mural.html；八章24句讲解、17处注释已按敦煌研究院解读与相关史书重新审校。字幕从canvas移到画布下方独立区域，右侧说明可滚动。旧“正文不得改”的冻结假设因用户的新要求作废；旧v3音轨/记录保留，当前公开zm_010音色继续采用并重录v4。资产与下肢捕获步态继续使用r4已保存版本，不改其来源hash。

11资产由原6项基础清单与5项scene-assets-r4补充清单合并；拘留营地和正式王庭由Blender构建，既有Tripo人物/物件参与展示，没有新的收费Tripo任务。随从按带纹理整人正面-60°校正，真实CMU下肢周期、稳定上肢、守卫区别与主客站位仍保留。历史/壁画/推演的边界见story.ts的sourceIds与来源文档。

## 已取得的r5配音证据

v4独立审计 `narration-delivery-verification-r5.json`：24轨与原导出脚本重新导出的冻结id/text逐字一致；实际bytes/SHA、FFprobe、FFmpeg独立解码、有限值和零削波全部通过。268.23秒、3,243,384字节，最短9.71秒、最长12.44秒，最大解码峰值0.823904。公开zm_010/0.92，24kHz mono 96kbps；模型与语音环境未下载/更换，不含私人素材。

冻结正文sourceSHA：`aec6ee24c2b8df729564051a873947e1a9f03fc1ac0a167f8bf8ada9f1649ea9`。cue导出SHA：`e86997c7901af4b19dffb70ef08f21b3f4766ab7f956b030903dfc730aa2a654`。v4 manifest SHA：`b7a5eb65d31b2eb08f296f01970b50907e22faed872dd30249ed4eb1676b7ab7`。原v3的27份文件全部hash保持不变；r4的sourceSHA与两轨纠音只是当时证据，不拿来替代新文稿的冻结记录。

每轨沿原标点分成2组、最多100音素，分组拼回原句且不允许截断。配方提示未配置英语处理，但审计确认24句均无英文字母，不存在该分支移除英文正文。原始WAV与全部authoring/失败证据在仓库外保留，交付仅含成品/许可/配方和审计。

## 最终总体验收的证据入口

实际项目检查与构建读取 `final-r5-command-results.json`及其实际log；若后续解读标签小修，则最终冻结指定 `final-r5-label-command-results.json`并绑定其中真实check/build日志。冻结绑定退出值与日志hash，从真实日志动态解析测试数量，不复用旧r3或预计数字。快照为 `delivery-source-snapshot-r5.json`，所有附带public文件必须与dist逐字节一致，封包前当前源码还需与快照相同。新文稿依据见narration-writing-r5.md，独立文稿审校为independent-narration-review-r5.json，代码审查为final-code-review-r5.json。

当前布局静态验证及typecheck已通过，源检查记录为 `subtitles-voice-env-r5-source-check.json`；它没有代替浏览器bounding box或最终截图。最终字幕位置看 `subtitles-layout-r5.json`；近景/场景看 `scene-r5-final-checks.json`；控件看 `browser-validation-r5.json`；连续走路看 `walking-validation-r5.json`；全程看 `natural-playback-r5.json`和trace。只有这些当前证据齐全且负责人审阅后才正式freeze/封包。

新解压目录验证由 `verify-clean-mural-r5.py --run`显式执行，保存ci/check/build日志及clean-install-validation-r5.json；未执行则不创建结果。ZIP排他创建并检查路径、CRC与逐文件SHA，旧包不删除/覆盖。GitHub状态依据真实Git/GitHub结果，未取得结果不写已提交。公开权利和历史/视觉接受仍按原provenance边界复核。

## 废弃假设与失败记录候选

1. 整体朝向：无纹理轮廓/远景被误当正面证据，随后只调头颈的方案也未覆盖真正整人朝向。当前用带纹理正面和整人-60°校正。证据指针cinema-world.ts、walking.ts、真实GLB与最终r5近景。回滚条件为头、胸、脚任一持续偏离行走方向；应回模型/坐标证据，不用远景掩盖。

2. 连通拓扑：按X硬分双脚与衣料造成鞋尖错归、长三角拉伸。最小修复是踝X/Z分簇、整鞋归属、连续权重；真实顶点/索引和连续相位检查仍需配合可视审查。证据walking.ts、mural-walking.test.ts。脚轴、衣料或支撑异常即重新定位权重/顶点，不靠缩镜头隐藏。

3. 历史读音：身毒曾猜作shen1 du2，官方教育部词条确认为juān dú，配方G2P覆盖而正文保留原字。r4只重录两轨；r5因文稿整体改变重新生成24轨。证据词典URL、v3纠音记录、v4 manifest及r5独立审计。来源矛盾或正文改变时回源确认，不继续猜字音。

4. 验证方法：Kokoro恒等affine曾被误认为缺失训练tensor；已按官方源码核对548训练tensor与140恒等默认参数。FFmpeg JSON尾部统计曾导致Extra data；改用raw_decode取一个对象并保持有限值检查。错误记录与原WAV保留。不能把自动测试通过扩展为动作自然或完整产品验收通过。

## 持久化判断与剩余核验

上述失败作为项目级failure_record候选；r5稿件、音轨、布局、日志、ZIP与提交事实归no_persist。本轮不改长期memory、active skill、meta-skill或底层规则。剩余核验聚焦字幕是否遮挡、完整24句音画时序、连续步态与主客站位、新目录复现及实际交付状态，以最终记录为准。
