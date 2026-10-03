# 固定公开声音与独立环境

用户已经认可公开合成 Uncle_fu 参考的本地复刻，并授权继续旁白；2026-10-03 追加要求将声音固定到 Agent，隔离原 GPT-SoVITS 私人内容。本实现创建新环境，不清理或复制原私人安装。

固定声音 ID 为 `history3d-public-uncle-fu-r13`，参考 SHA `f47d4c2e50cdbc2dee165d7cd2415c5e667c9af68863127701344c20b6f73e37`。官方源码冻结在 `d7c2210da8c013e81a94bfc7b811a477c99fd506`。官方基模为 s1v3 和 v2ProPlus，辅以公开 BERT、HuBERT、说话人编码与中文读音资源；本地字幕对齐用公开 faster-whisper-large-v3。没有训练或新模型下载。

新环境当前位置为 `E:/History3D-PublicVoice-r13/GPT-SoVITS-v2pro-20250604-nvidia50`。该机器盘符只是本地部署位置；接力机器通过 `HISTORY3D_PUBLIC_VOICE_ROOT` 指定独立环境目录，不能指向原私人安装。

启动声音服务：在该环境目录运行 `runtime/python.exe public_voice_server.py`。服务绑定 `127.0.0.1:9886`；启动会核查参考、公开模型、读音资源、官方源码、Python 身份和哈希。`GET /health` 返回固定身份；`POST /tts` 仅接受 `{text}`。没有参考上传、文件路径、权重切换、训练或管理接口。没有访问日志；错误不回显正文或路径。下载与缓存配置指向独立目录，模型只从本地读取。

随后在工程执行 `powershell -NoProfile -File scripts/start-heritage-agent.ps1`，打开 `http://127.0.0.1:5210/`。启动器以 Node 24 官方环境代理支持复用现有 Windows 网络配置，并保持本地直连；`npm run agent:dev` 适用于已经配置好 Node 网络的环境。CLI 默认接固定声音 runner；库调用允许注入离线 runner，用于测试。该测试入口不等于正式 CLI 已完成配音。

真实短句实跑：8.44秒 WAV，SHA `88f34d63057be2c026f782fe523b204fcfbb8caab0ef4b0bf2b283702491e5ba`，32个字幕时点，离线ASR相似度0.96875。Node→Python、缓存恢复、WAV/静音和字幕绑定均另有实际复验。证据在任务根 `outputs/story-r8/public-voice-r13-v1/`。该结果不认证未来生成的每篇故事或专名听感。

声音失败保留已 ready 的3D资产，人工恢复只补未完成音轨。每次失败保留独立attempt；HTTP成功不等于整句合格。过长正文在收费前拒绝；旧长句原稿和SHA保留并明确要求拆句重新审核。长静音、缺失整句、音轨/字幕不一致会停止。

交接分两个包：源码与实际成果；独立公开声音运行环境。环境包只按许可和清单包含官方公开基模、必要运行时、公开读音/ASR资源及唯一认可参考。原来的录音、私人权重、旧配置、凭据、训练日志和缓存不得进入交接。最终ZIP及干净解压启动仍须另验，不能把环境目录存在当作压缩包交付完成。
