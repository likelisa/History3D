import { useCallback, useEffect, useState } from 'react'
import {
  TerrainWorld,
  type CameraMode,
  type StepDirection,
} from './TerrainWorld'
import { loadSouthDetour, type ScenePackage } from './data'
import './single.css'

const inspection = [
  {
    title: '远山与山前',
    text: '从远处山体过渡到山前砾坡，给出“沿南山”的空间方向。地形是现代地貌启发的示意，不能当成张骞的实走路线。',
    tag: '地貌参考',
  },
  {
    title: '能走的一段路',
    text: '让用户站到 1.7 米视线，沿路向前；路面宽度和曲率只服务体验，不标为古道遗迹。',
    tag: '演示设定',
  },
  {
    title: '岩体与人形参照',
    text: '一处近景岩体测试 Tripo 的轮廓、贴图和接地；中性旅人只作尺寸参照，没有相貌和服饰考证。',
    tag: '资产候选',
  },
]
export default function SingleSceneExperience() {
  const [story, setStory] = useState<ScenePackage | null>(null)
  const [loadError, setLoadError] = useState('')
  const [reload, setReload] = useState(0)
  const [beat, setBeat] = useState(0)
  const [mode, setMode] = useState<CameraMode>('overview')
  const [reset, setReset] = useState(0)
  const [command, setCommand] = useState<{
    serial: number
    direction: StepDirection
  }>({ serial: 0, direction: 'forward' })
  const [status, setStatus] = useState('正在加载环境资产…')
  const [fps, setFps] = useState(0)
  const [progress, setProgress] = useState(0)
  const [showProcess, setShowProcess] = useState(false)
  const onBeat = useCallback((index: number) => setBeat(index), [])
  const onError = useCallback((message: string) => setLoadError(message), [])
  const onStatus = useCallback(
    (message: string, value: number, walked: number) => {
      setStatus(message)
      setFps(value)
      setProgress(walked)
    },
    [],
  )
  useEffect(() => {
    const controller = new AbortController()
    setLoadError('')
    setStory(null)
    loadSouthDetour(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setStory(data)
      })
      .catch((error) => {
        if (!controller.signal.aborted) setLoadError(error.message)
      })
    return () => controller.abort()
  }, [reload])
  const active = story?.beats[beat]
  const sources =
    active?.sourceIds
      .map((id) => story!.sources.find((source) => source.id === id))
      .filter((source) => source != null) ?? []
  const next = () => setBeat((index) => Math.min(index + 1, 2))
  return (
    <main className="single-page">
      <header className="single-nav">
        <a className="single-logo" href="/">
          H<span>3D</span>
          <i />
          历史空间实验室
        </a>
        <span>张骞归途 · 单场景试验</span>
        <nav>
          <a href="/journey">六站路线索引 ↗</a>
          <a href="/cases">技术验收 ↗</a>
        </nav>
      </header>
      <section className="single-hero">
        <div>
          <span className="single-eyebrow">
            ZHANG QIAN · THE SOUTHERN DETOUR
          </span>
          <h1>
            沿南山，
            <br />
            <em>寻找回汉的路。</em>
          </h1>
          <p>
            从西域返汉时，张骞试图沿南缘绕行，以避开匈奴控制的道路。《史记》《汉书》记下了他的选择，也记下后来再次被俘的结果。
          </p>
          <div className="single-hero-meta">
            <span>元朔元年归途 · 前128年为词条整理</span>
            <span>史实有出处</span>
            <span>空间为非比例示意</span>
          </div>
        </div>
        <aside>
          <strong>这一段，只讲一个选择。</strong>
          <p>
            站到路上，看远山、碎石坡和前路。走完后回答：张骞为何改走这条方向？他最后是否避开了被俘？
          </p>
          <button
            onClick={() => {
              setMode('walk')
              document
                .getElementById('single-field')
                ?.scrollIntoView({ behavior: 'smooth' })
            }}
          >
            进入场景 <b>↗</b>
          </button>
        </aside>
      </section>
      <section className="single-content" id="single-field">
        <div className="single-heading">
          <div>
            <span className="single-eyebrow">
              ONE HISTORICAL MOMENT · THREE BEATS
            </span>
            <h2>走一段归途，看一个转折</h2>
          </div>
          <div className="single-marker">
            {String(beat + 1).padStart(2, '0')} <small>/ 03</small>
          </div>
        </div>
        <div className="single-grid">
          <div className="single-stage">
            <div className="single-world-top">
              <span>山前路段 · 概念复原</span>
              <span>{status}</span>
            </div>
            {story && !loadError ? (
              <TerrainWorld
                story={story}
                mode={mode}
                beat={beat}
                reset={reset}
                command={command}
                onBeat={onBeat}
                onStatus={onStatus}
                onError={onError}
              />
            ) : (
              <div className="single-load">
                {loadError || '正在读取史料与场景包…'}
                {loadError && (
                  <button onClick={() => setReload((value) => value + 1)}>
                    重试加载
                  </button>
                )}
              </div>
            )}
            <div className="single-world-bottom">
              <div role="group" aria-label="体验视角">
                <button
                  aria-pressed={mode === 'overview'}
                  onClick={() => setMode('overview')}
                >
                  观察整段空间
                </button>
                <button
                  aria-pressed={mode === 'walk'}
                  onClick={() => setMode('walk')}
                >
                  沿路行走 · 1.7m
                </button>
              </div>
              <button
                onClick={() => {
                  setReset((v) => v + 1)
                  setBeat(0)
                }}
              >
                ↺ 回到起点
              </button>
              <small>
                {mode === 'walk'
                  ? 'W A S D 行走 · 拖动转向'
                  : '拖动旋转 · 滚轮缩放 · 点击光点'}
              </small>
            </div>
            {mode === 'walk' && (
              <div className="walk-pad" role="group" aria-label="逐步移动">
                <button
                  aria-label="前进一米"
                  onClick={() =>
                    setCommand((old) => ({
                      serial: old.serial + 1,
                      direction: 'forward',
                    }))
                  }
                >
                  ↑
                </button>
                <div>
                  <button
                    aria-label="向左一步"
                    onClick={() =>
                      setCommand((old) => ({
                        serial: old.serial + 1,
                        direction: 'left',
                      }))
                    }
                  >
                    ←
                  </button>
                  <button
                    aria-label="后退一米"
                    onClick={() =>
                      setCommand((old) => ({
                        serial: old.serial + 1,
                        direction: 'back',
                      }))
                    }
                  >
                    ↓
                  </button>
                  <button
                    aria-label="向右一步"
                    onClick={() =>
                      setCommand((old) => ({
                        serial: old.serial + 1,
                        direction: 'right',
                      }))
                    }
                  >
                    →
                  </button>
                </div>
              </div>
            )}
          </div>
          <aside className="single-story">
            <div className="single-story-head">
              <span>此刻的史实</span>
              <b>{String(beat + 1).padStart(2, '0')} / 03</b>
            </div>
            <nav aria-label="归途的三个讲述点">
              {story?.beats.map((point, index) => (
                <button
                  key={point.id}
                  aria-current={beat === index ? 'step' : undefined}
                  className={beat === index ? 'active' : ''}
                  onClick={() => setBeat(index)}
                >
                  <i>{String(index + 1).padStart(2, '0')}</i>
                  <span>{point.title}</span>
                </button>
              ))}
            </nav>
            <div className="single-story-copy">
              <span className="single-evidence-tag">
                史书记载的事件 · 空间是示意
              </span>
              <h3>{active?.title ?? '正在加载…'}</h3>
              <p>{active?.text ?? loadError}</p>
            </div>
            <div className="single-source">
              <span>判断依据</span>
              {sources.map((source) => (
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
            <div className="single-story-footer">
              <button
                onClick={() => setBeat((index) => Math.max(0, index - 1))}
                disabled={beat === 0}
              >
                ← 上一步
              </button>
              <button onClick={next} disabled={beat === 2}>
                下一步 →
              </button>
            </div>
          </aside>
        </div>
        <div className="single-proof">
          <article>
            <strong>当前视角</strong>
            <span>
              {mode === 'walk' ? '人在路上 · 眼高 1.7m' : '空间总览 · 非比例'}
            </span>
          </article>
          <article>
            <strong>沿路进度</strong>
            <span>
              {mode === 'walk'
                ? `${Math.max(0, Math.min(100, progress))}%（场景内示意）`
                : '进入行走模式开始记录'}
            </span>
          </article>
          <article>
            <strong>本地运行</strong>
            <span>
              {fps ? `${fps} FPS（瞬时）` : '等待测量'} · 模型不自动成为历史资产
            </span>
          </article>
        </div>
      </section>
      <section className="single-details">
        <span className="single-eyebrow">SCENE CRAFT · PROCESSING LAYER</span>
        <h2>这段路的细节，哪些做了，哪些还要考证？</h2>
        <div className="single-detail-grid">
          {inspection.map((item) => (
            <article key={item.title}>
              <span>{item.tag}</span>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
              {item.tag === '地貌参考' && (
                <a
                  href="https://zh.wikipedia.org/wiki/塔里木盆地"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  查看现代地貌依据 ↗
                </a>
              )}
            </article>
          ))}
        </div>
        <p className="single-limits">
          画面中的山体、道路、岩石和人物数量均不指认具体古道地点；再次被俘的地点未见于此段资料。下一轮若要给人物服饰或器物上“汉代”标签，需先补同代参考并经过采集器审核。
        </p>
      </section>
      <section className="single-process">
        <button
          aria-expanded={showProcess}
          onClick={() => setShowProcess(!showProcess)}
        >
          查看制作链：采集器 → 处理层 → 世界现场{' '}
          <span>{showProcess ? '收起 −' : '展开 ＋'}</span>
        </button>
        {showProcess && (
          <div>
            <p>
              <b>历史采集器</b>
              ：给出《史记》《汉书》叙述、现代地貌参考与未知项。史料没有指定本段道路的坐标、宽度、服饰或天气。
            </p>
            <p>
              <b>历史处理层</b>
              ：把一个历史选择拆成三处讲述点，制作山前路段、人物尺度和资产候选，并保留来源及演示标记。
            </p>
            <p>
              <b>历史世界现场</b>
              ：按场景包加载、提供漫游和点击说明；反馈遮挡、漂浮、加载与性能问题。
            </p>
          </div>
        )}
      </section>
      <footer className="single-footer">
        <span>History3D · 南缘绕行单场景原型</span>
        <div>
          <a href="/journey">查看六站路线</a>
          <a href="/cases">查看技术案例</a>
        </div>
      </footer>
    </main>
  )
}
