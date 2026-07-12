import 'dotenv/config';
import { Pool } from 'pg';
import { buildGatePrompt } from './enrich/taxonomy';
import { createClipTextEmbedder } from './enrich/textEmbedder';
import { dot } from './enrich/vectorMath';

// 一次性校準：讀 DB 既有圖的 embedding（pgvector，讀回為 '[0.1,...]' 字串），
// 對所屬 styleGroup × medium 的 gate prompt 算 cosine，依審核狀態分組印分佈，
// 供 RELEVANCE_THRESHOLD 定案。門檻與 gate prompt 綁定：改 prompt 要重跑本腳本。
//   執行：npx tsx scripts/calibrateRelevanceGate.ts

interface Row {
  style_group: string;
  medium: string;
  embedding: string;
  needs_review: { styleGroup: boolean; medium: boolean; subMedium: boolean };
  excluded: boolean | null;
}

function quantile(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

function report(label: string, values: number[]): void {
  if (values.length === 0) {
    console.log(`${label}: (無資料)`);
    return;
  }
  const s = [...values].sort((a, b) => a - b);
  console.log(
    `${label}: n=${s.length} min=${s[0].toFixed(3)} p5=${quantile(s, 0.05).toFixed(3)} ` +
      `p25=${quantile(s, 0.25).toFixed(3)} p50=${quantile(s, 0.5).toFixed(3)} ` +
      `p95=${quantile(s, 0.95).toFixed(3)} max=${s[s.length - 1].toFixed(3)}`
  );
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const embedder = await createClipTextEmbedder();
    const { rows } = await pool.query<Row>(
      `SELECT style_group, medium, embedding::text AS embedding, needs_review, excluded
       FROM images
       WHERE embedding IS NOT NULL AND medium IS NOT NULL AND style_group IS NOT NULL`
    );

    const gateVectors = new Map<string, number[]>();
    const all: number[] = [];
    const clean: number[] = []; // styleGroup/medium 未被 flag 且未被人工排除
    const flagged: number[] = [];
    const humanExcluded: number[] = []; // 人工刷掉的圖 —— 門檻最想擋住的那群

    for (const row of rows) {
      const key = `${row.style_group}|${row.medium}`;
      if (!gateVectors.has(key)) {
        const [vector] = await embedder.embedTexts([buildGatePrompt(row.style_group, row.medium)]);
        gateVectors.set(key, vector);
      }
      const relevance = dot(JSON.parse(row.embedding) as number[], gateVectors.get(key)!);
      all.push(relevance);
      if (row.excluded) humanExcluded.push(relevance);
      else if (row.needs_review.styleGroup || row.needs_review.medium) flagged.push(relevance);
      else clean.push(relevance);
    }

    report('全部', all);
    report('乾淨（未 flag、未排除）', clean);
    report('被 flag（styleGroup/medium）', flagged);
    report('人工排除（excluded）', humanExcluded);
    console.log('建議：門檻取「乾淨組 p5」與「人工排除組 p50」之間，寧低勿高（誤殺比漏放貴）。');
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
