import 'dotenv/config';
import fs from 'node:fs';
import { Pool } from 'pg';
import { createClipTextEmbedder } from './enrich/textEmbedder';

// 本機測試候選錨點文字，不寫資料庫。做法：讀現行 9 組 classification_anchors
// （production），只把要測的候選組別換成新文字算出的 embedding（純本機計算），
// 其餘 7 組維持現行文字不變，跑一次 Text Anchor Top-1/confusion，
// 跟現行版本（第八節：Top-1 80.3%，EAG→FT 誤判 7/18）比較有沒有真的變好。
// 確認候選文字有改善，才進 scripts/enrich/taxonomy.ts 改常數、
// 用 scripts/computeStyleGroupAnchors.ts 正式寫回 classification_anchors。
//
// 用法：npx tsx scripts/testAnchorCandidate.ts path/to/labeled-test-set.json
const CANDIDATE_ANCHORS: Record<string, string> = {
  'Experimental & Avant-Garde': 'deconstructed asymmetric avant-garde couture brutalist anti-design unconventional'
};

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

function evaluate(testSet: TestCase[], byId: Map<string, number[]>, anchors: AnchorRow[]) {
  let top1 = 0;
  let evaluated = 0;
  const confusion = new Map<string, Map<string, number>>();

  for (const testCase of testSet) {
    const embedding = byId.get(testCase.imageId);
    if (!embedding) continue;
    evaluated += 1;

    const ranked = anchors
      .map((a) => ({ label: a.label, score: cosineSimilarity(embedding, a.embedding) }))
      .sort((a, b) => b.score - a.score);
    const predicted = ranked[0].label;
    if (predicted === testCase.groundTruthStyleGroup) top1 += 1;

    if (!confusion.has(testCase.groundTruthStyleGroup)) confusion.set(testCase.groundTruthStyleGroup, new Map());
    const row = confusion.get(testCase.groundTruthStyleGroup)!;
    row.set(predicted, (row.get(predicted) ?? 0) + 1);
  }

  return { top1: top1 / evaluated, evaluated, confusion };
}

async function main(): Promise<void> {
  const testSetPath = process.argv[2];
  if (!testSetPath) {
    console.error('用法：npx tsx scripts/testAnchorCandidate.ts path/to/labeled-test-set.json');
    process.exit(1);
  }
  const testSet: TestCase[] = JSON.parse(fs.readFileSync(testSetPath, 'utf-8'));

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const [anchorRes, imageRes] = await Promise.all([
      pool.query(`SELECT label, embedding::text AS embedding FROM classification_anchors WHERE dimension = 'styleGroup'`),
      pool.query(`SELECT id, embedding::text AS embedding FROM images WHERE embedding IS NOT NULL`)
    ]);
    const currentAnchors: AnchorRow[] = anchorRes.rows.map((r) => ({ label: r.label, embedding: JSON.parse(r.embedding) }));
    const byId = new Map(imageRes.rows.map((r) => [r.id, JSON.parse(r.embedding) as number[]]));

    console.log('--- 現行錨點（對照組）---');
    const before = evaluate(testSet, byId, currentAnchors);
    console.log(`Top-1 = ${(before.top1 * 100).toFixed(1)}% (n=${before.evaluated})`);
    const eagRowBefore = before.confusion.get('Experimental & Avant-Garde');
    console.log(`EAG 誤判分佈：`, eagRowBefore ? Object.fromEntries(eagRowBefore) : '無資料');

    const embedder = await createClipTextEmbedder();
    const candidateLabels = Object.keys(CANDIDATE_ANCHORS);
    const candidateEmbeddings = await embedder.embedTexts(candidateLabels.map((l) => CANDIDATE_ANCHORS[l]));

    const newAnchors = currentAnchors.map((a) => {
      const idx = candidateLabels.indexOf(a.label);
      return idx === -1 ? a : { label: a.label, embedding: candidateEmbeddings[idx] };
    });

    console.log('\n--- 候選錨點（本機測試，未寫資料庫）---');
    for (const label of candidateLabels) {
      console.log(`${label} 候選文字："${CANDIDATE_ANCHORS[label]}"`);
    }
    const after = evaluate(testSet, byId, newAnchors);
    console.log(`Top-1 = ${(after.top1 * 100).toFixed(1)}% (n=${after.evaluated})`);
    const eagRowAfter = after.confusion.get('Experimental & Avant-Garde');
    console.log(`EAG 誤判分佈：`, eagRowAfter ? Object.fromEntries(eagRowAfter) : '無資料');

    console.log(`\nTop-1 變化：${(before.top1 * 100).toFixed(1)}% → ${(after.top1 * 100).toFixed(1)}%`);

    console.log('\n--- 全部 9 組 Top-1 正確數對照（每組自己被分類正確的比例）---');
    const allLabels = currentAnchors.map((a) => a.label);
    for (const label of allLabels) {
      const b = before.confusion.get(label);
      const a2 = after.confusion.get(label);
      const total = b ? Array.from(b.values()).reduce((x, y) => x + y, 0) : 0;
      const beforeCorrect = b?.get(label) ?? 0;
      const afterCorrect = a2?.get(label) ?? 0;
      console.log(`${label} | n=${total} | before=${beforeCorrect} | after=${afterCorrect}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
