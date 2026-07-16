import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

// Phase C：用 270 張正樣本（labeled-test-set.json）+ 100 張純負樣本
// （negative-samples.json，scripts/collectNegativeSamples.ts 產生）算出
// Acceptance Threshold 的 ROC，而不是憑感覺挑一個 T。
//
// 校準對象是現行 Search 頁正在用的 Text Anchor 方法（見設計文件第八節：
// Prototype 沒有明顯優於 Text Anchor，不換架構，所以門檻要校準的是實際上線的方法）。
//
// 用法：npx tsx scripts/calibrateAcceptanceThreshold.ts path/to/labeled-test-set.json
interface AnchorRow {
  label: string;
  embedding: number[];
}

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

function topScores(embedding: number[], anchors: AnchorRow[]): { top1: number; top2: number; margin: number } {
  const scores = anchors.map((a) => cosineSimilarity(embedding, a.embedding)).sort((a, b) => b - a);
  return { top1: scores[0], top2: scores[1], margin: scores[0] - scores[1] };
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * (sorted.length - 1));
  return sorted[idx];
}

function summarize(name: string, values: number[]): void {
  console.log(
    `${name} | n=${values.length} | min=${Math.min(...values).toFixed(3)} | p25=${percentile(values, 25).toFixed(3)} ` +
      `| median=${percentile(values, 50).toFixed(3)} | p75=${percentile(values, 75).toFixed(3)} | max=${Math.max(...values).toFixed(3)}`
  );
}

async function main(): Promise<void> {
  const testSetPath = process.argv[2];
  if (!testSetPath) {
    console.error('用法：npx tsx scripts/calibrateAcceptanceThreshold.ts path/to/labeled-test-set.json');
    process.exit(1);
  }

  const testSet: TestCase[] = JSON.parse(fs.readFileSync(testSetPath, 'utf-8'));
  const negatives: NegativeSample[] = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'scripts', 'negative-samples.json'), 'utf-8')
  );

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const [anchorRes, imageRes] = await Promise.all([
      pool.query(`SELECT label, embedding::text AS embedding FROM classification_anchors WHERE dimension = 'styleGroup'`),
      pool.query(`SELECT id, embedding::text AS embedding FROM images WHERE embedding IS NOT NULL`)
    ]);
    const anchors: AnchorRow[] = anchorRes.rows.map((r) => ({ label: r.label, embedding: JSON.parse(r.embedding) }));
    const byId = new Map(imageRes.rows.map((r) => [r.id, JSON.parse(r.embedding) as number[]]));

    const positiveTop1: number[] = [];
    const positiveMargin: number[] = [];
    let skipped = 0;
    for (const testCase of testSet) {
      const embedding = byId.get(testCase.imageId);
      if (!embedding) {
        skipped += 1;
        continue;
      }
      const { top1, margin } = topScores(embedding, anchors);
      positiveTop1.push(top1);
      positiveMargin.push(margin);
    }

    const negativeTop1 = negatives.map((n) => topScores(n.embedding, anchors).top1);
    const negativeMargin = negatives.map((n) => topScores(n.embedding, anchors).margin);

    console.log(`正樣本（真的屬於某風格）n=${positiveTop1.length}，略過 ${skipped} 筆找不到 embedding 的`);
    console.log(`負樣本（純負樣本，狗/貓/食物/風景等）n=${negativeTop1.length}\n`);

    console.log('--- Top1 分數分佈 ---');
    summarize('正樣本 Top1', positiveTop1);
    summarize('負樣本 Top1', negativeTop1);
    console.log('\n--- Margin (Top1-Top2) 分佈 ---');
    summarize('正樣本 Margin', positiveMargin);
    summarize('負樣本 Margin', negativeMargin);

    console.log('\n--- Top1 Threshold 掃描（拒絕條件：Top1 < T）---');
    console.log('T | TPR（正樣本被正確接受的比例）| FPR（負樣本被誤接受的比例）| Youden J = TPR-FPR');
    let bestT = 0;
    let bestJ = -Infinity;
    for (let t = 0.2; t <= 0.6; t += 0.02) {
      const tpr = positiveTop1.filter((s) => s >= t).length / positiveTop1.length;
      const fpr = negativeTop1.filter((s) => s >= t).length / negativeTop1.length;
      const j = tpr - fpr;
      if (j > bestJ) {
        bestJ = j;
        bestT = t;
      }
      console.log(`${t.toFixed(2)} | ${(tpr * 100).toFixed(1)}% | ${(fpr * 100).toFixed(1)}% | ${j.toFixed(3)}`);
    }
    console.log(`\nYouden Index 最大的 T ≈ ${bestT.toFixed(2)}（J=${bestJ.toFixed(3)}）——僅供參考，實際採用前應由團隊依 False Reject 的體感成本決定要不要偏保守`);

    // Top1 × Margin 二維掃描：接受條件改成 Top1>=T1 AND Margin>=T2，
    // 看聯合門檻能不能比單獨用 Top1 分得更開。
    console.log('\n--- Top1 × Margin 二維掃描（接受條件：Top1 >= T1 AND Margin >= T2）---');
    let best2D = { t1: 0, t2: 0, tpr: 0, fpr: 1, j: -Infinity };
    for (let t1 = 0.18; t1 <= 0.3; t1 += 0.02) {
      for (let t2 = 0; t2 <= 0.06; t2 += 0.01) {
        const tpr =
          positiveTop1.filter((s, i) => s >= t1 && positiveMargin[i] >= t2).length / positiveTop1.length;
        const fpr =
          negativeTop1.filter((s, i) => s >= t1 && negativeMargin[i] >= t2).length / negativeTop1.length;
        const j = tpr - fpr;
        if (j > best2D.j) best2D = { t1, t2, tpr, fpr, j };
      }
    }
    console.log(
      `最佳聯合門檻：Top1>=${best2D.t1.toFixed(2)}, Margin>=${best2D.t2.toFixed(2)} | TPR=${(best2D.tpr * 100).toFixed(1)}% | FPR=${(best2D.fpr * 100).toFixed(1)}% | J=${best2D.j.toFixed(3)}`
    );
    console.log(
      best2D.j > bestJ
        ? `比單獨用 Top1（J=${bestJ.toFixed(3)}）好，加 Margin 有幫助`
        : `沒有比單獨用 Top1（J=${bestJ.toFixed(3)}）好，這批資料上 Margin 沒有額外增益`
    );

    // 匯出原始點位供散佈圖用
    const scatterData = [
      ...positiveTop1.map((top1, i) => ({ top1, margin: positiveMargin[i], label: 'positive' as const })),
      ...negativeTop1.map((top1, i) => ({ top1, margin: negativeMargin[i], label: 'negative' as const }))
    ];
    fs.writeFileSync(
      path.join(process.cwd(), 'scripts', 'acceptance-scatter-data.json'),
      JSON.stringify(scatterData)
    );
    console.log('\n散佈圖原始資料已寫入 scripts/acceptance-scatter-data.json');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
