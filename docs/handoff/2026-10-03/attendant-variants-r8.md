# 两名随从的运行时区别

两名随从沿用现有真实 Tripo `yuezhi.glb`。持节者的袍身改为偏灰蓝，携行囊者改为赭褐色，并增加朴素的布包、水囊和背带。角色身高由场景调用方分别归一到 1.72 米、1.66 米；这里不改变人体网格位置，也不重做步行动作。

这些是匿名随从的叙事造型区别，不是已考证的汉使制服或出土行囊复原。原有面部、手、鞋、贴图、UV 和 PBR 材质保留。局部袍身着色采用当前模型的高度及横向范围，不能直接套用到任意新人物模型；新模型需要重新验证染色范围和朝向。

## 集成顺序

```ts
import { prepareAttendantVariant, attachAttendantEquipment } from './attendant-variants.ts'

// body 是已经 clone、落地、按对应 height 归一的模型。
const role = carriesStaff ? 'staff-bearer' : 'pack-carrier'
const sourceYaw = -Math.PI / 3
prepareAttendantVariant(body, role, sourceYaw)
const rig = bindWalkRig(body, height, 'human', carriesStaff, sourceYaw)
attachAttendantEquipment(body, rig, role)
```

必须先准备袍身区别，再绑定真实身体，最后挂行囊。`bindWalkRig` 会遍历所有网格并采样鞋底，所以不能先加行囊再绑定，也不能在挂接后重新绑定。行囊挂在 `walk-pelvis` 下，不进入身体的蒙皮网格或鞋底采样。持节者的旌节仍由场景现有逻辑挂到右手骨；这个 helper 不添加或移动旌节。

共享模板的几何和材质均在修改前克隆，贴图对象只读共享，不修改源 GLB。角色间身高、站位、节杖和行囊的最终画面仍需在浏览器人工验收。

## 已实际验证

`npm run typecheck` 出口 0。`npx vitest run tests/mural-attendant-variants.test.ts` 实际 4 项通过，读取原始 `yuezhi.glb`，SHA256 为 `5051979679573bec5b1c4805480698de04654dea3d2ba221c708223e795411fa`。

- 共享模板、几何坐标、UV、PBR 贴图引用不被修改；两种角色的袍身颜色属性不同。
- 当前模型的头部、手部、腿靴样本保持原色乘数。
- 行囊只挂腰骨；装饰前后完整一圈步态的身体状态、手臂和鞋底位置一致。
- 拒绝重复染色、绑定后再准备、角色不匹配和重复挂接。

Node 测试不渲染贴图，使用对应材质的只读贴图引用验证克隆行为；它不代替浏览器里观察肤色、袍身颜色、包体遮挡、人物轮廓和运动效果。

项目分类：`no_persist`；不会修改全局 memory、skill 或人物原始资产。
