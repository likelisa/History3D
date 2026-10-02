# 张骞壁画 · 公开通用旁白v4 / r5讲解稿

24轨位于viewer/public/mural-assets/narration-v4，页面读取这一版。正文与已审校story.ts的24个cue逐字一致；不是在旧v3上只替换两句。旧v3全部27个文件hash保留。当前共268.23秒、3,243,384字节，每轨9.71–12.44秒；24kHz单声道96kbps，原始速度0.92。语音之外另有逐句场景动作与阅读停留。

## 公开来源和许可

模型为hexgrad/Kokoro-82M-v1.1-zh，固定版本01e7505bd6a7a2ac4975463114c3a7650a9f7218。官方预设voices/zm_010.pt已经用户试听采用，不使用私人参考录音或声音克隆。[固定版本模型卡](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh/blob/01e7505bd6a7a2ac4975463114c3a7650a9f7218/README.md)标注Apache-2.0，并说明中文专业说话人数据由LongMaoData免费且宽松授权提供。

- checkpoint SHA256：b1d8410fa44dfb5c15471fd6c4225ea6b4e9ac7fa03c98e8bea47a9928476e2b。
- 声向量SHA256：d2eeba86192eee269f600ca6821038034abd017532a1fe68ff7b0e86c2983b2a。
- config SHA256：bc333efa5ce4ceff433c8c8e5d027a1eca0166001e4e4a62bea2d26ff7a46890。

NOTICE.md与LICENSE-Apache-2.0.txt随音轨保留。产品仅含成品音轨、清单、配方、包锁和公开许可，不含模型/声向量/环境、原WAV或任何私人参考素材。

## 离线配方

先用原scripts/mural-narration-data.ts导出chapterDefinitions；在已核验的独立环境运行scripts/mural-narration-kokoro.py。该脚本只读本地官方模型并校验hash，强制离线，不下载或安装。包版本与PyPI wheel hash在mural-narration-kokoro-requirements.lock.txt；本次Python3.10.20、torch2.1.2+cpu、numpy1.26.4、soundfile0.14.0、Kokoro/Misaki0.9.4。正常build不运行推理。

```powershell
node --import tsx scripts/mural-narration-data.ts ..\speech-r5\reviewed-cues.json
python scripts/mural-narration-kokoro.py --cues ..\speech-r5\reviewed-cues.json --wav-dir ..\speech-r5\wavs --output-dir ..\speech-r5\encoded --model-dir ..\official-kokoro-model --license-file viewer\public\mural-assets\narration-v3\LICENSE-Apache-2.0.txt --public-version 4
```

参数 `--public-version`默认3以保留旧配方的v3语义；r5明确传4，生成formatVersion=4.0.0以及/mural-assets/narration-v4/c*.mp3。先创建新的仓库外工作父目录，所有输出必须是新目录，原WAV必须在仓库外。先核对新成品，再安装新的公共版本目录，旧版本不覆写。`--only-cues`仅供后续批准的局部重录到新暂存目录；不要把两轨局部manifest冒充完整24轨。

G2P沿原标点分组，上限100音素，每组拼回完整原句，未知音素与截断均拒绝。本次24句均为中文，通用英语模块警告不涉及正文。张骞zhang1 qian1、月氏yue4 zhi1、邛qiong2、身毒juan1 du2、旌节jing1 jie2、大宛da4 yuan1均明确覆盖；身毒作为印度旧称的读音已回证[教育部词典](https://dict.revised.moe.edu.tw/dictView.jsp?ID=97511)，不改显示汉字。

编码为两遍loudnorm（-18 LUFS、-1.5 dBTP、LRA7）、libmp3lame单声道24kHz96k，去除metadata。模型与声向量用weights_only=True；548训练tensor与checkpoint完全匹配，官方旧ONNX导出额外140归一化affine项只接受weight=1/bias=0。

## 独立验证与版本绑定

原导出脚本第二次导出，核对24个有序id/text及导出hash。每轨重新跑FFprobe、独立FFmpeg decode、实际bytes/SHA、有限值、无削波，并核对原WAV hash、分组拼接和不截断。最大解码peak0.823904，削波比例0。证据narration-delivery-verification-r5.json保存每轨probe/decode/原WAV与分组记录；播放器仍再次核验真实读取的MP3。

manifest绑定冻结story SHA aec6ee24c2b8df729564051a873947e1a9f03fc1ac0a167f8bf8ada9f1649ea9、cue SHA e86997c7901af4b19dffb70ef08f21b3f4766ab7f956b030903dfc730aa2a654、当次配方SHA与包锁SHA。不同推理/编码版本不保证重录bytes相同；已有成品以保存manifest为准。后来更改正文或配方不能偷换录制时hash，应产生新的版本与证据。

这份审计证明声音源/成品完整，不代替最终场景、字幕、自然播放、构建或ZIP接受。r4加载/编码/历史读音失败保留为项目failure_record；本次v4产物与验收为no_persist，不修改全局memory或active skill。
