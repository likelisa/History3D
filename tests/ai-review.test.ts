import { describe, expect, it } from 'vitest'

import {
  buildComment,
  chunkDiff,
  coverageLines,
  describeEmptyReview,
  mergeIssues,
  parseReviewContent,
  parseSseLine,
  readReviewResponse,
  truncateDiff,
} from '../scripts/ai-review-lib.mjs'

/**
 * AI 审查此前只在真实网关上手动跑过，失败原因（模型名大小写、思考长度不受控）
 * 都是靠读日志猜出来的。这些是其中最会反复踩到的规则，放在这里固定住。
 */

const file = (path: string, body = '+const value = 1') =>
  `diff --git a/${path} b/${path}\nindex 111..222 100644\n--- a/${path}\n+++ b/${path}\n@@ -1,1 +1,1 @@\n${body}`

describe('chunkDiff：按文件边界切块', () => {
  it('把多个小文件合并进同一块，不按字符硬切', () => {
    const diff = [file('a.ts'), file('b.ts'), file('c.ts')].join('\n')
    const chunks = chunkDiff(diff, 10_000)

    expect(chunks).toHaveLength(1)
    expect(chunks[0]!.files).toEqual(['a.ts', 'b.ts', 'c.ts'])
    expect(chunks[0]!.index).toBe(0)
    expect(chunks[0]!.totalChunks).toBe(1)
  })

  it('块之间不重叠，切点在文件之间而不是文件内部', () => {
    const diff = [file('a.ts'), file('b.ts'), file('c.ts')].join('\n')
    const perFile = file('a.ts').length
    const chunks = chunkDiff(diff, perFile + 10)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.map((chunk) => chunk.files)).toEqual([['a.ts'], ['b.ts'], ['c.ts']])
    for (const chunk of chunks) {
      // 每一块都应以自己的 diff 头开始，而不是从半个 hunk 开始
      expect(chunk.text.startsWith('diff --git ')).toBe(true)
    }
  })

  it('按顺序编号，并给出总块数', () => {
    const diff = [file('a.ts'), file('b.ts'), file('c.ts')].join('\n')
    const chunks = chunkDiff(diff, file('a.ts').length + 10)

    expect(chunks.map((chunk) => chunk.index)).toEqual([0, 1, 2])
    expect(chunks.every((chunk) => chunk.totalChunks === chunks.length)).toBe(true)
  })

  it('单个文件就超预算时按行硬切，不让任何一块撑爆请求', () => {
    const huge = file('huge.ts', Array.from({ length: 200 }, (_, i) => `+line ${i}`).join('\n'))
    const chunks = chunkDiff(huge, 500)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.chars).toBeLessThanOrEqual(500)
      expect(chunk.files).toEqual(['huge.ts'])
    }
  })

  it('空 diff 不产生块', () => {
    expect(chunkDiff('', 1000)).toEqual([])
  })

  it('预算不是正数时直接报错，而不是悄悄切出怪东西', () => {
    expect(() => chunkDiff(file('a.ts'), 0)).toThrow(/positive number/)
  })
})

describe('parseSseLine：解析网关的流式分片', () => {
  it('从 delta 里取出正文', () => {
    const event = parseSseLine('data: {"choices":[{"delta":{"content":"hi"},"finish_reason":null}]}')
    expect(event?.content).toBe('hi')
    expect(event?.reasoning).toBe('')
  })

  it('把推理模型的思考内容和正文分开取', () => {
    const event = parseSseLine('data: {"choices":[{"delta":{"reasoning_content":"想想"},"finish_reason":null}]}')
    expect(event?.reasoning).toBe('想想')
    expect(event?.content).toBe('')
  })

  it('取出结束原因与用量', () => {
    const event = parseSseLine('data: {"choices":[{"delta":{},"finish_reason":"length"}],"usage":{"completion_tokens":8000}}')
    expect(event?.finishReason).toBe('length')
    expect(event?.completionTokens).toBe(8000)
  })

  it('忽略 [DONE]、注释行、非 data 行与坏 JSON', () => {
    expect(parseSseLine('data: [DONE]')).toBeNull()
    expect(parseSseLine(': keep-alive')).toBeNull()
    expect(parseSseLine('event: ping')).toBeNull()
    expect(parseSseLine('data: {不是 json')).toBeNull()
  })
})

describe('readReviewResponse：非流式响应的判定依据', () => {
  it('统计思考长度，便于区分「只在想」和「真的空」', () => {
    const response = readReviewResponse({
      choices: [{ message: { content: '', reasoning_content: '嗯……' }, finish_reason: 'length' }],
    })
    expect(response.content).toBe('')
    expect(response.reasoningChars).toBe(3)
    expect(response.finishReason).toBe('length')
  })

  it('缺失字段时不抛异常', () => {
    expect(readReviewResponse({}).reasoningChars).toBe(0)
  })
})

describe('describeEmptyReview：说清是哪种「没给出结果」', () => {
  it('只有思考内容时，点名推理模型并给出可操作的方向', () => {
    const message = describeEmptyReview({ reasoningChars: 28058, finishReason: 'length' })
    expect(message).toContain('28058')
    expect(message).toContain('推理模型')
    expect(message).toContain('AI_CHUNK_CHARS')
  })

  it('撞上 max_tokens 但没产出正文时，提示调大上限', () => {
    expect(describeEmptyReview({ reasoningChars: 0, finishReason: 'length' })).toContain('AI_MAX_TOKENS')
  })

  it('什么都没有时保持朴素描述', () => {
    expect(describeEmptyReview({})).toContain('空响应')
  })
})

describe('mergeIssues：合并各分块的判断', () => {
  it('重复的判断只保留一条', () => {
    const duplicate = { severity: 'warning', file: 'a.ts', line: 3, description: 'same' }
    const merged = mergeIssues([[duplicate], [{ ...duplicate }]])
    expect(merged).toHaveLength(1)
  })

  it('需要人工确认的阻塞项排在前面', () => {
    const merged = mergeIssues([
      [{ severity: 'info', file: 'a.ts', line: 1, description: 'note' }],
      [{ severity: 'blocking', file: 'b.ts', line: 2, description: 'blocker' }],
    ])
    expect(merged.map((issue) => issue.severity)).toEqual(['blocking', 'info'])
  })

  it('容忍空块与缺字段的条目', () => {
    expect(mergeIssues([[], [undefined as never], null as never])).toHaveLength(1)
  })
})

describe('coverageLines：如实标注覆盖范围', () => {
  it('全部成功时只报覆盖比例', () => {
    expect(coverageLines({ totalChunks: 5, reviewedChunks: 5, failedChunks: [] })).toEqual(['本次审查覆盖 5/5 块。'])
  })

  it('有失败分块时逐条列出，并带上涉及的文件', () => {
    const lines = coverageLines({
      totalChunks: 5,
      reviewedChunks: 3,
      failedChunks: [{ index: 3, files: ['a.ts', 'b.ts'], reason: '超时' }],
    })
    expect(lines[0]).toBe('本次审查覆盖 3/5 块。')
    expect(lines[1]).toContain('第 4 块未审查')
    expect(lines[1]).toContain('a.ts')
    expect(lines[1]).toContain('超时')
  })

  it('没有覆盖信息时不产生额外文字', () => {
    expect(coverageLines(undefined)).toEqual([])
  })
})

describe('截断与解析的既有约定', () => {
  it('只在行边界截断，并写清丢了多少', () => {
    const result = truncateDiff('a\nb\nc\nd\n', 4)
    expect(result.truncated).toBe(true)
    expect(result.text).toContain('truncated')
    expect(result.text.startsWith('a\nb')).toBe(true)
  })

  it('容忍模型把 JSON 包在代码块里', () => {
    expect(parseReviewContent('```json\n{"summary":"ok"}\n```')).toEqual({ summary: 'ok' })
  })

  it('评论里会带上覆盖说明', () => {
    const comment = buildComment({ summary: 's' }, [], {
      coverage: { totalChunks: 2, reviewedChunks: 1, failedChunks: [{ index: 1, files: [], reason: '超时' }] },
    })
    expect(comment).toContain('本次审查覆盖 1/2 块。')
    expect(comment).toContain('第 2 块未审查')
  })
})
