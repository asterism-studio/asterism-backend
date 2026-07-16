import 'dotenv/config';
import fs from 'node:fs';
import { Pool } from 'pg';

// δ（IMAGE_SEARCH_CONFIG.styleGroupBoundaryMargin）校準：現行值 0.05 從頭到尾
// 沒有拿真實資料驗證過，只是設計文件第五節兩個舉例（0.03、假設性的 0.007）之間
// 隨便抓的中間值。這裡用 270 張標記測試集校準，只讀 classification_anchors，
// **不寫資料庫**。
//
// δ 的作用：Top-1/Top-2 分數差距小於 δ 時，同時搜尋多個 styleGroup 合併結果，
// 不是只搜贏家那一組。校準的問題不是「準確率」，是 trade-off：
//   - δ 越大 → 「贏家答錯時，正解有沒有被撈進候選組」的救援率越高（coverage）
//   - δ 越大 → 平均候選組數越多 → 每次搜尋混進越多不相關風格的圖（稀釋成本）
// 目標是找到「救援率已經打平、繼續加大 δ 只會增加稀釋成本」的那個轉折點。
//
// 用法：npx tsx scripts/calibrateBoundaryMargin.ts path/to/labeled-test-set.json
interface AnchorRow {
  label: string;
  embedding: number[];
}

interface TestCase {
  imageId: string;
  groundTruthStyleGroup: string;
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

async function main(): Promise<void> {
  const testSetPath = process.argv[2];
  if (!testSetPath) {
    console.error('用法：npx tsx scripts/calibrateBoundaryMargin.ts path/to/labeled-test-set.json');
    process.exit(1);
  }
  const testSet: TestCase[] = JSON.parse(fs.readFileSync(testSetPath, 'utf-8'));

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const [anchorRes, imageRes] = await Promise.all([
      pool.query(`SELECT label, embedding::text AS embedding FROM classification_anchors WHERE dimension = 'styleGroup'`),
      pool.query(`SELECT id, embedding::text AS embedding FROM images WHERE embedding IS NOT NULL`)
    ]);
    const anchors: AnchorRow[] = anchorRes.rows.map((r) => ({ label: r.label, embedding: JSON.parse(r.embedding) }));
    const byId = new Map(imageRes.rows.map((r) => [r.id, JSON.parse(r.embedding) as number[]]));

    // 每張測試圖只需要算一次完整排名，後面對不同 δ 重複使用
    const rankings: { groundTruth: string; ranked: { label: string; score: number }[] }[] = [];
    let skipped = 0;
    for (const testCase of testSet) {
      const embedding = byId.get(testCase.imageId);
      if (!embedding) {
        skipped += 1;
        continue;
      }
      const ranked = anchors
        .map((a) => ({ label: a.label, score: cosineSimilarity(embedding, a.embedding) }))
        .sort((a, b) => b.score - a.score);
      rankings.push({ groundTruth: testCase.groundTruthStyleGroup, ranked });
    }

    console.log(`測試集共 ${testSet.length} 筆，${skipped} 筆找不到 embedding（略過），實際評測 n=${rankings.length}\n`);
    console.log('δ | 平均候選組數 | Top-1 本來就對的比例 | 救援率（Top-1 答錯時，正解有沒有被 δ 撈進候選組）');

    for (let delta = 0; delta <= 0.15; delta += 0.01) {
      let totalCandidateCount = 0;
      let top1Correct = 0;
      let top1WrongCount = 0;
      let rescued = 0;

      for (const { groundTruth, ranked } of rankings) {
        const topScore = ranked[0].score;
        const candidates = ranked.filter((r) => r.score >= topScore - delta);
        totalCandidateCount += candidates.length;

        const isTop1Correct = ranked[0].label === groundTruth;
        if (isTop1Correct) {
          top1Correct += 1;
        } else {
          top1WrongCount += 1;
          if (candidates.some((c) => c.label === groundTruth)) rescued += 1;
        }
      }

      const avgCandidates = totalCandidateCount / rankings.length;
      const top1Rate = (top1Correct / rankings.length) * 100;
      const rescueRate = top1WrongCount > 0 ? (rescued / top1WrongCount) * 100 : 0;
      console.log(
        `${delta.toFixed(2)} | ${avgCandidates.toFixed(2)} | ${top1Rate.toFixed(1)}% | ${rescueRate.toFixed(1)}% (n=${top1WrongCount})`
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
