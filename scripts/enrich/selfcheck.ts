import assert from 'node:assert/strict';
import { SUBMEDIUM_BY_MEDIUM, SUBMEDIUM_PROMPTS_BY_MEDIUM } from './taxonomy';
import { classifySubMedium } from './classify';
import type { Scorer } from './scorer';

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

  // classifySubMedium：prompt top-1 對映回標籤；未知 medium → null
  const bedroomPrompt = SUBMEDIUM_PROMPTS_BY_MEDIUM['Interior Design'].Bedroom;
  const bedroomScorer: Scorer = {
    async classify(_ref, labels) {
      return [...labels]
        .map((label) => ({ label, score: label === bedroomPrompt ? 0.9 : 0.1 }))
        .sort((a, b) => b.score - a.score);
    }
  };
  const sub = await classifySubMedium(bedroomScorer, 'Interior Design', 'img.jpg');
  assert.equal(sub?.label, 'Bedroom');
  assert.equal(sub?.score, 0.9);
  assert.equal(await classifySubMedium(bedroomScorer, 'Unknown Medium', 'img.jpg'), null);

  console.log('selfcheck OK');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
