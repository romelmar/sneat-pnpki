<script setup>
import { ref, onMounted, computed } from 'vue'
import { useTheme } from 'vuetify'
import illustrationJohnDark from '@images/cards/illustration-john-dark.png'
import illustrationJohnLight from '@images/cards/illustration-john-light.png'
import api from '@/plugins/axios'

// Vuetify theme image switcher
const { global } = useTheme()
const illustrationJohn = computed(() => global.name.value === 'dark' ? illustrationJohnDark : illustrationJohnLight)

// Data and form states
const items = ref([])
const form = ref({ name: '', quantity: '', id: null })
const showModal = ref(false)

// Fetch items from API
const fetchItems = async () => {
  const res = await api.get('/items')
  items.value = res.data
}

// Open modal for adding item
const openModal = () => {
  form.value = { name: '', quantity: '', id: null }
  showModal.value = true
}

// Close modal
const closeModal = () => {
  showModal.value = false
}

// Save item (create or update)
const saveItem = async () => {
  if (form.value.id) {
    await api.put(`/items/${form.value.id}`, form.value)
  } else {
    await api.post('/items', form.value)
  }
  await fetchItems()
  closeModal()
}

// Edit existing item
const editItem = (item) => {
  form.value = { ...item }
  showModal.value = true
}

// Delete item
const deleteItem = async (id) => {
  await api.delete(`/items/${id}`)
  await fetchItems()
}

// Initial data fetch
onMounted(fetchItems)
</script>

<template>
    <div>
      <VBtn @click="openModal">Add Item</VBtn>
  
      <VTable class="mt-4">
        <thead>
          <tr>
            <th>Name</th>
            <th>Quantity</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="item.id">
            <td>{{ item.name }}</td>
            <td>{{ item.quantity }}</td>
            <td>
              <VBtn icon @click="editItem(item)">✏️</VBtn>
              <VBtn icon @click="deleteItem(item.id)">🗑️</VBtn>
            </td>
          </tr>
        </tbody>
      </VTable>
  
      <VDialog v-model="showModal" max-width="500px">
        <VCard>
          <VCardTitle>{{ form.id ? 'Edit' : 'Add' }} Item</VCardTitle>
          <VCardText>
            <VTextField label="Name" v-model="form.name" />
            <VTextField label="Quantity" v-model="form.quantity" type="number" />
          </VCardText>
          <VCardActions>
            <VBtn color="primary" @click="saveItem">Save</VBtn>
            <VBtn text @click="closeModal">Cancel</VBtn>
          </VCardActions>
        </VCard>
      </VDialog>
    </div>
  </template>
  
  
  