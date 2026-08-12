import { defineStore } from 'pinia'
import type { ParseResult } from '@/types/parse'

const STORAGE_KEY = 'douyin-parser-history'
const MAX_HISTORY = 20

function toHistoryRecord(result: ParseResult): ParseResult {
  return {
    ...result,
    videoUrl: '',
    videoBackupUrls: [],
    video265Url: '',
    video265BackupUrls: [],
    audioUrl: '',
    audioBackupUrls: [],
  }
}

export const useHistoryStore = defineStore('history', {
  state: () => ({
    currentResult: null as ParseResult | null,
    records: [] as ParseResult[],
  }),
  actions: {
    load() {
      const records = uni.getStorageSync(STORAGE_KEY)
      this.records = Array.isArray(records) ? records : []
    },
    setCurrentResult(result: ParseResult) {
      this.currentResult = result
    },
    addRecord(result: ParseResult) {
      const record = toHistoryRecord(result)
      const nextRecords = [
        record,
        ...this.records.filter((item) => item.shareUrl !== result.shareUrl),
      ].slice(0, MAX_HISTORY)

      this.records = nextRecords
      uni.setStorageSync(STORAGE_KEY, nextRecords)
    },
    clear() {
      this.records = []
      this.currentResult = null
      uni.removeStorageSync(STORAGE_KEY)
    },
  },
})
