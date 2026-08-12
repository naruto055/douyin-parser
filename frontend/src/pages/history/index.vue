<script setup lang="ts">
import { onMounted } from 'vue'
import BaseState from '@/components/base/BaseState.vue'
import ResultCard from '@/components/business/ResultCard.vue'
import { useHistoryStore } from '@/stores/history'
import type { ParseResult } from '@/types/parse'

const historyStore = useHistoryStore()

onMounted(() => {
  historyStore.load()
})

function openRecord(record: ParseResult) {
  historyStore.setCurrentResult(record)
  uni.navigateTo({ url: '/pages/parser/index' })
}
</script>

<template>
  <view class="page">
    <view class="page-container">
      <text class="page-title">解析历史</text>
      <text class="page-subtitle">历史记录只保存在当前设备，点击后会回到解析工作台。</text>

      <view v-if="historyStore.records.length">
        <view
          v-for="record in historyStore.records"
          :key="record.shareUrl"
          class="history-item"
          @tap="openRecord(record)"
        >
          <ResultCard :result="record" mode="video" />
        </view>

        <view class="button-row">
          <button class="secondary-button" @tap="historyStore.clear">清空历史</button>
        </view>
      </view>

      <BaseState v-else title="暂无历史" description="成功解析后会自动保存最近记录。" />
    </view>
  </view>
</template>

<style scoped lang="scss">
.history-item {
  margin-top: 24rpx;
}
</style>
