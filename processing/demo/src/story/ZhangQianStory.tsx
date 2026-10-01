import { useCallback, useEffect, useState } from 'react'
import { RouteWorld } from './RouteWorld'
import { loadStory, type StoryPackage } from './storyData'

type ViewMode = 'route' | 'person'
const stageNotes = [
  {
    title: '历史采集器',
    present: '整理文献与路线叙述',
    missing: '仍需核对更直接的史料、地名对应及争议',
  },
  {
    title: '历史处理层',
    present: '拆成 6 个叙事节点并编排示意空间',
    missing: '缺实测地理坐标、真实物件、尺度与美术考证',
  },
  {
    title: '历史世界现场',
    present: '浏览、切换人尺度、逐站查看出处',
    missing: '缺真正行走、测距与场景化历史资产',
  },
]
export default function ZhangQianStory() {
  const [story, setStory] = useState<StoryPackage | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(0)
  const [view, setView] = useState<ViewMode>('route')
  const [reload, setReload] = useState(0)
  const [showMaking, setShowMaking] = useState(false)
  const onSelect = useCallback((index: number) => setSelected(index), [])
  const onFailure = useCallback((message: string) => setError(message), [])
  useEffect(() => {
    const controller = new AbortController()
    setStory(null)
    setError('')
    loadStory(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setStory(data)
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause.message)
      })
    return () => controller.abort()
  }, [reload])
  const current = story?.steps[selected]
  const citations =
    current?.sourceIds
      .map((id) => story!.sources.find((s) => s.id === id))
      .filter((s) => s != null) ?? []
  return (
    <main className="story-page">
      <header className="story-nav">
        <a className="story-logo" href="/">
          H<span>3D</span>
          <i />
          历史空间实验室
        </a>
        <div className="story-nav-right">
          <span>第一段可体验史实 · 张骞归途</span>
          <a href="/cases">查看技术验收案例 ↗</a>
        </div>
      </header>
      <section className="story-hero">
        <div className="story-hero-copy">
          <span className="story-kicker">
            THE RETURN JOURNEY · 元朔元年 / 前128年
          </span>
          <h1>
            张骞的归途，
            <br />
            <em>为什么走向更远的路？</em>
          </h1>
          <p>
            带着从西域搜集的见闻回国，他试图绕开匈奴控制的道路。循一段记载，沿葱岭与南缘诸地，走向再次被俘的结局。
          </p>
          <button
            onClick={() => {
              setSelected(0)
              document
                .getElementById('story-experience')
                ?.scrollIntoView({ behavior: 'smooth' })
            }}
          >
            进入这段归途 <span>↗</span>
          </button>
        </div>
        <div className="story-hero-aside">
          <strong>一段有出处的历史 · 一条可探索的示意路线</strong>
          <p>
            这里呈现史料叙事与空间感。山形、路线长度、节点间距和人物造型均为体验示意。
          </p>
          <div className="aside-stats">
            <span>
              <b>06</b>叙事节点
            </span>
            <span>
              <b>02</b>参考文本
            </span>
            <span>
              <b>01</b>归途转折
            </span>
          </div>
        </div>
      </section>
      <section className="story-experience" id="story-experience">
        <div className="experience-heading">
          <div>
            <span className="story-kicker">FOLLOW THE RECORD</span>
            <h2>沿归途前行</h2>
            <p>点击左侧节点，观察路线，再看史料写了什么。</p>
          </div>
          <span className="section-progress">
            {String(selected + 1).padStart(2, '0')} <i>/ 06</i>
          </span>
        </div>
        <div className="experience-grid">
          <nav className="route-steps" aria-label="张骞归途章节">
            {story?.steps.map((step, index) => (
              <button
                key={step.id}
                className={selected === index ? 'active' : ''}
                aria-current={selected === index ? 'step' : undefined}
                onClick={() => setSelected(index)}
              >
                <span className="step-index">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span>
                  <strong>{step.title}</strong>
                  <small>{step.eyebrow}</small>
                </span>
                <i>{selected === index ? '●' : '○'}</i>
              </button>
            ))}
            {!story && (
              <p className="route-loading">{error || '正在读取路线资料…'}</p>
            )}
          </nav>
          <div className="route-stage">
            <div className="route-stage-top">
              <span>归途空间示意</span>
              <span>节点顺序有出处 · 坐标与距离不按比例</span>
            </div>
            {story && !error ? (
              <RouteWorld
                story={story}
                selected={selected}
                view={view}
                onSelect={onSelect}
                onFailure={onFailure}
              />
            ) : (
              <div className="route-loading stage-error">
                {error || '正在构建路线…'}{' '}
                {error && (
                  <button onClick={() => setReload((v) => v + 1)}>重试</button>
                )}
              </div>
            )}
            <div className="map-legend">
              <span>
                <i className="legend-line" />
                归途顺序
              </span>
              <span>
                <i className="legend-dash" />
                被俘位置未定位
              </span>
              <span>
                <i className="legend-person" />
                人的高度参照
              </span>
            </div>
            <div className="route-controls">
              <div role="group" aria-label="路线视角">
                <button
                  aria-pressed={view === 'route'}
                  onClick={() => setView('route')}
                >
                  路线总览
                </button>
                <button
                  aria-pressed={view === 'person'}
                  onClick={() => setView('person')}
                >
                  站到路线中 · 1.7m
                </button>
              </div>
              <span>拖动旋转 · 滚轮缩放 · 点击节点</span>
            </div>
          </div>
          <aside className="story-inspector">
            <div className="inspector-top">
              <span>正在经历</span>
              <span>{String(selected + 1).padStart(2, '0')} / 06</span>
            </div>
            {current ? (
              <>
                <span className="story-chapter-label">{current.eyebrow}</span>
                <h3>{current.title}</h3>
                <p className="story-narrative">{current.text}</p>
                <div className="story-evidence">
                  <span className="story-evidence-title">这一步的依据</span>
                  {citations.map((source) => (
                    <a
                      key={source.id}
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <strong>{source.title} ↗</strong>
                      <small>{source.excerpt}</small>
                    </a>
                  ))}
                </div>
                <div className="story-boundary">
                  <strong>空间表达的边界</strong>
                  <p>
                    {selected === 5
                      ? '“再次被俘”是结局节点。材料未明确被俘地点，图中末端是叙事终点，不是地理位置。'
                      : '此处显示的是节点顺序。山体、路程长短、地面和人物形态为演示；不能据此判断真实地理距离。'}
                  </p>
                </div>
                <div className="story-next">
                  <button
                    onClick={() => setSelected(Math.max(0, selected - 1))}
                    disabled={selected === 0}
                  >
                    ← 上一站
                  </button>
                  <button
                    onClick={() =>
                      setSelected(
                        Math.min(story.steps.length - 1, selected + 1),
                      )
                    }
                    disabled={selected === story.steps.length - 1}
                  >
                    下一站 →
                  </button>
                </div>
              </>
            ) : (
              <p className="story-narrative">{error || '正在加载章节…'}</p>
            )}
          </aside>
        </div>
        <div className="story-truth">
          <div>
            <span className="truth-index">史实线索</span>
            <p>回国绕行、南山一线、再次被匈奴俘获，可在参考文本中找到依据。</p>
          </div>
          <div>
            <span className="truth-index">叙述整理</span>
            <p>“葱岭 → 莎车 → 于阗 → 楼兰”的逐站顺序来自张骞词条的现代整理。</p>
          </div>
          <div>
            <span className="truth-index">空间示意</span>
            <p>
              这里的地形、线条和人物仅帮助体验路途，不等于古地图或遗址复原。
            </p>
          </div>
        </div>
      </section>
      <section className="story-making">
        <button
          className="making-toggle"
          aria-expanded={showMaking}
          onClick={() => setShowMaking(!showMaking)}
        >
          <span>
            <small>HOW IT IS MADE</small>
            <strong>这段体验由哪三层做出来？</strong>
          </span>
          <b>{showMaking ? '收起 −' : '展开制作链 ＋'}</b>
        </button>
        {showMaking && (
          <div className="making-grid">
            {stageNotes.map((stage, index) => (
              <article key={stage.title}>
                <span>
                  0{index + 1} / {stage.title}
                </span>
                <h4>{stage.present}</h4>
                <p>待继续：{stage.missing}</p>
              </article>
            ))}
          </div>
        )}
      </section>
      <footer className="story-footer">
        <span>History3D · 张骞归途体验样例</span>
        <a href="/cases">团队技术验收案例 →</a>
      </footer>
    </main>
  )
}
