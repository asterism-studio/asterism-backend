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

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < entries.length; i++) {
        const { label } = entries[i];
        const embedding = embeddings[i];

        await client.query(
          `INSERT INTO classification_anchors (dimension, label, embedding)
           VALUES ('gate', $1, $2::vector)
           ON CONFLICT (dimension, label) DO UPDATE SET embedding = EXCLUDED.embedding`,
          [label, `[${embedding.join(',')}]`]
        );
        console.log(`寫入 gate 錨點：${label}`);
      }

      // taxonomy 改過（styleGroup/medium 增刪或改名）留下的舊 label，這裡一併清掉，
      // 避免幽靈錨點繼續參與 Domain Gate 的 max-cosine 比對。
      const currentLabels = entries.map((e) => e.label);
      const { rowCount } = await client.query(
        `DELETE FROM classification_anchors WHERE dimension = 'gate' AND NOT (label = ANY($1))`,
        [currentLabels]
      );
      if (rowCount) console.log(`清除 ${rowCount} 筆已從 taxonomy 移除的舊 gate 錨點`);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
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
