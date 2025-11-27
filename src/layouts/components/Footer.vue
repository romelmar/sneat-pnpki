<template>
  <div class="h-100 d-flex flex-wrap align-center justify-space-between">
    <!-- 👉 Footer: left content -->
    <span class="d-flex align-center">
      &copy;
      {{ new Date().getFullYear() }}
      Made With
      <VIcon
        icon="bx-heart"
        color="error"
        size="1.25rem"
        class="mx-1"
      />
      By &nbsp;  <span style=" color: #1f6feb;font-weight: bold;">DSWD FO6 DevTeam</span> 
    </span>
  </div>
</template>
