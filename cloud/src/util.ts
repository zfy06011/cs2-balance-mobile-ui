/** 通用小工具（纯函数，无依赖） */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function unixSec(): number {
  return Math.floor(Date.now() / 1000);
}

export function fmtErr(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}