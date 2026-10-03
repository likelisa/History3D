"""Rebuild the static asset-board inventory from the actual cinema definitions.

Run with Python 3: python scripts/build-asset-board-r8.py
Then render thumbnails with Blender and run this script again to bind PNG hashes.
No generation APIs or model files are modified.
"""
from pathlib import Path
import hashlib, json, re, struct

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'viewer/public'
OUT = PUBLIC / 'asset-board-r8'
OUT.mkdir(parents=True, exist_ok=True)

def read(rel):
    return json.loads((PUBLIC / rel.lstrip('/')).read_text(encoding='utf-8'))

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def local(path):
    target=(PUBLIC/path.lstrip('/')).resolve()
    if not target.is_relative_to(PUBLIC.resolve()) or not target.is_file():
        raise ValueError('Missing or non-public asset: '+path)
    return target

def stats(path):
    raw=path.read_bytes()
    magic,version,length=struct.unpack_from('<III',raw)
    if magic!=0x46546c67 or version!=2 or length!=len(raw):
        raise ValueError('Invalid GLB '+str(path))
    size,kind=struct.unpack_from('<II',raw,12)
    if kind!=0x4e4f534a:raise ValueError('Missing JSON chunk')
    doc=json.loads(raw[20:20+size])
    if any(item.get('uri','') and not item['uri'].startswith('data:') for item in doc.get('images',[])+doc.get('buffers',[])):
        raise ValueError('External GLB resource '+str(path))
    triangles=0
    for mesh in doc.get('meshes',[]):
        for prim in mesh.get('primitives',[]):
            count=doc['accessors'][prim.get('indices',prim['attributes']['POSITION'])]['count']
            mode=prim.get('mode',4)
            triangles+=count//3 if mode==4 else max(0,count-2) if mode in (5,6) else 0
    return {'triangles':triangles,'meshes':len(doc.get('meshes',[])),
            'materials':len(doc.get('materials',[])),'images':len(doc.get('images',[])),
            'normalMappedMaterials':sum('normalTexture' in m for m in doc.get('materials',[])),
            'animations':len(doc.get('animations',[]))}

config={
 'envoy':('张骞 · 独立汉使人物','Tripo v3.1详细文字生成 / Blender比例与前轴校准','/mural-assets/tripo-story-r9/normalized-manifest.json','1.75米张骞，汉使出发、扣留、西行、接见与贸易见闻','汉使身份与经历有记载；约42岁、瘦高长脸、红袍和帽为辨人艺术设定，不是确证肖像或统一汉使制服。','P1 · 实看人物步态、袍摆与手脚；静态模型通过不等于动作验收。','tripo','/mural.html'),
 'ganfu':('甘父 · 独立远行伙伴','Tripo v3.1详细文字生成 / Blender比例与前轴校准','/mural-assets/tripo-story-r9/normalized-manifest.json','1.69米甘父，同行、帮助西行、十三年后归汉；携囊是可拆运行时附件','史书记胡人、善射和同行，不据此认定匈奴族属。方脸、壮实体型、短赭袍与年龄为艺术设定；善射不以人物融合弓箭表示。','P1 · 实看脚尖中和与两腿步态，保留短袍、空手和清楚轮廓。','tripo','/mural.html'),
 'visitor':('大夏商旅 · 保留旧人物','既有Tripo文字生成 / 匿名配角再利用','/yuezhi/figures/manifest.json','市场中的匿名商旅，复用先前envoy基础GLB，不作为本轮新生成张骞','面貌与服装为示意；不认定具体商人、民族或服装实制。缩略图保留原人物渲染，旧张骞卡片作为过程证据归档。','P2 · 配角服务市场交流，避免与新的张骞、甘父混淆。','tripo','/mural.html'),
 'attendant':('匿名持节随从 · 灰蓝袍','Tripo文字生成 / 运行时灰蓝袍与独立持节道具','/yuezhi/figures/manifest.json','行进使团中1.72米灰蓝袍持节者；接见与市场中的匿名人物保持匿名','缩略图展示基础GLB；灰蓝袍色与持节道具在运行时添加。按用户最新选择，细竹杖作为持节道具杖身的艺术载体，不据此认定汉节材质或器制。匿名身份、服色和配件为叙事示意，不是考证的汉使制服。甘父已有独立资产，不再描述同模双随从。','P1 · 保持持节语义、细杖握持与手臂固定；其他接见者和市场人物不全局认定为甘父。','tripo','/mural.html'),
 'qiong-bamboo':('细竹杖 · 市场货物与持节道具杖身','Tripo v3.1详细文字生成 / Blender竹杖比例校准','/mural-assets/tripo-story-r9/normalized-manifest.json','大夏市场中来自蜀地的货物；同一GLB按用户最新选择复用为行进与接见中的持节道具杖身','《史记》记邛竹杖、蜀布及从身毒购得的转述，也记持汉节；这两项记载不证明两者器制相同。竹质杖身作为持节道具的艺术载体，不是汉节考古复原。1.55米、3.2厘米横径和具体竹节为本地校准的艺术示意，不称武器或蛇杖。','P1 · 保留竹节、纤维和连续细杆；实看握持与货物近景，不表示张骞亲至身毒。','tripo','/mural.html'),
 'horse':('壁画马匹','Tripo文字生成 / 第323窟马形与矿物色意象','/mural-assets/manifest.json','辞行、西行与资产展示','艺术化转译初唐壁画，不是汉代马具的考古复原。','P1 · 镜头里避开马遮住主角与汉节；补马具近景。','tripo','/mural.html'),
 'gate':('现用城门 · Tripo B','Tripo提示词A/B试验，精细提示词B','/tripo-prompt-lab/results.json','后世壁画的抵城转译','参考第323窟的小城轮廓；不是已确认的汉代大夏城门复原。','P2 · 看通道和前后厚度，再处理城门与地面的衔接。','tripo','/tripo-lab.html'),
 'monk':('壁画僧人','Tripo文字生成 / 第323窟人物解读','/mural-assets/monk-provenance.json','故事结束后的初唐壁画改写说明','用于解释初唐画中情节；不证明首次出使时张骞见僧问佛。','P2 · 接迎全身朝向自然；服装细节服务原画的理解。','tripo','/mural.html'),
 'tower':('壁画佛塔','Tripo文字生成 / 第323窟建筑解读','/mural-assets/tower-provenance.json','后世壁画中的佛教叙事','仅作初唐壁画空间转译；塔的隐蔽面和尺度属于推演。','P1 · 优先细化塔层、基座、邻近建筑与空间比例。','tripo','/mural.html'),
 'xiongnu':('匈奴看守 · 基础人物','Tripo文字生成 / 多源服饰参考 / 项目变体','/yuezhi/figures/xiongnu-manifest.json','扣留场景的匿名看守','参考帽、袍、靴、带饰等跨时地材料；不是统一军服、真实肖像或确定穿搭。','P1 · 对比两个看守变体与使团身份，修正近景遮挡。','tripo','/yuezhi.html'),
 'reception-court':('月氏接见前院','Blender程序搭建 / 内嵌PBR细化','/mural-assets/reception-court-manifest.json','主客交涉、求盟未成','史书未详载接见建筑和礼仪；围合院落与棚毯是空间示意，不是成功会盟场。','P1 · 接见补光与主客中景；人物表意比增加装饰优先。','authored','/mural.html'),
 'market':('大夏市场场景','Blender程序搭建 / 材质细化 / 运行时货物补充','/yuezhi/sets/refined-manifest.json','贸易见闻与蜀物问题','史书提供城邑、市场和物产线索；摊位具体形状、交易动作属于展示推演。','P1 · 蜀布与邛竹杖可辨，配角动作围绕交换。','authored','/mural.html'),
 'environment':('河谷环境与植被','Blender地形组合 / 内嵌PBR / 既有植被资产','/yuezhi/environment-refined-manifest.json','行路、扣留和月氏/大夏的展示底景','地形、河流与植被为情境示意，不是张骞路线实测地貌。','P2 · 降低重复地面纹理、改善远山比例与空天占比。','authored','/mural.html'),
 'detention-camp':('匈奴扣留营地','Blender程序搭建 / 内嵌PBR / 帐绳器物细化','/mural-assets/detention-camp-manifest.json','扣留十余年，使命未忘','张骞被留的史实有记载；营地布局、帐篷及守卫站位未经考古确认。','P1 · 用张骞与看守中景讲清受阻；不以随机路人制造热闹。','authored','/mural.html'),
 'departure-outpost':('汉使出发关口','Blender程序搭建 / 出发空间与道路细化','/mural-assets/departure-outpost-r8-manifest.json','求盟出发，为西行故事建立汉使身份与任务','史书提供出使使命；关口、道路和建筑具体形态为叙事空间示意，不是汉代遗址实测复原。','P1 · 出发镜头讲清张骞、持节随从和西行方向，保留人物腿脚与装备可见。','authored','/mural.html'),
}
base=read('/mural-assets/manifest.json');supp=read('/mural-assets/scene-assets-r4.json')
results=read('/tripo-prompt-lab/results.json');experiment=read('/tripo-prompt-lab/experiment.json')
records={a['id']:a for a in base['assets']+supp['assets']}
departure=read('/mural-assets/departure-outpost-r8-manifest.json')['asset']
if departure['id']!='departure-outpost' or departure['path']!='/mural-assets/departure-outpost-r8.glb':
    raise ValueError('Departure source record identity changed; review board description')
records[departure['id']]=departure
generated={a['id']:a for a in results['cases']}
records['gate']=dict(generated['gate-b'],id='gate')
story_raw=read('/mural-assets/tripo-story-r9/manifest.json')
story_normalized=read('/mural-assets/tripo-story-r9/normalized-manifest.json')
story_raw_records={a['id']:a for a in story_raw['assets']}
story_assets={a['id']:a for a in story_normalized['assets']}
if set(story_assets)!={'zhangqian','ganfu','qiong-bamboo'} or len(story_assets)!=len(story_normalized['assets']):
    raise ValueError('Story r9 must contain exactly three independent normalized assets')
old_envoy=dict(records['envoy'])
records['visitor']=dict(old_envoy,id='visitor')
for source_id,cinema_id in [('zhangqian','envoy'),('ganfu','ganfu'),('qiong-bamboo','qiong-bamboo')]:
    normalized=story_assets[source_id];raw=story_raw_records[source_id]
    if normalized['rawSha256']!=raw['sha256'] or sha(local(raw['path']))!=raw['sha256']:
        raise ValueError('Story r9 raw provenance mismatch: '+source_id)
    if normalized['frontAxis']!='+Z' or normalized['taskId']!=raw['taskId']:
        raise ValueError('Story r9 normalized identity/orientation mismatch: '+source_id)
    records[cinema_id]=dict(normalized,id=cinema_id)
source=ROOT/'viewer/src/mural/cinema-world.ts'
definitions=re.search(r'const definitions=\[(.*?)\n \]',source.read_text(encoding='utf-8'),re.S)
if not definitions:raise ValueError('Unable to locate actual cinema definitions')
pairs=re.findall(r"\{id:'([^']+)',url:'([^']+)'",definitions.group(1))
if len(pairs)!=len(config) or len(set(x for x,_ in pairs))!=len(pairs) or set(x for x,_ in pairs)!=set(config):
    raise ValueError('Current cinema definitions changed; review board descriptions')

# Preserve the pre-r9 board and the original envoy render before replacing its
# thumbnail. The unchanged old GLB is now the anonymous visitor asset.
inventory_file=OUT/'inventory.json'
if inventory_file.is_file():
    old_inventory=json.loads(inventory_file.read_text(encoding='utf-8'))
    if 'staff' not in dict(pairs) and any(row['id']=='staff' and row['group']=='current' for row in old_inventory['assets']):
        for filename in ['inventory.json','thumbnail-jobs.json','thumbnail-provenance.json']:
            source_file=OUT/filename
            backup=OUT/(Path(filename).stem+'-pre-slender-credential-r9.json')
            if source_file.is_file() and not backup.exists():
                with backup.open('xb') as handle:handle.write(source_file.read_bytes())
    if old_inventory['counts']['current']<len(pairs):
        for filename in ['inventory.json','thumbnail-jobs.json','thumbnail-provenance.json']:
            source_file=OUT/filename
            backup=OUT/(Path(filename).stem+'-pre-tripo-r9.json')
            if source_file.is_file() and not backup.exists():
                with backup.open('xb') as handle:handle.write(source_file.read_bytes())
old_thumb=OUT/'thumbs/envoy-pre-tripo-r9.png'
visitor_thumb=OUT/'thumbs/visitor.png'
if not old_thumb.is_file():
    prior=OUT/'thumbs/envoy.png'
    if not prior.is_file():raise ValueError('Original envoy thumbnail required for audited visitor reuse')
    with old_thumb.open('xb') as handle:handle.write(prior.read_bytes())
if not visitor_thumb.is_file():
    with visitor_thumb.open('xb') as handle:handle.write(old_thumb.read_bytes())
if sha(visitor_thumb)!=sha(old_thumb):raise ValueError('Visitor thumbnail differs from preserved original envoy render')
provenance_file=OUT/'thumbnail-provenance.json'
if provenance_file.is_file():
    provenance=json.loads(provenance_file.read_text(encoding='utf-8'))
    provenance_changed=False
    if not any(p['id']=='visitor' for p in provenance):
        original=next((p for p in provenance if p['id']=='envoy' and p['glbSha256']==old_envoy['sha256']),None)
        if original is None:raise ValueError('Original envoy thumbnail provenance required')
        provenance.append(dict(original,id='visitor',thumbnail='/asset-board-r8/thumbs/visitor.png',
                               thumbnailSha256=sha(visitor_thumb),reuse='original envoy render preserved; no new render',
                               originalThumbnail='/asset-board-r8/thumbs/envoy-pre-tripo-r9.png'))
        provenance_changed=True
    if not any(p['id']=='staff-b' for p in provenance):
        original=next((p for p in provenance if p['id']=='staff' and p['glbSha256']==generated['staff-b']['sha256']),None)
        if original is None:raise ValueError('Original staff-b thumbnail provenance required')
        staff_thumb=local(original['thumbnail'])
        if sha(staff_thumb)!=original['thumbnailSha256']:raise ValueError('Original staff-b thumbnail hash mismatch')
        provenance[provenance.index(original)]=dict(original,id='staff-b',
            reuse='original current staff-b render retained for A/B only; no new render',
            originalThumbnail=original['thumbnail'],previousCurrentUseId='staff',supersededBy='qiong-bamboo')
        provenance_changed=True
    if provenance_changed:
        provenance_file.write_text(json.dumps(provenance,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

def entry(item,path,record,group,title=None,desc=None):
    file=local(path);digest=sha(file);size=file.stat().st_size
    if digest!=record['sha256'] or size!=record['bytes']:raise ValueError('SHA/size mismatch: '+item)
    c=config.get(item)
    thumb='/asset-board-r8/thumbs/'+item+'.png'
    thumbFile=PUBLIC/thumb.lstrip('/')
    row={'id':item,'title':title or c[0],'group':group,'path':path,'bytes':size,'sha256':digest,'stats':stats(file),'thumbnail':thumb,
         'source':c[1] if c else 'Tripo提示词A/B / 保留真实生成结果','sourceRecord':c[2] if c else '/tripo-prompt-lab/results.json',
         'use':c[3] if c else '独立对照试验','boundary':c[4] if c else '艺术化示意。单seed试验不能证明提示词稳定优越，也不证明历史真实性。',
         'priority':c[5] if c else 'P2 · 在同灯光与比例下查看几何、PBR和结构，再决定是否替换。',
         'origin':c[6] if c else 'tripo','viewer':c[7] if c else '/tripo-lab.html','integrity':'文件大小与SHA-256已核对',
         'status':'现用 / 已整合' if group=='current' else '已生成 / 对照保留'}
    if desc:row.update(desc)
    thumbFile=PUBLIC/row['thumbnail'].lstrip('/')
    if thumbFile.exists():row['thumbnailSha256']=sha(thumbFile)
    if record.get('taskId'):row['taskId']=record['taskId']
    if item in ('envoy','ganfu','qiong-bamboo'):
        row.update({'generationRecord':'/mural-assets/tripo-story-r9/manifest.json',
                    'planRecord':'/mural-assets/tripo-story-r9/plan.json',
                    'rawPath':record['rawPath'],'rawSha256':record['rawSha256'],
                    'creditsConsumed':record['creditsConsumed'],'heightMeters':record['heightMeters'],
                    'frontAxis':record['frontAxis'],'editableBlend':record['editableBlend'],
                    'reviewBlend':record['reviewBlend'],'reviewViews':record['views'],
                    'animationStatus':record['animationStatus']})
        if 'diameterMeters' in record:row['diameterMeters']=record['diameterMeters']
    return row

rows=[entry(item,path,records[item],'current') for item,path in pairs]
for case in experiment['cases']:
    r=generated[case['id']]
    title=case['title']+' · '+case['variant']+' / '+case['label']
    used=case['id']=='gate-b'
    desc={'status':'已生成 / 同文件已用于故事' if used else '已生成 / 对照保留',
          'prompt':case['request']['prompt'],'criteria':case['criteria'],'currentUseId':case['asset'] if used else None,
          'thumbnail':'/asset-board-r8/thumbs/'+(case['asset'] if used else 'staff' if case['id']=='staff-b' else case['id'])+'.png'}
    if case['id']=='staff-b':
        desc.update({'use':'独立A/B对照保留；现用持节道具杖身已按用户选择改用r9细竹杖',
                     'boundary':'普通木杖艺术示意，现已停用于故事；原GLB和缩略图保留供A/B比较。史书可证持汉节，不能以该生成外观认定具体形制。'})
    rows.append(entry(case['id'],r['path'],r,'experiment',title,desc))
trial=read('/mural-assets/zhangqian-mural-trial/provenance.json');review=read('/mural-assets/zhangqian-mural-trial/visual-review.json')
rows.append(entry('zhangqian-trial',trial['path'],trial,'rejected','壁画张骞 · 未通过的人物试验',{
    'source':'Tripo图生3D / 初唐壁画62×147原生像素局部',
    'sourceRecord':'/mural-assets/zhangqian-mural-trial/provenance.json','viewer':'/zhangqian-mural-trial.html',
    'use':'保留独立试验；未替换现用张骞','status':'生成成功 / 人物验收未通过',
    'boundary':'壁画残损与相邻人物被带入薄浮雕形体，面部、手臂和跪姿不完整。图源放大没有补回细节。',
    'priority':'P1 · 先审清晰参照或概念形象，再评估新试验；当前不提交收费任务。',
    'reviewRecord':'/mural-assets/zhangqian-mural-trial/visual-review.json','reference':'/mural-assets/zhangqian-mural-trial/reference-native.png',
    'sourceUrl':trial['source']['url'],'rejectionStatus':review['status']}))
paths={row['path'] for row in rows}
counts={'current':sum(row['group']=='current' for row in rows),'experiments':sum(row['group']=='experiment' for row in rows),
        'rejected':sum(row['group']=='rejected' for row in rows),'uniqueGLBs':len(paths)}
if counts['current']!=len(pairs) or counts['experiments']!=len(experiment['cases']) or counts['rejected']!=1:
    raise ValueError('Dynamic board count mismatch')
index={'schema':'history3d.asset-board.v1','date':'2026-10-03','counts':counts,
       'scope':f"现用以cinema-world.ts的{len(pairs)}个GLB定义为准；张骞、甘父、细竹杖是本轮三个独立Tripo资产，旧envoy复用为匿名visitor。细竹杖用于市场货物，并按用户最新选择作为持节道具杖身的艺术载体；不表示汉节与大夏邛竹杖器制相同。A/B仅gate-b与故事共用原文件，staff-b对照保留；运行时服色、器物与动画不重复计为独立GLB。",
       'sources':[{'path':'viewer/src/mural/cinema-world.ts','sha256':sha(source)},
                  {'path':'viewer/src/mural/attendant-variants.ts','sha256':sha(ROOT/'viewer/src/mural/attendant-variants.ts')},
                  *[{'path':'viewer/public'+p,'sha256':sha(local(p))} for p in ['/mural-assets/manifest.json','/mural-assets/scene-assets-r4.json','/mural-assets/departure-outpost-r8-manifest.json','/tripo-prompt-lab/results.json','/tripo-prompt-lab/experiment.json','/mural-assets/zhangqian-mural-trial/provenance.json','/mural-assets/zhangqian-mural-trial/visual-review.json','/mural-assets/tripo-story-r9/manifest.json','/mural-assets/tripo-story-r9/normalized-manifest.json','/mural-assets/tripo-story-r9/plan.json']]],
       'thumbnailMethod':'本地Blender导入同一GLB，仅居中、显示归一化、设置正交相机与柔和灯光后渲染；不改GLB。每资产独立取景，不用于A/B同比例结论。',
       'assets':rows}
(OUT/'inventory.json').write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
jobs=[]
for row in rows:
    if row.get('currentUseId'):continue
    jobs.append({'id':row['id'],'path':row['path'],'sha256':row['sha256'],'thumbnail':row['thumbnail']})
(OUT/'thumbnail-jobs.json').write_text(json.dumps(jobs,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({**counts,'renderJobs':len(jobs),'thumbnailsPresent':sum((PUBLIC/j['thumbnail'].lstrip('/')).is_file() for j in jobs)},ensure_ascii=False))
