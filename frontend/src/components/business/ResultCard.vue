<script setup lang="ts">
import type { ParseResult } from '@/types/parse'

const { result, mode = 'video' } = defineProps<{
  result: ParseResult
  mode?: 'video' | 'audio'
}>()
</script>

<template>
  <view class="section-card">
    <image v-if="result.cover" class="cover" :src="result.cover" mode="aspectFill" />
    <view class="content">
      <text class="title">{{ result.title || '未命名作品' }}</text>
      <text class="meta">作者：{{ result.author || '未知' }}</text>
      <text class="meta">时长：{{ Math.round((result.duration || 0) / 1000) }} 秒</text>
      <text v-if="mode === 'video' && result.videoCodec" class="meta">
        视频编码：{{ result.videoCodec }} {{ result.videoWidth || '-' }}x{{ result.videoHeight || '-' }}
      </text>
      <text v-if="mode === 'audio'" class="meta">
        音频状态：{{ result.audioReady ? '可用' : '不可用' }}
      </text>
    </view>
  </view>
</template>

<style scoped lang="scss">
.cover {
  width: 100%;
  height: 360rpx;
  border-radius: 18rpx;
  background: #e5e7eb;
}

.content {
  margin-top: 24rpx;
}

.title {
  display: block;
  font-size: 32rpx;
  font-weight: 700;
  line-height: 1.4;
  color: #111827;
}

.meta {
  display: block;
  margin-top: 12rpx;
  font-size: 26rpx;
  color: #6b7280;
}

@media screen and (min-width: 768px) {
  .section-card {
    display: grid;
    grid-template-columns: 220px minmax(0, 1fr);
    gap: 24rpx;
    align-items: center;
  }

  .cover {
    height: 220px;
  }

  .content {
    margin-top: 0;
  }
}
</style>
