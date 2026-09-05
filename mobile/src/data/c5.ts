/**
 * c5：C5GAME 直连适配器（手机端）。
 * 首选官方 OpenAPI（openapi.c5game.com，需 app-key）。
 * 未配置 app-key 或端点未验证时返回 null（禁止臆造价格），
 * 用户也可在详情页手动录入 C5 买入价。
 */
export async function fetchC5Price(name: string, appKey: string): Promise<number | null> {
  if (!appKey || !appKey.trim()) return null;
  // C5GAME OpenAPI 正式接入需按 https://opendoc.c5game.com 文档核验端点与鉴权方式，
  // 当前与后端一致：未验证前不臆造数据，返回 null（由手动录入兜底）。
  void name;
  void appKey;
  return null;
}
