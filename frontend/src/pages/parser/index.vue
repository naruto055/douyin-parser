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
      <text class="page-subtitle">一次粘贴链接，同时获取视频、音频和下载入口。</text>

      <view class="desktop-grid">
        <UrlInputCard
          v-model="url"
          title="输入链接"
          description="支持抖音短链接或分享文案，解析成功后会自动保存到本机历史。"
          submit-text="开始解析"
          :loading="loading"
          @submit="submit"
        />

        <view>
          <BaseState v-if="errorMessage" title="解析失败" :description="errorMessage" />
          <BaseState v-else-if="loading" title="正在解析" description="后端正在获取作品信息。" />
          <BaseState v-else-if="!result" title="等待解析" description="视频和音频资源会集中展示在这里。" />

          <template v-else>
            <ResultCard :result="result" mode="video" />

            <view class="resource-card">
              <view class="resource-header">
                <text class="resource-title">原始链接</text>
                <text class="resource-state">可复制</text>
              </view>
              <text class="resource-desc">用于重新解析、后端下载和跨端分享。</text>
              <view class="button-row">
                <button class="secondary-button" @tap="copyShareUrl">复制原始链接</button>
              </view>
            </view>

            <view class="resource-card">
              <view class="resource-header">
                <text class="resource-title">视频资源</text>
                <text class="resource-state">{{ hasVideo ? '可用' : '不可用' }}</text>
              </view>
              <text class="resource-desc">
                {{ result.videoCodec || '未知编码' }}
                <template v-if="result.videoWidth && result.videoHeight">
                  · {{ result.videoWidth }}x{{ result.videoHeight }}
                </template>
              </text>
              <view class="button-row">
                <button class="primary-button" :disabled="!canDownloadVideo" @tap="copyMedia('video')">
                  复制下载链接
                </button>
                <button class="secondary-button" :disabled="!canDownloadVideo" @tap="download('video')">
                  下载视频
                </button>
              </view>
            </view>

            <view class="resource-card">
              <view class="resource-header">
                <text class="resource-title">音频资源</text>
                <text class="resource-state">{{ hasAudio ? '可用' : '不可用' }}</text>
              </view>
              <text class="resource-desc">
                {{ hasAudio ? result.audioTitle || '作品音乐/BGM' : '当前作品未返回可用音频' }}
              </text>
              <view class="button-row">
                <button class="primary-button" :disabled="!canDownloadAudio" @tap="copyMedia('audio')">
                  复制下载链接
                </button>
                <button class="secondary-button" :disabled="!canDownloadAudio" @tap="download('audio')">
                  下载音频
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
