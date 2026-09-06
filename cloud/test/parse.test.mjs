/**
 * steam.ts 纯解析单测（node --test，无需 wrangler / 网络）。
 * fixture：2026-09-07 实测保存的 Steam gid 页（CS:GO Weapon Case，G18A11F3004）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  parseSSR,
  extractPriceHistory,
  extractOrderbook,
  extractLine1,
  extractGid,
  parseListingPage,
} from '../src/steam.ts';
import { filterHistoryPoints } from '../src/steamClient.ts';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const gidHtml = readFileSync(join(fixtures, 'gid_page.html'), 'utf8');

test('SSR: 能解析 window.SSR.renderContext', () => {
  const rc = parseSSR(gidHtml);
  assert.ok(rc, 'renderContext 应为对象');
});

test('SSR pricehistory: 5202 点，2013-08-14 → 2026-09-06，价格为正', () => {
  const rc = parseSSR(gidHtml);
  const ph = extractPriceHistory(rc);
  assert.ok(ph, 'pricehistory query 应存在');
  assert.equal(ph.points.length, 5202);
  const first = ph.points[0];
  const last = ph.points[ph.points.length - 1];
  assert.equal(new Date(first.ts * 1000).toISOString().slice(0, 10), '2013-08-14');
  assert.equal(new Date(last.ts * 1000).toISOString().slice(0, 10), '2026-09-06');
  assert.ok(last.price > 0, '末点价格应为正');
  assert.ok(last.volume >= 0, '末点成交量应非负');
  assert.equal(ph.currency, 23);
});

test('SSR orderbook: 盘口深度齐全（实测 2900 买单 / 668 卖单）', () => {
  const rc = parseSSR(gidHtml);
  const ob = extractOrderbook(rc);
  assert.ok(ob);
  assert.equal(ob.amtMaxBuyOrder, 93000);
  assert.equal(ob.amtMinSellOrder, 96673);
  assert.equal(ob.currency, 23);
  assert.ok(ob.buyOrders.length >= 2900, '买单深度应不少于 2900');
  assert.ok(ob.sellOrders.length >= 668, '卖单深度应不少于 668');
});

test('line1 兜底: 旧版列表页 var line1 解析', () => {
  const html =
    '<html><head></head><body><script>var line1=[["Jun 01 2014 01: +0",0.12,15],["Jun 02 2014 01: +0",0.13,20]];</script></body></html>';
  const pts = extractLine1(html);
  assert.ok(pts);
  assert.equal(pts.length, 2);
  assert.equal(new Date(pts[0].ts * 1000).toISOString().slice(0, 10), '2014-06-01');
  assert.equal(pts[0].price, 0.12);
  assert.equal(pts[0].volume, 15);
  assert.equal(new Date(pts[1].ts * 1000).toISOString().slice(0, 10), '2014-06-02');
});

test('parseListingPage: 综合解析，SSR 优先、提取 gid', () => {
  const parsed = parseListingPage(gidHtml, 'https://steamcommunity.com/market/listings/730/G18A11F3004');
  assert.equal(parsed.gid, 'G18A11F3004');
  assert.ok(parsed.pricePoints);
  assert.equal(parsed.pricePoints.length, 5202);
  assert.ok(parsed.orderbook);
});

test('parseListingPage: 无 SSR 时回退 line1', () => {
  const html =
    '<html><script>var line1=[["Jan 01 2020 01: +0",10.5,3]];</script></html>';
  const parsed = parseListingPage(html, 'https://steamcommunity.com/market/listings/730/Some%20Case');
  assert.equal(parsed.gid, null);
  assert.ok(parsed.pricePoints);
  assert.equal(parsed.pricePoints.length, 1);
  assert.equal(parsed.orderbook, null);
});

test('extractGid: URL 与 HTML 均能提取 / 缺省返回 null', () => {
  assert.equal(extractGid('https://steamcommunity.com/market/listings/730/G18A11F3004'), 'G18A11F3004');
  assert.equal(extractGid('https://steamcommunity.com/market/listings/730/abc'), null);
});

test('filterHistoryPoints: 天数截断 + 增量过滤', () => {
  const now = Math.floor(Date.now() / 1000);
  const points = [
    { ts: now - 400 * 86400, price: 1, volume: 1 },
    { ts: now - 100 * 86400, price: 2, volume: 2 },
    { ts: now - 10 * 86400, price: 3, volume: 3 },
    { ts: now - 86400, price: 4, volume: 4 },
  ];
  const out = filterHistoryPoints(points, 120, now - 20 * 86400);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((p) => p.price), [3, 4]);
});