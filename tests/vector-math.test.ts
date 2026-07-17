import assert from 'node:assert/strict'
import test from 'node:test'
import { l2Normalize } from '../scripts/enrich/vectorMath'

test('l2Normalize 把向量縮放成單位長度', () => {
  const result = l2Normalize([3, 4])
  assert.ok(Math.abs(result[0] - 0.6) < 1e-9)
  assert.ok(Math.abs(result[1] - 0.8) < 1e-9)
})

test('l2Normalize 對零向量原樣回傳（避免除以 0）', () => {
  assert.deepEqual(l2Normalize([0, 0]), [0, 0])
})

test('l2Normalize 保留向量維度', () => {
  const input = [1, 2, 3, 4, 5]
  const result = l2Normalize(input)
  assert.equal(result.length, input.length)
})
