import {spawnSync} from 'node:child_process'
import {mkdirSync,writeFileSync} from 'node:fs'
import {chapters} from '../viewer/src/mural/story.ts'
mkdirSync('.processing-data/mural-narration',{recursive:true})
mkdirSync('viewer/public/mural-assets/narration',{recursive:true})
const timings=[]
for(let i=0;i<chapters.length;i++){
 const intermediate=`.processing-data/mural-narration/${i}.aiff`,output=`viewer/public/mural-assets/narration/${i}.m4a`
 for(const [cmd,args]of [['/usr/bin/say',['-v','Tingting','-r','195','-o',intermediate,chapters[i]!.text]],['/usr/bin/afconvert',['-f','m4af','-d','aac@44100','-b','64000',intermediate,output]]] as const){const r=spawnSync(cmd,args,{encoding:'utf8'});if(r.status!==0)throw new Error(r.stderr||'Narration command failed')}
 const info=spawnSync('/usr/bin/afinfo',[output],{encoding:'utf8'});const seconds=Number(info.stdout.match(/estimated duration:\s*([\d.]+)/)?.[1]);if(!seconds)throw new Error('No verified audio duration')
 timings.push({file:`/mural-assets/narration/${i}.m4a`,seconds,text:chapters[i]!.text});console.log(JSON.stringify({chapter:i+1,seconds}))
}
writeFileSync('viewer/public/mural-assets/narration/manifest.json',JSON.stringify({voice:'macOS Tingting',rate:195,tracks:timings},null,2)+'\n')
