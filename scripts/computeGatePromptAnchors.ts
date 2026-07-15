import 'dotenv/config';
import { Pool } from 'pg';
import { STYLE_GROUP_GATE_DESCRIPTIONS, MEDIUM_GATE_PHRASES, buildGatePrompt } from './enrich/taxonomy';
import { createClipTextEmbedder } from './enrich/textEmbedder';

// 算 36 組 gate prompt（9 styleGroup × 4 medium）的 embedding，寫進
// classification_anchors（dimension='gate'）——前端以圖搜圖用這 36 個向量算
// Domain Gate 分數（跟 36 句的最大 cosine），判斷「是不是設計參考圖」，
// 跟 dimension='styleGroup' 的 9 組錨點（用於別處）是獨立的一組資料。
// label 格式 `${styleGroup}::${medium}`，跟 (dimension, label) 的 UNIQUE 對齊，可重跑覆蓋更新。
async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const embedder = await createClipTextEmbedder();
    const entries: { label: string; text: string }[] = [];
    for (const styleGroup of Object.keys(STYLE_GROUP_GATE_DESCRIPTIONS)) {
      for (const medium of Object.keys(MEDIUM_GATE_PHRASES)) {
        entries.push({ label: `${styleGroup}::${medium}`, text: buildGatePrompt(styleGroup, medium) });
      }
    }

    const embeddings = await embedder.embedTexts(entries.map((e) => e.text));

    for (let i = 0; i < entries.length; i++) {
      const { label } = entries[i];
      const embedding = embeddings[i];

      await pool.query(
        `INSERT INTO classification_anchors (dimension, label, embedding)
         VALUES ('gate', $1, $2::vector)
         ON CONFLICT (dimension, label) DO UPDATE SET embedding = EXCLUDED.embedding`,
        [label, `[${embedding.join(',')}]`]
      );
      console.log(`寫入 gate 錨點：${label}`);
    }

    console.log(`完成 ${entries.length} 組 gate 錨點`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
