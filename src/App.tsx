import CaseWorkbench from './CaseWorkbench'
import ZhangQianStory from './story/ZhangQianStory'
import './story/story.css'

export default function App() {
  return window.location.pathname.startsWith('/cases') ? (
    <CaseWorkbench />
  ) : (
    <ZhangQianStory />
  )
}
