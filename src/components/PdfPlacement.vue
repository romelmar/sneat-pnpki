<template>
  <div :style="wrap">
    <div :style="bar">
      <div style="display: flex;flex-wrap: wrap;align-items: center;gap: 8px;">
        <button
          :style="btn"
          :disabled="page <= 1"
          @click="prevPage"
        >
          ◀
        </button>
        <span style="min-width: 120px;">Page {{ page }} / {{ numPages || '…' }}</span>
        <button
          :style="btn"
          :disabled="!numPages || page >= numPages"
          @click="nextPage"
        >
          ▶
        </button>

        <span style="width: 1px;height: 22px;margin: 0 8px;background: #e5e7eb;" />

        <button
          :style="btn"
          @click="zoomOut"
        >
          –
        </button>
        <span style="min-width: 70px;text-align: center;">{{ Math.round(scale*100) }}%</span>
        <button
          :style="btn"
          @click="zoomIn"
        >
          +
        </button>

        <span style="width: 1px;height: 22px;margin: 0 8px;background: #e5e7eb;" />

        <button
          :style="btn"
          :disabled="!hasSelection"
          @click="clearSelection"
        >
          Clear selection
        </button>
        <span
          v-if="hasSelection"
          style="color: #6b7280;font-size: 12px;"
        >
          x={{ lastCoords.llx.toFixed(2) }}, yTop={{ lastCoords.yTop.toFixed(2) }},
          w={{ lastCoords.w.toFixed(2) }}, h={{ lastCoords.h.toFixed(2) }}
        </span>
      </div>
    </div>

    <div
      ref="stageEl"
      :style="stageStyle"
    >
      <canvas ref="pdfCanvas" />
      <canvas
        ref="overlay"
        :style="overlayCss"
        @mousedown="onDown"
        @mousemove="onMove"
        @mouseup="onUp"
        @mouseleave="onLeave"
      />
    </div>
  </div>
</template>

<script setup>
import * as pdfjsLib from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.mjs?url'
import { markRaw, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'

/* ---------- props & emits ---------- */
const props = defineProps({
  src: { type: String, default: null },               // blob: or http(s) URL
  file: { type: [File, Blob], default: null },        // preferred: File/Blob
  modelValue: { type: Object, default: null },        // { page,llx,lly,w,h }
  specimenUrl: { type: String, default: null },       // guide image
  signerName: { type: String, default: '' },          // CN for text
  showPnPkiText: { type: Boolean, default: true },    // toggle text in guide
})

const emit = defineEmits(['update:modelValue'])

/* ---------- PDF.js setup ---------- */
pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc

const { getDocument } = pdfjsLib

/* ---------- refs / state ---------- */
const pdfCanvas = ref(null)
const overlay = ref(null)
const stageEl = ref(null)

const pdf = shallowRef(null)
const objectUrl = ref(null)

const page = ref(1)                 // 1-based for UI
const numPages = ref(null)
const scale = ref(1.0)
const baseViewport = ref(null)      // viewport at scale=1 (points)
const rendering = ref(false)

const hasSelection = ref(false)
const drag = ref({ active: false, x0: 0, y0: 0, x1: 0, y1: 0 })
const lastCoords = ref({ page: 0, llx: 0, lly: 0, w: 0, h: 0, yTop: 0, pageHeight: 0 })

/* specimen image cache */
const specimenImg = shallowRef(null)

watch(() => props.specimenUrl, () => {
  specimenImg.value = null
  if (!props.specimenUrl) { drawOverlay() 

    return }
  const img = new Image()

  img.onload = () => { specimenImg.value = img; drawOverlay() }
  img.onerror = () => { specimenImg.value = null; drawOverlay() }
  img.src = props.specimenUrl
})

/* ---------- styles ---------- */
const wrap = {
  width: '100%', maxWidth: '980px', margin: '8px auto',
  fontFamily: '-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif',
}

const bar = {
  marginBottom: '8px', background: '#f9fafb', border: '1px solid #e5e7eb',
  borderRadius: '8px', padding: '8px 10px',
}

const btn = {
  background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: '8px',
  padding: '6px 10px', cursor: 'pointer',
}

const stageStyle = {
  position: 'relative', width: '100%', overflow: 'auto', background: '#fff',
  border: '1px solid #e5e7eb', borderRadius: '8px', minHeight: '200px',
}

const overlayCss = { position: 'absolute', left: 0, top: 0, cursor: 'crosshair' }

/* ---------- constants / helpers ---------- */
const PT_TO_CSSPX = 96 / 72 // px per pt @96dpi
function pt2px(pt) { return pt * PT_TO_CSSPX * scale.value }

/* ---------- load & render ---------- */
async function loadPdf () {
  if (objectUrl.value) { try { URL.revokeObjectURL(objectUrl.value) } catch {}; objectUrl.value = null }

  let src = props.src || null
  if (!src && props.file) { objectUrl.value = URL.createObjectURL(props.file); src = objectUrl.value }
  if (!src) return

  await openPdf(src)
}

async function openPdf (src) {
  if (pdf.value) { try { await pdf.value.destroy() } catch {}; pdf.value = null }
  numPages.value = null

  page.value = Math.max(1, (props.modelValue?.page || 0) + 1)

  const loadingTask = getDocument({ url: src })
  const doc = await loadingTask.promise

  pdf.value = markRaw(doc)
  numPages.value = doc.numPages
  if (page.value > numPages.value) page.value = numPages.value

  await renderCurrentPage(true)
}

async function renderCurrentPage (fitWidth = false) {
  const doc = pdf.value
  if (!doc) return
  rendering.value = true
  try {
    const p   = await doc.getPage(page.value)
    const rot = (p.rotate || 0) % 360
    const v1  = p.getViewport({ scale: 1.0, rotation: rot }) // base viewport in points

    baseViewport.value = v1

    let s = scale.value
    if (fitWidth) {
      const containerW = (stageEl.value?.clientWidth || 900) - 2

      s = containerW / v1.width
      scale.value = Math.max(0.2, Math.min(5, s))
    }

    const vp = p.getViewport({ scale: scale.value, rotation: rot })
    const canvas = pdfCanvas.value
    const ctx = canvas.getContext('2d', { alpha: false })

    // simple CSS pixel canvas (keeps overlay math 1:1)
    canvas.width = Math.ceil(vp.width)
    canvas.height = Math.ceil(vp.height)
    canvas.style.width = vp.width + 'px'
    canvas.style.height = vp.height + 'px'

    const ov = overlay.value

    ov.width = canvas.width
    ov.height = canvas.height
    ov.style.width = canvas.style.width
    ov.style.height = canvas.style.height
    ov.style.left = canvas.offsetLeft + 'px'
    ov.style.top = canvas.offsetTop + 'px'

    await p.render({ canvasContext: ctx, viewport: vp }).promise
    drawOverlay()

    // if parent passed a modelValue for this page, draw it
    if (props.modelValue && props.modelValue.page === (page.value - 1)) {
      drawModelValueRect(props.modelValue)
    }
  } finally {
    rendering.value = false
  }
}

/* ---------- nav & zoom ---------- */
function prevPage(){ if (page.value > 1){ page.value--; renderCurrentPage(true) } }
function nextPage(){ if (numPages.value && page.value < numPages.value){ page.value++; renderCurrentPage(true) } }
function zoomIn(){ scale.value = Math.min(5, scale.value * 1.2); renderCurrentPage(false) }
function zoomOut(){ scale.value = Math.max(0.2, scale.value / 1.2); renderCurrentPage(false) }

/* ---------- selection (drag rect) ---------- */
function onDown(e){
  const { x, y } = evtToLocal(e)

  drag.value = { active: true, x0: x, y0: y, x1: x, y1: y }
  drawOverlay()
}
function onMove(e){
  if (!drag.value.active) return
  const { x, y } = evtToLocal(e)

  drag.value.x1 = x; drag.value.y1 = y
  drawOverlay()
}
function onUp(){
  if (!drag.value.active) return
  drag.value.active = false

  const rect = normalizedRect(drag.value.x0, drag.value.y0, drag.value.x1, drag.value.y1)
  const coords = rectToPdfPoints(rect)

  hasSelection.value = true
  lastCoords.value = coords
  emit('update:modelValue', coords)
  drawOverlay()
}
function onLeave(){ if (drag.value.active){ drag.value.active = false; drawOverlay() } }

function clearSelection(){
  hasSelection.value = false
  drag.value.active = false
  drawOverlay()
  emit('update:modelValue', null)
}

/* ---------- math & conversion ---------- */
function evtToLocal(e){
  if ('offsetX' in e) return { x: e.offsetX, y: e.offsetY }
  const r = overlay.value.getBoundingClientRect()
  
  return { x: e.clientX - r.left, y: e.clientY - r.top }
}
function normalizedRect(x0, y0, x1, y1){
  const x = Math.min(x0, x1), y = Math.min(y0, y1)
  const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0)
  
  return { x, y, w, h }
}

function rectToPdfPoints({ x, y, w, h }) {
  const s = scale.value
  const x1v = x / s, y1v = y / s
  const x2v = (x + w) / s, y2v = (y + h) / s

  // viewport coords -> PDF user space (handles rotation)
  const [llx, lly] = baseViewport.value.convertToPdfPoint(x1v, y2v)   // lower-left
  const [urx, ury] = baseViewport.value.convertToPdfPoint(x2v, y1v)   // upper-right

  const width  = urx - llx
  const height = ury - lly
  const pageHeight = baseViewport.value.height
  const yTop = pageHeight - (lly + height) // top-origin helper (PDF pts)

  return { page: page.value - 1, llx, lly, w: width, h: height, yTop, pageHeight }
}

function pdfPointsToCanvasRect({ llx, lly, w, h }) {
  const s = scale.value

  // top-left and bottom-right in viewport
  const [x1v, y1v] = baseViewport.value.convertToViewportPoint(llx,     lly + h)
  const [x2v, y2v] = baseViewport.value.convertToViewportPoint(llx + w, lly)
  
  return { x: x1v * s, y: y1v * s, w: (x2v - x1v) * s, h: (y2v - y1v) * s }
}

/* ---------- overlay drawing ---------- */
function drawOverlay() {
  const ov = overlay.value
  if (!ov) return
  const ctx = ov.getContext('2d')

  ctx.clearRect(0, 0, ov.width, ov.height)

  // If dragging, show the SAME guide preview in the live rectangle
  if (drag.value.active) {
    const r = normalizedRect(drag.value.x0, drag.value.y0, drag.value.x1, drag.value.y1)

    // draw background + border
    drawGuide(ctx, r)

    // draw specimen + (optional) PNPKI text while dragging
    drawPnPkiGuide(ctx, r, {
      showText: props.showPnPkiText !== false,
      signerName: props.signerName || '(unknown)',
      specimenImg: specimenImg.value, // will render once loaded
    })

    return
  }

  // After selection is finished, use the stored coords
  if (hasSelection.value) {
    const rect = pdfPointsToCanvasRect(lastCoords.value)

    drawGuide(ctx, rect)
    drawPnPkiGuide(ctx, rect, {
      showText: props.showPnPkiText !== false,
      signerName: props.signerName || '(unknown)',
      specimenImg: specimenImg.value,
    })
  }
}

function drawGuide (ctx, r) {
  ctx.fillStyle = 'rgba(31,111,235,0.12)'
  ctx.strokeStyle = '#1f6feb'
  ctx.lineWidth = 2
  ctx.fillRect(r.x, r.y, r.w, r.h)
  ctx.strokeRect(r.x, r.y, r.w, r.h)
}

/* text clamping (never use fillText's 4th arg) */
function drawLineClamped(ctx, text, x, yBaseline, maxWidthPx) {
  if (!text) return
  if (ctx.measureText(text).width <= maxWidthPx) { ctx.fillText(text, x, yBaseline) 

    return }
  const ell = '…'
  const ellW = ctx.measureText(ell).width
  let lo = 0, hi = text.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    const slice = text.slice(0, mid)
    if (ctx.measureText(slice).width + ellW <= maxWidthPx) lo = mid + 1
    else hi = mid
  }
  const fitted = text.slice(0, Math.max(0, lo - 1)) + ell

  ctx.fillText(fitted, x, yBaseline)
}

/**
 * Draw specimen + (optional) PNPKI text at point-accurate sizes:
 *   padding: 6pt, top: 12pt, gap: 2pt, fonts: 8pt regular, 10pt bold.
 */
function drawPnPkiGuide(ctx, rectCanvasPx, opts) {
  const { x, y, w, h } = rectCanvasPx
  const showText   = !!opts.showText
  const signerName = opts.signerName || '(unknown)'
  const specimen   = opts.specimenImg || null

  // background + border
  ctx.fillStyle = 'rgba(31,111,235,0.12)'
  ctx.strokeStyle = '#1f6feb'
  ctx.lineWidth = 2
  ctx.fillRect(x, y, w, h)
  ctx.strokeRect(x, y, w, h)

  // padding
  const padPx = Math.round(pt2px(6))
  let textStartX = x + padPx

  // specimen image (left) scaled to fit height
  if (specimen && specimen.complete) {
    const imgH = Math.max(1, h - padPx * 2)
    const imgW = Math.round(specimen.naturalWidth * (imgH / specimen.naturalHeight))

    ctx.drawImage(specimen, x + padPx, y + padPx, imgW, imgH)
    textStartX += imgW + padPx
  }

  if (!showText) return

  // font sizes (px) from points
  const regPx  = Math.round(pt2px(8))
  const boldPx = Math.round(pt2px(10))
  const gapPx  = Math.round(pt2px(2))
  const topPad = Math.round(pt2px(12))

  ctx.fillStyle = '#000'
  ctx.textBaseline = 'alphabetic' // we compute baseline via ascent

  const maxTextW = Math.max(0, x + w - padPx - textStartX)

  const now = new Date()
  const pad2 = n => (n < 10 ? '0' + n : '' + n)
  const line1 = 'Digitally signed by'
  const line2 = signerName
  const line3 = `${now.getFullYear()}-${pad2(now.getMonth()+1)}-${pad2(now.getDate())}`
  const line4 = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`

  let yCursor = y + topPad

  const setFontAndGetMetrics = (px, bold=false) => {
    ctx.font = `${bold ? 'bold ' : ''}${px}px Arial, "Helvetica Neue", Helvetica, sans-serif`

    const m = ctx.measureText('Mg')
    const ascent  = (m.actualBoundingBoxAscent ?? px * 0.8)
    const descent = (m.actualBoundingBoxDescent ?? px * 0.2)
    
    return { ascent, lineH: ascent + descent }
  }

  { // line 1
    const { ascent, lineH } = setFontAndGetMetrics(regPx, false)

    drawLineClamped(ctx, line1, textStartX, yCursor + ascent, maxTextW)
    yCursor += lineH + gapPx
  }
  { // line 2 (bold)
    const { ascent, lineH } = setFontAndGetMetrics(boldPx, true)

    drawLineClamped(ctx, line2, textStartX, yCursor + ascent, maxTextW)
    yCursor += lineH + gapPx
  }
  { // line 3
    const { ascent, lineH } = setFontAndGetMetrics(regPx, false)

    drawLineClamped(ctx, line3, textStartX, yCursor + ascent, maxTextW)
    yCursor += lineH + gapPx
  }
  { // line 4
    const { ascent } = setFontAndGetMetrics(regPx, false)

    drawLineClamped(ctx, line4, textStartX, yCursor + ascent, maxTextW)
  }
}

/* ---------- lifecycle & watchers ---------- */
onMounted(loadPdf)
onBeforeUnmount(async () => {
  if (objectUrl.value) { try { URL.revokeObjectURL(objectUrl.value) } catch {} }
  if (pdf.value) { try { await pdf.value.destroy() } catch {} }
})

watch(() => [props.src, props.file], loadPdf)

watch(() => props.modelValue, async nv => {
  if (!pdf.value || rendering.value) return
  if (!nv) { clearSelection() 

    return }
  const targetPg = (nv.page ?? 0) + 1
  if (targetPg !== page.value) {
    page.value = targetPg
    await nextTick()
    await renderCurrentPage(false)
  } else {
    hasSelection.value = true
    lastCoords.value = nv
    drawOverlay()
  }
})

// redraw guide when these change
watch(() => [props.specimenUrl, props.signerName, props.showPnPkiText], () => drawOverlay())
watch(() => scale.value, () => drawOverlay())
</script>
