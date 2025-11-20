<template>
  <div :style="styles.wrap">
    <h2>PDF Signer (Client-side .p12)</h2>

    <!-- 1) Files -->
    <section :style="styles.card">
      <h3>1) Files</h3>
      <div :style="styles.row">
        <label :style="styles.label">PDF</label>
        <input
          type="file"
          accept="application/pdf"
          @change="onPickPdf"
        >
      </div>
      <div :style="styles.row">
        <label :style="styles.label">Image (optional)</label>
        <input
          type="file"
          accept="image/png,image/jpeg"
          @change="onPickImg"
        >
      </div>
    </section>

    <!-- 2) P12 -->
    <section :style="styles.card">
      <h3>2) Certificate (.p12/.pfx)</h3>
      <div :style="styles.row">
        <label :style="styles.label">.p12/.pfx</label>
        <input
          type="file"
          accept=".p12,.pfx"
          @change="onPickP12"
        >
      </div>
      <div :style="styles.row">
        <label :style="styles.label">Password</label>
        <input
          v-model="p12Pass"
          type="password"
          placeholder="Enter P12 password"
          :style="styles.input"
        >
        <button
          :style="styles.btn"
          @click="onLoadP12"
        >
          Load certificate
        </button>
      </div>
      <div style="margin-top: 6px;font-size: 14px;">
        <strong>Signer (CN):</strong> {{ signerCN }}
      </div>
    </section>

    <!-- 3) Place visible signature (auto-loads the picked PDF) -->
    <section :style="styles.card">
      <h3>3) Place visible signature</h3>
      <div style="margin-bottom: 8px;color: #6b7280;font-size: 12px;">
        Drag to draw a rectangle where the signature box should appear.
      </div>

      <PdfPlacement
        v-if="pdfFile || pdfUrl"
        v-model="coords"
        :file="pdfFile"
        :src="pdfUrl"
        :page="page" 
      />

      <!-- fallback manual fields (optional) -->
      <div
        v-else
        :style="styles.grid"
        style="margin-top: 8px;"
      >
        <Field
          label="Page"
          type="number"
          :value="manual.page"
          @update="v => manual.value.page = +v"
        />
        <Field
          label="LLX"
          type="number"
          :value="manual.llx"
          @update="v => manual.value.llx = +v"
        />
        <Field
          label="LLY"
          type="number"
          :value="manual.lly"
          @update="v => manual.value.lly = +v"
        />
        <Field
          label="Width"
          type="number"
          :value="manual.w"
          @update="v => manual.value.w = +v"
        />
        <Field
          label="Height"
          type="number"
          :value="manual.h"
          @update="v => manual.value.h = +v"
        />
        <div style="grid-column: 1 / -1;">
          <button
            :style="styles.btn"
            @click="coords = { ...manual.value }"
          >
            Use these values
          </button>
        </div>
      </div>
    </section>

    <!-- 4) Run -->
    <section :style="styles.card">
      <h3>4) Run</h3>
      <div style="display: flex;gap: 8px;">
        <button
          :style="{...styles.btn, opacity: busy ? 0.6 : 1}"
          :disabled="busy"
          @click="onPrepareAndSign"
        >
          {{ busy ? 'Working…' : 'Prepare & Sign' }}
        </button>
        <button
          :style="styles.btnSecondary"
          @click="onReset"
        >
          Reset
        </button>
      </div>
    </section>

    <!-- Output -->
    <section :style="styles.card">
      <h3>Output</h3>
      <div
        v-if="downHref"
        style="margin-bottom: 8px;"
      >
        <a :href="downHref">Download (direct)</a>
      </div>
      <div
        v-if="downUrl"
        style="margin-bottom: 8px;"
      >
        <a
          :href="downUrl"
          download="signed.pdf"
        >Download (blob)</a>
      </div>
      <div
        v-if="previewSrc"
        style="margin-top: 8px;"
      >
        <iframe
          title="PDF Preview"
          :src="previewSrc"
          style="width: 100%;height: 600px;border: 1px solid #e5e7eb;border-radius: 8px;background: #fff;"
        />
      </div>
      <pre :style="styles.log">{{ logs.join('\n') }}</pre>
    </section>
  </div>
</template>

<script setup>
import forge from 'node-forge' // or use window.forge via CDN
import { defineComponent, ref } from 'vue'
import PdfPlacement from './PdfPlacement.vue'

/* ---------- state ---------- */
const pdfFile   = ref(null)   // File object used for viewer & uploading
const pdfUrl    = ref('')     // blob URL for viewer (optional)
const page      = ref(1)
const coords = ref(null)
const manual = ref({ page: 0, llx: 359, lly: 746, w: 200, h: 60 }) // for fallback inputs

const image     = ref(null)
const p12File   = ref(null)
const p12Pass   = ref('')
const signerCN  = ref('(not loaded)')
const signerRef = ref(null)   // { key, leafCert, chain, subjectCN }

const reason    = ref('Approved')
const location  = ref('Iloilo City')

const downUrl   = ref(null)
const downHref  = ref(null)
const previewSrc= ref(null)
const busy      = ref(false)
const logs      = ref([])

function log(m){ logs.value = [...logs.value, `• ${m}`].slice(-200) }

/* ---------- handlers ---------- */
function onPickPdf(e){
  const f = e.target.files?.[0]
  if (!f) return
  pdfFile.value = f                  // <— set the actual File
  pdfUrl.value  = URL.createObjectURL(f) // optional viewer URL
}

function onPickImg(e){ image.value = e.target.files?.[0] || null }
function onPickP12(e){ p12File.value = e.target.files?.[0] || null }

async function onLoadP12(){
  if (!p12File.value) return alert('Choose a .p12/.pfx file')
  if (!p12Pass.value) return alert('Enter the .p12 password')
  try{
    log('Loading .p12…')

    const signer = await loadP12(p12File.value, p12Pass.value, forge)

    signerRef.value = signer
    signerCN.value  = signer.subjectCN
    log('Loaded certificate for: ' + signer.subjectCN)
  }catch(e){
    console.error(e)
    alert('Failed to read .p12: ' + (e.message || e))
  }
}

async function onPrepareAndSign(){
  downUrl.value = downHref.value = previewSrc.value = null
  try{
    if (!pdfFile.value) return alert('Choose a PDF')           // <— use pdfFile
    if (!signerRef.value) return alert('Load your .p12 first')

    busy.value = true
    log('Preparing…')

    const fd = new FormData()
    if (!pdfFile.value) { alert('Choose a PDF') 

      return }
    fd.append('pdf', pdfFile.value)                            // <— use pdfFile
    if (image.value) fd.append('image', image.value)
    if (!coords.value) {
      alert('Please drag a rectangle in Step 3 (or click "Use these values" in the fallback).')
      
      return
    }

    const LLY = Number.isFinite(coords.value.lly)
      ? coords.value.lly
      : (coords.value.pageHeight - coords.value.yTop - coords.value.h)

    fd.append('page', String(coords.value.page))
    fd.append('llx',  String(coords.value.llx))
    fd.append('lly',  String(LLY))
    fd.append('w',    String(coords.value.w))
    fd.append('h',    String(coords.value.h))
    fd.append('reason', reason.value)
    fd.append('location', location.value)
    fd.append('pnpki', 'true')
    fd.append('signer', signerRef.value.subjectCN)
    fd.append('tz', 'Asia/Manila')

    const r = await fetch('http://127.0.0.1:8000/api/sign/prepare', { method: 'POST', body: fd })
    if (!r.ok) throw new Error('Prepare failed')
    const prep = await r.json()

    log('Prepared: toSign length=' + (prep.toSignBase64?.length || 0))

    log('Signing in browser…')

    const toSignBytes = b64ToBytes(prep.toSignBase64)
    const cmsBase64   = signDetachedCMS(toSignBytes, signerRef.value, forge)

    log('Finalizing…')

    const finalRes = await fetch('http://127.0.0.1:8000/api/sign/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txId: prep.transactionId, cmsBase64 }),
    })

    const finalJson = await finalRes.json()
    if (!finalRes.ok || !finalJson.ok) throw new Error('Finalize failed')

    const direct = `http://127.0.0.1:8000/api/sign/download?path=${encodeURIComponent(finalJson.filePath)}&filename=${encodeURIComponent(finalJson.filename)}`

    downHref.value  = direct
    previewSrc.value = direct

    // convenience blob (desktop)
    const dl = await fetch(direct, { cache: 'no-store' })
    if (dl.ok){
      const blob = await dl.blob()

      downUrl.value = URL.createObjectURL(blob)

      // If you prefer blob preview instead:
      previewSrc.value = downUrl.value
    } else {
      log('Download fetch failed (using direct link instead).')
    }

    log('Done.')
  }catch(e){
    console.error(e)
    log('Error: ' + (e.message || e))
  }finally{
    busy.value = false
  }
}

function onReset(){
  pdfFile.value = null
  pdfUrl.value  = ''
  image.value   = null
  p12File.value = null
  p12Pass.value = ''
  signerRef.value = null
  signerCN.value  = '(not loaded)'
  downUrl.value = downHref.value = previewSrc.value = null
  logs.value = []
}

/* ---------- forge helpers ---------- */
async function loadP12(file, password, forgeLib){
  const buf  = new Uint8Array(await file.arrayBuffer())
  const asn1 = forgeLib.asn1.fromDer(forgeLib.util.createBuffer(buf))
  const p12  = forgeLib.pkcs12.pkcs12FromAsn1(asn1, password)

  const keyBagType = forgeLib.pki.oids.pkcs8ShroudedKeyBag
  const keyBag = p12.getBags({ bagType: keyBagType })[keyBagType]?.[0]
  if (!keyBag || !keyBag.key) throw new Error('Private key not found in .p12')
  const key = keyBag.key

  const certBagType = forgeLib.pki.oids.certBag
  const certBags = p12.getBags({ bagType: certBagType })[certBagType] || []
  if (certBags.length === 0) throw new Error('No certificates in .p12')

  const keyIdHex = keyBag.attributes.localKeyId
    ? forgeLib.util.bytesToHex(keyBag.attributes.localKeyId[0])
    : null

  let leafCert = certBags[0].cert
  for (const b of certBags){
    const id = b.attributes.localKeyId ? forgeLib.util.bytesToHex(b.attributes.localKeyId[0]) : null
    if (keyIdHex && id === keyIdHex){ leafCert = b.cert; break }
  }
  const chain = certBags.map(b => b.cert)
  const subjectCN = leafCert.subject.getField('CN')?.value || '(unknown)'
  
  return { key, leafCert, chain, subjectCN }
}

function signDetachedCMS(toSignBytes, { key, leafCert, chain }, forgeLib){
  const p7 = forgeLib.pkcs7.createSignedData()

  p7.content = new forgeLib.util.ByteBuffer(bytesToBin(toSignBytes))
  p7.addCertificate(leafCert)
  chain.filter(c => c !== leafCert).forEach(c => p7.addCertificate(c))
  p7.addSigner({
    key,
    certificate: leafCert,
    digestAlgorithm: forgeLib.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forgeLib.pki.oids.contentType,  value: forgeLib.pki.oids.data },
      { type: forgeLib.pki.oids.signingTime, value: new Date() },
      { type: forgeLib.pki.oids.messageDigest },
    ],
  })
  p7.sign({ detached: true })

  const der = forgeLib.asn1.toDer(p7.toAsn1()).getBytes()
  
  return forgeLib.util.encode64(der)
}

function b64ToBytes(b64){
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i=0;i<bin.length;i++) out[i] = bin.charCodeAt(i)
  
  return out
}
function bytesToBin(u8){
  let s = ''
  for (let i=0;i<u8.length;i++) s += String.fromCharCode(u8[i])
  
  return s
}

/* ---------- tiny Field component (inline) ---------- */
const Field = defineComponent({
  props: { label: String, value: [String, Number], type: { type: String, default: 'text' }, placeholder: String },
  emits: ['update'],
  template: `
    <div style="display:flex;flex-direction:column;gap:6px">
      <label style="font-size:12px;color:#444">{{label}}</label>
      <input :type="type" :value="value" :placeholder="placeholder"
             @input="$emit('update',$event.target.value)"
             style="padding:8px 10px;border-radius:8px;border:1px solid #ddd;outline:none;font-size:14px" />
    </div>
  `,
})

/* ---------- styles ---------- */
const styles = {
  wrap: { maxWidth: '860px', margin: '24px auto', padding: '0 16px',
    fontFamily: '-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif' },
  card: { background: '#fff', border: '1px solid #eee', borderRadius: '12px', padding: '16px',
    marginBottom: '16px', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' },
  row: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' },
  label: { width: '140px', color: '#333', fontSize: '14px' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '10px', marginTop: '8px' },
  input: { padding: '8px 10px', borderRadius: '8px', border: '1px solid #ddd', outline: 'none', fontSize: '14px' },
  btn: { background: '#1f6feb', color: '#fff', border: 'none', padding: '8px 14px', borderRadius: '10px', cursor: 'pointer', fontWeight: 600 },
  btnSecondary: { background: '#f3f4f6', color: '#111827', border: '1px solid #e5e7eb', padding: '8px 14px', borderRadius: '10px', cursor: 'pointer', fontWeight: 600 },
  log: { background: '#0b1020', color: '#d1d5db', borderRadius: '8px', padding: '12px', fontSize: '12px', lineHeight: 1.5, maxHeight: '220px', overflow: 'auto', marginTop: '8px' },
}
</script>
