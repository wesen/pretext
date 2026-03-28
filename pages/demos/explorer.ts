import {
  prepare,
  prepareWithSegments,
  layout,
  layoutWithLines,
  layoutNextLine,
  clearCache,
  type PreparedText,
  type PreparedTextWithSegments,
  type LayoutCursor,
} from '../../src/layout.ts'
import { TEXTS } from '../../src/test-data.ts'

const FONT = '15px "Helvetica Neue", Helvetica, Arial, sans-serif'
const LINE_HEIGHT = 22
const CJK_FONT = '20px "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif CJK JP", serif'
const CJK_LINE_HEIGHT = 30

// ─── Helpers ───────────────────────────────────────────────────────

function $(id: string): HTMLElement {
  const el = document.getElementById(id)
  if (!el) throw new Error(`#${id} not found`)
  return el
}

function $input(id: string): HTMLInputElement {
  return $(id) as HTMLInputElement
}

function $textarea(id: string): HTMLTextAreaElement {
  return $(id) as HTMLTextAreaElement
}

function $canvas(id: string): HTMLCanvasElement {
  return $(id) as HTMLCanvasElement
}

function formatMs(ms: number): string {
  if (ms < 0.01) return '<0.01ms'
  if (ms < 1) return `${ms.toFixed(2)}ms`
  if (ms < 10) return `${ms.toFixed(1)}ms`
  return `${Math.round(ms)}ms`
}

function escapeSegmentText(text: string): string {
  return text
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
    .replace(/\u00AD/g, '\\u00AD')
    .replace(/\u00A0/g, '\\u00A0')
    .replace(/\u200B/g, '\\u200B')
    .replace(/\u2060/g, '\\u2060')
    .replace(/\uFEFF/g, '\\uFEFF')
    .replace(/ /g, '\u00B7')
}

function kindClass(kind: string): string {
  return `seg seg--${kind}`
}

function renderStats(container: HTMLElement, entries: { label: string; value: string }[]): void {
  container.innerHTML = ''
  for (const entry of entries) {
    const stat = document.createElement('div')
    stat.className = 'stat'
    stat.innerHTML = `<span class="stat-value">${entry.value}</span><span class="stat-label">${entry.label}</span>`
    container.appendChild(stat)
  }
}

// ─── Demo 1: The Problem (DOM vs Pretext comparison) ───────────────

function initProblemDemo(): void {
  const btn = $('problem-run')
  btn.addEventListener('click', runProblemComparison)
}

function runProblemComparison(): void {
  const texts = TEXTS.filter(t => t.text.length > 0).slice(0, 200)
  const font = FONT
  const lineHeight = LINE_HEIGHT
  const widths = [200, 300, 400]

  // DOM interleaved: write + read for each text (worst case)
  const container = document.createElement('div')
  container.style.cssText = 'position:absolute;visibility:hidden;top:-9999px;left:-9999px'
  document.body.appendChild(container)

  const block = document.createElement('div')
  block.style.cssText = `font:${font};line-height:${lineHeight}px;overflow-wrap:break-word;word-break:normal;white-space:normal`
  container.appendChild(block)

  const t0 = performance.now()
  for (const w of widths) {
    for (const t of texts) {
      block.style.width = `${w}px`
      block.textContent = t.text
      block.getBoundingClientRect() // force reflow
    }
  }
  const domInterleavedMs = performance.now() - t0

  // DOM batched: write all, then read all
  const blocks: HTMLDivElement[] = []
  for (const t of texts) {
    const b = document.createElement('div')
    b.style.cssText = `font:${font};line-height:${lineHeight}px;overflow-wrap:break-word;word-break:normal;white-space:normal;width:300px`
    b.textContent = t.text
    container.appendChild(b)
    blocks.push(b)
  }

  const t1 = performance.now()
  for (const b of blocks) {
    b.getBoundingClientRect()
  }
  const domBatchedMs = performance.now() - t1
  container.remove()

  // Pretext prepare
  clearCache()
  const t2 = performance.now()
  const prepared: PreparedText[] = []
  for (const t of texts) {
    prepared.push(prepare(t.text, font))
  }
  const prepareMs = performance.now() - t2

  // Pretext layout (×10 widths to make it visible)
  const t3 = performance.now()
  for (let round = 0; round < 10; round++) {
    for (const w of widths) {
      for (const p of prepared) {
        layout(p, w, lineHeight)
      }
    }
  }
  const layoutMs = performance.now() - t3

  // Render bars
  const maxMs = Math.max(domInterleavedMs, domBatchedMs, prepareMs, layoutMs, 1)
  const barHeight = (ms: number) => `${Math.max(4, (ms / maxMs) * 130)}px`

  ;($('problem-bar-dom') as HTMLElement).style.height = barHeight(domInterleavedMs)
  ;($('problem-bar-batch') as HTMLElement).style.height = barHeight(domBatchedMs)
  ;($('problem-bar-prep') as HTMLElement).style.height = barHeight(prepareMs)
  ;($('problem-bar-lay') as HTMLElement).style.height = barHeight(layoutMs)

  ;($('problem-val-dom') as HTMLElement).textContent = formatMs(domInterleavedMs)
  ;($('problem-val-batch') as HTMLElement).textContent = formatMs(domBatchedMs)
  ;($('problem-val-prep') as HTMLElement).textContent = formatMs(prepareMs)
  ;($('problem-val-lay') as HTMLElement).textContent = formatMs(layoutMs)
}

// ─── Demo 3: Analysis (interactive segmenter) ─────────────────────

let analysisState: {
  prepared: PreparedTextWithSegments | null
} = { prepared: null }

function initAnalysisDemo(): void {
  const input = $textarea('analysis-input')
  // Decode the escaped NBSP in the default value
  input.value = input.value.replace(/\\u00A0/g, '\u00A0')
  input.addEventListener('input', updateAnalysis)
  updateAnalysis()
}

function updateAnalysis(): void {
  const text = $textarea('analysis-input').value
  const prepared = prepareWithSegments(text, FONT)
  analysisState.prepared = prepared

  renderSegmentChips($('analysis-segments'), prepared)
  renderStats($('analysis-stats'), [
    { label: 'segments', value: String(prepared.segments.length) },
    { label: 'text length', value: String(text.length) },
  ])

  // Also update the measurement demo since it depends on the same text
  updateMeasurement()
}

function renderSegmentChips(container: HTMLElement, prepared: PreparedTextWithSegments): void {
  container.innerHTML = ''
  for (let i = 0; i < prepared.segments.length; i++) {
    const seg = document.createElement('span')
    const kind = prepared.kinds[i]!
    seg.className = kindClass(kind)
    const escaped = escapeSegmentText(prepared.segments[i]!)
    const display = escaped.length === 0 ? '\u2205' : escaped
    seg.innerHTML = `<span class="seg-kind">${kind}</span>${display}`
    seg.title = `${kind}: "${prepared.segments[i]}" (width: ${prepared.widths[i]?.toFixed(1)}px)`
    container.appendChild(seg)
  }
}

// ─── Demo 4: Measurement (width bars) ─────────────────────────────

function initMeasurementDemo(): void {
  // Updated from analysis demo
}

function updateMeasurement(): void {
  const prepared = analysisState.prepared
  if (!prepared) return

  const container = $('measurement-bars')
  container.innerHTML = ''

  const maxW = Math.max(1, ...prepared.widths)
  let totalWidth = 0

  for (let i = 0; i < prepared.segments.length; i++) {
    const width = prepared.widths[i]!
    totalWidth += width
    const bar = document.createElement('div')
    bar.className = 'width-bar'
    const height = Math.max(4, (width / maxW) * 80)
    const kind = prepared.kinds[i]!
    const colors: Record<string, string> = {
      text: '#c4a080',
      space: '#80c480',
      glue: '#8080c4',
      'soft-hyphen': '#c480c4',
      'zero-width-break': '#c4c480',
      'hard-break': '#e08080',
      tab: '#80b8e0',
      'preserved-space': '#80e0b8',
    }
    bar.innerHTML = `
      <div class="width-bar-fill" style="height:${height}px; background:${colors[kind] ?? '#ccc'}"></div>
      <div class="width-bar-label" title="${prepared.segments[i]} (${width.toFixed(1)}px)">${escapeSegmentText(prepared.segments[i]!)}</div>
    `
    bar.title = `${prepared.segments[i]}: ${width.toFixed(1)}px`
    container.appendChild(bar)
  }

  renderStats($('measurement-stats'), [
    { label: 'total width', value: `${totalWidth.toFixed(1)}px` },
    { label: 'segments', value: String(prepared.segments.length) },
  ])
}

// ─── Demo 5: Line Breaking ────────────────────────────────────────

function initLinebreakDemo(): void {
  const input = $textarea('linebreak-input')
  const slider = $input('linebreak-width')
  const valLabel = $('linebreak-width-val')

  input.addEventListener('input', updateLinebreak)
  slider.addEventListener('input', () => {
    valLabel.textContent = `${slider.value}px`
    updateLinebreak()
  })
  updateLinebreak()
}

function updateLinebreak(): void {
  const text = $textarea('linebreak-input').value
  const maxWidth = parseInt($input('linebreak-width').value, 10)
  const prepared = prepareWithSegments(text, FONT)
  const result = layoutWithLines(prepared, maxWidth, LINE_HEIGHT)

  renderLines($('linebreak-render'), result.lines, maxWidth, FONT, LINE_HEIGHT)
  renderStats($('linebreak-stats'), [
    { label: 'lines', value: String(result.lineCount) },
    { label: 'height', value: `${result.height}px` },
    { label: 'width', value: `${maxWidth}px` },
  ])
}

function renderLines(
  container: HTMLElement,
  lines: { text: string; width: number }[],
  maxWidth: number,
  font: string,
  lineHeight: number,
): void {
  container.innerHTML = ''
  container.style.width = `${maxWidth}px`
  container.style.setProperty('--lh', `${lineHeight}px`)

  for (const line of lines) {
    const div = document.createElement('div')
    div.className = 'line-render-line'
    div.style.font = font
    div.style.lineHeight = `${lineHeight}px`
    div.style.height = `${lineHeight}px`
    div.textContent = line.text
    div.title = `width: ${line.width.toFixed(1)}px`
    container.appendChild(div)
  }

  const marker = document.createElement('div')
  marker.className = 'line-render-width-marker'
  container.appendChild(marker)
}

// ─── Demo 6: CJK & Kinsoku ───────────────────────────────────────

function initCjkDemo(): void {
  const input = $textarea('cjk-input')
  const slider = $input('cjk-width')
  const valLabel = $('cjk-width-val')

  input.addEventListener('input', updateCjk)
  slider.addEventListener('input', () => {
    valLabel.textContent = `${slider.value}px`
    updateCjk()
  })
  updateCjk()
}

function updateCjk(): void {
  const text = $textarea('cjk-input').value
  const maxWidth = parseInt($input('cjk-width').value, 10)
  const prepared = prepareWithSegments(text, CJK_FONT)
  const result = layoutWithLines(prepared, maxWidth, CJK_LINE_HEIGHT)

  renderSegmentChips($('cjk-segments'), prepared)
  renderLines($('cjk-render'), result.lines, maxWidth, CJK_FONT, CJK_LINE_HEIGHT)
}

// ─── Demo 7: Soft Hyphens ─────────────────────────────────────────

function initShyDemo(): void {
  const input = $textarea('shy-input')
  const slider = $input('shy-width')
  const valLabel = $('shy-width-val')

  input.addEventListener('input', updateShy)
  slider.addEventListener('input', () => {
    valLabel.textContent = `${slider.value}px`
    updateShy()
  })
  updateShy()
}

function updateShy(): void {
  const text = $textarea('shy-input').value
  const maxWidth = parseInt($input('shy-width').value, 10)
  const prepared = prepareWithSegments(text, FONT)
  const result = layoutWithLines(prepared, maxWidth, LINE_HEIGHT)

  renderLines($('shy-render'), result.lines, maxWidth, FONT, LINE_HEIGHT)

  const hasShy = result.lines.some(l => l.text.endsWith('-'))
  renderStats($('shy-stats'), [
    { label: 'lines', value: String(result.lineCount) },
    { label: 'soft hyphen active', value: hasShy ? 'yes' : 'no' },
    { label: 'width', value: `${maxWidth}px` },
  ])
}

// ─── Demo 8: Shrink Wrap ──────────────────────────────────────────

let shrinkState = {
  running: false,
  animationFrame: 0,
}

function initShrinkDemo(): void {
  $('shrink-run').addEventListener('click', runShrinkDemo)
  $('shrink-reset').addEventListener('click', resetShrinkDemo)
  resetShrinkDemo()
}

function resetShrinkDemo(): void {
  shrinkState.running = false
  if (shrinkState.animationFrame) cancelAnimationFrame(shrinkState.animationFrame)
  const box = $('shrink-text-box')
  box.style.width = '100%'
  box.style.whiteSpace = ''
  $('shrink-log').innerHTML = ''
  $('shrink-status').textContent = ''
}

function runShrinkDemo(): void {
  if (shrinkState.running) return
  shrinkState.running = true

  const box = $('shrink-text-box')
  const log = $('shrink-log')
  const status = $('shrink-status')
  const text = box.textContent ?? ''
  const font = FONT
  const lineHeight = LINE_HEIGHT

  box.style.whiteSpace = 'normal'
  log.innerHTML = ''

  const maxWidth = box.parentElement!.clientWidth - 24
  box.style.width = `${maxWidth}px`

  const prepared = prepare(text, font)
  const initialResult = layout(prepared, maxWidth, lineHeight)
  const targetLineCount = initialResult.lineCount

  status.textContent = `Target: ${targetLineCount} lines`
  addLogEntry(log, `Initial: ${maxWidth}px → ${targetLineCount} lines`)

  let lo = 1
  let hi = maxWidth
  let best = maxWidth

  const steps: { lo: number; hi: number; mid: number; lines: number; fits: boolean }[] = []

  // Precompute all steps
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    const result = layout(prepared, mid, lineHeight)
    const fits = result.lineCount <= targetLineCount
    steps.push({ lo, hi, mid, lines: result.lineCount, fits })
    if (fits) {
      best = mid
      hi = mid
    } else {
      lo = mid + 1
    }
  }

  // Animate through steps
  let stepIndex = 0
  function animateStep(): void {
    if (!shrinkState.running || stepIndex >= steps.length) {
      box.style.width = `${best}px`
      status.textContent = `Tightest: ${best}px (${targetLineCount} lines)`
      addLogEntry(log, `Result: ${best}px — same ${targetLineCount} lines, ${maxWidth - best}px saved`)
      shrinkState.running = false
      return
    }

    const step = steps[stepIndex]!
    box.style.width = `${step.mid}px`
    addLogEntry(log, `[${step.lo}..${step.hi}] try ${step.mid}px → ${step.lines} lines ${step.fits ? '✓' : '✗'}`)
    stepIndex++
    shrinkState.animationFrame = requestAnimationFrame(() => {
      setTimeout(animateStep, 250)
    })
  }

  setTimeout(animateStep, 300)
}

function addLogEntry(container: HTMLElement, text: string): void {
  const line = document.createElement('div')
  line.textContent = text
  container.appendChild(line)
  container.scrollTop = container.scrollHeight
}

// ─── Demo 9: Variable Width (obstacle) ────────────────────────────

type ObstacleState = {
  x: number
  y: number
  dragging: boolean
  dragOffsetX: number
  dragOffsetY: number
}

const obstacleState: ObstacleState = {
  x: 380,
  y: 20,
  dragging: false,
  dragOffsetX: 0,
  dragOffsetY: 0,
}

const OBSTACLE_W = 120
const OBSTACLE_H = 100
const VARIABLE_FONT = '15px "Helvetica Neue", Helvetica, Arial, sans-serif'
const VARIABLE_LH = 22
const VARIABLE_PADDING = 12
const VARIABLE_TEXT = "Pretext lets you lay out text one line at a time with a different width for each line. This streaming API — layoutNextLine() — enables flows around arbitrary shapes: images, pull quotes, sidebars, or any obstacle the designer imagines. Each line asks for the available width at its vertical position, and the engine responds with exactly that line's content and measured width. No DOM measurement, no reflow, no guessing. The text simply flows, like water around a stone. This is possible because prepare() has already done all the expensive work: segmenting the text, applying script-specific rules, measuring widths with canvas. The layout phase is pure arithmetic on cached numbers. Call it a thousand times at a thousand different widths and it barely registers on a performance trace."

function initVariableDemo(): void {
  const wrap = $('variable-canvas-wrap')
  const obstacle = $('variable-obstacle')
  const canvas = $canvas('variable-canvas')

  const resizeObserver = new ResizeObserver(() => updateVariable())
  resizeObserver.observe(wrap)

  obstacle.addEventListener('mousedown', (e: MouseEvent) => {
    obstacleState.dragging = true
    const rect = obstacle.getBoundingClientRect()
    obstacleState.dragOffsetX = e.clientX - rect.left
    obstacleState.dragOffsetY = e.clientY - rect.top
    obstacle.style.cursor = 'grabbing'
    e.preventDefault()
  })

  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (!obstacleState.dragging) return
    const wrapRect = wrap.getBoundingClientRect()
    obstacleState.x = Math.max(0, Math.min(
      wrapRect.width - OBSTACLE_W,
      e.clientX - wrapRect.left - obstacleState.dragOffsetX,
    ))
    obstacleState.y = Math.max(0, Math.min(
      300 - OBSTACLE_H,
      e.clientY - wrapRect.top - obstacleState.dragOffsetY,
    ))
    updateVariable()
  })

  document.addEventListener('mouseup', () => {
    if (obstacleState.dragging) {
      obstacleState.dragging = false
      obstacle.style.cursor = 'grab'
    }
  })

  // Touch support
  obstacle.addEventListener('touchstart', (e: TouchEvent) => {
    const touch = e.touches[0]!
    obstacleState.dragging = true
    const rect = obstacle.getBoundingClientRect()
    obstacleState.dragOffsetX = touch.clientX - rect.left
    obstacleState.dragOffsetY = touch.clientY - rect.top
    e.preventDefault()
  })

  document.addEventListener('touchmove', (e: TouchEvent) => {
    if (!obstacleState.dragging) return
    const touch = e.touches[0]!
    const wrapRect = wrap.getBoundingClientRect()
    obstacleState.x = Math.max(0, Math.min(
      wrapRect.width - OBSTACLE_W,
      touch.clientX - wrapRect.left - obstacleState.dragOffsetX,
    ))
    obstacleState.y = Math.max(0, Math.min(
      300 - OBSTACLE_H,
      touch.clientY - wrapRect.top - obstacleState.dragOffsetY,
    ))
    updateVariable()
  })

  document.addEventListener('touchend', () => {
    obstacleState.dragging = false
  })

  // Initial size
  canvas.width = wrap.clientWidth
  canvas.height = 300
  canvas.style.height = '300px'
  updateVariable()
}

function updateVariable(): void {
  const canvas = $canvas('variable-canvas')
  const obstacle = $('variable-obstacle')
  const wrap = $('variable-canvas-wrap')
  const canvasWidth = wrap.clientWidth

  canvas.width = canvasWidth * (window.devicePixelRatio || 1)
  canvas.height = 300 * (window.devicePixelRatio || 1)
  canvas.style.width = `${canvasWidth}px`
  canvas.style.height = '300px'

  const ctx = canvas.getContext('2d')!
  const dpr = window.devicePixelRatio || 1
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, canvasWidth, 300)

  // Position obstacle div
  obstacle.style.left = `${obstacleState.x}px`
  obstacle.style.top = `${obstacleState.y}px`

  // Lay out text around obstacle
  const prepared = prepareWithSegments(VARIABLE_TEXT, VARIABLE_FONT)
  let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }
  let y = VARIABLE_PADDING

  ctx.font = VARIABLE_FONT
  ctx.fillStyle = '#201b18'

  const obstacleLeft = obstacleState.x
  const obstacleRight = obstacleState.x + OBSTACLE_W
  const obstacleTop = obstacleState.y
  const obstacleBottom = obstacleState.y + OBSTACLE_H
  const obstaclePadding = 10

  while (y + VARIABLE_LH <= 300 - VARIABLE_PADDING) {
    const lineTop = y
    const lineBottom = y + VARIABLE_LH
    let lineX = VARIABLE_PADDING
    let lineWidth = canvasWidth - VARIABLE_PADDING * 2

    // Check if this line overlaps the obstacle
    if (lineBottom > obstacleTop && lineTop < obstacleBottom) {
      // Obstacle overlaps this line band
      const leftGap = obstacleLeft - obstaclePadding - VARIABLE_PADDING
      const rightGap = canvasWidth - VARIABLE_PADDING - (obstacleRight + obstaclePadding)

      if (leftGap >= rightGap && leftGap > 30) {
        // Use left side
        lineWidth = leftGap
        lineX = VARIABLE_PADDING
      } else if (rightGap > 30) {
        // Use right side
        lineX = obstacleRight + obstaclePadding
        lineWidth = rightGap
      } else {
        // Skip this line (obstacle too wide)
        y += VARIABLE_LH
        continue
      }
    }

    const line = layoutNextLine(prepared, cursor, lineWidth)
    if (line === null) break

    ctx.fillText(line.text, lineX, y + VARIABLE_LH * 0.78)
    cursor = line.end
    y += VARIABLE_LH
  }
}

// ─── Demo 10: Performance ─────────────────────────────────────────

function initPerfDemo(): void {
  $('perf-run').addEventListener('click', runPerfBenchmark)
}

function runPerfBenchmark(): void {
  const texts = TEXTS.filter(t => t.text.length > 0)
  // Repeat to get ~200 texts
  const batch: string[] = []
  while (batch.length < 200) {
    for (const t of texts) {
      batch.push(t.text)
      if (batch.length >= 200) break
    }
  }

  const font = FONT
  const lineHeight = LINE_HEIGHT
  const widths = [200, 300, 400, 500]

  clearCache()

  // Time prepare
  const t0 = performance.now()
  const prepared: PreparedText[] = []
  for (const text of batch) {
    prepared.push(prepare(text, font))
  }
  const prepareMs = performance.now() - t0

  // Time layout (multiple widths)
  const t1 = performance.now()
  for (const w of widths) {
    for (const p of prepared) {
      layout(p, w, lineHeight)
    }
  }
  const layoutMs = performance.now() - t1
  const layoutPerText = layoutMs / (batch.length * widths.length)

  // Render bars
  const maxMs = Math.max(prepareMs, layoutMs, 0.1)

  const barHeight = (ms: number) => `${Math.max(4, (ms / maxMs) * 130)}px`

  ;($('perf-bar-prep') as HTMLElement).style.height = barHeight(prepareMs)
  ;($('perf-bar-lay') as HTMLElement).style.height = barHeight(layoutMs)
  ;($('perf-bar-layper') as HTMLElement).style.height = barHeight(layoutPerText * 100)

  ;($('perf-val-prep') as HTMLElement).textContent = formatMs(prepareMs)
  ;($('perf-val-lay') as HTMLElement).textContent = formatMs(layoutMs)
  ;($('perf-val-layper') as HTMLElement).textContent = formatMs(layoutPerText)

  renderStats($('perf-stats'), [
    { label: 'texts prepared', value: String(batch.length) },
    { label: 'layout calls', value: String(batch.length * widths.length) },
    { label: 'prepare / text', value: formatMs(prepareMs / batch.length) },
    { label: 'layout / text / width', value: formatMs(layoutPerText) },
  ])
}

// ─── Boot ─────────────────────────────────────────────────────────

function boot(): void {
  initProblemDemo()
  initAnalysisDemo()
  initMeasurementDemo()
  initLinebreakDemo()
  initCjkDemo()
  initShyDemo()
  initShrinkDemo()
  initVariableDemo()
  initPerfDemo()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true })
} else {
  boot()
}
