import assert from 'node:assert/strict';
import { STYLE_GROUP_ANCHORS, MEDIUM_LABELS, buildGatePrompt } from './taxonomy';
import { dot } from './vectorMath';

// relevance gate 純邏輯自檢（後端無測試框架，assert 腳本代替）：
//   npx tsx scripts/enrich/gateSelfcheck.ts
// 註：與 selfcheck.ts（subMedium）分開，讓兩個 PR 不管誰先 merge 都不衝突。
async function main(): Promise<void> {
  // dot：L2 normalized 向量的內積即 cosine
  assert.equal(dot([1, 0], [1, 0]), 1);
  assert.equal(dot([1, 0], [0, 1]), 0);
  assert.ok(Math.abs(dot([0.6, 0.8], [0.8, 0.6]) - 0.96) < 1e-9);

  // gate prompt：9 個 styleGroup × 4 個 medium 都組得出完整句子（無缺素材）
  for (const styleGroup of Object.keys(STYLE_GROUP_ANCHORS)) {
    for (const medium of MEDIUM_LABELS) {
      const prompt = buildGatePrompt(styleGroup, medium);
      assert.ok(prompt.length > 40, `gate prompt 過短: ${prompt}`);
      assert.ok(!prompt.includes('undefined'), `gate prompt 缺素材: ${styleGroup} × ${medium}`);
    }
  }

  console.log('gate selfcheck OK');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
