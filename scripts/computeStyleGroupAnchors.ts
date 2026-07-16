import 'dotenv/config';
import { Pool } from 'pg';
import { STYLE_GROUP_ANCHORS } from './enrich/taxonomy';
import { createClipTextEmbedder } from './enrich/textEmbedder';

// 算 9 組 styleGroup 錨點文字的 embedding，寫進 classification_anchors
// （dimension='styleGroup'）。可重跑：撞到 (dimension, label) 就覆蓋更新，
// 不會重複插入。
async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const embedder = await createClipTextEmbedder();
    const entries = Object.entries(STYLE_GROUP_ANCHORS);
    const texts = entries.map(([, anchorText]) => anchorText);
    const embeddings = await embedder.embedTexts(texts);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < entries.length; i++) {
        const [styleGroup] = entries[i];
        const embedding = embeddings[i];

        await client.query(
          `INSERT INTO classification_anchors (dimension, label, embedding)
           VALUES ('styleGroup', $1, $2::vector)
           ON CONFLICT (dimension, label) DO UPDATE SET embedding = EXCLUDED.embedding`,
          [styleGroup, `[${embedding.join(',')}]`]
        );
        console.log(`寫入錨點：${styleGroup}`);
      }

      // taxonomy 改過（styleGroup 改名或移除）留下的舊 label 一併清掉，避免幽靈錨點。
      const currentLabels = entries.map(([styleGroup]) => styleGroup);
      const { rowCount } = await client.query(
        `DELETE FROM classification_anchors WHERE dimension = 'styleGroup' AND NOT (label = ANY($1))`,
        [currentLabels]
      );
      if (rowCount) console.log(`清除 ${rowCount} 筆已從 taxonomy 移除的舊 styleGroup 錨點`);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    console.log(`完成 ${entries.length} 組 styleGroup 錨點`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
