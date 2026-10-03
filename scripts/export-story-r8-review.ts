/** Export the actual product script for human review; no provider calls. */
import { writeFileSync } from 'node:fs'
import { chapterDefinitions, sources } from '../viewer/src/mural/story.ts'
import { englishSubtitles } from '../viewer/src/mural/subtitles.ts'
import { getSceneBeat } from '../viewer/src/mural/scene-beats.ts'
import { cueView } from '../viewer/src/mural/cue-presentation.ts'

let markdown = '# 张骞故事解说稿 r8\n\n以故事的时间顺序与因果为主线。前七章讲外交经历，最后一章才解释后世壁画。图像和3D辅助理解，不决定故事顺序。\n\n'
markdown += '本稿由实际源码导出；修改产品正文后重新运行 `node --import tsx scripts/export-story-r8-review.ts`。中文音轨使用公开Kokoro zm_010，未使用私人录音。\n\n'
for (const [i, chapter] of chapterDefinitions.entries()) {
  markdown += `## ${i + 1}. ${chapter.title}\n\n${chapter.takeaway}\n\n`
  for (const cue of chapter.cues) {
    const beat = getSceneBeat(cue.id)
    const view = cueView(cue.id, 0, !!beat)
    markdown += `**${cue.id}** ${cue.text}\n\n${englishSubtitles[cue.id]}\n\n`
    markdown += `画面：${view === 'spatial' ? beat!.title : view === 'map' ? '路线图辅助当前事件' : '原壁画辅助后世记忆的解释'}。来源：${cue.sourceIds.join('、')}。\n\n`
  }
}
markdown += '## 查证入口\n\n' + sources.map(s => `- [${s.title}](${s.url})：${s.description}`).join('\n') + '\n'
writeFileSync('docs/historical/story-first-r8.md', markdown, 'utf8')
