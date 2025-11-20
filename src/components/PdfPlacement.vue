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
import * as pdfjsLib from 'pdfjs-dist' // v5 API (ESM)
import workerSrc from 'pdfjs-dist/build/pdf.worker.mjs?url' // v5 worker as URL
import { markRaw, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'

/* ---------- props & emit ---------- */
const props = defineProps({
  src: { type: String, default: null },
  file: { type: [File, Blob], default: null },
  modelValue: { type: Object, default: null }, // { page, llx, lly, w, h, yTop? }
  specimenUrl: { type: String, default: null },    // <- NEW (object URL of uploaded image)
  signerName: { type: String, default: '' },       // <- NEW (for sample text)
  showPnPkiText: { type: Boolean, default: true }, // <- NEW (toggle sample text)
})

const emit = defineEmits(['update:modelValue'])
const specimenImg = shallowRef(null)


// Load/unload the specimen image
watch(() => props.specimenUrl, () => {
  specimenImg.value = null
  if (!props.specimenUrl) { drawOverlay() 

    return }
  const img = new Image()

  img.onload = () => { specimenImg.value = img; drawOverlay() }
  img.onerror = () => { specimenImg.value = null; drawOverlay() }
  img.src = props.specimenUrl
})

/* ---------- PDF.js setup (match API + worker versions) ---------- */
pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc

const { getDocument } = pdfjsLib

/* ---------- refs / state ---------- */
const pdfCanvas = ref(null)
const overlay = ref(null)
const stageEl = ref(null)

const pdf = shallowRef(null)        // PDFDocumentProxy (kept raw)
const objectUrl = ref(null)         // for File blobs (revoke on change)

const page = ref(1)                 // 1-based for UI
const numPages = ref(null)
const scale = ref(1.0)
const baseViewport = ref(null)      // viewport at scale=1 (for point math)
const rendering = ref(false)

const hasSelection = ref(false)
const drag = ref({ active: false, x0: 0, y0: 0, x1: 0, y1: 0 })
const lastCoords = ref({ page: 0, llx: 0, lly: 0, w: 0, h: 0 })


/* ---------- inline styles (objects) ---------- */
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
  border: '1px solid #e5e7eb', borderRadius: '8px',
  minHeight: '200px',
}

const overlayCss = { position: 'absolute', left: 0, top: 0, cursor: 'crosshair' }

/* ---------- loading & rendering ---------- */
async function loadPdf () {
  // revoke old blob URL
  if (objectUrl.value) {
    try { URL.revokeObjectURL(objectUrl.value) } catch {}
    objectUrl.value = null
  }

  // decide source
  let src = props.src || null
  if (!src && props.file) {
    objectUrl.value = URL.createObjectURL(props.file)
    src = objectUrl.value
  }
  if (!src) return

  await openPdf(src)
}

async function openPdf (src) {
  // destroy old doc if any
  if (pdf.value) {
    try { await pdf.value.destroy() } catch {}
    pdf.value = null
  }

  numPages.value = null

  // derive starting page from v-model (convert 0-based to 1-based)
  page.value = Math.max(1, (props.modelValue?.page || 0) + 1)

  const loadingTask = getDocument({ url: src })
  const doc = await loadingTask.promise

  // avoid Vue proxy on private-field objects
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
    const p   = await pdf.value.getPage(page.value)
    const rot = (p.rotate || 0) % 360
    const v1  = p.getViewport({ scale: 1.0, rotation: rot }) // base viewport (points)

    baseViewport.value = v1

    // auto-fit width (once) or on navigation
    let s = scale.value
    if (fitWidth) {
      const containerW = (stageEl.value?.clientWidth || 900) - 2

      s = containerW / v1.width
      scale.value = Math.max(0.2, Math.min(5, s))
    }

    const vp = p.getViewport({ scale: scale.value, rotation: rot })
    const canvas = pdfCanvas.value
    const ctx = canvas.getContext('2d', { alpha: false })

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
function onLeave(){
  if (drag.value.active){ drag.value.active = false; drawOverlay() }
}
function clearSelection(){
  hasSelection.value = false
  drag.value.active = false
  drawOverlay()
  emit('update:modelValue', null)
}

/* ---------- math ---------- */
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

// Put this near your other constants
const CSS_UNITS = 96 / 72 // css px per point


function rectToPdfPoints({ x, y, w, h }) {
  const s = scale.value
  const x1v = x / s, y1v = y / s
  const x2v = (x + w) / s, y2v = (y + h) / s

  // Convert viewport coords -> PDF user space (handles rotation properly)
  const [llx, lly] = baseViewport.value.convertToPdfPoint(x1v, y2v)   // lower-left
  const [urx, ury] = baseViewport.value.convertToPdfPoint(x2v, y1v)   // upper-right

  const width  = urx - llx
  const height = ury - lly

  // Top-origin helper values (in PDF points)
  const pageHeight = baseViewport.value.height
  const yTop = pageHeight - (lly + height)

  return {
    page: page.value - 1, // 0-based for backend
    llx, lly, w: width, h: height,
    yTop, pageHeight,
  }
}



function pdfToUiTop({ llx, lly, w, h }) {
  const pageH = baseViewport.value.height // PDF points
  // top-left style Y (0 at top):
  const yTop = pageH - (lly + h)
  
  return { x: llx, yTop, w, h }
}

// PDF points -> canvas rectangle (px at current scale)
function pdfPointsToCanvasRect({ llx, lly, w, h }) {
  const s = scale.value
  const [x1v, y1v] = baseViewport.value.convertToViewportPoint(llx,     lly + h) // top-left
  const [x2v, y2v] = baseViewport.value.convertToViewportPoint(llx + w, lly)     // bottom-right
  
  return { x: x1v * s, y: y1v * s, w: (x2v - x1v) * s, h: (y2v - y1v) * s }
}


/* ---------- overlay drawing ---------- */
function drawOverlay(){
  const ov = overlay.value
  if (!ov) return
  const ctx = ov.getContext('2d')

  ctx.clearRect(0, 0, ov.width, ov.height)

  // While dragging: show a translucent guide + specimen preview
  if (drag.value.active){
    const r = normalizedRect(drag.value.x0, drag.value.y0, drag.value.x1, drag.value.y1)

    // rectangle guide
    ctx.fillStyle = 'rgba(31,111,235,0.12)'
    ctx.strokeStyle = '#1f6feb'
    ctx.lineWidth = 2
    ctx.fillRect(r.x, r.y, r.w, r.h)
    ctx.strokeRect(r.x, r.y, r.w, r.h)

    // specimen preview (semi-transparent while dragging)
    drawSpecimen(ctx, r, { alpha: 0.85 })
    
    return
  }
  

  // After selection: show the final specimen guide
  if (hasSelection.value){
    const r = pdfPointsToCanvasRect(lastCoords.value)

    ctx.fillStyle = 'rgba(31,111,235,0.10)'
    ctx.strokeStyle = '#1f6feb'
    ctx.lineWidth = 2
    ctx.fillRect(r.x, r.y, r.w, r.h)
    ctx.strokeRect(r.x, r.y, r.w, r.h)

    drawSpecimen(ctx, r, { alpha: 1.0 })
  }
}

function drawSpecimen(ctx, rect, { alpha = 1.0 } = {}){
  if (!rect.w || !rect.h) return

  // transparent background (overlay canvas is already transparent)
  // Optional subtle border to mimic final appearance box:
  ctx.save()
  ctx.globalAlpha = alpha

  const pad = Math.max(4, Math.floor(rect.h * 0.08))  // 8% padding
  let cursorX = rect.x + pad
  const contentTop = rect.y + pad
  const contentH = Math.max(1, rect.h - pad * 2)
  const contentW = Math.max(1, rect.w - pad * 2)

  // 1) Optional image at left, scaled to box height
  let imgW = 0
  if (specimenImg.value){
    const img = specimenImg.value
    const targetH = contentH
    const ratio = img.width / img.height

    imgW = Math.min(contentW * 0.45, Math.floor(targetH * ratio)) // keep some room for text
    if (imgW > 0){
      const imgH = Math.floor(imgW / ratio)
      const imgY = Math.floor(contentTop + (contentH - imgH) / 2)

      ctx.drawImage(img, Math.floor(cursorX), imgY, imgW, imgH)
      cursorX += imgW + pad
    }
  }

  // 2) PNPKI-ish sample text on the right (if enabled)
  if (props.showPnPkiText){
    const textW = Math.max(1, rect.x + rect.w - pad - cursorX)
    if (textW > 10){
      const date = new Date()
      const dateStr = date.toISOString().slice(0, 10)
      const timeStr = date.toTimeString().slice(0, 8)
      const line1 = 'Digitally signed by'
      const line2 = props.signerName || '(unknown)'
      const line3 = dateStr
      const line4 = timeStr

      // Scale text roughly with box height
      const fontReg = Math.max(9, Math.floor(contentH * 0.22))
      const fontBold = Math.max(10, Math.floor(contentH * 0.26))
      const lineGap = Math.max(2, Math.floor(contentH * 0.06))

      ctx.fillStyle = '#111'
      let y = contentTop + fontReg + Math.floor(lineGap * 0.5)

      ctx.font = `${fontReg}px sans-serif`
      fillClampedText(ctx, line1, cursorX, y, textW); y += fontReg + lineGap

      ctx.font = `bold ${fontBold}px sans-serif`
      fillClampedText(ctx, line2, cursorX, y, textW); y += fontBold + lineGap

      ctx.font = `${fontReg}px sans-serif`
      fillClampedText(ctx, line3, cursorX, y, textW); y += fontReg + lineGap
      fillClampedText(ctx, line4, cursorX, y, textW)
    }
  }

  // Optional light border inside
  ctx.strokeStyle = 'rgba(0,0,0,0.10)'
  ctx.lineWidth = 1
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1)

  ctx.restore()
}

// Truncate text with ellipsis if it overflows a given width
function fillClampedText(ctx, text, x, y, maxW){
  if (!text) return
  if (ctx.measureText(text).width <= maxW){
    ctx.fillText(text, x, y)
    
    return
  }
  let t = text
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW){
    t = t.slice(0, -1)
  }
  ctx.fillText(t + '…', x, y)
}


function drawModelValueRect(mv){
  hasSelection.value = true
  lastCoords.value = mv
  drawOverlay()
}

/* ---------- lifecycle ---------- */
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
</script>
