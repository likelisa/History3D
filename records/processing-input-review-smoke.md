# 处理层输入审核实测（技术 fixture）

日期：2026-09-25。输入是仓库 `contracts/fixtures/handoff/collection/` 的占位货包，非傅老师真实交付。代码基线从 `origin/dev@52721c8` 建立，功能分支仍在开发。

- 冻结导入：`import-1fd814aa0802d410efc6`，快照 SHA-256 `1fd814aa0802d410efc6812676664298489b0d0c78a1d7c0ccf08ac2ad4459fb`。原包与报告留在本机 `.processing-data/`，不提交。
- 证据：Blender 5.2.0 LTS 导入 GLB，正/后/左/右/俯/三分之四六视角 PNG，每张 640×640；`view_image` 人工查看三分之四视角，确认为简化盒体。另送 GLB 包围盒/字节数、原规划、story/sources。没有世界画面或运动证据。
- 模型：DeepSeek 官方 `deepseek-flash`；请求 ID `30e6023c-1e41-4aa4-a67e-2a9d908570d8`，响应 model `deepseek-flash`。第二次请求完成，输入 9,699 token、输出 10,102 token。第一次请求 `finish_reason=length` 被拒绝；第二次原始输出因若干空 `subjectRefs` 被拒绝，随后仅用已保存响应重新校验，将这类发现定位到已知 storyId 并留下归一化说明，没有第三次模型调用。
- 最终输入报告 `review-1fd814aa0802d410efc6-asset-pack-bundle` 判为 `needs_information`，9 条建议、7 项未评估范围。资产形制、载体与货包连接、历史来源与场景装配等意见仍需 B 核对后分派；未自动要求 A 修改，也未采用资产或发布世界。
- 局限：两次调用的总 token/费用尚未从首轮截断响应的服务端用量单独核实；报告只含第二次的用量。原调用耗时未在失败路径持久化，恢复报告中为 `null`。真实 A 资产、世界复审与 C 页面验收均未发生。
