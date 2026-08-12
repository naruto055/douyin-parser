import { defineStore } from 'pinia'
import type { HealthData } from '@/types/api'

export const useAppStore = defineStore('app', {
  state: () => ({
    health: null as HealthData | null,
  }),
  actions: {
    setHealth(health: HealthData) {
      this.health = health
    },
  },
})
