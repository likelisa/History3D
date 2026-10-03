# 当前公开参考旁白

当前 24 句由用户本机 GPT-SoVITS v2ProPlus 官方预训练权重合成。参考为 Qwen3-TTS 官方 CustomVoice 的 Chinese / Uncle_fu / 1.7B 公开合成音；用户先认可原音，再认可本地复刻试听并授权继续制作旁白。使用了参考音克隆，没有使用私人录音或私人微调权重，没有训练。

原故事正文保持不变。月氏、大宛、身毒、单于在合成输入中使用同音提示，具体文本与参数、参考 SHA、模型 SHA、逐句字节和时长见 [manifest.json](manifest.json)。音轨总长 248.72 秒；网页加上对应视觉动作、阅读下限和换句余量后重新计算完整故事时间。

24 条文件都已核对正文、SHA/bytes、完整解码、静音分布和离线 Paraformer 转写筛查。初版两句发生缺句与长静音，已在独立版本按句号分段、串行推理重做；原失败结果保留在任务证据目录。筛查结果没有触发缺句/长静音标记，不能代替人耳检查音色、专名与全篇听感。用户认可范围目前是短试听和继续制作，完整新音轨仍待整体试听。

源码：scripts/mural-narration-gpt-sovits.py、scripts/repair-gpt-narration-r10.py。正常 build 不合成、不训练、不调用收费接口。参考原件 reference-uncle-fu.wav 与 voice-acceptance.json 随工程保存，推理环境和模型权重不随交付分发。

来源：[GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS)，本地代码许可证 MIT，见 GPT-SoVITS-LICENSE；[Qwen3-TTS 模型](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice)，模型卡标注 Apache-2.0；[官方合成页面](https://huggingface.co/spaces/Qwen/Qwen3-TTS)。

## v12 字幕同步

声音和正文沿用 v11，24 条音轨字节不变。字幕以实际播放器位置与本地 Whisper 逐词时间戳出字，并将落在已检测长静音内部的字时点移到静音结束；原始识别、时间戳、校正记录和脚本随本版本保存。时间戳仍是自动估计，完整人耳复核尚未标记通过。
