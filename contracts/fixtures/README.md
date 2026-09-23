# 固定测试样例

这些样例只用于验证技术能力，**不构成历史核验**。

| 路径 | 作用 | 期望结果 |
| --- | --- | --- |
| `valid/minimal/` | 最小有效场景包：1 个资产、1 个对象实例、3 个故事点 | `validateScenePackage` 无 error |
| `invalid/*` | 五个定向失败样例 | 每个样例报出下方表格指定的 code |
| `collection/silk-road-demo/` | 采集层资料包样例（`validate:collection` 的默认输入） | `validateCollection` 无 error |
| `glb/unit-cube.glb`、`glb/pack-bundle.glb` | 米制基准 GLB，1 米与 1.2 × 0.8 × 0.6 米 | 三轴包围盒与声明一致 |

## 失败样例与期望诊断

由 `scripts/make-invalid-fixtures.mjs` 从 `valid/minimal/` 派生。修改派生逻辑需在 PR 说明原因；**不得为了让检查通过而删掉某个样例**。

| 目录 | 注入的问题 | 期望 code |
| --- | --- | --- |
| `invalid/schema-unsupported/` | `story.json` 的 `schemaVersion` 为 `0.2.0` | `SCHEMA_UNSUPPORTED` |
| `invalid/unknown-field/` | `story.json` 多出未声明字段 `draftNotes` | `VALIDATION_FAILED` |
| `invalid/revision-mismatch/` | `scene.json` 的 `contentRevision` 与资料不一致 | `REVISION_MISMATCH` |
| `invalid/missing-reference/` | 故事点引用了不存在的判断 ID | `REFERENCE_MISSING` |
| `invalid/missing-asset/` | `scene.json` 声明的 GLB 文件不存在 | `REFERENCE_MISSING` |

两个运行期失败样例不落盘，由手测覆盖：

- 删除已过检场景包中的主模型 → 页面进入 `ASSET_LOAD_FAILED`，不静默降级成灰盒。
- 断网 → 外部原文不可访问时显示本地摘要与链接，场景本身不阻塞（`SOURCE_OFFLINE`）。
