/**
 * CookieManager.web.ts —— Web 端打桩（v1.8.6-web）。
 *
 * @preeternal/react-native-cookie-manager 是原生模块，浏览器里没有等价能力。
 * 网页调试用不到「抓 Steam 登录 cookie」，这里返回空值并静默失败，
 * 保证 CookieLoginScreen 能正常渲染、不因缺原生模块而崩。
 */
export interface CookieManagerStatic {
  get(url: string): Promise<Record<string, string>>;
  set(details: unknown): Promise<boolean>;
  clearAll(useWebKit?: boolean): Promise<boolean>;
  flush(): Promise<void>;
  getAll(useWebKit?: boolean): Promise<Record<string, string>>;
}

const CookieManager: CookieManagerStatic = {
  async get() {
    return {};
  },
  async set() {
    return false;
  },
  async clearAll() {
    return true;
  },
  async flush() {
    // 浏览器无 cookie 容器可落盘
  },
  async getAll() {
    return {};
  },
};

export default CookieManager;
