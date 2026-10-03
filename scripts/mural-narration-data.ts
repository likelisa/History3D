/** Export reviewed display text for local synthesis; never calls a hosted service. */
import { writeFileSync } from 'node:fs'
import { chapterDefinitions } from '../viewer/src/mural/story.ts'
const destination = process.argv[2]
if (!destination) throw new Error('Pass a local JSON output file')
writeFileSync(destination, JSON.stringify({ cues: chapterDefinitions.flatMap(chapter => chapter.cues) }, null, 2) + '\n', 'utf8')
