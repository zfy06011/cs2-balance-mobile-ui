// 比较 trace 工具产出的 cold/warm/reverse/fresh JSON；不访问网络。
const fs = require('fs');
const path = require('path');
const files = process.argv.slice(2);
if (files.length < 2) {
  console.error('用法：node scripts/compare_forecast_traces.cjs traceA.json traceB.json ...');
  process.exit(1);
}
const docs = files.map((file) => ({ file, data: JSON.parse(fs.readFileSync(path.resolve(process.cwd(), file), 'utf8')) }));
const byFile = new Map(docs.map((doc) => [doc.file, new Map(doc.data.rounds[0].traces.map((trace) => [trace.item, trace]))]));
const names = [...byFile.values()][0] ? [...[...byFile.values()][0].keys()] : [];
const diff = [];
for (const item of names) {
  const traces = docs.map((doc) => doc.data.rounds[0].traces.find((trace) => trace.item === item));
  const first = traces[0];
  diff.push({
    item,
    changes: traces.slice(1).map((trace, index) => ({
      against: docs[index].file,
      readinessChanged: first.bundle.readinessStatus !== trace.bundle.readinessStatus,
      sourceChanged: first.historyLookup.historySource !== trace.historyLookup.historySource,
      pointCountChanged: first.normalizedHistory.outputPointCount !== trace.normalizedHistory.outputPointCount,
      forecastChanged: JSON.stringify(first.forecast) !== JSON.stringify(trace.forecast),
      cacheHitChanged: first.bundle.cacheHit !== trace.bundle.cacheHit,
    })),
  });
}
console.log(JSON.stringify({ files, diff }, null, 2));

