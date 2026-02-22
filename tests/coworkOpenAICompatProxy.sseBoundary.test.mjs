import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const proxyModule = require('../dist-electron/libs/coworkOpenAICompatProxy.js');
const testUtils = proxyModule.__openAICompatProxyTestUtils;

if (!testUtils?.findSSEPacketBoundary) {
  throw new Error('findSSEPacketBoundary 在 __openAICompatProxyTestUtils 中不可用');
}

test('findSSEPacketBoundary 检测 LF 数据包分隔符', () => {
  const boundary = testUtils.findSSEPacketBoundary('data: 1\n\ndata: 2\n\n');
  assert.ok(boundary);
  assert.equal(boundary.index, 7);
  assert.equal(boundary.separatorLength, 2);
});

test('findSSEPacketBoundary 检测 CRLF 数据包分隔符', () => {
  const boundary = testUtils.findSSEPacketBoundary('data: 1\r\n\r\ndata: 2\r\n\r\n');
  assert.ok(boundary);
  assert.equal(boundary.index, 7);
  assert.equal(boundary.separatorLength, 4);
});

test('findSSEPacketBoundary 在混合输入中返回最早出现的分隔符', () => {
  const boundary = testUtils.findSSEPacketBoundary('data: 1\r\n\r\ndata: 2\n\n');
  assert.ok(boundary);
  assert.equal(boundary.index, 7);
  assert.equal(boundary.separatorLength, 4);
});
