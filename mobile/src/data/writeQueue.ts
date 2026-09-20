/**
 * writeQueue：全局 SQLite 写操作串行队列（v1.8.1 引入，v1.8.5 抽成独立模块）。
 *
 * 为什么必须共享：expo-sqlite 的 withTransactionAsync 文档明写「非互斥，可被其它异步查询
 * 打断」——它只是裸发 BEGIN / COMMIT，JS 层没有任何锁。同一条连接上两个事务交错会出现
 * 嵌套 BEGIN，原生层不稳定直接闪退（无 JS 报错）。
 *
 * v1.8.5 修复的遗漏：v1.8.1 只把 storage.ts 的 7 个事务入口接入队列，
 * zhNames.mergeZhNames（每次扫描开始必调）与 migrate 仍自行开事务，绕过了队列。
 * 现在所有 withTransactionAsync 调用点统一经此队列，杜绝事务重叠。
 */
let writeQueue: Promise<unknown> = Promise.resolve();

/** 把一段（通常含事务的）写操作排入全局串行队列，返回其结果 Promise。 */
export function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(task, task);
  writeQueue = result.then(() => undefined, () => undefined);
  return result;
}

/** 等待当前队列排空（测试用；生产代码无需调用） */
export function waitWriteQueueIdle(): Promise<unknown> {
  return writeQueue;
}
