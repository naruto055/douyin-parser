<script setup lang="ts">
const { title, description = '' } = defineProps<{
  title: string
  description?: string
}>()
</script>

<template>
  <view class="state">
    <text class="state-title">{{ title }}</text>
    <text v-if="description" class="state-desc">{{ description }}</text>
  </view>
</template>

<style scoped lang="scss">
.state {
  padding: 40rpx 24rpx;
  border: 1rpx dashed #d1d5db;
  border-radius: 20rpx;
  text-align: center;
}

.state-title {
  display: block;
  font-size: 30rpx;
  font-weight: 600;
  color: #374151;
}

.state-desc {
  display: block;
  margin-top: 12rpx;
  font-size: 26rpx;
  line-height: 1.6;
  color: #6b7280;
}
</style>
