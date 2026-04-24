const crypto = require('crypto');

const config = require('../../config');

/**
 * AISessionStore 是一个轻量级的内存会话存储器，用于管理 AI 对话的上下文历史。
 *
 * 主要职责：
 * 1. 为新会话生成唯一的 sessionId。
 * 2. 按 sessionId 读取和维护对应的消息历史。
 * 3. 在发起新一轮对话前，组装 AI 请求所需的上下文数据。
 * 4. 在一轮对话结束后，保存用户消息和助手回复，并按配置裁剪历史长度。
 *
 * 适用场景：
 * - 单进程、内存态的会话管理。
 * - 不要求进程重启后保留历史记录的场景。
 * - 需要在调用大模型前快速拼接最近若干轮上下文的场景。
 *
 * 基本用法：
 * ```js
 * const store = new AISessionStore();
 * const { resolvedSessionId, history, userMessage } = store.createContext('你好');
 * // 将 history 和 userMessage 传给 AI 服务后，拿到 reply
 * store.saveTurn(resolvedSessionId, userMessage, reply);
 * ```
 *
 * 设计说明：
 * - 当前实现使用 Map 在内存中保存所有会话，结构简单，符合 KISS。
 * - 只暴露最小必要能力：生成 ID、读取历史、创建上下文、保存轮次，符合 YAGNI。
 * - 通过 sessionIdFactory 注入 ID 生成策略，避免把生成逻辑硬编码在调用侧，符合依赖抽象的思路。
 */
class AISessionStore {
  /**
   * 创建一个 AI 会话存储实例。
   *
   * @param {{ sessionLimit?: number, sessionIdFactory?: Function }} [options]
   * @param {number} [options.sessionLimit]
   * 会话轮次上限。每一轮包含 1 条用户消息和 1 条助手消息，因此最终最多保留 sessionLimit * 2 条消息。
   *
   * @param {Function} [options.sessionIdFactory]
   * 自定义会话 ID 生成函数。若未传入有效函数，则回退到 AISessionStore.defaultSessionIdFactory。
   */
  constructor({ sessionLimit, sessionIdFactory } = {}) {
    /**
     * 当前实例使用的会话轮次上限原始值。
     *
     * 作用：
     * - 允许调用方在实例级别覆盖默认配置。
     * - 实际生效前会在 _resolveSessionLimit 中做标准化和兜底处理。
     */
    this.sessionLimit = sessionLimit;

    /**
     * 会话 ID 生成器。
     *
     * 作用：
     * - 为新会话提供唯一标识。
     * - 允许通过依赖注入替换默认实现，便于测试或接入外部 ID 规范。
     *
     * 这里通过 `typeof sessionIdFactory === 'function'` 检查传入值是否为函数，
     * 只有在满足条件时才使用外部实现，否则回退到内置默认生成器。
     */
    this.sessionIdFactory = typeof sessionIdFactory === 'function' ? sessionIdFactory : AISessionStore.defaultSessionIdFactory;

    /**
     * 内存中的会话仓库。
     *
     * 数据结构：
     * - key: sessionId，表示一次独立会话。
     * - value: 消息数组，数组元素通常为 `{ role, content }` 结构。
     *
     * 使用 Map 的原因：
     * - 适合按 sessionId 做高频读写。
     * - `Map.prototype.get` / `Map.prototype.set` 语义明确，可读性比普通对象更好。
     */
    this.sessions = new Map();
  }

  /**
   * 生成会话 ID。
   *
   * 调用 `this.sessionIdFactory()` 的作用：
   * - 统一由当前实例配置的 ID 生成策略创建新 ID。
   * - 让调用方无需关心底层使用 UUID 还是随机字节串。
   *
   * @returns {string}
   */
  createSessionId() {
    return this.sessionIdFactory();
  }

  /**
   * 获取会话历史消息。
   *
   * @param {string} sessionId 会话 ID
   * @returns {Array}
   */
  getMessages(sessionId) {
    /**
     * 当前会话对应的历史消息副本源数据。
     *
     * `this.sessions.get(sessionId)` 的作用：
     * - 从内存仓库中读取指定 sessionId 对应的消息数组。
     *
     * `|| []` 的作用：
     * - 当会话尚未存在时，返回空数组，避免后续调用方处理 undefined。
     */
    const messages = this.sessions.get(sessionId) || [];

    /**
     * 返回浅拷贝后的消息列表，而不是直接暴露内部数组引用。
     *
     * `messages.map(...)` 的作用：
     * - 遍历每一条消息并构造一个新对象。
     *
     * `{ ...message }` 的作用：
     * - 浅拷贝单条消息，避免外部修改返回值时直接污染内部状态。
     */
    return messages.map((message) => ({ ...message }));
  }

  /**
   * 构建本轮会话上下文。
   *
   * @param {string} message 用户输入
   * @param {string} [sessionId] 会话 ID
   * @returns {{ resolvedSessionId: string, history: Array, userMessage: { role: string, content: string } }}
   */
  createContext(message, sessionId) {
    /**
     * 本次请求最终使用的 sessionId。
     *
     * `sessionId || this.createSessionId()` 的作用：
     * - 优先复用调用方传入的会话 ID，确保同一会话可以连续对话。
     * - 若未传入，则自动创建一个新的会话 ID，用于初始化新会话。
     */
    const resolvedSessionId = sessionId || this.createSessionId();

    /**
     * 当前会话已有的历史消息。
     *
     * `this.getMessages(resolvedSessionId)` 的作用：
     * - 读取当前会话之前的上下文。
     * - 返回的是副本，避免拼接上下文时误改内部存储。
     */
    const history = this.getMessages(resolvedSessionId);

    /**
     * 当前这一轮的用户消息对象。
     *
     * 字段说明：
     * - role: 消息角色，这里固定为 'user'，用于告诉 AI 这是用户输入。
     * - content: 消息正文。
     *
     * `String(message)` 的作用：
     * - 将任意传入值显式转换为字符串，避免出现 null、number 等非字符串类型导致的异常。
     *
     * `.trim()` 的作用：
     * - 去掉首尾空白字符，减少无意义空格对上下文的干扰。
     */
    const userMessage = { role: 'user', content: String(message).trim() };

    return {
      resolvedSessionId,
      history,
      userMessage
    };
  }

  /**
   * 保存当前轮次消息并按配置裁剪历史长度。
   *
   * @param {string} sessionId 会话 ID
   * @param {{ role: string, content: string }} userMessage 用户消息
   * @param {string} reply 助手回复
   */
  saveTurn(sessionId, userMessage, reply) {
    /**
     * 读取保存前的历史消息。
     *
     * 这里复用 `getMessages`，确保基于当前会话已有记录构建下一版历史。
     */
    const history = this.getMessages(sessionId);

    /**
     * 当前实例最终生效的会话轮次上限。
     *
     * `_resolveSessionLimit()` 的作用：
     * - 从实例配置和全局配置中解析出一个合法的正整数上限。
     * - 对非法配置做兜底，避免 slice 范围异常。
     */
    const sessionLimit = this._resolveSessionLimit();

    /**
     * 保存后的新历史记录。
     *
     * 构建逻辑：
     * 1. 先拼接旧历史。
     * 2. 再追加当前轮用户消息。
     * 3. 再追加当前轮助手回复。
     * 4. 最后只保留最近若干轮消息。
     *
     * `...history` 的作用：
     * - 展开已有历史消息，维持原始顺序。
     *
     * `{ ...userMessage }` 的作用：
     * - 拷贝用户消息对象，避免外部后续修改原对象影响存储结果。
     *
     * `{ role: 'assistant', content: reply }` 的作用：
     * - 构造当前轮的助手回复消息，统一消息结构。
     *
     * `.slice(-sessionLimit * 2)` 的作用：
     * - 只保留最近 N 轮对话。
     * - 每轮包含 2 条消息，因此保留条数为 `sessionLimit * 2`。
     * - 负数起始位表示从数组尾部反向截取最近若干条。
     */
    const nextHistory = [
      ...history,
      { ...userMessage },
      { role: 'assistant', content: reply }
    ].slice(-sessionLimit * 2);

    /**
     * 将裁剪后的最新历史写回内存仓库。
     *
     * `this.sessions.set(sessionId, nextHistory)` 的作用：
     * - 以 sessionId 为键覆盖保存当前会话的最新消息列表。
     */
    this.sessions.set(sessionId, nextHistory);
  }

  /**
   * 默认会话 ID 生成器。
   *
   * 优先使用 `crypto.randomUUID()`，因为它能直接生成标准 UUID。
   * 如果当前运行环境不支持，则退化为随机 16 字节并转成十六进制字符串。
   *
   * @returns {string}
   */
  static defaultSessionIdFactory() {
    /**
     * `typeof crypto.randomUUID === 'function'` 的作用：
     * - 检查当前 Node.js 运行环境是否提供了原生 UUID 生成能力。
     */
    if (typeof crypto.randomUUID === 'function') {
      /**
       * `crypto.randomUUID()` 的作用：
       * - 生成一个随机 UUID 字符串，适合作为会话唯一标识。
       */
      return crypto.randomUUID();
    }
    /**
     * `crypto.randomBytes(16)` 的作用：
     * - 生成 16 字节的高质量随机数据。
     *
     * `.toString('hex')` 的作用：
     * - 将二进制随机字节编码为十六进制字符串，便于存储和传输。
     */
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * 解析有效的会话轮次上限。
   *
   * @returns {number}
   */
  _resolveSessionLimit() {
    /**
     * 待解析的原始上限值。
     *
     * `this.sessionLimit ?? config.ai.sessionLimit` 的作用：
     * - 优先使用实例级配置。
     * - 当实例级配置为 null 或 undefined 时，再回退到全局配置。
     *
     * 这里使用空值合并运算符 `??`，而不是 `||`，
     * 是为了避免把 0、'' 这类值误判为“未配置”。
     */
    const rawLimit = this.sessionLimit ?? config.ai.sessionLimit;

    /**
     * 标准化后的数值结果。
     *
     * `Number(rawLimit)` 的作用：
     * - 将配置值统一转换为 number，兼容字符串数字等输入形式。
     */
    const normalizedLimit = Number(rawLimit);

    /**
     * `Number.isFinite(normalizedLimit)` 的作用：
     * - 判断结果是否为有限数字，过滤 NaN、Infinity 等非法值。
     *
     * `normalizedLimit < 1` 的作用：
     * - 确保会话轮次上限至少为 1，避免出现 0 或负数导致历史被全部裁掉。
     */
    if (!Number.isFinite(normalizedLimit) || normalizedLimit < 1) {
      return 1;
    }

    /**
     * `Math.floor(normalizedLimit)` 的作用：
     * - 向下取整，保证最终返回整数轮次。
     */
    return Math.floor(normalizedLimit);
  }
}

module.exports = AISessionStore;
