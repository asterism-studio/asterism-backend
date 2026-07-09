import assert from 'node:assert/strict';
import { SUBMEDIUM_BY_MEDIUM, SUBMEDIUM_PROMPTS_BY_MEDIUM } from './taxonomy';

// enrich 純邏輯自檢（後端無測試框架，assert 腳本代替）：npx tsx scripts/enrich/selfcheck.ts
async function main(): Promise<void> {
  // 每個 medium 維持 4 個 subMedium，且 SUBMEDIUM_BY_MEDIUM 與 prompts 的 key 一致
  for (const [medium, subs] of Object.entries(SUBMEDIUM_BY_MEDIUM)) {
    assert.equal(subs.length, 4, `${medium} 應有 4 個 subMedium`);
    assert.deepEqual(subs, Object.keys(SUBMEDIUM_PROMPTS_BY_MEDIUM[medium]));
  }
  // 新場景型分類已生效
  assert.deepEqual(SUBMEDIUM_BY_MEDIUM.Outfit, ['Full Look', 'Top Focus', 'Bottom Focus', 'Accessory Focus']);
  assert.deepEqual(SUBMEDIUM_BY_MEDIUM['Interior Design'], ['Living & Dining Space', 'Bedroom', 'Lighting', 'Decor Detail']);
  assert.deepEqual(SUBMEDIUM_BY_MEDIUM.Architecture, ['Building Exterior', 'Facade', 'Entrance', 'Passage']);
  // 每條 prompt 都是非空句子
  for (const prompts of Object.values(SUBMEDIUM_PROMPTS_BY_MEDIUM)) {
    for (const prompt of Object.values(prompts)) assert.ok(prompt.length > 20);
  }
  console.log('selfcheck OK');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
