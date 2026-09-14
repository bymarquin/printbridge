<script setup lang="ts">
import { useIsPwa } from '../composables/usePwa'
import MainLayout from './MainLayout.vue'
import MobileLayout from './MobileLayout.vue'

const isPwa = useIsPwa()
</script>

<template>
  <MobileLayout v-if="isPwa" />
  <MainLayout v-else />
</template>
