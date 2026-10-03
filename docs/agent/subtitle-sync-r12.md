# v12 字幕对齐与浏览器验证

[publish-mural-subtitle-alignment.py](../../scripts/publish-mural-subtitle-alignment.py) 把已完成的 24 轨对齐结果绑定到冻结的 v11 MP3，并创建新的 `viewer/public/mural-assets/narration-v12/`。该发布已实际执行；运行时已切换 v12。发布脚本本身不合成、不做 ASR、不下载、不训练、不收费，也不访问 GUI。

## 已验证范围

24 轨保留原音频字节和原正文，947 个字幕时点，30 个位于已测长静音内的时点推迟至静音结束。v12 manifest SHA 为 `2e853216e5cb312cd7c7a7722a5e303d96aa682538238585e26eb302d03d8ad5`。

字幕跟随真实 `HTMLAudioElement.currentTime`，不累积限帧 dt，也不把阅读下限当语速。新音轨未就绪时等待；阅读尾段 seek 不再卡住。暂停、前后拖动、0.8/1.5 倍速和结束有真实 DOM 观察。修复版本的完整 check 为 355 pass / 4 skip，独立目录 Vite build exit 0；日志在任务根 `outputs/story-r8/subtitle-sync-r12-v1/`。

随后 UI 从开头启动一遍 1x 播放，自然抵达故事时间367秒，末轨媒体/字幕时钟均10.54秒。该次只有开头与结尾端点记录，不能当成全片逐帧/逐词人耳审核。此前控制验证含多次实际时钟采样。全篇听感、专名发音、录屏与最终封包仍有独立验收要求。

## 冻结输入与校验

- v11 manifest SHA256 固定为 `1b861e03fb33e516bf0765b9872adc30ebeeed8f17eee6642bda1fe3dab65d69`；文件字节或版本改变即拒绝。
- `--alignment` 指向完成的 `subtitle-alignment-no-prompt-v2/alignments.json`。其 `sourceManifestSha256` 必须匹配冻结 manifest，24 个 `c0-0` 至 `c7-2` ID 必须完整且不重复，每轨 display text、audio SHA256 必须与 manifest 完全相同；实际 MP3 字节数及哈希逐轨核对，音轨哈希不得重复。
- `--audit` 指向 `asr-audit-v2/report.json`，固定报告 SHA256 为 `80fa1feb193a33c5aa663e847dfeaf6def9813fe61e3f8f3f388631f36c50679`，并须与 v11 的 `automaticAudioAudit.reportSha256` 相同。该报告产生于给 manifest 增补 audit 字段之前，因此报告内旧 `manifestSha256` 不等于最终 v11 manifest 哈希；二者分别保存，不伪称相等。24 条 audit 的 expected text、时长与静音区间另逐项核对。
- 每个 point 只含 `{seconds,textEnd}`：秒数有限、非负、单调不减且不超过轨道 audioSeconds；textEnd 为严格递增的 Unicode code point 累计边界，最后一点须覆盖包含标点的完整原文。Python `len(text)` 对有效 Unicode 文本与浏览器 `Array.from(text).length` 相同；未配对 surrogate 拒绝。
- 原 `points` 先校验，再调整，再完整复验。只调整严格位于 audit 已测长静音内部的 point，移到该段 `silence.end`；静音来源是 `silencedetect=noise=-40dB:d=0.5`，数值单位是秒，不是毫秒。保留原秒数、point 索引、textEnd、对应静音和原因；后续仍保持时间单调。

例如 `c0-0` 的“张”对应时间 4.82 秒落在 `[4.626313, 5.225125]` 静音内部，可推迟到 5.225125 秒；不能把模型时间点本身视为已人工确认的真实词边界。ASR 对专名的候选转写不改变屏幕原文。

所有输入读取、哈希、引用文件、points、静音、全文覆盖及 JSON 序列化检查都在创建目录前完成。目标 v12 必须不存在（包括 symlink）；写文件使用独占 `xb`，保留 v11 和已有 v12。写入中断留下的部分 v12 也不会被清空或覆盖，须由父代理核对后决定后续处理。

## 人工执行入口

父代理先核对完成的 24 轨 alignment、audit 和对齐源码，再在项目根目录执行。下面仅展示参数形状，`TASK_ROOT` 应替换为本次任务根的绝对路径；没有运行时切换副作用。

```text
python scripts/publish-mural-subtitle-alignment.py --alignment TASK_ROOT/outputs/story-r8/gpt-sovits-public-r10-v1/subtitle-alignment-no-prompt-v2/alignments.json --audit TASK_ROOT/outputs/story-r8/gpt-sovits-public-r10-v1/asr-audit-v2/report.json --aligner EXACT_ALIGNER_SOURCE.py
```

`--aligner` 可选，但交接时建议提供与 alignment 的 `scriptSha256` 完全一致的源码。哈希不符或带 BOM 会拒绝；未提供时 provenance 明确 `included:false`，不能声称源码已封入。

## 新版本产物与未完成事项

v12 复制 24 个 MP3 和公开 reference、voice-acceptance、GPT-SoVITS LICENSE、SOURCE，保持字节/哈希不变。manifest 更新为 `12.0.0`，轨道 URL 指向 `/mural-assets/narration-v12/`，每轨写入 `subtitlePoints`，并追加 `subtitleAlignment` 输入哈希、方法、24 轨覆盖、调整数和人工待审状态。

`subtitle-alignment.json` 是原始 alignment 的原字节副本；修正后的 points 与逐条调整在 `subtitle-alignment-adjustments.json`，并与 manifest 中采用的 points 相同。`subtitle-silence-audit.json` 保存原 audit 字节。另保存发布脚本源码、可选对齐源码和 `subtitle-publication-receipt.json`；成功输出新 manifest SHA256、24 轨数量和调整数量。所有程序读取 JSON 为 UTF-8 无 BOM。

发布瞬间的 provenance 与 receipt 保留 `humanWordTimingReviewed:false`、`guiVerified/guiSynchronized:false` 和 `runtimeSwitched:false`，作为当时事实不得回写。后续运行时切换、工程检查及真实浏览器操作另外保存证据。v11 短试听认可不等于逐字时间戳或全篇字幕认可；ASR 同音转写仍是候选，不能更改屏幕原文。

本次产物为项目发布脚本与说明；不修改全局 memory、active skill、模型训练或安全规则。
