# 处理层候选世界验收记录

日期：2026-09-25。本记录仅是 B 本机技术 fixture 验证，未经过傅老师/靳老师联调。

- 基线：`origin/dev@52721c8b064710958c8744681976826eb57428bb`；功能分支 `feature/processing-end-to-end-20260925`。
- 输入：`import-1fd814aa0802d410efc6`，仓库内占位货包 GLB。原始资料仍是技术样例，驮兽还是灰盒。
- B 世界计划：`processing/fixtures/silk-road-world-plan.json`。`obj-pack-a` 摆在 `obj-beast` 顶部，静态接触与水平重叠检查通过；`obj-pack-b` 保留原展示位置。动态父子挂接未实现。
- 固定候选：`release-efecbcecfaceae4a3023`，`scene.json` SHA-256 `16251cfac722ed182e5829a38f28b8a8a8fc7adadaa8992c2c641dd0d581ef89`，`qualityStatus=needs_review`。正式包校验 0 错误、1 条预期的货包高于地面警告。
- 正式 viewer 本机入口：`http://127.0.0.1:5173/?story=silk-road-demo&candidate=release-efecbcecfaceae4a3023`。2026-09-25 在 Codex 浏览器实际打开，页面显示“可体验”，第一人称看到一个货包放在灰色载体顶部；切到俯视也能看到布局。候选 scene 与货包 GLB HTTP 均为 200，分别返回 9,658 与 1,632 字节。浏览器测试窗口是窄屏，尚未在计划要求的 1440×900 固定环境测性能或录制动态场景。
- 质量边界：这证明 B 输出被正式 C 代码读取并渲染，尚不证明 C 本人验收、历史准确性、完整世界复审、人物/道具、运动承载、音乐或性能门槛。
