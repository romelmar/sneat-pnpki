<script setup>
import GuestLayout from './components/GuestLayout.vue'
</script>

<template>
  <GuestLayout>
    <RouterView />
  </GuestLayout>
</template>

<style lang="scss">
// As we are using `layouts` plugin we need its styles to be imported
@use "@layouts/styles/default-layout";
</style>
