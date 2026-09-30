# 张骞使月氏 · 空间故事首版

基线：dev `66e7a83`；实现分支 `feature/yuezhi-experience`。

## 运行

使用 Node 20+。本机已有 Node 22，系统默认 Node 16 不满足项目运行要求：

```sh
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run yuezhi:dev
```

打开 `http://127.0.0.1:5191/yuezhi.html`。日常启动只重新编排已有资产，不调用 Tripo。

## 用户体验

1. 第一幕说明汉廷目标与抵达过程，支持原文与路线顺序查看。
2. 第二幕可以点击或走近“安居生活、遥远汉朝、共同旧敌”三条线索；展开原文，观察空间，提出自己的判断。
3. 无论用户判断如何，第三幕均呈现史书“未得要领”的结果，再解释张骞带回的见闻。自由探索不设找齐线索的强制门槛。

全景支持拖动、缩放；人尺度漫游提供 WASD、鼠标锁定以及按钮步进。讲述面板可收起；语音朗读使用浏览器系统 TTS，默认关闭。故事章节与已看线索按本故事版本保存在本机浏览器；“重新开始”清除此体验进度。

## 内容与资产

事件叙述与来源在正式 `packages/zhang-qian-yuezhi/story.json`、`sources.json`；空间和对象在 `scene.json`。`narrative.json` 保存三幕及探索线索，资产来源与 SHA-256 在 `asset-provenance.json`。

新增页面复用本仓库 contracts 校验、米制数据和 Walker。浏览器先验证同版包，再下载四件 GLB、逐件核对 SHA-256 后渲染。原正式查看器也可读取本包：`/?story=zhang-qian-yuezhi`，但三幕引导在新页面。

使者与月氏一侧人物各完成一笔真实 Tripo text-to-model，合计40点，原始GLB与provider状态保存在忽略Git的 `.processing-data/yuezhi-tripo/`。Blender 5.2 LTS校准1.7米、脚底与朝向，并将贴图缩至1024。人物相貌、服饰、月氏人物身份与会见布局为制作示意。汉节持有有文字记载，杆状外形仍是示意。

环境由 Blender 脚本与自然模块组成，来源／许可与可编辑 `.blend` 在 `viewer/public/yuezhi/`。`scripts/build-yuezhi-package.ts` 将各资产底部中心归零，写入同版故事包；每次加工后运行 `npm run yuezhi:prepare`。

## 边界

史料来自古籍数字转录，未做影印底本校勘或最终史料负责人批准。本包保留 `draft`。月氏继位者的太子／夫人异文不在画面中裁定；没有编造完整谈判对白或将生成形貌当作历史证据。

当前以静态人物、空间探索和镜头推进讲述。未实现人物口型、骨骼行走、角色专属四视角、多人账户或公网发布。已有角色可重复实例化，但场景人物数量是制作设定。
