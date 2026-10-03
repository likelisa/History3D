> 历史版本v3：当前r5稿件已重录到v4，现用说明请读narration-v4.md。下文的正文、总时长与hash描述保留为r4当时版本。

# 张骞壁画 · 公开通用旁白 v3

已采用用户确认的官方公开预设 `zm_010`，完成当前正文的24轨中文旁白。成品位于 `viewer/public/mural-assets/narration-v3/`，页面读取此版本；旧 v2 保留。声音正文与 `chapterDefinitions` 的24句逐字一致，没有新增史料或改写句子。

24轨共210.815秒，MP3共2,554,488字节。每轨为24kHz单声道96kbps MP3；全部通过 FFprobe 编码/时长核验、FFmpeg独立解码、有限值与无削波检查。原始合成速度为0.92；默认界面1×播放这份舒缓音轨，界面速度调整同时作用于音频和故事进度。3D场景与阅读停留时间另计。

## 来源与授权

- 模型：`hexgrad/Kokoro-82M-v1.1-zh`，固定版本 `01e7505bd6a7a2ac4975463114c3a7650a9f7218`。
- 官方模型卡：[固定版本说明](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh/blob/01e7505bd6a7a2ac4975463114c3a7650a9f7218/README.md)。卡片标注 Apache-2.0，并说明专业中文说话人数据由 LongMaoData 免费且宽松授权提供。
- 公开声向量：该官方仓库的 `voices/zm_010.pt`，没有使用私人参考录音或声音克隆。
- checkpoint SHA256：`b1d8410fa44dfb5c15471fd6c4225ea6b4e9ac7fa03c98e8bea47a9928476e2b`。
- 声向量 SHA256：`d2eeba86192eee269f600ca6821038034abd017532a1fe68ff7b0e86c2983b2a`。
- config SHA256：`bc333efa5ce4ceff433c8c8e5d027a1eca0166001e4e4a62bea2d26ff7a46890`。
- `narration-v3/LICENSE-Apache-2.0.txt` 与 `NOTICE.md` 保留许可和来源说明。交付仅含成品音轨、清单、配方和公开许可；权重、声向量、推理环境、原始 WAV 均不进入交付。

## 配方与校验

先用原 `scripts/mural-narration-data.ts` 导出当前正文，再在独立推理环境运行 `scripts/mural-narration-kokoro.py`。该脚本只读已下载且经 SHA256 核验的本地官方模型，并强制离线推理。包版本和官方 PyPI 哈希见 `scripts/mural-narration-kokoro-requirements.lock.txt`；验证环境为 Python 3.10.20、torch 2.1.2+cpu、numpy 1.26.4、soundfile 0.14.0、Kokoro/Misaki 0.9.4。正常 `npm build` 不合成声音。

示例参数中的输入模型目录、正文JSON和原始WAV目录应放在仓库外；输出目录必须是新的 `viewer/public/mural-assets/narration-v3`。已存在的音频不会覆盖。`--resume-empty-output` 只允许复用经核对完全为空的输出目录，用于首轮编码中断后的接续。

```powershell
node --import tsx scripts/mural-narration-data.ts ..\speech-work\cues.json
python scripts/mural-narration-kokoro.py --cues ..\speech-work\cues.json --wav-dir ..\speech-work\wavs --output-dir viewer\public\mural-assets\narration-v3 --model-dir ..\official-kokoro-model --license-file ..\official-kokoro-license.txt
```

G2P只沿原文标点分组，每组最多100音素，分组拼接必须完整还原原句。禁止截断或静默丢弃不在模型词表中的音素。专名读音经过明确覆盖与断言：张骞 `zhang1 qian1`、月氏 `yue4 zhi1`、邛 `qiong2`、身毒 `juan1 du2`、旌节 `jing1 jie2`、大宛 `da4 yuan1`；这些覆盖不会修改显示正文。身毒作为印度旧称读 juān dú，已回证[教育部官方词典](https://dict.revised.moe.edu.tw/dictView.jsp?ID=97511)。此前 `shen1 du2` 假设已废弃，只重新合成 c5-2、c6-1；另外22轨SHA不变，旧两MP3、manifest和原WAV留在仓库外。每轨清单记录正文、实测时长、文件字节数和SHA256。播放器再次核验实际读取的24份文件。

局部重录可用 `--only-cues c5-2 c6-1` 输出到新的仓库外暂存目录。配方不会直接覆盖产品音频；在独立比对正文、解码和hash后才替换批准的音轨。当前 manifest 保留最初录制的正文源SHA、正文导出SHA与配方SHA，另记当前源SHA、当前配方SHA和纠音来源。当前 `story.ts` 后补两条《汉书》来源，24句正文仍逐字一致；不能因为仅来源metadata变化便偷换最初录制hash。

编码使用两遍响度标准化（-18 LUFS、-1.5 dBTP、LRA 7）、单声道24kHz libmp3lame 96k，并去除元数据。模型加载与声向量均使用 `weights_only=True`。548个训练张量全部与 checkpoint 相同；官方为旧ONNX导出新增的140个归一化 affine 参数均验证为 weight=1/bias=0，不接受其他缺失权重。

## 本阶段复盘

公开预设、模型卡、PyPI包与哈希都经文件/命令回源验证；原推理环境的包清单未变化。首次完整性断言把官方恒等 affine 也视为缺失训练参数，随后通过官方源码注释和逐张量检查定位并修正。首轮批量编码还发现 FFmpeg JSON 后追加统计文本，配方改为读取第一段 JSON 对象，仍严格核对各测量字段。原失败证据及原始WAV保留在仓库外工作区。

这些问题归为项目级 `failure_record` 候选；成品、配方和校验属于本次交付证据，不写全局 memory 或修改 active skill。语音子任务完成不代表3D场景整体已经验收，最终场景与完整播放由总任务继续核验。
