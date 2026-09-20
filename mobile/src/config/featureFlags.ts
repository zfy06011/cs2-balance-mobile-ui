/** 生产算法开关：默认 legacy，3C-1 不提供用户可见 toggle。 */
import { IS_RC_BUILD } from './buildChannel';
declare const __DEV__: boolean;

export type OpportunityMode = 'legacy' | 'shadow' | 'v2';

export interface FeatureFlags {
  opportunityMode: OpportunityMode;
}

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = Object.freeze({
  opportunityMode: 'v2',
});

export function isDevRuntime(): boolean {
  const injected = typeof __DEV__ !== 'undefined' && __DEV__ === true;
  const globalFlag = typeof globalThis !== 'undefined'
    && (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ === true;
  return injected || globalFlag;
}

/**
 * Dev-only override：不提供用户可见 toggle。生产构建没有该全局值时始终 legacy。
 * Web debug 可在控制台设置 globalThis.__YU_E_OPPORTUNITY_MODE__ 后刷新页面。
 */
export function getRuntimeFeatureFlags(): FeatureFlags {
  if (IS_RC_BUILD) return { opportunityMode: 'v2' };
  const globals = typeof globalThis !== 'undefined'
    ? globalThis as typeof globalThis & { __YU_E_OPPORTUNITY_MODE__?: unknown }
    : undefined;
  const candidate = isDevRuntime()
    ? globals?.__YU_E_OPPORTUNITY_MODE__
    : undefined;
  return normalizeFeatureFlags(candidate ? { opportunityMode: candidate as OpportunityMode } : DEFAULT_FEATURE_FLAGS);
}

export function normalizeFeatureFlags(input?: Partial<FeatureFlags> | null): FeatureFlags {
  const mode = input?.opportunityMode;
  return {
    opportunityMode: mode === 'legacy' || mode === 'shadow' || mode === 'v2' ? mode : 'legacy',
  };
}
