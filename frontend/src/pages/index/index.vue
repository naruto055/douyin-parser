<script setup lang="ts">
import { onMounted } from 'vue'
import { getHealth } from '@/api/request'
import { useAppStore } from '@/stores/app'
import { useHistoryStore } from '@/stores/history'

const appStore = useAppStore()
const historyStore = useHistoryStore()

onMounted(async () => {
  historyStore.load()

  try {
    appStore.setHealth(await getHealth())
  } catch {
    // 首页健康检查失败不阻断用户进入解析页面。
  }
})

function go(path: string) {
  uni.navigateTo({ url: path })
}
</script>

<template>
  <view class="page">
    <view class="page-container">
      <view class="hero">
        <view>
          <text class="page-title">粘贴抖音链接，提取视频和音频</text>
          <text class="page-subtitle">一个工作台完成解析、复制和下载。</text>
        </view>
        <text v-if="appStore.health" class="health">服务在线</text>
      </view>

      <view class="desktop-grid">
        <view class="section-card nav-card" @tap="go('/pages/parser/index')">
          <text class="section-title">进入解析工作台</text>
          <text class="section-desc">粘贴抖音链接或分享文案，解析后直接处理视频和音频资源。</text>
          <view class="button-row">
            <button class="primary-button">开始解析</button>
          </view>
        </view>

        <view class="section-card">
          <text class="section-title">最近记录</text>
          <text class="section-desc">
            本地保存最近 {{ historyStore.records.length }} 条成功解析记录。
          </text>
          <view class="button-row">
            <button class="secondary-button" @tap="go('/pages/history/index')">查看历史</button>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped lang="scss">
.hero {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
  margin-bottom: 24rpx;
}

.health {
  align-self: flex-start;
  padding: 8rpx 18rpx;
  border-radius: 999rpx;
  background: #dcfce7;
  color: #166534;
  font-size: 24rpx;
  font-weight: 600;
}

.nav-card {
  transition: transform 0.18s ease;
}

.nav-card:active {
  transform: scale(0.99);
}

@media screen and (min-width: 768px) {
  .hero {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }
}
</style>
