import 'dotenv/config';
import { Pool } from 'pg';

// ============================================================================
// 分類方法評測框架 —— 給一批「人工確認過標籤」的測試圖片，比較不同分類策略的
// Top-1 / Top-3 / MRR / Confusion Matrix，取代單一案例來回拉鋸的直覺判斷。
//
// 用法：
//   npx tsx scripts/benchmarkClassifier.ts path/to/labeled-test-set.json
//
// labeled-test-set.json 格式（由 scripts/exportLabelingTool.ts 產生的
// labeling-tool.html 人工標記匯出）：
//   [{ "imageId": "ext-pexels-123", "groundTruthStyleGroup": "Minimal & Structured Modern" }, ...]
//
// 四個候選方法（見設計文件第七節「現在其實有四個候選 Classifier」）：
//   A. Text Anchor —— 現行 Search 頁正在用的方法：手寫文字錨點（classification_anchors
//      表，dimension='styleGroup'）跟查詢圖片 embedding 比 cosine，這是唯一的「現役」方法，
//      前面幾次評測漏掉了它，導致沒辦法回答「換掉現行方法值不值得」這個真正的問題。
//   B. Prototype Raw —— 真實圖片平均向量（不分 medium），LOO 校正。
//   C. Prototype Z-Score —— 同 B，但用 LOO mean/stddev 校正過分數再排序。
//   D. Medium Prototype（架構二：全 36 組直接比）—— 9 styleGroup × 4 medium 共 36 個
//      prototype 全部算一次 cosine，直接挑最高分那一格的 styleGroup，medium 是「順便
//      得到的結果」不是「事先要猜對的前提」。比「先分類 medium 再選對應 prototype」
//      （架構一）更好的地方：架構一如果 medium 分類本身就錯了，後面全部連帶錯，36 次
//      cosine 成本可忽略（512 維 dot product，微秒等級），不需要為了省算力賭一次
//      medium 分類。
//
// 每張測試圖都用 leave-one-out：如果這張圖本身就是某個 prototype 的組成成員之一，
// 算那個 prototype 時先排除自己，避免自己驗證自己把準確率灌水。
// ============================================================================

interface ImageRow {
  id: string;
  styleGroup: string;
  medium: string | null;
  embedding: number[];
}

interface AnchorRow {
  label: string;
  embedding: number[];
}

interface TestCase {
  imageId: string;
  groundTruthStyleGroup: string;
}

interface RankedGuess {
  label: string;
  score: number;
}

const STYLE_GROUPS = [
  'Future Tech & Digital Psychedelia',
  'Y2K & Internet Aesthetics',
  'Decorative & Opulent Art',
  'Minimal & Structured Modern',
  'Earth & Organic Humanism',
  'Romantic & Pastoral Living',
  'Retro & Nostalgia',
  'Experimental & Avant-Garde',
  'Street & Youth Culture'
];

// confusion matrix 表頭用縮寫，9 組全名太長排不進終端機
const STYLE_GROUP_ABBR: Record<string, string> = {
  'Future Tech & Digital Psychedelia': 'FT',
  'Y2K & Internet Aesthetics': 'Y2K',
  'Decorative & Opulent Art': 'DOA',
  'Minimal & Structured Modern': 'MSM',
  'Earth & Organic Humanism': 'EOH',
  'Romantic & Pastoral Living': 'RPL',
  'Retro & Nostalgia': 'RN',
  'Experimental & Avant-Garde': 'EAG',
  'Street & Youth Culture': 'SYC'
};

function averageVectors(vectors: number[][]): number[] {
  const dim = vectors[0].length;
  const sum = new Array(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) sum[i] += v[i];
  }
  return sum.map((s) => s / vectors.length);
}

function l2Normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return norm === 0 ? v : v.map((x) => x / norm);
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

async function loadAllImages(pool: Pool): Promise<ImageRow[]> {
  const res = await pool.query(
    `SELECT id, style_group AS "styleGroup", medium, embedding::text AS embedding
     FROM images WHERE embedding IS NOT NULL`
  );
  return res.rows.map((r) => ({ ...r, embedding: JSON.parse(r.embedding) }));
}

async function loadTextAnchors(pool: Pool): Promise<AnchorRow[]> {
  const res = await pool.query(
    `SELECT label, embedding::text AS embedding FROM classification_anchors WHERE dimension = 'styleGroup'`
  );
  return res.rows.map((r) => ({ label: r.label, embedding: JSON.parse(r.embedding) }));
}

function groupByStyleGroup(images: ImageRow[]): Map<string, ImageRow[]> {
  const groups = new Map<string, ImageRow[]>();
  for (const img of images) {
    if (!groups.has(img.styleGroup)) groups.set(img.styleGroup, []);
    groups.get(img.styleGroup)!.push(img);
  }
  return groups;
}

// key 格式："styleGroup||medium"，方便查表
function groupByStyleGroupAndMedium(images: ImageRow[]): Map<string, ImageRow[]> {
  const groups = new Map<string, ImageRow[]>();
  for (const img of images) {
    if (!img.medium) continue;
    const key = `${img.styleGroup}||${img.medium}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(img);
  }
  return groups;
}

function looPrototype(group: ImageRow[], excludeId: string | null): number[] {
  const members = excludeId ? group.filter((img) => img.id !== excludeId) : group;
  return l2Normalize(averageVectors(members.map((m) => m.embedding)));
}

// Method A: Text Anchor —— 現行 Search 頁的方法，跟查詢圖片無關（錨點是固定文字算好的），
// 不需要 LOO。
function classifyTextAnchor(embedding: number[], anchors: AnchorRow[]): RankedGuess[] {
  return anchors
    .map((a) => ({ label: a.label, score: cosineSimilarity(embedding, a.embedding) }))
    .sort((a, b) => b.score - a.score);
}

// Method B: Prototype Raw —— 對每組（排除自己，若自己在該組內）算 LOO prototype，
// 直接依 cosine similarity 排序。
function classifyRawCosine(
  embedding: number[],
  selfId: string,
  groups: Map<string, ImageRow[]>
): RankedGuess[] {
  const guesses: RankedGuess[] = [];
  for (const [styleGroup, members] of groups) {
    const isMember = members.some((m) => m.id === selfId);
    const prototype = looPrototype(members, isMember ? selfId : null);
    guesses.push({ label: styleGroup, score: cosineSimilarity(embedding, prototype) });
  }
  return guesses.sort((a, b) => b.score - a.score);
}

// Method C: Prototype Z-Score —— 用「LOO mean/stddev」校正過的分數排序（z-score 回答的是
// 「典不典型」，不是「像不像」，這裡直接讓 benchmark 測出它適不適合拿來排序）。
function classifyZScore(embedding: number[], selfId: string, groups: Map<string, ImageRow[]>): RankedGuess[] {
  const guesses: RankedGuess[] = [];
  for (const [styleGroup, members] of groups) {
    if (members.length < 3) continue;
    const isMember = members.some((m) => m.id === selfId);
    const prototype = looPrototype(members, isMember ? selfId : null);

    const others = isMember ? members.filter((m) => m.id !== selfId) : members;
    const sims = others.map((m, i) => {
      const otherProto = looPrototype(others, others[i].id);
      return cosineSimilarity(m.embedding, otherProto);
    });
    const mean = sims.reduce((a, b) => a + b, 0) / sims.length;
    const variance = sims.reduce((a, b) => a + (b - mean) ** 2, 0) / sims.length;
    const stddev = Math.sqrt(variance) || 1e-6;

    const rawScore = cosineSimilarity(embedding, prototype);
    guesses.push({ label: styleGroup, score: (rawScore - mean) / stddev });
  }
  return guesses.sort((a, b) => b.score - a.score);
}

// Method D: Medium Prototype（架構二）—— 9×4=36 個 (styleGroup, medium) prototype 全部
// 算一次 cosine，直接排序，不事先猜 medium。回傳的 label 只取 styleGroup（同一個
// styleGroup 可能因為不同 medium 出現兩次以上，去重時保留分數較高的那個）。
function classifyAllPrototypes(
  embedding: number[],
  selfId: string,
  cellGroups: Map<string, ImageRow[]>
): RankedGuess[] {
  const bestPerStyleGroup = new Map<string, number>();
  for (const [key, members] of cellGroups) {
    if (members.length < 2) continue; // 這格樣本太少，LOO 沒意義，跳過
    const [styleGroup] = key.split('||');
    const isMember = members.some((m) => m.id === selfId);
    const prototype = looPrototype(members, isMember ? selfId : null);
    const score = cosineSimilarity(embedding, prototype);
    const prevBest = bestPerStyleGroup.get(styleGroup);
    if (prevBest === undefined || score > prevBest) bestPerStyleGroup.set(styleGroup, score);
  }
  return Array.from(bestPerStyleGroup, ([label, score]) => ({ label, score })).sort(
    (a, b) => b.score - a.score
  );
}

interface MethodStats {
  top1: number;
  top3: number;
  mrrSum: number;
  evaluated: number;
  confusion: Map<string, Map<string, number>>; // groundTruth -> predicted -> count
}

function newStats(): MethodStats {
  return { top1: 0, top3: 0, mrrSum: 0, evaluated: 0, confusion: new Map() };
}

function recordResult(stats: MethodStats, guesses: RankedGuess[], groundTruth: string): void {
  if (guesses.length === 0) return;
  stats.evaluated += 1;
  const rank = guesses.findIndex((g) => g.label === groundTruth);
  if (rank === 0) stats.top1 += 1;
  if (rank >= 0 && rank < 3) stats.top3 += 1;
  if (rank >= 0) stats.mrrSum += 1 / (rank + 1);

  const predicted = guesses[0].label;
  if (!stats.confusion.has(groundTruth)) stats.confusion.set(groundTruth, new Map());
  const row = stats.confusion.get(groundTruth)!;
  row.set(predicted, (row.get(predicted) ?? 0) + 1);
}

function printReport(name: string, stats: MethodStats): void {
  if (stats.evaluated === 0) {
    console.log(`${name} | 沒有可評測的案例`);
    return;
  }
  console.log(
    `${name} | n=${stats.evaluated} | Top-1=${((stats.top1 / stats.evaluated) * 100).toFixed(1)}% ` +
      `| Top-3=${((stats.top3 / stats.evaluated) * 100).toFixed(1)}% | MRR=${(stats.mrrSum / stats.evaluated).toFixed(3)}`
  );
}

function printConfusionMatrix(name: string, stats: MethodStats): void {
  console.log(`\n${name} confusion matrix（列=真實標籤，欄=預測結果，只列有資料的組）`);
  const present = STYLE_GROUPS.filter((g) => stats.confusion.has(g));
  if (present.length === 0) {
    console.log('（無資料）');
    return;
  }
  const header = ['真實\\預測', ...present.map((g) => STYLE_GROUP_ABBR[g])].join('\t');
  console.log(header);
  for (const truth of present) {
    const row = stats.confusion.get(truth)!;
    const cells = present.map((pred) => row.get(pred) ?? 0);
    console.log([STYLE_GROUP_ABBR[truth], ...cells].join('\t'));
  }
  console.log('縮寫對照：' + present.map((g) => `${STYLE_GROUP_ABBR[g]}=${g}`).join('；'));
}

async function main(): Promise<void> {
  const testSetPath = process.argv[2];
  if (!testSetPath) {
    console.error('用法：npx tsx scripts/benchmarkClassifier.ts path/to/labeled-test-set.json');
    process.exit(1);
  }

  const fs = await import('node:fs');
  const testSet: TestCase[] = JSON.parse(fs.readFileSync(testSetPath, 'utf-8'));

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const [allImages, textAnchors] = await Promise.all([loadAllImages(pool), loadTextAnchors(pool)]);
    const byId = new Map(allImages.map((img) => [img.id, img]));
    const styleGroups = groupByStyleGroup(allImages);
    const cells = groupByStyleGroupAndMedium(allImages);

    const statsTextAnchor = newStats();
    const statsRawCosine = newStats();
    const statsZScore = newStats();
    const statsMediumPrototype = newStats();

    let skipped = 0;
    for (const testCase of testSet) {
      const image = byId.get(testCase.imageId);
      if (!image) {
        skipped += 1;
        continue;
      }

      recordResult(statsTextAnchor, classifyTextAnchor(image.embedding, textAnchors), testCase.groundTruthStyleGroup);
      recordResult(
        statsRawCosine,
        classifyRawCosine(image.embedding, image.id, styleGroups),
        testCase.groundTruthStyleGroup
      );
      recordResult(
        statsZScore,
        classifyZScore(image.embedding, image.id, styleGroups),
        testCase.groundTruthStyleGroup
      );
      recordResult(
        statsMediumPrototype,
        classifyAllPrototypes(image.embedding, image.id, cells),
        testCase.groundTruthStyleGroup
      );
    }

    console.log(`測試集共 ${testSet.length} 筆，${skipped} 筆在圖庫裡找不到對應圖片（略過）\n`);
    console.log('方法 | 樣本數 | Top-1 | Top-3 | MRR');
    printReport('A. Text Anchor（現行 Search 方法）', statsTextAnchor);
    printReport('B. Prototype Raw', statsRawCosine);
    printReport('C. Prototype Z-Score', statsZScore);
    printReport('D. Medium Prototype（全 36 組直接比，架構二）', statsMediumPrototype);

    printConfusionMatrix('A. Text Anchor', statsTextAnchor);
    printConfusionMatrix('D. Medium Prototype', statsMediumPrototype);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
