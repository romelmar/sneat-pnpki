<!-- PdfListFromApi.vue -->
<template>
  <div>
    <div
      v-if="loading"
      style="color: #6b7280;font-size: 13px;"
    >
      Loading documents…
    </div>
    <div
      v-else-if="error"
      style="color: #b91c1c;font-size: 13px;"
    >
      {{ error }}
    </div>
    <div v-else>
      <div
        v-if="docs.length === 0"
        style="color: #6b7280;font-size: 13px;"
      >
        No documents available for signing.
      </div>
      <ul style="overflow: auto;max-height: 260px;padding: 0;margin: 0;list-style: none;">
        <li
          v-for="doc in docs"
          :key="doc.id"
          :style="rowStyle(doc)"
          @click="select(doc)"
        >
          <div style="font-size: 14px;font-weight: 500;">
            {{ doc.fileName || doc.title || ('Document #' + doc.id) }}
          </div>
          <div style="color: #6b7280;font-size: 12px;">
            {{ doc.description || doc.createdAt || '' }}
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'

const props = defineProps({
  apiUrl: {
    type: String,
    required: true,
  },
  modelValue: {
    type: Object,
    default: null,
  },
})

const emit = defineEmits(['update:modelValue'])

const docs = ref([])
const loading = ref(false)
const error = ref('')

async function loadDocs () {
  loading.value = true
  error.value = ''
  try {
    const res = await fetch(props.apiUrl, { cache: 'no-store' })
    if (!res.ok) throw new Error('Failed to load list from API')

    // expected: [{ id, fileName, url, ... }]
    docs.value = await res.json()
  } catch (e) {
    console.error(e)
    error.value = e.message || 'Failed to load documents'
  } finally {
    loading.value = false
  }
}

function select (doc) {
  emit('update:modelValue', doc)
}

function rowStyle (doc) {
  const isSelected = props.modelValue && props.modelValue.id === doc.id
  
  return {
    padding: '8px 10px',
    borderRadius: '8px',
    marginBottom: '4px',
    cursor: 'pointer',
    border: isSelected ? '1px solid #1f6feb' : '1px solid #e5e7eb',
    background: isSelected ? '#eff6ff' : '#fff',
  }
}

onMounted(loadDocs)
</script>
