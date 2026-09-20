/** Forecast Prepare → Freeze 的纯数据结构和确定性 helper。 */

export type ForecastReadinessStatus =
  | 'ready'
  | 'missing_history'
  | 'insufficient_history'
  | 'history_fetch_failed'
  | 'history_parse_failed'
  | 'history_stale'
  | 'prediction_failed'
  | 'unsupported_item'
  | 'warming';

export interface ForecastReadiness {
  item: string;
  status: ForecastReadinessStatus;
  historySource?: 'local' | 'steam_ssr';
  retrievalSource?: 'persistent_cache' | 'steam_ssr';
  historyPointCount?: number;
  requiredPointCount?: number;
  historyStartAt?: number;
  historyEndAt?: number;
  forecastAsOf?: number;
  modelVersion?: string;
  cacheHit?: boolean;
  latencyMs?: number;
  reason?: string;
}

export interface ForecastBundleItem {
  item: string;
  readiness: ForecastReadiness;
  forecast?: {
    p25: number;
    p50: number;
    p75: number;
    confidence?: number;
    marketState?: string;
    direction?: string;
  };
}

export interface ForecastBundleManifest {
  candidateCount: number;
  readyCount: number;
  unsupportedCount: number;
  failedCount: number;
  startedAt: number;
  completedAt: number;
  prepareCompleted: true;
  inFlightAtFreeze: 0;
}

export interface ForecastBundle {
  createdAt: number;
  modelVersion: string;
  candidateHash: string;
  manifest: ForecastBundleManifest;
  items: Record<string, ForecastBundleItem>;
}

export function candidateHashOf(items: readonly string[]): string {
  let hash = 2166136261;
  for (const text of items.slice().sort()) {
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    hash ^= 10;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

export function freezeForecastBundle(bundle: ForecastBundle): ForecastBundle {
  if (bundle.manifest.prepareCompleted !== true || bundle.manifest.inFlightAtFreeze !== 0) {
    throw new Error('forecast_bundle_not_ready_to_freeze');
  }
  return deepFreeze(bundle);
}

export async function prepareForecastBundle(
  candidates: readonly string[],
  resolver: (item: string) => Promise<ForecastBundleItem>,
  options: { modelVersion: string; startedAt?: number } = { modelVersion: 'baseline-robust-v4' },
): Promise<ForecastBundle> {
  const unique = [...new Set(candidates)];
  const startedAt = options.startedAt ?? Date.now();
  const items: Record<string, ForecastBundleItem> = {};
  let inFlight = 0;
  for (const item of unique) {
    inFlight++;
    try {
      items[item] = await resolver(item);
    } catch (error) {
      items[item] = {
        item,
        readiness: { item, status: 'history_fetch_failed', requiredPointCount: 3, reason: String((error as Error)?.message || error) },
      };
    } finally {
      inFlight--;
    }
  }
  const completedAt = Date.now();
  const values = Object.values(items);
  const readyCount = values.filter((value) => value.readiness.status === 'ready').length;
  const unsupportedCount = values.filter((value) => value.readiness.status === 'unsupported_item').length;
  const failedCount = values.length - readyCount - unsupportedCount;
  return freezeForecastBundle({
    createdAt: completedAt,
    modelVersion: options.modelVersion,
    candidateHash: candidateHashOf(unique),
    manifest: {
      candidateCount: unique.length,
      readyCount,
      unsupportedCount,
      failedCount,
      startedAt,
      completedAt,
      prepareCompleted: true,
      inFlightAtFreeze: inFlight as 0,
    },
    items,
  });
}
