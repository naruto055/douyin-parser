import { buildDownloadUrl } from '@/api/download'
import type { DownloadRequest } from '@/types/download'

export function downloadMedia(params: DownloadRequest): void {
  const url = buildDownloadUrl(params)

  // #ifdef H5
  window.open(url, '_blank')
  // #endif

  // #ifdef MP-WEIXIN || MP-TOUTIAO
  uni.setClipboardData({
    data: url,
    success() {
      uni.showToast({
        title: '已复制下载链接',
        icon: 'none',
      })
    },
    fail() {
      uni.showToast({
        title: '复制失败',
        icon: 'none',
      })
    },
  })
  // #endif

  // #ifdef APP-PLUS
  uni.downloadFile({
    url,
    success(response) {
      if (response.statusCode === 200) {
        uni.openDocument({
          filePath: response.tempFilePath,
          showMenu: true,
        })
        return
      }

      uni.showToast({
        title: '下载失败',
        icon: 'none',
      })
    },
    fail() {
      uni.showToast({
        title: '下载失败',
        icon: 'none',
      })
    },
  })
  // #endif
}
