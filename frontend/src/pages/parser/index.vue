<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import UrlInputCard from '@/components/business/UrlInputCard.vue'
import ResultCard from '@/components/business/ResultCard.vue'
import BaseState from '@/components/base/BaseState.vue'
import { buildDownloadUrl, hasPublicDownloadBaseUrl } from '@/api/download'
import { parseDouyin } from '@/api/parse'
import { useHistoryStore } from '@/stores/history'
import { copyText } from '@/utils/clipboard'
import { downloadMedia } from '@/utils/download'
import type { ApiError } from '@/types/api'
import type { MediaType, ParseResult } from '@/types/parse'

const url = ref('')
const loading = ref(false)
const errorMessage = ref('')
const result = ref<ParseResult | null>(null)
const historyStore = useHistoryStore()

const hasVideo = computed(() => Boolean(result.value?.videoUrl))
const canDownloadVideo = computed(() => Boolean(result.value?.shareUrl))
const hasAudio = computed(() => Boolean(result.value?.audioReady))
const canDownloadAudio = computed(() => Boolean(result.value?.audioReady && result.value.shareUrl))
const downloadBaseReady = computed(() => hasPublicDownloadBaseUrl())
const videoMeta = computed(() => {
  if (!result.value) return '等待解析'

  const items = [
    result.value.videoCodec || '默认视频',
    result.value.videoWidth && result.value.videoHeight
      ? `${result.value.videoWidth}x${result.value.videoHeight}`
      : '',
    result.value.videoFormat ? result.value.videoFormat.toUpperCase() : '',
  ].filter(Boolean)

  return items.join(' · ') || '视频资源'
})

onMounted(() => {
  if (historyStore.currentResult) {
    result.value = historyStore.currentResult
    url.value = historyStore.currentResult.shareUrl
  }
})

async function submit() {
  const value = url.value.trim()
  if (!value) {
    errorMessage.value = '请先粘贴抖音分享链接'
    return
  }

  loading.value = true
  errorMessage.value = ''

  try {
    const parsed = await parseDouyin({ url: value })
    result.value = parsed
    historyStore.setCurrentResult(parsed)
    historyStore.addRecord(parsed)
  } catch (error) {
    errorMessage.value = (error as ApiError).message || '解析失败'
  } finally {
    loading.value = false
  }
}

function copyMedia(type: MediaType) {
  if (!result.value) {
    uni.showToast({ title: '暂无下载链接', icon: 'none' })
    return
  }

  if (!hasPublicDownloadBaseUrl()) {
    uni.showToast({ title: '请先配置下载域名', icon: 'none' })
    return
  }

  if (type === 'audio' && !result.value.audioReady) {
    uni.showToast({ title: '暂无可用音频', icon: 'none' })
    return
  }

  const downloadUrl = buildDownloadUrl({
    type,
    url: result.value.shareUrl,
    title: result.value.title,
  })

  copyText(downloadUrl).then(() => {
    uni.showToast({ title: '已复制', icon: 'success' })
  })
}

function download(type: MediaType) {
  if (!result.value) return

  if (!hasPublicDownloadBaseUrl()) {
    uni.showToast({ title: '请先配置下载域名', icon: 'none' })
    return
  }

  if (type === 'audio' && !result.value.audioReady) {
    uni.showToast({ title: '暂无可用音频', icon: 'none' })
    return
  }

  downloadMedia({
    type,
    url: result.value.shareUrl,
    title: result.value.title,
  })
}

function copyShareUrl() {
  if (!result.value?.shareUrl) {
    uni.showToast({ title: '暂无原始链接', icon: 'none' })
    return
  }

  copyText(result.value.shareUrl).then(() => {
    uni.showToast({ title: '已复制', icon: 'success' })
  })
}

</script>

<template>
  <view class="page">
    <view class="page-container">
      <text class="page-title">解析工作台</text>
      <text class="page-subtitle">一次粘贴链接，统一完成解析、复制和下载。</text>

      <view class="desktop-grid">
        <UrlInputCard
          v-model="url"
          title="输入链接"
          description="粘贴抖音链接或分享文案，解析成功后会保存到本机历史。"
          submit-text="开始解析"
          :loading="loading"
          @submit="submit"
        />

        <view>
          <BaseState v-if="errorMessage" title="解析失败" :description="errorMessage" />
          <BaseState v-else-if="loading" title="正在解析" description="后端正在获取作品信息。" />
          <BaseState v-else-if="!result" title="等待解析" description="视频和音频资源会集中展示在这里。" />

          <template v-else>
            <view class="result-summary">
              <text class="summary-label">解析完成</text>
              <text class="summary-title">{{ result.title || '未命名作品' }}</text>
              <text class="summary-desc">已为你整理好可用资源，选择下方操作即可。</text>
              <text v-if="!downloadBaseReady" class="summary-warning">
                当前下载链接暂不可用，请稍后再试。
              </text>
            </view>

            <ResultCard :result="result" mode="video" />

            <view class="resource-card">
              <view class="resource-header">
                <text class="resource-title">分享链接</text>
                <text class="resource-state">可复制</text>
              </view>
              <text class="resource-desc">保留原分享内容，方便稍后重新解析。</text>
              <view class="button-row">
                <button class="secondary-button" @tap="copyShareUrl">复制分享链接</button>
              </view>
            </view>

            <view class="resource-card">
              <view class="resource-header">
                <text class="resource-title">视频资源</text>
                <text class="resource-state">{{ hasVideo ? '可用' : '不可用' }}</text>
              </view>
              <text class="resource-desc">
                {{ videoMeta }}
              </text>
              <view class="button-row">
                <button class="secondary-button" :disabled="!canDownloadVideo || !downloadBaseReady" @tap="download('video')">
                  下载视频
                </button>
                <button class="primary-button" :disabled="!canDownloadVideo || !downloadBaseReady" @tap="copyMedia('video')">
                  复制视频下载链接
                </button>
              </view>
            </view>

            <view class="resource-card">
              <view class="resource-header">
                <text class="resource-title">音频资源</text>
                <text class="resource-state">{{ hasAudio ? '可用' : '不可用' }}</text>
              </view>
              <text class="resource-desc">
                {{ hasAudio ? result.audioTitle || '作品音乐/BGM' : '当前作品未解析到可下载音频' }}
              </text>
              <view class="button-row">
                <button class="secondary-button" :disabled="!canDownloadAudio || !downloadBaseReady" @tap="download('audio')">
                  下载音频
                </button>
                <button class="primary-button" :disabled="!canDownloadAudio || !downloadBaseReady" @tap="copyMedia('audio')">
                  复制音频下载链接
                </button>
              </view>
            </view>
          </template>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.result-summary {
  box-sizing: border-box;
  width: 100%;
  margin-top: 24rpx;
  padding: 28rpx;
  border: 1rpx solid #d1fae5;
  border-radius: 20rpx;
  background: #f8fffc;
  color: #111827;
}

.summary-label {
  display: block;
  font-size: 24rpx;
  color: #0f766e;
  font-weight: 700;
}

.summary-title {
  display: block;
  margin-top: 10rpx;
  font-size: 34rpx;
  font-weight: 700;
  line-height: 1.4;
}

.summary-desc {
  display: block;
  margin-top: 12rpx;
  font-size: 25rpx;
  line-height: 1.6;
  color: #6b7280;
}

.summary-warning {
  display: block;
  margin-top: 14rpx;
  padding: 14rpx 18rpx;
  border-radius: 14rpx;
  background: #fffbeb;
  color: #92400e;
  font-size: 24rpx;
  line-height: 1.5;
}

.resource-card {
  box-sizing: border-box;
  width: 100%;
  margin-top: 24rpx;
  padding: 28rpx;
  border: 1rpx solid #e5e7eb;
  border-radius: 20rpx;
  background: #fff;
}

.resource-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
}

.resource-title {
  font-size: 30rpx;
  font-weight: 700;
  color: #111827;
}

.resource-state {
  flex: 0 0 auto;
  padding: 6rpx 16rpx;
  border-radius: 999rpx;
  background: #f3f4f6;
  color: #4b5563;
  font-size: 24rpx;
}

.resource-desc {
  display: block;
  margin-top: 12rpx;
  font-size: 26rpx;
  line-height: 1.6;
  color: #6b7280;
}
</style>
