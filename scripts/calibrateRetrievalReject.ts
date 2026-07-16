import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

// 純檢索架構的 reject 門檻校準:把 open-set 拒絕從「圖對文字錨點」換成「圖對全庫 top-1」,
// 用同一批資料(270 正樣本 + 100 負樣本)畫 ROC,跟現行基準(TPR 85.6% / FPR 11%)比。
// 正樣本在庫內,算 top-1 時 leave-one-out 排除自己。不寫 DB、不跑 CLIP(embedding 全是現成的)。
//   執行:npx tsx scripts/calibrateRetrievalReject.ts scripts/labeled-test-set-270.json

interface TestCase {
  imageId: string;
  groundTruthStyleGroup: string;
}

interface NegativeSample {
  query: string;
  url: string;
  embedding: number[];
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function top1Similarity(embedding: number[], library: Map<string, number[]>, excludeId?: string): number {
  let best = -1;
  for (const [id, candidate] of library) {
    if (id === excludeId) continue;
    const score = cosineSimilarity(embedding, candidate);
    if (score > best) best = score;
  }
  return best;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((p / 100) * (sorted.length - 1))];
}

function summarize(name: string, values: number[]): void {
  console.log(
    `${name} | n=${values.length} | min=${Math.min(...values).toFixed(3)} | p5=${percentile(values, 5).toFixed(3)} ` +
      `| p25=${percentile(values, 25).toFixed(3)} | median=${percentile(values, 50).toFixed(3)} ` +
      `| p75=${percentile(values, 75).toFixed(3)} | max=${Math.max(...values).toFixed(3)}`
  );
}

async function main(): Promise<void> {
  const testSetPath = process.argv[2];
  if (!testSetPath) {
    console.error('用法:npx tsx scripts/calibrateRetrievalReject.ts scripts/labeled-test-set-270.json');
    process.exit(1);
  }

  const testSet: TestCase[] = JSON.parse(fs.readFileSync(testSetPath, 'utf-8'));
  const negatives: NegativeSample[] = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'scripts', 'negative-samples.json'), 'utf-8')
  );

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query<{ id: string; embedding: string }>(
      'SELECT id, embedding::text AS embedding FROM images WHERE embedding IS NOT NULL'
    );
    const library = new Map(rows.map((r) => [r.id, JSON.parse(r.embedding) as number[]]));
    console.log(`圖庫 embedding 數:${library.size}\n`);

    const positiveTop1: number[] = [];
    let skipped = 0;
    for (const testCase of testSet) {
      const embedding = library.get(testCase.imageId);
      if (!embedding) {
        skipped += 1;
        continue;
      }
      positiveTop1.push(top1Similarity(embedding, library, testCase.imageId));
    }
    const negativeTop1 = negatives.map((n) => top1Similarity(n.embedding, library));

    console.log(`正樣本 n=${positiveTop1.length}(略過 ${skipped} 筆找不到 embedding)`);
    console.log(`負樣本 n=${negativeTop1.length}\n`);
    console.log('--- 全庫 top-1 相似度分佈 ---');
    summarize('正樣本', positiveTop1);
    summarize('負樣本', negativeTop1);

    console.log('\n--- Threshold 掃描(拒絕條件:top-1 < T)---');
    console.log('T | TPR(正樣本被接受)| FPR(負樣本被誤接受)| Youden J');
    let bestT = 0;
    let bestJ = -Infinity;
    for (let t = 0.4; t <= 0.95; t += 0.02) {
      const tpr = positiveTop1.filter((s) => s >= t).length / positiveTop1.length;
      const fpr = negativeTop1.filter((s) => s >= t).length / negativeTop1.length;
      const j = tpr - fpr;
      if (j > bestJ) {
        bestJ = j;
        bestT = t;
      }
      console.log(`${t.toFixed(2)} | ${(tpr * 100).toFixed(1)}% | ${(fpr * 100).toFixed(1)}% | ${j.toFixed(3)}`);
    }
    console.log(`\nYouden 最佳 T ≈ ${bestT.toFixed(2)}(J=${bestJ.toFixed(3)})`);
    console.log('現行文字錨點基準:TPR 85.6% / FPR 11%(J=0.746)。');
    console.log('決策:最佳 J 明顯高於 0.746 → 純檢索定案,T_reject 取此值(依 False Reject 體感可偏保守);');
    console.log('      沒有明顯優於 → 停,回設計文件討論方案 2/3。');
    console.log('weakMatchThreshold 建議:正樣本 median 附近(top-1 低於它=「相似度中等」提示層)。');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
