# 固定公开男声参考

`reference.wav` 是用户已认可的公开合成男声参考，不来自原私人录音。SHA-256：`f47d4c2e50cdbc2dee165d7cd2415c5e667c9af68863127701344c20b6f73e37`。

队友准备独立 GPT-SoVITS 环境时，把该文件作为 `scripts/prepare-public-voice-environment.py` 的 `--reference` 输入。同目录清单固定官方源码、模型、读音资源、服务和运行时哈希。源码脚本与启动说明在 `docs/agent/public-voice-r13.md`。

本目录不包含模型权重或 Python 运行时；现有旁白已经随实际网页交付，直接播放无需恢复声音服务。要继续生成旁白，按官方来源和清单准备独立环境，禁止复制旧私人录音、模型和配置。
