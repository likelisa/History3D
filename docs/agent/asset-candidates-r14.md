# 质量优先的替代资产接力

用户已授权效果优先、继续生成，不再逐件询问 credits。当前版本实现了候选生成、独立预览和选择；只做过离线 HTTP/真实 GLB 夹具验证，**尚未收费实测新候选或认证其视觉效果**。当前实物案例原始 3D 与旁白不被自动替换。

## 下一步

打开现有 Agent，恢复 RAM 凭据后，对形态不足的资产生成新候选，查看候选预览中的真实模型，再选择合格结果。重点核对轮廓、细部、照片展示台/反光误入、纹理及故事镜头。若效果不足，使用新 operationId 与新 seed 继续比较；网络未知提交应先核对提供方记录。

## API

- `POST /api/runs/:id/budget`：`{maxAssets,maxCredits}`；credits 为 ≥50 的安全整数。默认网页使用最大安全整数，用户可以主动设置停止边界。累计费用包括原资产及所有已提交候选，选用不重复计费；不提供充值/购买逻辑。
- `POST /api/runs/:id/asset-candidates`：`{planSha256,assetId,prompt,reason,operationId,faceLimit?,seed?}`；operationId 为客户端 UUID，超时后应复用它并读取已有候选。同 ID 参数不一致拒绝，新候选会冻结独立参数/原因。
- `POST /api/runs/:id/asset-candidates/:candidateId/resume`：`{}`。只恢复未提交候选或已知任务轮询；unknown 不会重投。
- `POST /api/runs/:id/asset-candidates/:candidateId/select`：`{candidateSha256}`。须下载、UV/PBR/实际字节/hash 检查通过，重新生成独立 package 并切换稳定 `/runs/:id/viewer.html` 映射。故事与已有音轨复用，视觉审查重新待确认。

`GET /api/runs/:id` 提供 `assetCandidates`，含 `id/operationId/status/seed/faceLimit/sha256/errors/active/previewUrl`。`active=false` 的已知任务可恢复；`previewUrl` 指向独立预览，不会切换当前采用版本。原 raw、意图、回执、拒绝下载与历史 package 均保留；key 和上传 token 仅 RAM。

候选默认面数目标 100000、随机固定 seed；`seed` 同时映射 `model_seed/texture_seed`。范围为 seed 0..2147483647、faceLimit 10000..1500000。官方 [图生参数](https://developers.tripo3d.ai/en/docs/generation-image-to-model/standard) 说明同几何 seed/输入会复现网格，v3.1 Standard 三角上限 1500000。面数目标不保证实际输出或视觉质量。图生仍使用原图，`promptApplied=false`，其 prompt 是展示意图，不声称 provider 使用了它。

## 验证与复盘

验证回执：`docs/agent/validation/asset-candidates-r14-result.json`；详细测试：`asset-candidates-r14-vitest.json`。覆盖同 operationId 并发幂等、unknown/已知 task 重启、撕裂状态恢复、候选指纹、隔离预览、预算累计、真实 GLB 哈希、字幕音轨复用和选择失败保留原包。结构验证不认证新的生成效果，真实候选预览仍待接力执行。

本轮产物归为项目 `routing_prior` 与 `no-global-persist`，没有修改全局 memory/skill。一次测试把文件名当作 JSON 内容导致断言失败，已改用真实文件目录证据；未降低工作流门槛。
