import { Suspense, lazy } from 'react'
import SingleSceneExperience from './single/SingleSceneExperience'
import './story/story.css'

const CaseWorkbench = lazy(() => import('./CaseWorkbench'))
const ZhangQianStory = lazy(() => import('./story/ZhangQianStory'))

export default function App() {
  const route = window.location.pathname
  if (route.startsWith('/cases'))
    return (
      <Suspense fallback={<main>正在加载技术案例…</main>}>
        <CaseWorkbench />
      </Suspense>
    )
  if (route.startsWith('/journey'))
    return (
      <Suspense fallback={<main>正在加载六站路线…</main>}>
        <ZhangQianStory />
      </Suspense>
    )
  return <SingleSceneExperience />
}
