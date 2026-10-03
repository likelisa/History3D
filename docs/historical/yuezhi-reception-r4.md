# 月氏接见空间与人物：证据和制作边界

更新触发：用户指出旧门廊前站着三个人不像正式接见，两名匈奴人物同款同姿。旧接见资产保留给原绘本，但壁画补充镜头不再采用它。此段是张骞求盟未成，不是成功缔约的会盟仪式。

## 实际阅读的史料

1. [《史记》卷123《大宛列传》](https://zh.wikisource.org/wiki/史記/卷123)：大月氏“遂都妫水北，为王庭”；张骞到达时“地肥饶，少寇，志安乐……殊无报胡之心”，“竟不能得月氏要领”。可支持王庭语境与外交结果，不能支持具体宫殿平面、服装或接见礼仪。
2. [《汉书·西域传》](https://ctext.org/han-shu/xi-yu-zhuan/zh)：记“大月氏本行国也，随畜移徙，与匈奴同俗”，迁徙后“都妫水北为王庭”；另载“治监氏城”。后者不能直接当成张骞首次出使时确证的会面地址，不能把本传所述后续地理统计全部倒推到同一年。
3. [《汉书·张骞李广利传》](https://ctext.org/han-shu/zhang-qian-li-guang-li-zhuan/zh)：记“传诣单于”“留骞十余岁……然骞持汉节不失”；记大宛提供“译道”、康居传致大月氏、求盟未成。使者和接待方有明确外交关系，不能变成无身份路人闲谈。
4. Laurianne Sève，*Ai Khanoum after 145 BC: The Post-Palatial Occupation*，Ancient Civilizations from Scythia to Siberia 24 (2018), 354–419，[实际可读的作者摘要页](https://www.researchgate.net/publication/333071989_Ai_Khanoum_after_145_BC_The_Post-Palatial_Occupation)，DOI 10.1163/15700577-12341336。摘要明确该城约前145年遭破坏，随后为后宫殿时期。只读了摘要，未获得论文全文。它用于排除“把运行中的阿伊哈努姆宫殿直接画成张骞会面地点”的做法，不用于证明新场景的具体平面。

注意版本差异：本次阅读的《史记》文本为“立其太子为王”，《汉书·张骞李广利传》为“立其夫人为王”。画面中的主位人物称“月氏接待方示意”，不用现有男性模型断定真实统治者的性别和肖像。CTP页面的自动英文翻译不作依据，以中文原文为准。

## 本轮采用的场景

制作正式接见的空间示意：有围合前院、等候区、宽幅织物顶棚、清晰的主位与来使位置、随行传译及少量侍从。木构、夯土/泥砖、毡织物与朴素器皿是制作材料选择；这套组合、尺度、低台和席位都没有本事件的直接证据。不会标为考古复原，不设置盟约签字、握手、歃血等史料未载的成功缔约动作。

人物只复用已有Tripo资产，并由项目作者做局部服饰和站姿差异。两个匈奴人物是匿名营地守卫示意，不能被读成两名已知历史人物或统一制服。其帽、衣、靴及带扣原型的交叉来源在原人物manifest及来源清单内，年代和阶层差异不能抹去。

## 可复核证据

原始网页正文、检索结果和访问失败留在父任务 `outputs/mural-clarity/reception-primary-web-r4*.json`、`reception-research-r5.json`、`reception-research-r6.json`。Brill、Cambridge和Wikipedia访问失败不算已读正文；Bing后续出现验证码不算检索成功，未绕过。

新布景由 `scripts/build-mural-reception-set.py` 原创生成，使用已核验的Blender 4.5.14和作者自制的512px PBR栅格，GLB嵌入baseColor/normal/roughness贴图。运行清单和SHA绑定在 `viewer/public/mural-assets/reception-court-manifest.json`；原资产不覆盖，不新增收费Tripo任务。
