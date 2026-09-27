const story = document.getElementById('story')
const feedback = document.getElementById('feedback')
const clarify = document.getElementById('clarify')
const message = document.getElementById('message')
const question = document.getElementById('question')
let feedbackId = null

async function send(url, payload) {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
  let result
  try { result = JSON.parse(await response.text()) }
  catch { throw new Error(response.ok ? '服务响应格式无效，请稍后重试。' : `提交失败（HTTP ${response.status}），请稍后重试。`) }
  if (!response.ok) throw new Error(result?.error || `提交失败（HTTP ${response.status}）`)
  if (!result || typeof result !== 'object') throw new Error('服务响应格式无效，请稍后重试。')
  return result
}

function showResult(result) {
  feedbackId = result.id
  if (result.question) {
    question.textContent = result.question
    clarify.style.display = 'block'
    message.textContent = '已收到。请回答下面的问题，帮助我们找到准确位置。'
    document.getElementById('answer').focus()
  } else {
    clarify.style.display = 'none'
    message.textContent = result.status === 'duplicate'
      ? '已收到。这个问题之前有人提出过，我们保留了你的反馈并关联到已有记录。'
      : '已收到。采集层会重新核对资料，处理结果需要人工评审。'
  }
}

fetch('/api/collector/stories').then((response) => response.json()).then((stories) => {
  for (const item of stories) {
    const option = document.createElement('option')
    option.value = item.storyId
    option.textContent = `${item.title}${item.demo ? '（技术演示）' : ''}`
    story.append(option)
  }
  message.textContent = stories.length ? '请选择故事并描述问题。' : '目前没有可选择的故事，也可以直接描述问题，稍后补充故事名称。'
}).catch(() => { message.textContent = '故事列表暂时不可用，请稍后重试。' })

feedback.addEventListener('submit', async (event) => {
  event.preventDefault()
  try {
    const text = document.getElementById('text').value.trim()
    const context = story.value ? { storyId: story.value } : {}
    showResult(await send('/api/collector/feedback', { text, context }))
  } catch (error) { message.textContent = error.message }
})

clarify.addEventListener('submit', async (event) => {
  event.preventDefault()
  if (!feedbackId) return
  try {
    const answer = document.getElementById('answer').value.trim()
    showResult(await send(`/api/collector/feedback/${feedbackId}/clarify`, { answer }))
    document.getElementById('answer').value = ''
  } catch (error) { message.textContent = error.message }
})
