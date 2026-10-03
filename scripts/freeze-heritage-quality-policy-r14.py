"""Create a new project policy; never overwrite an old policy or run."""
from pathlib import Path
import hashlib
import json

repo = Path(__file__).resolve().parent.parent
source = repo / 'docs/agent/workflow-lessons-r14.md'
policy = json.loads((repo / 'agent/quality-policy-r13.json').read_text(encoding='utf-8'))
policy.update(policyId='heritage-story-quality-r14', sourceDocument='../docs/agent/workflow-lessons-r14.md',
              sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(), supersedes='r13 for new runs; old frozen runs stay unchanged')
policy['runtimeGenerationPolicy'] = {'automaticAfterValidatedPlan': True, 'perAssetCostConfirmation': False,
    'qualityBeforeCreditSaving': True, 'unknownPostMustBeReconciled': True, 'humanQualityApprovalIsSeparate': True,
    'authority': 'User explicit instructions on 2026-10-03: 自动生成、效果优先、不逐笔请示'}
additions = [
    ('A09', '旁白可改写，evidence.quote逐字复制连续原文；已知合同失败仅一次绑定候选SHA的明确修正，保存首候选与新意图/响应。未知请求不可重投；成功候选快照中断时本地恢复并验证绑定。'),
    ('A10', '讲解先明确对象、背景、关键变化和结果，再插入图像/3D细节；出处与精确引文放证据栏，不机械念来源，不让工程说明喧宾夺主，不把造型解释当匠人个人心理实证。'),
    ('C06', '实际校验媒体后允许同源blob音频与内嵌纹理，外网不开放。捕获Three吞掉的纹理错误，缺纹理/音轨停止；灰白模型或静音不能替代成功。'),
    ('C07', '网页提交后自动推进合格计划的详细几何/PBR资产、公开旁白与网页；不逐件收费请示、不伪称人工批准。只读余额失败尚无资产意图可恢复；忽略旧状态响应，不让新进度倒退。'),
    ('C08', 'Windows Node接入复用现有系统代理，仅改变子进程环境并保留本地直连与TLS验证。网络错误不能当额度不足；错误诊断不输出key、鉴权、响应全文或签名URL。'),
]
for rule_id, requirement in additions:
    policy['rules'].append({'id': rule_id, 'stage': rule_id[0], 'requirement': requirement, 'caseEvidenceRefs': [],
        'releaseBlocking': True, 'verificationMode': 'mixed', 'defaultRunState': 'pending', 'appliesTo': ['mural', 'artifact']})
destination = repo / 'agent/quality-policy-r14.json'
with destination.open('x', encoding='utf-8') as handle:
    handle.write(json.dumps(policy, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'rules': len(policy['rules']), 'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(), 'certifiesRuns': False}))
