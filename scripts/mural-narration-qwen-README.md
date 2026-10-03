# Qwen 公开 Uncle_fu 旁白生产配方

本脚本只使用官方 Qwen3-TTS demo 的 `CustomVoice` 公开预设 `Uncle_fu`，语言 `Chinese`、模型 `1.7B`。用户已认可第一条官方 UI 样本。`--reuse-first-sample` 必填，其 SHA256 固定为 `f47d4c2e50cdbc2dee165d7cd2415c5e667c9af68863127701344c20b6f73e37`，原始 24kHz 单声道 PCM 长度为 8.616875 秒；第一轨不会重复提交。

固定风格为：

> 用标准普通话，像一位沉稳、温暖的历史讲述者，语速适中，叙述自然连贯。句尾轻收，适当停顿，不用新闻播报腔，不夸张表演，不压低嗓音。

月氏、单于、身毒、邛相关 cue 在 `instruct` 中追加专名拼音提示，正文 `data[0]` 不变。读音复制旧 Kokoro `READINGS`，另补 `单于＝chan2 yu2`；`身毒＝juan1 du2` 的来源是教育部重编国语辞典：https://dict.revised.moe.edu.tw/dictView.jsp?ID=97511 。风格指令不能替代最终人工听辨。

## 运行与断点续传

在仓库根目录运行。已有 Python、FFmpeg 和 FFprobe 即可，不安装 Python 包，不下载权重，不需要密钥。先运行只读计划；默认不创建文件、不调用网络。确认计划后，使用完全相同的参数追加 `--run`。

```powershell
$qwenArgs = @(
  'scripts/mural-narration-qwen.py',
  '--cues', '../../outputs/story-r8/reviewed-cues-r8.json',
  '--output', 'viewer/public/mural-assets/narration-v9',
  '--evidence', '../../outputs/story-r8/voice-r10-uncle-fu/production-v9',
  '--reuse-first-sample', '../../outputs/story-r8/voice-r10-uncle-fu/c0-0-official-demo.wav'
)
python @qwenArgs
# 明确开始生产：
python @qwenArgs --run
# 正常中断或可恢复的传输中断后，用同一命令续传：
python @qwenArgs --run
```

可用 `--ffmpeg`、`--ffprobe` 指定已安装的程序路径；`--timeout` 默认 600 秒。新 evidence 目录须位于仓库之外，并与原始 UI 样本和 public 输出分开。新 output 只能为本仓库的 `narration-v9`，第一次必须为空。OS 文件锁阻止两个生产进程同时操作；进程退出会释放锁，无须删除锁文件。

每轨固定请求以 UTF-8 无 BOM JSON 保存；收据 JSONL 追加写入并 fsync。POST 前保存提交意图；收到 `event_id` 后只读取同一个事件，不重新 POST。官方 API 格式来自当前 UI 的 cURL 文档：

```text
POST https://qwen-qwen3-tts.hf.space/gradio_api/call/generate_custom_voice
{"data":[正文,"Chinese","Uncle_fu",风格指令,"1.7B"]}
GET  https://qwen-qwen3-tts.hf.space/gradio_api/call/generate_custom_voice/<event_id>
SSE event: complete -> [FileData,status]
```

完整 SSE、FileData、原始 WAV 和验证结果均保留。文件下载及所有重定向仅允许 HTTPS `qwen-qwen3-tts.hf.space`。不会下载模型、调用克隆接口或读取私人音声。

quota/生成错误立即停止，失败收据阻止自动重提；POST 结果未知且没有已保存 `event_id` 时也停止。人工续传只恢复已知事件/文件的传输或尚未提交的轨道；不会自动重做失败/未知生成。损坏、参数改变、部分写入或无法核验的已有文件一律保留并停止，不覆盖、不删除、不混入旧音轨。若遇此类阻塞，由操作者复核证据后决定下一步，不能把换目录当成自动重试。

原始 WAV 先校验 RIFF、24kHz 单声道 PCM、时长与完整有限值解码；再以 FFmpeg `-n` 两遍 loudnorm（-18 LUFS / -1.5 dBTP / LRA 7）生成 24kHz 单声道 96kbps MP3。MP3 经 FFprobe 和全量 float 解码验证无裁剪、无非有限值，解码长度与原 WAV 差异不超过 0.01 秒。已有已验证轨道只有请求、原始 WAV 与 MP3 digest 全部匹配才复用。

只有 24 轨都完成才写 `manifest.json`（9.0.0），并生成公开来源说明 `NOTICE.md`。页面/普通 build 不调用此脚本。人工听辨正确后，再由 root 接入 v9；脚本不改 main、story 或 tests。

## 来源与服务边界

- 官方代码：https://github.com/QwenLM/Qwen3-TTS
- 公开 demo：https://huggingface.co/spaces/Qwen/Qwen3-TTS
- 模型卡：https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice
- 代码与模型标注 Apache-2.0；在线服务受 Hugging Face ZeroGPU 排队、额度和服务条款约束：https://huggingface.co/docs/hub/spaces-zerogpu

托管模型版本和采样随机性未由此接口固定，脚本不声称再次生成可以得到相同音频字节。可复现性依靠固定原文/请求/配方、原始 WAV、SSE、收据和 SHA256；已验证音频可直接续用。模型权重留在服务方，不进入产品仓库或交付包。脚本无需授权头，也不会查询或使用账户预付费额度。
