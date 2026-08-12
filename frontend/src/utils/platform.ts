export function isH5(): boolean {
  // #ifdef H5
  return true
  // #endif

  return false
}

export function isMiniProgram(): boolean {
  // #ifdef MP-WEIXIN || MP-TOUTIAO
  return true
  // #endif

  return false
}
