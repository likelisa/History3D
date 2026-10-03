"""Version the user-authorized project policy; preserves r10 and all old run evidence."""
from pathlib import Path
import hashlib
import json

repo = Path(__file__).resolve().parent.parent
old = json.loads((repo / 'agent/quality-policy.json').read_text(encoding='utf-8'))
source = repo / 'docs/agent/heritage-quality-r13.md'
policy = dict(old)
policy.update(policyId='heritage-story-quality-r13', subjectTypes=['mural', 'artifact'],
              sourceDocument='../docs/agent/heritage-quality-r13.md', sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),
              supersedes='mural-story-quality-r10 for new runs only',
              goal='故事优先：壁画事件与文物用途、工艺、纹饰及历史，均由原图与真实3D辅助解释。')
policy['publicVoicePolicy'] = {
    'voiceId': 'history3d-public-uncle-fu-r13', 'privateVoiceForbidden': True,
    'publicSyntheticReferenceCloningAllowedWithUserAuthorization': True,
    'referenceSha256': 'f47d4c2e50cdbc2dee165d7cd2415c5e667c9af68863127701344c20b6f73e37',
    'noTrainingInNormalBuild': True, 'noPrivateModelWeightsInDelivery': True,
    'publicWeightsAllowedOnlyInSeparateWhitelistedVoiceEnvironment': True,
}
replacements = {
    'A03': '区分史料支持的事实、他人转述、争议、未知与艺术补全。不能把后来事件并入当事人的经历，也不能用精确肖像、统一服装或猜测器物内部填空；张骞专用反例见保留的r10证据。',
    'B08': '地图与叙事段落连续对应，不因换句重播同一路线；大小地图共用时钟，现代参考路线与历史未知边界明确标为示意。无旅行情节时不强制使用地图。',
    'B10': '固定用户认可的公开合成参考与官方基模，只接受正文的本地声音接口。记录真实克隆方式、模型、参考SHA、正文、字节与时长；禁止私人录音或权重进入公共环境。短试听不替代全篇和专名审核。',
    'C04': '交接包含完整源码、锁文件、实际资产/音轨、许可证、入口、修改与待办、当前验证。源码包排除凭据、私人音声/权重、缓存和venv；用户明确要求的公开声音环境另以白名单打包，含公开基模及运行时。每包记录bytes/SHA并验证安全解压。',
}
for rule in policy['rules']:
    rule['appliesTo'] = ['mural', 'artifact']
    if rule['id'] in replacements:
        rule['requirement'] = replacements[rule['id']]
    if rule['id'] in {'B03', 'B04', 'B05', 'B06'}:
        rule['condition'] = 'only when the generated plan includes corresponding human animation; absence means not applicable, never fabricated pass'
additions = [
    ('A07', '文物信息是provided context；身份、年代、材质、尺寸与馆藏的断言必须有对应原文，未知类别不强行凑齐。'),
    ('A08', '文物主资产使用本次原照片的图生任务，原图、上传、意图、任务、原始GLB可回查；失败不得以文本生成相似器物替代。'),
    ('B12', '照片未覆盖的背面、内部、原色与残损补全明确为生成推断；模型不得标为扫描原件或考古复原定论。'),
    ('B13', '细节讲解绑定真实原图位置和来源；二维锚点不可伪称精确三维热点，展示比例与实测尺寸分开。'),
    ('B14', '逐词字幕与音轨SHA、正文及真实媒体时钟绑定；切句、暂停、倍速、拖动和阅读尾段要实际验证。'),
    ('C05', '新声音环境只含官方源码、干净运行时、公开模型白名单与唯一认可参考；入口拒绝参考/权重/文件路径参数，绑定loopback，不自动复制旧私人环境。'),
    ('D06', '壁画和文物分别实跑并人工核对故事、图生身份与细节；离线fixture只能证明代码路径，不能认证真实历史或生成质量。'),
]
for rule_id, requirement in additions:
    policy['rules'].append({'id': rule_id, 'stage': rule_id[0], 'requirement': requirement,
                            'caseEvidenceRefs': [], 'releaseBlocking': True, 'verificationMode': 'mixed',
                            'defaultRunState': 'pending', 'appliesTo': ['mural', 'artifact'] if rule_id in {'B14', 'C05', 'D06'} else ['artifact']})
destination = repo / 'agent/quality-policy-r13.json'
with destination.open('x', encoding='utf-8') as handle:
    handle.write(json.dumps(policy, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'rules': len(policy['rules']), 'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(), 'certifiesRuns': False}))
