<script setup lang="ts">
const model = defineModel<string>({ required: true })

const { title, description, submitText, loading = false } = defineProps<{
  title: string
  description: string
  submitText: string
  loading?: boolean
}>()

const emit = defineEmits<{
  submit: []
}>()
</script>

<template>
  <view class="section-card">
    <text class="section-title">{{ title }}</text>
    <text class="section-desc">{{ description }}</text>

    <textarea
      v-model="model"
      class="url-input"
      maxlength="1000"
      auto-height
      placeholder="粘贴抖音分享链接或分享文案"
    />

    <button class="primary-button submit-button" :loading="loading" @tap="emit('submit')">
      {{ loading ? '解析中' : submitText }}
    </button>
  </view>
</template>

<style scoped lang="scss">
.url-input {
  box-sizing: border-box;
  width: 100%;
  min-height: 180rpx;
  margin-top: 28rpx;
  padding: 24rpx;
  border: 1rpx solid #d1d5db;
  border-radius: 18rpx;
  background: #f9fafb;
  color: #1f2937;
  font-size: 28rpx;
  line-height: 1.6;
}

.submit-button {
  margin-top: 24rpx;
}
</style>
