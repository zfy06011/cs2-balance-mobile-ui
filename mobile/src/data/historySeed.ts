import { HISTORY_SEED, HISTORY_SEED_VERSION } from './historySeed.generated';
import { storage } from './storage';
import { isSeedTrackedCase } from './caseFilter';

export async function importBundledHistorySeed(): Promise<number> {
  const status = await storage.getLocalSyncStatus();
  if (status.seedVersion === HISTORY_SEED_VERSION) return 0;
  let imported = 0;
  for (const entry of HISTORY_SEED) {
    if (!isSeedTrackedCase(entry.name)) continue;
    const points = entry.points.map(([timestamp, price, volume]) => {
      const date = new Date(timestamp).toISOString().slice(0, 10);
      return { date, price, volume };
    });
    imported += await storage.mergeSteamHistory(entry.name, points);
  }
  await storage.saveLocalSyncStatus({ seedVersion: HISTORY_SEED_VERSION });
  return imported;
}
