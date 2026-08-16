/**
 * 创建解析链路耗时跟踪器。
 *
 * 这个工具只负责记录“从哪一步开始、每一步耗时多久”。
 * 它不负责业务判断，也不负责输出详细诊断，只保留足够轻的时间信息。
 *
 * @param {string} name 跟踪器名称，用于区分不同解析链路
 * @returns {object} 解析耗时跟踪器
 */
function createParseTiming(name) {
  // 起点只记录一次，后续所有阶段都基于这个时间计算。
  const startTime = Date.now();
  // 每个阶段的耗时明细按顺序累积，供 snapshot 汇总。
  const stages = [];

  return {
    // 便于日志或上层链路识别当前是哪一路解析。
    name,
    // 保留 ISO 时间，方便跨系统、跨时区排查。
    startedAt: new Date(startTime).toISOString(),
    /**
     * 标记某个阶段成功完成。
     *
     * @param {string} stage 阶段名称
     * @param {number} startedAt 该阶段的开始时间戳
     * @param {object} extra 需要附加到该阶段的补充字段
     */
    mark(stage, startedAt, extra = {}) {
      stages.push({
        stage,
        durationMs: Date.now() - startedAt,
        ...extra
      });
    },
    /**
     * 标记某个阶段失败。
     *
     * 这里保留失败原因，便于上层只看总耗时日志时也能知道失败阶段。
     *
     * @param {string} stage 阶段名称
     * @param {number} startedAt 该阶段的开始时间戳
     * @param {Error|string} error 失败原因
     * @param {object} extra 需要附加到该阶段的补充字段
     */
    fail(stage, startedAt, error, extra = {}) {
      stages.push({
        stage,
        durationMs: Date.now() - startedAt,
        ok: false,
        error: error?.message || String(error),
        ...extra
      });
    },
    /**
     * 生成当前链路的耗时快照。
     *
     * @param {object} extra 额外要合并到快照中的字段
     * @returns {object} 包含总耗时和阶段明细的快照对象
     */
    snapshot(extra = {}) {
      return {
        name,
        totalMs: Date.now() - startTime,
        startedAt: this.startedAt,
        stages: stages.slice(),
        ...extra
      };
    }
  };
}

/**
 * 输出解析链路耗时摘要。
 *
 * 当前只输出总耗时，避免把日志重新拉回到详细诊断模式。
 *
 * @param {object} timing 耗时快照
 */
function logParseTiming(timing) {
  if (!timing) {
    return;
  }

  // 保留最核心的一条总耗时日志，其他阶段信息只留在快照对象里。
  console.log(`[parse-timing:${timing.name}] total=${timing.totalMs}ms`);
}

module.exports = {
  createParseTiming,
  logParseTiming
};
