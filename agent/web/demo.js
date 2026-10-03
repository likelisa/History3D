const $ = id => document.getElementById(id);
const element = (tag, text) => { const item = document.createElement(tag); item.textContent = text; return item; };
try {
  const responses = await Promise.all(['story.json', 'asset-manifest.json'].map(file => fetch(`/examples/bronze-horse/${file}`)));
  if (responses.some(response => !response.ok)) throw new Error('保存的案例资料暂时无法读取，请先打开现有作品或稍后刷新。');
  const [story, manifest] = await Promise.all(responses.map(response => response.json()));
  $('demo-title').textContent = story.title;
  for (const [key, label] of [['name', '名称'], ['period', '年代'], ['material', '材质'], ['collection', '收藏信息']]) {
    const value = story.subjectMetadata?.[key];
    if (value) $('demo-metadata').append(element('dt', label), element('dd', value));
  }
  for (const source of story.sources) {
    const section = element('section', '');
    section.append(element('h3', source.title), element('p', source.excerpt));
    if (source.url) {
      const url = new URL(source.url);
      if (['https:', 'http:'].includes(url.protocol)) {
        const link = element('a', '回查原文 ↗'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; section.append(link);
      }
    }
    $('demo-sources').append(section);
  }
  let cueCount = 0;
  for (const chapter of story.chapters) {
    $('demo-chapters').append(element('li', `${chapter.title} · ${chapter.cues.length} 句`));
    for (const cue of chapter.cues) { cueCount++; $('demo-cues').append(element('p', `${cueCount}．${cue.text}`)); }
  }
  const assets = manifest.assets;
  const triangles = assets.reduce((sum, asset) => sum + (asset.stats?.triangles || 0), 0);
  const credits = assets.every(asset => Number.isFinite(asset.creditsConsumed)) ? assets.reduce((sum, asset) => sum + asset.creditsConsumed, 0) : null;
  $('demo-assets').textContent = `${assets.length} 件已保存的真实 GLB · ${triangles.toLocaleString()} 个三角面 · ${cueCount} 句讲解${credits === null ? '' : ` · 本案例记录消耗 ${credits} credits`}`;
} catch (error) {
  $('demo-error').hidden = false;
  $('demo-error').textContent = error instanceof Error ? error.message : '案例资料读取失败，请打开现有作品。';
}
