<template>
  <div :style="styles.wrap">
    <h2>PDF Signer (Server PDFs + client-side .p12)</h2>

    <!-- 1) PDF list from API -->
    <section :style="styles.card">
      <h3>1) Choose PDF from API</h3>
      <PdfListFromApi
        v-model="selectedPdf"
        api-url="http://127.0.0.1:8000/api/pdfs"
      />
      <div
        v-if="selectedPdf"
        style="margin-top: 8px;color: #4b5563;font-size: 13px;"
      >
        Selected:
        <strong>{{ selectedPdf.fileName || selectedPdf.title || ('#' + selectedPdf.id) }}</strong>
      </div>
    </section>

    <!-- 2) Certificate (.p12/.pfx) + PNPKI extracted form -->
    <section :style="styles.card">
      <h3>2) Certificate (.p12/.pfx) &amp; PNPKI</h3>

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

      <!-- PNPKI form auto-filled from .p12, but editable -->
      <div
        v-if="signerRef"
        style="margin-top: 12px;"
      >
        <h4 style="margin: 0 0 6px;color: #374151;font-size: 13px;">
          Extracted PNPKI data
        </h4>
        <div :style="styles.grid">
          <Field
            label="Subject CN"
            :value="pnpki.subjectCN"
            @update="v => pnpki.subjectCN = v"
          />
          <Field
            label="Serial number"
            :value="pnpki.serial"
            @update="v => pnpki.serial = v"
          />
          <Field
            label="Issuer"
            :value="pnpki.issuer"
            @update="v => pnpki.issuer = v"
          />
          <Field
            label="Valid from"
            :value="pnpki.validFrom"
            @update="v => pnpki.validFrom = v"
          />
          <Field
            label="Valid to"
            :value="pnpki.validTo"
            @update="v => pnpki.validTo = v"
          />
        </div>
      </div>
    </section>

    <!-- 3) Signature image from API + placement viewer -->
    <section :style="styles.card">
      <h3>3) Visible signature</h3>

      <!-- PNPKI text toggle -->
      <label style="display: flex;align-items: center;margin: 4px 0 10px;color: #374151;font-size: 12px;gap: 8px;">
        <input
          v-model="showPnPkiText"
          type="checkbox"
        >
        Show PNPKI description in guide
      </label>

      <!-- Signature PNG selection (from API) -->
      <div :style="styles.row">
        <label :style="styles.label">Signature PNG</label>
        <select
          v-model="selectedSignatureId"
          :style="styles.input"
        >
          <option
            disabled
            value=""
          >
            Select a signature image…
          </option>
          <option
            v-for="sig in signatures"
            :key="sig.id"
            :value="sig.id"
          >
            {{ sig.label || sig.fileName || ('Signature #' + sig.id) }}
          </option>
        </select>
      </div>
      <div
        v-if="specimenUrl"
        style="margin-bottom: 10px;"
      >
        <img
          :src="specimenUrl"
          alt="Signature preview"
          style="max-width: 260px;padding: 4px;border: 1px solid #e5e7eb;border-radius: 8px;background: #fff;"
        >
      </div>

      <div style="margin-bottom: 8px;color: #6b7280;font-size: 12px;">
        Drag to draw a rectangle where the signature box should appear.
      </div>

      <!-- PDF viewer uses pdfUrl (from selected server PDF) -->
      <PdfPlacement
        v-if="pdfUrl"
        v-model="coords"
        :file="null"
        :src="pdfUrl"
        :page="page"
        :specimen-url="specimenUrl"
        :signer-name="signerRef?.subjectCN || ''"
        :show-pn-pki-text="showPnPkiText"
      />

      <!-- fallback manual coords (optional) -->
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
import forge from 'node-forge'
import { defineComponent, onMounted, ref, watch } from 'vue'
import PdfListFromApi from './PdfListFromApi.vue'
import PdfPlacement from './PdfPlacement.vue'

/* ---------- config (adjust to your backend) ---------- */
const DOCS_API = 'http://127.0.0.1:8000/api/signing/pdfs'

const SIGNATURES_API = 'http://127.0.0.1:8000/api/signatures'
const PREPARE_API = 'http://127.0.0.1:8000/api/sign/prepare'
const COMPLETE_API = 'http://127.0.0.1:8000/api/sign/complete'
const DOWNLOAD_API = 'http://127.0.0.1:8000/api/sign/download'

/* ---------- state ---------- */
const showPnPkiText = ref(true)
const specimenUrl = ref(null)

const selectedPdf = ref(null)  // chosen from API
const pdfUrl = ref('')         // URL from API for viewer
const page = ref(1)
const coords = ref(null)
const manual = ref({ page: 0, llx: 359, lly: 746, w: 200, h: 60 })

// signature PNGs from API
const signatures = ref([])
const selectedSignatureId = ref('')

const p12File = ref(null)
const p12Pass = ref('')
const signerCN = ref('(not loaded)')
const signerRef = ref(null)

const pnpki = ref({
  subjectCN: '',
  serial: '',
  issuer: '',
  validFrom: '',
  validTo: '',
})

const reason = ref('Approved')
const location = ref('Iloilo City')

const downUrl = ref(null)
const downHref = ref(null)
const previewSrc = ref(null)
const busy = ref(false)
const logs = ref([])

function log (m) {
  logs.value = [...logs.value, `• ${m}`].slice(-200)
}

/* ---------- load server lists ---------- */
async function loadSignatures () {
  try {
    const res = await fetch(SIGNATURES_API, { cache: 'no-store' })
    if (!res.ok) throw new Error('Failed to load signatures from API')

    // expected: [{ id, fileName, url, label? }]
    signatures.value = await res.json()
  } catch (e) {
    console.error(e)
    log('Error loading signatures: ' + (e.message || e))
  }
}

onMounted(() => {
  loadSignatures()
})

/* When user selects a PDF from API, set its URL for viewer */
watch(selectedPdf, doc => {
  if (!doc) {
    pdfUrl.value = ''
    coords.value = null
    
    return
  }

  // from Laravel index() above
  pdfUrl.value = doc.url
  page.value = 1
  coords.value = null
})

/* When user picks a signature image from API, set specimenUrl */
watch(selectedSignatureId, id => {
  const sig = signatures.value.find(s => s.id === id)

  specimenUrl.value = sig ? (sig.url || sig.downloadUrl) : null
})

/* ---------- handlers ---------- */
function onPickP12 (e) {
  p12File.value = e.target.files?.[0] || null
}

async function onLoadP12 () {
  if (!p12File.value) return alert('Choose a .p12/.pfx file')
  if (!p12Pass.value) return alert('Enter the .p12 password')
  try {
    log('Loading .p12…')

    const signer = await loadP12(p12File.value, p12Pass.value, forge)

    signerRef.value = signer
    signerCN.value = signer.subjectCN
    log('Loaded certificate for: ' + signer.subjectCN)

    // fill PNPKI form
    pnpki.value.subjectCN = signer.subjectCN || ''
    pnpki.value.serial = signer.serialNumber || ''
    pnpki.value.issuer = signer.issuer || ''
    pnpki.value.validFrom = signer.validFrom || ''
    pnpki.value.validTo = signer.validTo || ''
  } catch (e) {
    console.error(e)
    alert('Failed to read .p12: ' + (e.message || e))
  }
}

async function onPrepareAndSign () {
  downUrl.value = downHref.value = previewSrc.value = null
  try {
    if (!selectedPdf.value) return alert('Choose a PDF from the list')
    if (!selectedSignatureId.value) return alert('Choose a signature image')
    if (!signerRef.value) return alert('Load your .p12 first')
    if (!coords.value) {
      alert('Please drag a rectangle in Step 3 (or click "Use these values" in the fallback).')
      
      return
    }

    busy.value = true
    log('Preparing…')

    // NOTE:
    // Back-end must be updated to accept documentId + signatureImageId
    // instead of raw PDF & PNG file blobs.
    const fd = new FormData()

    // from your PDF list API, example entry:
    // { id, fileName, path: "private/signing/sample.pdf", url: "…" }
    fd.append('document_path', selectedPdf.value.path)

    // from your signatures API, example:
    // { id, fileName, path: "private/signatures/sig1.png", url: "…" }
    fd.append('signature_path', selectedSignature.path)  // or selectedSignature.value.path

    fd.append('page', String(coords.value.page))
    fd.append('llx',  String(coords.value.llx))
    fd.append('lly',  String(coords.value.yTop))
    fd.append('w',    String(coords.value.w))
    fd.append('h',    String(coords.value.h))
    fd.append('reason', reason.value)
    fd.append('location', location.value)
    fd.append('pnpki', showPnPkiText.value ? 'true' : 'false')
    fd.append('signer', signerRef.value.subjectCN)
    fd.append('tz', 'Asia/Manila')


    const r = await fetch(PREPARE_API, { method: 'POST', body: fd })
    if (!r.ok) throw new Error('Prepare failed')
    const prep = await r.json()

    log('Prepared: toSign length=' + (prep.toSignBase64?.length || 0))
    log('Signing in browser…')

    const toSignBytes = b64ToBytes(prep.toSignBase64)
    const cmsBase64 = signDetachedCMS(toSignBytes, signerRef.value, forge)

    log('Finalizing…')

    const finalRes = await fetch(COMPLETE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        txId: prep.transactionId,
        cmsBase64,
      }),
    })

    const finalJson = await finalRes.json()
    if (!finalRes.ok || !finalJson.ok) throw new Error('Finalize failed')

    // filePath/filename are assumed to point to a *server-saved* signed PDF
    const direct = `${DOWNLOAD_API}?path=${encodeURIComponent(finalJson.filePath)}&filename=${encodeURIComponent(finalJson.filename)}`

    downHref.value = direct
    previewSrc.value = direct

    // optional: create blob for blob download / preview
    const dl = await fetch(direct, { cache: 'no-store' })
    if (dl.ok) {
      const blob = await dl.blob()

      downUrl.value = URL.createObjectURL(blob)
      previewSrc.value = downUrl.value // use blob preview instead of direct link
    } else {
      log('Download fetch failed (using direct link instead).')
    }

    log('Done.')
  } catch (e) {
    console.error(e)
    log('Error: ' + (e.message || e))
  } finally {
    busy.value = false
  }
}

function onReset () {
  selectedPdf.value = null
  pdfUrl.value = ''
  signatures.value = []
  selectedSignatureId.value = ''
  specimenUrl.value = null

  p12File.value = null
  p12Pass.value = ''
  signerRef.value = null
  signerCN.value = '(not loaded)'
  pnpki.value = {
    subjectCN: '',
    serial: '',
    issuer: '',
    validFrom: '',
    validTo: '',
  }

  downUrl.value = downHref.value = previewSrc.value = null
  logs.value = []
}

/* ---------- forge helpers ---------- */
async function loadP12 (file, password, forgeLib) {
  const buf = new Uint8Array(await file.arrayBuffer())
  const asn1 = forgeLib.asn1.fromDer(forgeLib.util.createBuffer(buf))
  const p12 = forgeLib.pkcs12.pkcs12FromAsn1(asn1, password)

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
  for (const b of certBags) {
    const id = b.attributes.localKeyId
      ? forgeLib.util.bytesToHex(b.attributes.localKeyId[0])
      : null

    if (keyIdHex && id === keyIdHex) {
      leafCert = b.cert
      break
    }
  }
  const chain = certBags.map(b => b.cert)
  const subjectCN = leafCert.subject.getField('CN')?.value || '(unknown)'

  // Extract PNPKI-ish info
  const serialNumber = leafCert.serialNumber || ''

  const issuer = (leafCert.issuer?.attributes || [])
    .map(a => `${a.shortName || a.name}=${a.value}`)
    .join(', ')

  const validFrom = leafCert.validity?.notBefore
    ? leafCert.validity.notBefore.toISOString()
    : ''

  const validTo = leafCert.validity?.notAfter
    ? leafCert.validity.notAfter.toISOString()
    : ''

  return { key, leafCert, chain, subjectCN, serialNumber, issuer, validFrom, validTo }
}

function signDetachedCMS (toSignBytes, { key, leafCert, chain }, forgeLib) {
  const p7 = forgeLib.pkcs7.createSignedData()

  p7.content = new forgeLib.util.ByteBuffer(bytesToBin(toSignBytes))
  p7.addCertificate(leafCert)
  chain.filter(c => c !== leafCert).forEach(c => p7.addCertificate(c))
  p7.addSigner({
    key,
    certificate: leafCert,
    digestAlgorithm: forgeLib.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forgeLib.pki.oids.contentType, value: forgeLib.pki.oids.data },
      { type: forgeLib.pki.oids.signingTime, value: new Date() },
      { type: forgeLib.pki.oids.messageDigest },
    ],
  })
  p7.sign({ detached: true })

  const der = forgeLib.asn1.toDer(p7.toAsn1()).getBytes()

  return forgeLib.util.encode64(der)
}

function b64ToBytes (b64) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  
  return out
}
function bytesToBin (u8) {
  let s = ''
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i])
  
  return s
}

/* ---------- tiny Field component (inline) ---------- */
const Field = defineComponent({
  props: {
    label: String,
    value: [String, Number],
    type: { type: String, default: 'text' },
    placeholder: String,
  },
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
  wrap: {
    // maxWidth: '860px',
    margin: '24px auto',
    padding: '0 16px',
    fontFamily: '-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif',
  },
  card: {
    background: '#fff',
    border: '1px solid #eee',
    borderRadius: '12px',
    padding: '16px',
    marginBottom: '16px',
    boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '10px',
  },
  label: {
    width: '140px',
    color: '#333',
    fontSize: '14px',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))',
    gap: '10px',
    marginTop: '8px',
  },
  input: {
    padding: '8px 10px',
    borderRadius: '8px',
    border: '1px solid #ddd',
    outline: 'none',
    fontSize: '14px',
    width: '100%',
  },
  btn: {
    background: '#1f6feb',
    color: '#fff',
    border: 'none',
    padding: '8px 14px',
    borderRadius: '10px',
    cursor: 'pointer',
    fontWeight: 600,
  },
  btnSecondary: {
    background: '#f3f4f6',
    color: '#111827',
    border: '1px solid #e5e7eb',
    padding: '8px 14px',
    borderRadius: '10px',
    cursor: 'pointer',
    fontWeight: 600,
  },
  log: {
    background: '#0b1020',
    color: '#d1d5db',
    borderRadius: '8px',
    padding: '12px',
    fontSize: '12px',
    lineHeight: 1.5,
    maxHeight: '220px',
    overflow: 'auto',
    marginTop: '8px',
  },
}
</script>
