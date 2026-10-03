const $ = (id) => document.getElementById(id);
const state = { run: null, imageDataUrl: '', imageSequence: 0, sourceSeq: 0, pollTimer: null, refreshSequence: 0, busy: false, updateAt: null, recoveredId: null, candidateRequest: null };
const statusLabels = { planning: '规划中', story_review: '等待故事审核', generating: 'Tripo 生成中', assembling: '整合网页中', preview_ready: '预览已就绪，待视觉审核', visual_reviewed: '已记录视觉审核', failed: '任务失败', recoverable: '需要恢复凭据', unknown: '提交结果未知' };
const kindLabels = { documented: '原文支持', inferred: '推断', illustrative: '艺术补充', human: '人物', prop: '道具', environment: '环境' };
const relationLabels = { depicted: '原图可见', 'context-only': '原图仅作背景', 'not-depicted': '原图未展示' };
const focusLabels = { identity: '器物整体', use: '用途', craft: '工艺', motif: '纹饰', history: '历史故事', condition: '保存状态' };
const metadataFields = ['name', 'period', 'material', 'dimensions', 'collection'];
let budgetEdited = false;
const assetStatusLabels = { pending: '待提交', submitting: '已记录提交，等待 task ID', task_known: '已知 task，等待结果', ready: '实际 GLB 已通过检查', failed: '生成失败', unknown: '提交结果未知' };
const activeStatuses = new Set(['planning', 'generating', 'assembling']);
const errorLabels = {
  API_KEY_REQUIRED: '请填写模型与 Tripo 的有效 API Key。',
  MODEL_BASE_URL_INVALID: '请填写有效的模型 API 地址。',
  MODEL_HTTP_REQUIRES_LOOPBACK: '远程模型 API 地址需要使用 HTTPS。',
  PNG_JPEG_DATA_URL_REQUIRED: '请使用不超过 8 MB 的 PNG 或 JPG 原图。',
  SUBJECT_TYPE_INVALID: '请选择壁画或文物素材类型。',
  SOURCE_REFERENCE_UNKNOWN_OR_EMPTY: '计划引用了未知或空的史料，请核查来源。',
  EVIDENCE_QUOTE_NOT_IN_PROVIDED_EXCERPT: '模型引用未能与提供的原文摘录匹配，计划未通过。',
  BUDGET_REJECTED: '计划超过预算上限，请调整主题或预算后重新规划。',
  PLAN_HASH_MISMATCH: '计划版本已经改变，请重新读取并审核当前计划。',
  CANDIDATE_HASH_MISMATCH: '待修正候选已改变，请刷新并核对当前版本。',
  CREDENTIALS_REQUIRED: '本地服务需要重新填写凭据。',
  RUN_NOT_FOUND: '没有找到这个项目，请核对项目 ID。',
  UNKNOWN_SUBMISSION: '提交结果未知。请先刷新状态，避免重复收费提交。'
};
const eventLabels = { created: '项目已创建', planning_submitted: '已提交模型规划', model_submission_intent: '已记录模型规划提交', model_receipt: '已收到模型规划响应', story_review_required: '等待人工审核故事与资产计划', story_approved_generation_requested: '当前计划已确认，开始生成或恢复任务', asset_submission_intent: '已记录资产提交', asset_task_known: '已收到 Tripo task ID', asset_validated: '实际 GLB 已通过结构检查', assembling: '正在整合场景、旁白与字幕文件', preview_ready: '网页预览已就绪', restored_without_network: '从文件恢复项目，未调用上游', credentials_restored_in_memory: '凭据已恢复到进程内存', stopped: '任务已停止', visual_review_approved: '已记录人工视觉审核', visual_review_changes_requested: '人工视觉审核请求修改' };
Object.assign(eventLabels, { automatic_generation_requested: '按配置自动开始制作', generation_stop_boundary_updated: '已更新生成停止边界', artifact_image_upload_started: '正在上传文物原图', artifact_image_uploaded: '文物原图上传完成', narration_generation_started: '正在制作固定公开旁白', narration_generated_pending_review: '旁白与字幕文件检查通过', asset_candidate_requested: '开始打磨新候选', asset_candidate_submission_intent: '已记录候选提交', asset_candidate_task_known: '候选任务已受理', asset_candidate_preview_ready: '候选网页可以预览', asset_candidate_ready_for_selection: '新候选已完成，可比较选用', asset_candidate_selected: '已选用新候选', asset_candidate_stopped: '候选任务已暂停，请查看原因' });

function node(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = String(content);
  return element;
}
function cleanMessage(value) {
  let text = typeof value === 'string' ? value : '本地服务未完成请求，请刷新状态查看。';
  for (const id of ['model-key', 'tripo-key']) {
    const secret = $(id).value;
    if (secret.length >= 8) text = text.split(secret).join('[已隐藏凭据]');
  }
  return text.slice(0, 1000);
}
function notice(message, kind = '') {
  $('notice').textContent = cleanMessage(message);
  $('notice').className = `notice ${kind}`;
  $('notice').hidden = false;
}
function runUrl(id, suffix = '') {
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new Error('项目 ID 格式不正确。');
  return `/api/runs/${encodeURIComponent(id)}${suffix}`;
}
function safeLink(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
async function api(path, method = 'GET', body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(path, {
      method, credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    let data;
    try { data = await response.json(); } catch { throw new Error('本地服务返回了无法读取的响应。'); }
    if (!response.ok) {
      const code = typeof data?.error === 'string' ? data.error : data?.error?.code || data?.code || '';
      throw new Error(errorLabels[code] || cleanMessage(data?.error?.message) || (code ? `请求未通过：${cleanMessage(code)}` : '本地服务未完成请求。'));
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(method === 'GET' ? '状态读取超时，请手动刷新。' : '请求超时，提交结果可能未知。请先刷新项目状态，勿重复提交。');
    if (error instanceof TypeError) throw new Error('无法连接本地服务。请检查服务进程，再刷新状态；不要重复提交生成。');
    throw error;
  } finally { clearTimeout(timeout); }
}
function readCredentials() {
  for (const id of ['model-base', 'model-name', 'model-key', 'tripo-key']) {
    if (!$(id).reportValidity()) throw new Error('请先填写完整的模型与 Tripo 配置。');
  }
  return {
    model: { baseUrl: $('model-base').value.trim(), model: $('model-name').value.trim(), apiKey: $('model-key').value },
    tripo: { apiKey: $('tripo-key').value }
  };
}
function addSource(initial = {}) {
  if ($('source-list').children.length >= 12) return notice('最多可提供 12 条史料。', 'warning');
  const index = ++state.sourceSeq;
  const card = node('div', 'source-card');
  const heading = node('div', 'source-heading', `史料 ${index}`);
  const remove = node('button', 'source-remove', '移除');
  remove.type = 'button';
  remove.addEventListener('click', () => {
    if ($('source-list').children.length === 1) return notice('请保留至少一条带原文摘录的史料。', 'warning');
    card.remove();
  });
  heading.append(remove); card.append(heading);
  const pair = node('div', 'field-pair');
  for (const [name, label, max, value, target] of [
    ['id', '来源 ID', 48, initial.id || `source-${index}`, pair],
    ['title', '来源标题', 200, initial.title || '', pair],
    ['url', '原文链接（可选）', 2000, initial.url || '', card],
    ['excerpt', '原文摘录', 12000, initial.excerpt || '', card]
  ]) {
    const wrap = node('div');
    const caption = node('label', '', label);
    const field = document.createElement(name === 'excerpt' ? 'textarea' : 'input');
    field.id = `source-${index}-${name}`; field.dataset.field = name;
    caption.htmlFor = field.id; field.maxLength = max; field.value = value;
    if (name === 'url') { field.type = 'url'; field.placeholder = 'https://…'; }
    else field.required = true;
    if (name === 'id') field.pattern = '[a-z][a-z0-9-]{0,47}';
    if (name === 'excerpt') { field.rows = 4; field.placeholder = '粘贴需要用来支持叙述的原文，不能只写“见链接”。'; }
    wrap.append(caption, field); target.append(wrap);
    if (name === 'title') card.append(pair);
  }
  $('source-list').append(card);
}
function readSources() {
  return [...$('source-list').children].map(card => Object.fromEntries(
    [...card.querySelectorAll('[data-field]')].map(field => [field.dataset.field, field.value.trim()])
  ));
}
function setupSubject() {
  const artifact = $('subject-type').value === 'artifact';
  $('image-label').textContent = artifact ? '文物图片' : '壁画图片';
  $('mural-preview').alt = artifact ? '已选择的文物原图' : '已选择的壁画原图';
  $('topic').placeholder = artifact ? '这件文物为何被制作、怎样使用，纹饰与工艺透露了什么故事？' : '人物为何出发，遇到什么阻碍，最后带来什么改变？';
  $('image-note').textContent = artifact ? 'PNG / JPG，最大 8 MB。保留文物原图，主资产由原图生成 3D；未见背面、内部和补全纹饰须标为艺术补全。' : 'PNG / JPG，最大 8 MB。保留原图，按句说明哪些内容确实见于画中。';
  $('subject-metadata').hidden = !artifact;
  $('empty-image-label').textContent = artifact ? '文物' : '壁画';
  $('empty-description').textContent = artifact ? '上传文物原图与史料摘录，自动制作有依据的故事、文物 3D 与讲解网页。可旋转观察，并放大原图对照细节。' : '上传壁画与史料摘录，自动制作有依据的故事、真实 3D 场景与讲解网页。';
  if (!state.run) $('project-title').textContent = artifact ? '等待你的第一件文物' : '等待你的第一幅壁画';
  if (!budgetEdited) { $('max-assets').value = artifact ? '1' : '3'; $('max-credits').value = artifact ? '60' : '150'; }
}
function readMetadata() {
  return Object.fromEntries(metadataFields.map(key => [key, $(`subject-${key}`).value.trim()]).filter(([, value]) => value));
}
function restoreSubject(run) {
  $('subject-type').value = run.subjectType === 'artifact' ? 'artifact' : 'mural';
  for (const key of metadataFields) $(`subject-${key}`).value = run.subjectMetadata?.[key] || '';
  setupSubject();
}
function sourcesMap(run) { return new Map((run.sources || []).map(source => [source.id, source])); }
function renderStory(plan, run) {
  const fragment = document.createDocumentFragment();
  const sourceMap = sourcesMap(run);
  let cueNumber = 0;
  for (const [chapterIndex, chapter] of plan.chapters.entries()) {
    const section = node('section', 'chapter');
    const title = node('h4', 'chapter-heading');
    title.append(node('span', '', String(chapterIndex + 1).padStart(2, '0')), node('span', '', chapter.title));
    section.append(title);
    for (const cue of chapter.cues) {
      const card = node('article', 'cue-card');
      const body = node('div');
      body.append(node('p', 'cue-text', cue.text));
      const meta = node('div', 'cue-meta');
      meta.append(node('span', `tag ${cue.kind === 'documented' ? 'success' : 'warning'}`, kindLabels[cue.kind] || cue.kind));
      meta.append(node('span', 'tag', relationLabels[cue.imageRelation] || '原图关系未标注'));
      if (focusLabels[cue.focus]) meta.append(node('span', 'tag', focusLabels[cue.focus]));
      if (cue.imageAnchor?.label) meta.append(node('span', 'tag', `原图细节：${cue.imageAnchor.label}`));
      if (cue.sceneId) meta.append(node('span', 'tag', `场景 ${cue.sceneId}`));
      body.append(meta);
      const evidence = node('details'); evidence.append(node('summary', '', `依据与来源 · ${(cue.sourceIds || []).join('、') || '无原文引用'}`));
      const list = node('ul', 'evidence-list');
      for (const item of cue.evidence || []) {
        const source = sourceMap.get(item.sourceId);
        const row = node('li'); row.append(node('strong', '', source?.title || item.sourceId), node('span', '', item.quote));
        const href = source && safeLink(source.url);
        if (href) { const link = node('a', 'source-link', '回查原文'); link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; row.append(node('br'), link); }
        list.append(row);
      }
      if (!(cue.evidence || []).length) list.append(node('li', '', '本句须按推断或艺术补充审核，不能作为已核实史实。'));
      evidence.append(list); body.append(evidence);
      card.append(node('span', 'cue-number', String(++cueNumber).padStart(2, '0')), body); section.append(card);
    }
    fragment.append(section);
  }
  $('story-list').replaceChildren(fragment); $('cue-count').textContent = `${plan.chapters.length} 章 · ${cueNumber} 句`;
}
function renderAssets(plan, run) {
  const actual = new Map((run.assets || []).map(asset => [asset.id, asset]));
  const fragment = document.createDocumentFragment();
  for (const asset of plan.assets) {
    const record = actual.get(asset.id);
    const card = node('article', 'asset-card');
    card.append(node('h4', '', asset.label), node('span', 'tag', asset.id === run.primaryAssetId ? '文物主资产' : kindLabels[asset.kind] || asset.kind));
    const details = node('dl');
    const values = [['展示高度', `${asset.heightM} m（展示比例，非实测）`], ['生成方式', asset.generationMode === 'image-to-model' ? '原图生成 3D · 艺术重建' : '描述生成 3D · 艺术补充'], ['来源', asset.sourceIds.join('、')], ['使用场景', plan.scenes.filter(scene => scene.placements.some(item => item.assetId === asset.id)).map(scene => scene.title).join('、')]];
    if (record?.status) values.push(['生成状态', assetStatusLabels[record.status] || String(record.status)]);
    if (record?.taskId) values.push(['Tripo task', String(record.taskId)]);
    if (record?.creditsConsumed !== undefined) values.push(['实际 credits', String(record.creditsConsumed)]);
    if (record?.bytes) values.push(['GLB 文件', `${record.bytes.toLocaleString()} bytes`]);
    for (const [label, value] of values) details.append(node('dt', '', label), node('dd', '', value));
    card.append(details);
    const prompt = node('details'); prompt.append(node('summary', '', '查看生成描述'), node('p', 'prompt', asset.prompt)); card.append(prompt);
    if (record?.sha256) { const hash = node('details'); hash.append(node('summary', '', '查看文件指纹'), node('code', 'hash', record.sha256)); card.append(hash); }
    fragment.append(card);
  }
  $('asset-list').replaceChildren(fragment); $('asset-count').textContent = `${plan.assets.length} 项计划资产`;
}
function renderQuality(quality) {
  const items = [['structuralPassed', '结构检查'], ['visualReviewed', '人工视觉审核'], ['historicalVerified', '独立史料核实'], ['recordingVerified', '完整录屏验收'], ['zipVerified', '独立解包验收']];
  $('quality-panel').replaceChildren(...items.map(([key, label]) => node('span', `quality-item ${quality?.[key] === true ? 'passed' : 'pending'}`, `${quality?.[key] === true ? '✓' : '○'} ${label}${quality?.[key] === true ? '已通过' : '待完成'}`)));
  $('quality-panel').hidden = false;
}
function renderEvents(events) {
  const fragment = document.createDocumentFragment();
  for (const event of events || []) {
    const row = node('li');
    const stamp = event.atUtc || event.at || event.time || '';
    let displayTime = '';
    if (stamp && Number.isFinite(new Date(stamp).getTime())) displayTime = new Date(stamp).toLocaleTimeString('zh-CN', { hour12: false });
    const message = eventLabels[event.type] || event.type || '状态已更新';
    row.append(node('time', '', displayTime), node('span', '', cleanMessage(`${message}${event.assetId ? ` · ${event.assetId}` : ''}${event.code ? ` · ${event.code}` : ''}`))); fragment.append(row);
  }
  $('activity-list').replaceChildren(fragment); $('event-count').textContent = String((events || []).length); $('activity-panel').hidden = !(events || []).length;
}
function renderRepair(run) {
  const repair = run.planRepair;
  const visible = run.status === 'failed' && Boolean(repair?.diagnostics?.length);
  $('repair-panel').hidden = !visible;
  $('repair-button').hidden = !repair?.eligible;
  $('repair-button').disabled = state.busy || !repair?.eligible;
  $('repair-feedback').disabled = !repair?.eligible;
  $('repair-limit').textContent = repair?.eligible ? '可提交一次明确修正。先检查原因，再补充要求。' : '本项目修正次数已用完或不满足安全修正条件。保留失败证据，不能重复提交。';
  $('repair-diagnostics').replaceChildren(...(repair?.diagnostics || []).map(item => node('li', '', cleanMessage(`${item.cueId ? `段落 ${item.cueId} · ` : ''}${item.sourceId ? `来源 ${item.sourceId} · ` : ''}${errorLabels[item.code] || item.message || item.code}`))));
}
function candidateActive(run) { return (run?.assetCandidates || []).some(item => typeof item.active === 'boolean' ? item.active : ['pending', 'submitting', 'task_known'].includes(item.status)); }
function candidateBlocked(run) { return candidateActive(run) || (run?.assetCandidates || []).some(item => ['pending', 'submitting', 'task_known', 'unknown'].includes(item.status)); }
function readBudget() { return { maxAssets: Number($('max-assets').value), maxCredits: $('limit-credits').checked ? Number($('max-credits').value) : Number.MAX_SAFE_INTEGER }; }
function updateCandidateDescription() {
  const asset = state.run?.plan?.assets.find(item => item.id === $('candidate-asset').value);
  $('candidate-prompt').value = asset?.prompt || '';
  $('candidate-input-note').textContent = asset?.generationMode === 'image-to-model' ? '主资产仍用原图生成。这里的描述仅记录展示意图；图生接口不会读取文字描述。新候选采用新的几何与纹理种子。' : '描述用于 Tripo 文生 3D。请写清形制、材质与需要改善的细节。';
}
function renderCandidates(run) {
  const ready = ['preview_ready', 'visual_reviewed'].includes(run.status) && Boolean(run.plan);
  $('candidate-panel').hidden = !ready;
  if (!ready) return;
  const assetSelect = $('candidate-asset'), previous = assetSelect.value;
  assetSelect.replaceChildren(...run.plan.assets.map(item => { const option = node('option', '', item.label); option.value = item.id; return option; }));
  assetSelect.value = run.plan.assets.some(item => item.id === previous) ? previous : run.plan.assets[0].id;
  if (!previous || previous !== assetSelect.value) updateCandidateDescription();
  const candidates = run.assetCandidates || [];
  if (state.candidateRequest?.runId === run.id && candidates.some(item => item.operationId === state.candidateRequest.operationId)) state.candidateRequest = null;
  $('candidate-generate').disabled = state.busy || candidateBlocked(run) || run.credentialsReady !== true;
  const bounded = run.budget?.maxCredits < Number.MAX_SAFE_INTEGER;
  $('candidate-status').textContent = `${candidates.length} 个候选 · 已用或保留 ${run.creditsReservedOrConsumed || 0} credits${bounded ? ` · 当前停止上限 ${run.budget.maxCredits}` : ' · 效果优先，未设 credits 停止上限'}${run.credentialsReady ? '' : ' · 先恢复本地凭据'}`;
  $('candidate-list').replaceChildren(...candidates.map(item => {
    const card = node('article', 'asset-card'); card.append(node('h4', '', `${item.assetId} · ${assetStatusLabels[item.status] || item.status}`), node('p', '', item.reason));
    if (item.taskId) card.append(node('code', 'hash', item.taskId));
    if (item.faceLimit) card.append(node('p', 'field-note', `面数目标 ${item.faceLimit.toLocaleString()} · 种子 ${item.seed}`));
    if (item.previewUrl) { const link = node('a', 'button secondary', '预览候选'); const url = new URL(item.previewUrl, location.href); if (url.origin === location.origin && url.pathname.startsWith(`/runs/${run.id}/`)) { link.href = url.href; link.target = '_blank'; link.rel = 'noopener'; card.append(link); } }
    const selected = run.assets.some(asset => asset.selectedCandidateId === item.id);
    if (item.status === 'ready') {
      const select = node('button', 'button primary', selected ? '当前已选用' : '选用此候选'); select.type = 'button'; select.disabled = selected || state.busy || candidateActive(run) || run.credentialsReady !== true;
      select.addEventListener('click', () => action(async () => { await api(runUrl(run.id, `/asset-candidates/${encodeURIComponent(item.id)}/select`), 'POST', { candidateSha256: item.sha256 }); notice('已选用新候选，原资产保留，故事与旁白已复用。'); await refresh(); })); card.append(select);
    }
    if (['pending', 'task_known'].includes(item.status) && !item.active && !state.busy && !candidateActive(run)) {
      const resume = node('button', 'button secondary', '继续检查已知任务'); resume.type = 'button'; resume.addEventListener('click', () => action(async () => { await api(runUrl(run.id, `/asset-candidates/${encodeURIComponent(item.id)}/resume`), 'POST', {}); await refresh(); })); card.append(resume);
    }
    for (const error of item.errors || []) card.append(node('p', 'field-note', cleanMessage(error.message || error.code)));
    return card;
  }));
}
function render(run) {
  const previousHash = state.run?.planSha256;
  state.run = run; state.updateAt = new Date();
  $('empty-state').hidden = true; $('run-meta').hidden = false; $('refresh-button').disabled = false;
  $('run-id').textContent = run.id; $('restore-id').value = run.id;
  $('run-status').textContent = statusLabels[run.status] || run.status;
  $('run-status').className = `tag ${['failed', 'unknown'].includes(run.status) ? 'error' : run.status === 'visual_reviewed' ? 'success' : 'warning'}`;
  $('last-update').textContent = `更新于 ${state.updateAt.toLocaleTimeString('zh-CN', { hour12: false })}`;
  const progressStatuses = ['planning', 'story_review', 'generating', 'assembling', 'preview_ready'];
  const index = run.status === 'visual_reviewed' ? 4 : progressStatuses.indexOf(run.status);
  for (const item of document.querySelectorAll('.pipeline li')) {
    const target = progressStatuses.indexOf(item.dataset.stage);
    item.classList.toggle('active', target === index); item.classList.toggle('complete', target < index);
    if (target === index) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current');
  }
  $('project-title').textContent = run.plan?.title || (run.status === 'failed' ? '故事计划未通过，请查看原因' : '正在形成可审核计划');
  $('project-summary').textContent = run.plan?.summary || '请等待本地服务返回具体故事、证据引用与资产计划。';
  const artifact = run.subjectType === 'artifact';
  const metadata = metadataFields.map(key => run.subjectMetadata?.[key]).filter(Boolean);
  $('run-subject').textContent = artifact ? `文物${metadata.length ? ` · ${metadata.join(' · ')}（用户提供，未独立核实）` : ''} · 未见背面、内部和补全纹饰属于艺术补全。` : '壁画 · 原图保留，叙述逐句对应史料与画面关系。';
  $('run-subject').hidden = false;
  const hasPlan = Boolean(run.plan);
  $('story-panel').hidden = !hasPlan; $('asset-panel').hidden = !hasPlan;
  if (hasPlan) { renderStory(run.plan, run); renderAssets(run.plan, run); }
  if (previousHash !== run.planSha256 || run.status !== 'story_review') $('approve-checkbox').checked = false;
  $('approval-panel').hidden = run.status !== 'story_review' || !run.planSha256;
  $('plan-hash').textContent = run.planSha256 || '';
  $('approval-cost').textContent = hasPlan ? `${run.plan.assets.length} 项资产；${Number.isFinite(run.estimatedCredits) ? `本版计划预算预计 ${run.estimatedCredits} credits` : '计划预计 credits 尚未返回，请刷新状态'}。实际消耗以生成记录为准。` : '';
  $('generate-button').disabled = state.busy || run.status !== 'story_review';
  const needsCandidateCredentials = ['preview_ready', 'visual_reviewed'].includes(run.status) && run.credentialsReady === false;
  const recovery = needsCandidateCredentials || ['story_review', 'failed', 'recoverable', 'unknown'].includes(run.status);
  $('recovery-panel').hidden = !recovery;
  $('recovery-title').textContent = run.status === 'story_review' ? '服务重启后，可恢复本项目凭据' : statusLabels[run.status] || '项目需要处理';
  $('recovery-message').textContent = run.status === 'story_review' ? '故事与计划会保留，密钥仅在本地进程内存中。如果服务已经重启，请重新填写上方模型与 Tripo 配置，再恢复凭据。之后仍需审核并确认这版计划。' : run.status === 'unknown' ? '服务端没有确认提交结果。请保留本项目 ID 与已有任务记录，先刷新或核查 provider 任务，避免重复收费。' : run.status === 'recoverable' ? '服务端保留了项目与任务记录，但需要重新填写凭据。恢复凭据不会提交新的生成任务。' : '本次任务未通过。请查看下方记录和具体原因，保留已有文件，不自动重新收费生成。';
  $('resume-button').hidden = run.credentialsReady === true || (!needsCandidateCredentials && !['story_review', 'recoverable'].includes(run.status) && !run.planRepair?.eligible);
  if (needsCandidateCredentials) { $('recovery-title').textContent = '恢复凭据后继续打磨'; $('recovery-message').textContent = '现有网页和资产已保留。重新填入 API 并恢复到本地进程内存，即可制作新的 3D 候选。'; }
  $('resume-button').textContent = '恢复当前凭据并刷新状态';
  $('continue-button').hidden = run.status !== 'recoverable';
  $('continue-button').disabled = state.busy || (state.recoveredId !== run.id && run.credentialsReady !== true) || !run.planSha256;
  const ready = ['preview_ready', 'visual_reviewed'].includes(run.status);
  $('preview-panel').hidden = !ready;
  $('preview-link').href = run.packageUrl || `/runs/${encodeURIComponent(run.id)}/viewer.html`;
  $('visual-button').disabled = state.busy || !$('visual-checkbox').checked || run.status !== 'preview_ready';
  $('visual-checkbox').disabled = run.status === 'visual_reviewed';
  if (run.status === 'visual_reviewed') $('visual-checkbox').checked = true;
  renderRepair(run); renderCandidates(run); renderQuality(run.quality); renderEvents(run.events);
  const errors = (run.errors || []).map(item => typeof item === 'string' ? errorLabels[item] || item : errorLabels[item.code] || item.message || item.code || '').filter(Boolean);
  if (errors.length && ['failed', 'unknown', 'recoverable'].includes(run.status)) notice(errors.map(cleanMessage).join('；'), 'error');
  $('plan-button').disabled = state.busy || activeStatuses.has(run.status);
}
function stopPolling() { clearTimeout(state.pollTimer); state.pollTimer = null; }
async function refresh() {
  if (!state.run?.id) return;
  const requestedId = state.run.id;
  const requestedSequence = ++state.refreshSequence;
  stopPolling();
  try {
    const run = await api(runUrl(requestedId));
    if (state.run?.id !== requestedId || requestedSequence !== state.refreshSequence) return;
    render(run);
    if (activeStatuses.has(run.status) || candidateActive(run)) state.pollTimer = setTimeout(refresh, 2500);
  } catch (error) { if (requestedSequence === state.refreshSequence) notice(error.message, 'warning'); }
}
async function action(callback) {
  if (state.busy) return;
  stopPolling(); state.refreshSequence++;
  state.busy = true;
  for (const id of ['plan-button', 'generate-button', 'resume-button', 'continue-button', 'visual-button', 'restore-button', 'repair-button', 'candidate-generate']) $(id).disabled = true;
  try { await callback(); } catch (error) { notice(error.message, 'error'); }
  finally {
    state.busy = false;
    $('plan-button').disabled = Boolean(state.run && activeStatuses.has(state.run.status));
    $('resume-button').disabled = false; $('restore-button').disabled = false;
    $('generate-button').disabled = state.run?.status !== 'story_review';
    $('visual-button').disabled = !$('visual-checkbox').checked || state.run?.status !== 'preview_ready';
    $('continue-button').disabled = (state.recoveredId !== state.run?.id && state.run?.credentialsReady !== true) || state.run?.status !== 'recoverable' || !state.run?.planSha256;
    $('repair-button').disabled = !state.run?.planRepair?.eligible;
    if (state.run) renderCandidates(state.run);
  }
}

$('subject-type').addEventListener('change', setupSubject);
for (const id of ['max-assets', 'max-credits']) $(id).addEventListener('input', () => { budgetEdited = true; if (id === 'max-credits') $('limit-credits').checked = true; });
$('candidate-asset').addEventListener('change', updateCandidateDescription);
$('candidate-generate').addEventListener('click', () => action(async () => {
  const run = state.run; if (!run?.planSha256 || run.credentialsReady !== true || candidateBlocked(run)) throw new Error('先刷新项目状态或恢复凭据，已有候选仍在生成时请等待结果。');
  const request = state.candidateRequest?.runId === run.id ? state.candidateRequest : { runId: run.id, operationId: crypto.randomUUID(), planSha256: run.planSha256, assetId: $('candidate-asset').value, prompt: $('candidate-prompt').value.trim(), reason: $('candidate-reason').value.trim(), faceLimit: Number($('candidate-faces').value || 100000) };
  if (!request.reason) throw new Error('请写下本次希望改善的地方，方便比较结果。');
  state.candidateRequest = request;
  const credits = $('limit-credits').checked ? Number($('max-credits').value) : Number.MAX_SAFE_INTEGER;
  if (run.budget?.maxCredits !== credits) await api(runUrl(run.id, '/budget'), 'POST', { maxAssets: run.budget?.maxAssets || run.plan.assets.length, maxCredits: credits });
  const { runId, ...body } = request;
  await api(runUrl(runId, '/asset-candidates'), 'POST', body);
  notice('已开始生成新候选；旧网页继续保留，完成后可对比选用。'); await refresh();
}));
$('add-source').addEventListener('click', () => addSource());
$('clear-keys').addEventListener('click', () => { $('model-key').value = ''; $('tripo-key').value = ''; notice('已清空本页密钥。服务端已有项目凭据的生命周期由本地进程管理。'); });
$('mural-file').addEventListener('change', async () => {
  const sequence = ++state.imageSequence;
  state.imageDataUrl = ''; $('image-preview').hidden = true;
  const file = $('mural-file').files[0]; if (!file) return;
  if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 8 * 1024 * 1024) { $('mural-file').value = ''; return notice('请选择不超过 8 MB 的 PNG 或 JPG 图片。', 'error'); }
  try {
    const reader = new FileReader();
    const data = await new Promise((resolve, reject) => { reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('图片读取失败。')); reader.readAsDataURL(file); });
    const image = new Image(); image.src = data; await image.decode();
    if (sequence !== state.imageSequence) return;
    state.imageDataUrl = data; $('mural-preview').src = data;
    $('image-name').textContent = `${file.name} · ${image.naturalWidth} × ${image.naturalHeight}`; $('image-preview').hidden = false;
  } catch (error) { if (sequence === state.imageSequence) { $('mural-file').value = ''; notice(error.message, 'error'); } }
});
$('project-form').addEventListener('submit', event => {
  event.preventDefault();
  action(async () => {
    if (!state.imageDataUrl) throw new Error('请等待原图读取完成后再生成计划。');
    const subjectType = $('subject-type').value === 'artifact' ? 'artifact' : 'mural';
    const subjectMetadata = subjectType === 'artifact' ? readMetadata() : {};
    const input = { subjectType, autoGenerate: true, ...(Object.keys(subjectMetadata).length ? { subjectMetadata } : {}), topic: $('topic').value.trim(), imageDataUrl: state.imageDataUrl, sources: readSources(), ...readCredentials(), budget: readBudget() };
    stopPolling();
    const created = await api('/api/runs', 'POST', input);
    state.recoveredId = null; state.run = { ...created, subjectType: input.subjectType, subjectMetadata: input.subjectMetadata, sources: input.sources, assets: [], events: [], errors: [] };
    notice('已开始自动制作。故事通过合同检查后，将自动生成真实 3D、固定旁白和讲解网页。');
    await refresh();
  });
});
$('approve-checkbox').addEventListener('change', () => { $('generate-button').disabled = state.busy || state.run?.status !== 'story_review'; });
$('generate-button').addEventListener('click', () => action(async () => {
  if (!state.run?.planSha256 || state.run.status !== 'story_review') throw new Error('当前故事计划尚未通过合同检查。');
  const id = state.run.id;
  $('approve-checkbox').checked = false;
  await api(runUrl(id, '/generate'), 'POST', { planSha256: state.run.planSha256 });
  notice('正在生成或恢复当前计划的真实 3D 资产。');
  await refresh();
}));
$('refresh-button').addEventListener('click', refresh);
$('repair-button').addEventListener('click', () => action(async () => {
  const run = state.run;
  if (run?.status !== 'failed' || !run.planRepair?.eligible || !run.planRepair.candidateSha256) throw new Error('当前项目不能提交计划修正，请刷新状态。');
  await api(runUrl(run.id, '/repair-plan'), 'POST', { candidateSha256: run.planRepair.candidateSha256, feedback: $('repair-feedback').value.trim() });
  $('approve-checkbox').checked = false;
    notice('已提交一次模型修正。原失败证据保留，修正通过后按本项目配置继续制作。');
  await refresh();
}));
$('restore-button').addEventListener('click', () => action(async () => {
  const id = $('restore-id').value.trim(); const run = await api(runUrl(id));
  stopPolling(); state.recoveredId = null; restoreSubject(run); render(run); notice('已读取已有项目。此操作没有重新提交生成。');
  if (activeStatuses.has(run.status)) state.pollTimer = setTimeout(refresh, 2500);
}));
$('resume-button').addEventListener('click', () => action(async () => {
  if (!state.run) return;
  const result = await api(runUrl(state.run.id, '/credentials'), 'POST', readCredentials());
  state.recoveredId = state.run.id; render(result);
  notice('凭据已恢复到本地进程内存，现有故事和资产保留。可以继续制作或打磨候选。');
}));
$('continue-button').addEventListener('click', () => action(async () => {
  if (state.run?.status !== 'recoverable' || (state.recoveredId !== state.run.id && state.run.credentialsReady !== true) || !state.run.planSha256) throw new Error('请先恢复本项目凭据并核查已有任务。');
  await api(runUrl(state.run.id, '/generate'), 'POST', { planSha256: state.run.planSha256 });
  state.recoveredId = null; notice('已请求继续同一计划。服务端将复用已知任务，未知提交不会重发。'); await refresh();
}));
$('visual-checkbox').addEventListener('change', () => { $('visual-button').disabled = state.busy || !$('visual-checkbox').checked || state.run?.status !== 'preview_ready'; });
$('visual-button').addEventListener('click', () => action(async () => {
  if (!$('visual-checkbox').checked || state.run?.status !== 'preview_ready') throw new Error('请先在真实浏览器逐句审核并勾选确认。');
  await api(runUrl(state.run.id, '/review'), 'POST', { approved: true, notes: '用户在本地工作台确认已在真实浏览器逐句检查当前预览。' });
  notice('已记录本次视觉审核；独立史料核实、音轨、完整录屏和解包验收仍按实际范围判断。'); await refresh();
}));
setupSubject(); addSource();
api('/api/health').then(data => { if (data.ok !== true) throw new Error('服务未就绪'); $('connection').textContent = '本地服务已连接'; $('connection').classList.add('online'); }).catch(() => { $('connection').textContent = '本地服务未连接'; notice('本地服务尚未连接。配置 API 本身不会生成资产，请先启动本地 Agent 服务。', 'warning'); });
window.addEventListener('pagehide', stopPolling);
