import { layout, prepareWithSegments, walkLineRanges, type PreparedTextWithSegments } from '../../src/layout.ts'

type WrapMetrics = {
  lineCount: number
  height: number
  maxLineWidth: number
}

type BubbleState = {
  prepared: PreparedTextWithSegments
  shrinkDiv: HTMLDivElement
  cssDiv: HTMLDivElement
}

const FONT = '15px "Helvetica Neue", Helvetica, Arial, sans-serif'
const LINE_HEIGHT = 20
const PADDING_H = 12
const PADDING_V = 8
const BUBBLE_MAX_RATIO = 0.8

const messages: { text: string, sent: boolean }[] = [
  { text: 'Yo did you see the new Pretext library?', sent: false },
  { text: 'yeah! It measures text without the DOM. Pure JavaScript arithmetic', sent: true },
  { text: "That shrinkwrap demo is wild it finds the exact minimum width for multiline text. CSS can't do that.", sent: false },
  { text: '성능 최적화가 정말 많이 되었더라고요 🎉', sent: true },
  { text: 'Oh wow it handles CJK and emoji too??', sent: false },
  { text: 'everything. Mixed bidi, grapheme clusters, whatever you want. Try resizing', sent: true },
  { text: "the best part: zero layout reflow. You could shrinkwrap 10,000 bubbles and the browser wouldn't even blink", sent: true },
]

const domCache = {
  cssPanel: getRequiredSection('panel-css'),
  shrinkPanel: getRequiredSection('panel-shrink'),
  chatShrink: getRequiredDiv('chat-shrink'),
  chatCss: getRequiredDiv('chat-css'),
  slider: getRequiredInput('slider'),
  valLabel: getRequiredSpan('val'),
  cssWaste: getRequiredSpan('css-waste'),
  shrinkWaste: getRequiredSpan('shrink-waste'),
}

const bubbles: BubbleState[] = []
let requestedChatWidth = 340

for (let index = 0; index < messages.length; index++) {
  const message = messages[index]!
  const prepared = prepareWithSegments(message.text, FONT)

  const shrinkDiv = document.createElement('div')
  shrinkDiv.className = `msg ${message.sent ? 'sent' : 'recv'}`
  shrinkDiv.style.font = FONT
  shrinkDiv.style.lineHeight = `${LINE_HEIGHT}px`
  shrinkDiv.textContent = message.text
  domCache.chatShrink.appendChild(shrinkDiv)

  const cssDiv = document.createElement('div')
  cssDiv.className = `msg ${message.sent ? 'sent' : 'recv'}`
  cssDiv.style.font = FONT
  cssDiv.style.lineHeight = `${LINE_HEIGHT}px`
  cssDiv.textContent = message.text
  domCache.chatCss.appendChild(cssDiv)

  bubbles.push({ prepared, shrinkDiv, cssDiv })
}

domCache.slider.addEventListener('input', () => {
  requestedChatWidth = Number.parseInt(domCache.slider.value, 10)
  syncWidth()
})

window.addEventListener('resize', () => {
  syncWidth()
})

syncWidth()

function getRequiredDiv(id: string): HTMLDivElement {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLDivElement)) throw new Error(`#${id} not found`)
  return element
}

function getRequiredSection(id: string): HTMLElement {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLElement)) throw new Error(`#${id} not found`)
  return element
}

function getRequiredInput(id: string): HTMLInputElement {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLInputElement)) throw new Error(`#${id} not found`)
  return element
}

function getRequiredSpan(id: string): HTMLSpanElement {
  const element = document.getElementById(id)
  if (!(element instanceof HTMLSpanElement)) throw new Error(`#${id} not found`)
  return element
}

function collectWrapMetrics(prepared: PreparedTextWithSegments, maxWidth: number): WrapMetrics {
  let maxLineWidth = 0
  const lineCount = walkLineRanges(prepared, maxWidth, line => {
    if (line.width > maxLineWidth) maxLineWidth = line.width
  })
  return {
    lineCount,
    height: lineCount * LINE_HEIGHT,
    maxLineWidth,
  }
}

function findTightWrapMetrics(prepared: PreparedTextWithSegments, maxWidth: number): WrapMetrics {
  const initial = collectWrapMetrics(prepared, maxWidth)
  let lo = 1
  let hi = Math.max(1, Math.ceil(maxWidth))

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    const midLineCount = layout(prepared, mid, LINE_HEIGHT).lineCount
    if (midLineCount <= initial.lineCount) {
      hi = mid
    } else {
      lo = mid + 1
    }
  }

  return collectWrapMetrics(prepared, lo)
}

function syncWidth(): void {
  const minWidth = Number.parseInt(domCache.slider.min, 10)
  const maxWidth = getMaxChatWidth(minWidth)
  const chatWidth = Math.min(requestedChatWidth, maxWidth)

  domCache.slider.max = String(maxWidth)
  domCache.slider.value = String(chatWidth)
  domCache.valLabel.textContent = `${chatWidth}px`
  updateBubbles(chatWidth)
}

function getMaxChatWidth(minWidth: number): number {
  const cssWidth = getPanelContentWidth(domCache.cssPanel)
  const shrinkWidth = getPanelContentWidth(domCache.shrinkPanel)
  return Math.max(minWidth, Math.floor(Math.min(cssWidth, shrinkWidth)))
}

function getPanelContentWidth(panel: HTMLElement): number {
  const rect = panel.getBoundingClientRect()
  const styles = getComputedStyle(panel)
  const paddingLeft = Number.parseFloat(styles.paddingLeft) || 0
  const paddingRight = Number.parseFloat(styles.paddingRight) || 0
  return Math.max(1, rect.width - paddingLeft - paddingRight)
}

function updateBubbles(chatWidth: number): void {
  domCache.chatShrink.style.width = `${chatWidth}px`
  domCache.chatCss.style.width = `${chatWidth}px`

  const bubbleMaxWidth = Math.floor(chatWidth * BUBBLE_MAX_RATIO)
  const contentMaxWidth = bubbleMaxWidth - PADDING_H * 2

  let totalWastedPixels = 0

  for (let index = 0; index < bubbles.length; index++) {
    const bubble = bubbles[index]!
    const cssMetrics = collectWrapMetrics(bubble.prepared, contentMaxWidth)
    const tightMetrics = findTightWrapMetrics(bubble.prepared, contentMaxWidth)

    const cssWidth = Math.ceil(cssMetrics.maxLineWidth) + PADDING_H * 2
    const tightWidth = Math.ceil(tightMetrics.maxLineWidth) + PADDING_H * 2
    const cssHeight = cssMetrics.height + PADDING_V * 2
    totalWastedPixels += Math.max(0, cssWidth - tightWidth) * cssHeight

    bubble.shrinkDiv.style.maxWidth = `${bubbleMaxWidth}px`
    bubble.shrinkDiv.style.width = `${tightWidth}px`

    bubble.cssDiv.style.maxWidth = `${bubbleMaxWidth}px`
    bubble.cssDiv.style.width = 'fit-content'
  }

  domCache.cssWaste.textContent = formatPixelCount(totalWastedPixels)
  domCache.shrinkWaste.textContent = '0'
}

function formatPixelCount(value: number): string {
  return `${Math.round(value).toLocaleString()}`
}
