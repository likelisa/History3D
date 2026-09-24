import { useCallback, useEffect, useState } from 'react'
import {
  cases,
  loadPackage,
  sourceGaps,
  type AssetStates,
  type CaseId,
  type Package,
} from './demo/cases'
import { SceneView, type View } from './demo/SceneView'

const layerNames = ['历史采集器', '历史处理层', '历史世界现场']
export default function App() {
  const [caseId, setCaseId] = useState<CaseId>('complete')
  const [pack, setPack] = useState<Package | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState('bridge')
  const [view, setView] = useState<View>('overview')
  const [reset, setReset] = useState(0)
  const [reload, setReload] = useState(0)
  const [assets, setAssets] = useState<AssetStates>({})
  const [layer, setLayer] = useState(1)
  const [checks, setChecks] = useState<Record<string, boolean>>({})
  const [localModel, setLocalModel] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const current = cases.find((c) => c.id === caseId)!
  useEffect(() => {
    const controller = new AbortController()
    setPack(null)
    setError('')
    setAssets({})
    setNotice('')
    loadPackage(caseId, controller.signal)
      .then((data) => {
        setPack(data)
        setSelected(data.entities[0].id)
        setView('overview')
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message)
      })
    return () => controller.abort()
  }, [caseId, reload])
  useEffect(
    () => () => {
      if (localModel) URL.revokeObjectURL(localModel)
    },
    [localModel],
  )
  const onSelect = useCallback((id: string) => setSelected(id), [])
  const onAssets = useCallback((state: AssetStates) => setAssets(state), [])
  const onError = useCallback((message: string) => setError(message), [])
  const entity = pack?.entities.find((e) => e.id === selected)
  const gaps = pack ? sourceGaps(pack) : []
  const failed = Object.values(assets).filter(
    (a) => a.status === 'fallback',
  ).length
  const loading = Object.values(assets).filter(
    (a) => a.status === 'loading',
  ).length
  const ready = Object.values(assets).filter((a) => a.status === 'ready').length
  const statuses = [
    gaps.length ? '待补资料' : '样例已提供',
    failed ? '资产待补' : '手工编排',
    failed
      ? '占位降级'
      : loading
        ? '模型加载中'
        : error
          ? '加载异常'
          : pack
            ? '场景已显示'
            : '加载中',
  ]
  const switchCase = (id: CaseId) => {
    setCaseId(id)
    setLocalModel(null)
    setChecks({})
    setView('overview')
    setLayer(1)
  }
  const exportScene = () => {
    if (!pack) return
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(pack.scene, null, 2)], {
        type: 'application/json',
      }),
    )
    const a = document.createElement('a')
    a.href = url
    a.download = `${caseId}-scene.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setNotice('已导出场景配置。模型与资料文件需随完整场景包另行交付。')
  }
  return (
    <main className="workbench">
      <header className="topbar">
        <a className="brand" href="/">
          H<span>3D</span>
          <i />
          历史空间实验室
        </a>
        <span className="build-tag">处理层 · 案例验收 v0.1</span>
        <span className="local-badge">
          <i />
          本地演示
        </span>
      </header>
      <section className="intro">
        <div>
          <span className="eyebrow">从资料，到人的尺度</span>
          <h1>先走通一个案例，再看缺哪一层。</h1>
          <p>选择左侧案例 → 检查三层交接 → 在场景里逐项验收。</p>
        </div>
        <div className="intro-note">
          <strong>这是一组测试样例</strong>
          <span>渡口为虚构设定；生成候选不等于历史复原。</span>
        </div>
      </section>
      <section className="layer-strip" aria-label="三层交接状态">
        {layerNames.map((name, i) => (
          <button
            key={name}
            className={`layer-card ${layer === i ? 'active' : ''}`}
            aria-pressed={layer === i}
            onClick={() => {
              setLayer(i)
              document
                .getElementById('handoff')
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
          >
            <span className="layer-number">0{i + 1}</span>
            <span>
              <strong>{name}</strong>
              <small>
                {['待接真实史料', '待做尺度与朝向校准', '待做行走与测距'][i]}
              </small>
            </span>
            <em
              className={
                (i === 0 && gaps.length) || (i > 0 && failed)
                  ? 'status warn'
                  : 'status'
              }
            >
              {statuses[i]}
            </em>
            {i < 2 && <b className="connector">→</b>}
          </button>
        ))}
      </section>
      <div className="workspace">
        <aside className="case-list">
          <div className="section-label">
            测试案例 <span>04</span>
          </div>
          {cases.map((c) => (
            <button
              key={c.id}
              className={`case-button ${caseId === c.id ? 'chosen' : ''}`}
              onClick={() => switchCase(c.id)}
              aria-pressed={caseId === c.id}
            >
              <span className="case-top">
                <i>{c.number}</i>
                <small>{c.tag}</small>
              </span>
              <strong>{c.name}</strong>
              <p>{c.description}</p>
            </button>
          ))}
          <div className="case-hint">
            故障案例会故意失败。
            <br />
            测试的是：能否定位问题并继续查看。
          </div>
        </aside>
        <section className="stage-panel">
          <div className="stage-header">
            <div>
              <span className="eyebrow">CASE {current.number}</span>
              <h2>{current.name}</h2>
            </div>
            <button
              className="text-button"
              onClick={() => {
                setChecks({})
                setReload((v) => v + 1)
              }}
            >
              ↻ 重新加载
            </button>
          </div>
          <div className="scene-wrap">
            {pack && !error && (
              <SceneView
                pack={pack}
                view={view}
                reset={reset}
                selected={selected}
                localModel={localModel}
                onSelect={onSelect}
                onAssets={onAssets}
                onError={onError}
              />
            )}
            {!pack && !error && (
              <div className="scene-message">正在读取案例包…</div>
            )}
            {error && (
              <div className="scene-message error">
                <strong>案例暂时无法显示</strong>
                <p>{error}</p>
                <button onClick={() => setReload((v) => v + 1)}>
                  重新尝试
                </button>
              </div>
            )}
            <div className="scene-topline">
              <span>
                {caseId === 'tripo'
                  ? localModel
                    ? '本地文件 · 来源待核对'
                    : '真实生成候选'
                  : '虚构测试场景 · 非史实复原'}
              </span>
              <span>
                {ready}/{pack?.entities.length ?? 0} 对象就绪
                {failed ? ` · ${failed} 个占位` : ''}
              </span>
            </div>
            <div className="view-controls" role="group" aria-label="场景视角">
              {(
                [
                  ['overview', '全景'],
                  ['human', '人尺度 1.7m'],
                  ['top', '俯视'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  aria-pressed={view === id}
                  className={view === id ? 'selected' : ''}
                  onClick={() => setView(id)}
                >
                  {label}
                </button>
              ))}
              <button
                onClick={() => {
                  setView('overview')
                  setReset((v) => v + 1)
                }}
              >
                复位
              </button>
            </div>
            <div className="canvas-hint">
              拖动旋转 · 滚轮缩放 · 点击物件查看
            </div>
          </div>
          <div className="expected">
            <span>预期结果</span>
            <p>{current.expected}</p>
          </div>
          {caseId === 'tripo' && (
            <div className="file-row">
              <label className="file-button">
                选择本地 GLB
                <input
                  type="file"
                  accept=".glb"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) {
                      setLocalModel(URL.createObjectURL(f))
                      setChecks({})
                      setError('')
                    }
                  }}
                />
              </label>
              <small>
                文件仅在浏览器中读取，不上传。没有本机候选时可用此入口。
              </small>
            </div>
          )}
          <div className="checklist">
            <div className="checklist-title">
              <strong>我来验收</strong>
              <small>
                手动确认{' '}
                {
                  current.checks.filter((_, i) => checks[`${caseId}-${i}`])
                    .length
                }
                /3
              </small>
            </div>
            {current.checks.map((text, i) => (
              <label key={text}>
                <input
                  type="checkbox"
                  checked={!!checks[`${caseId}-${i}`]}
                  onChange={(e) =>
                    setChecks((old) => ({
                      ...old,
                      [`${caseId}-${i}`]: e.target.checked,
                    }))
                  }
                />
                <span>{text}</span>
              </label>
            ))}
          </div>
        </section>
        <aside className="inspector">
          <div className="section-label">
            物件检查 <span>{pack?.entities.length ?? 0}</span>
          </div>
          <div className="object-tabs">
            {pack?.entities.map((e) => (
              <button
                key={e.id}
                className={selected === e.id ? 'active' : ''}
                aria-pressed={selected === e.id}
                onClick={() => setSelected(e.id)}
              >
                {e.name}
              </button>
            ))}
          </div>
          {entity && (
            <>
              <h3>{localModel ? '本地 GLB 预览' : entity.name}</h3>
              <span
                className={`status ${entity.evidence === 'recorded' ? 'warn' : ''}`}
              >
                {entity.evidence === 'recorded'
                  ? '声称史料记载 · 待核对'
                  : '演示设定'}
              </span>
              <dl>
                <dt>资产状态</dt>
                <dd
                  className={
                    assets[entity.id]?.status === 'fallback' ? 'error-text' : ''
                  }
                >
                  {assets[entity.id]?.message ?? '等待场景加载'}
                </dd>
                <dt>
                  {entity.render_kind === 'model'
                    ? '显示包围盒 · 非实际尺寸'
                    : '设定尺寸 · 长 × 高 × 宽'}
                </dt>
                <dd className="dimensions">
                  {entity.dimensions_m.join(' × ')} <small>m</small>
                </dd>
                <dt>尺寸依据</dt>
                <dd>{entity.dimensions_basis}</dd>
                <dt>资料来源</dt>
                {localModel ? (
                  <dd className="source-card">
                    <strong>本地选择的模型</strong>
                    <p>
                      来源待核对。此文件尚未关联 Tripo
                      任务或历史资料，仅在浏览器中预览。
                    </p>
                  </dd>
                ) : (
                  entity.source_ids.map((id) => {
                    const s = pack!.sources.find((x) => x.id === id)
                    return (
                      <dd
                        key={id}
                        className={s ? 'source-card' : 'source-card missing'}
                      >
                        <strong>{s?.title ?? `缺失来源：${id}`}</strong>
                        <p>
                          {s?.excerpt ??
                            '请历史采集器补齐原始资料，再确认事实标记。'}
                        </p>
                      </dd>
                    )
                  })
                )}
              </dl>
              {pack?.scene.story_points
                .filter((p) => p.entity_id === entity.id)
                .map((p) => (
                  <div className="story-note" key={p.id}>
                    {p.text}
                  </div>
                ))}
            </>
          )}
          <button
            className="export-button"
            onClick={exportScene}
            disabled={!pack || !!localModel}
          >
            ↓ 导出 scene.json
          </button>
          <p className="notice" role="status">
            {localModel
              ? '本地文件仅供预览，导出原案例请重新选择此案例。'
              : notice}
          </p>
        </aside>
      </div>
      <section className="handoff" id="handoff">
        <div>
          <span className="eyebrow">正在检查 · 第 {layer + 1} 层</span>
          <h2>
            {layerNames[layer]}：
            {
              [
                '来源能找到吗？',
                '空间和模型准备好了吗？',
                '用户能看见并理解吗？',
              ][layer]
            }
          </h2>
        </div>
        <div className="handoff-grid">
          {layer === 0 ? (
            <>
              <article>
                <h4>输入 / 已有</h4>
                <p>
                  虚构资料说明和稳定来源
                  ID。正常案例可追溯；故障案例故意缺一条。
                </p>
              </article>
              <article>
                <h4>交给下一层</h4>
                <p>
                  sources.json · story.md。当前来源检查：
                  {gaps.length ? `${gaps.length} 条引用缺失` : '未发现缺失引用'}
                  。
                </p>
              </article>
              <article className="gap">
                <h4>还缺什么</h4>
                <p>
                  真实史料采集、证据审核、参考图整理。当前是手工样例，不是自动采集。
                </p>
              </article>
            </>
          ) : layer === 1 ? (
            <>
              <article>
                <h4>输入 / 已有</h4>
                <p>
                  读取对象与摆放清单；程序几何、真实 GLB
                  候选和缺失模型均可预览。
                </p>
              </article>
              <article>
                <h4>交给下一层</h4>
                <p>
                  entities.json · scene.json ·
                  资产路径。候选保持候选，失败显示占位。
                </p>
              </article>
              <article className="gap">
                <h4>还缺什么</h4>
                <p>
                  从资料自动提取对象、图生模型、真实尺寸和朝向校准、资产验收与采用。
                </p>
              </article>
            </>
          ) : (
            <>
              <article>
                <h4>输入 / 已有</h4>
                <p>
                  实际读取场景 JSON，支持物件选择、来源查看、全景 / 人尺度 /
                  俯视。
                </p>
              </article>
              <article>
                <h4>现在可以测试</h4>
                <p>
                  加载、模型失败提示、相机视角、导出配置。橙色表示模型占位。
                </p>
              </article>
              <article className="gap">
                <h4>还缺什么</h4>
                <p>
                  第一人称行走与碰撞、两点测距、正式故事流程和手机性能验收。
                </p>
              </article>
            </>
          )}
        </div>
        <details>
          <summary>查看当前层的交接数据</summary>
          <pre>
            {pack
              ? JSON.stringify(
                  layer === 0
                    ? pack.sources
                    : layer === 1
                      ? pack.entities
                      : pack.scene,
                  null,
                  2,
                )
              : '等待案例加载'}
          </pre>
        </details>
      </section>
      <footer>
        History3D · 三层协作验收台{' '}
        <span>几何样例 ≠ 历史复原　/　显示归一化 ≠ 真实尺度</span>
      </footer>
    </main>
  )
}
