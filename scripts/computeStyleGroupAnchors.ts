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

    for (let i = 0; i < entries.length; i++) {
      const [styleGroup] = entries[i];
      const embedding = embeddings[i];

      await pool.query(
        `INSERT INTO classification_anchors (dimension, label, embedding)
         VALUES ('styleGroup', $1, $2::vector)
         ON CONFLICT (dimension, label) DO UPDATE SET embedding = EXCLUDED.embedding`,
        [styleGroup, `[${embedding.join(',')}]`]
      );
      console.log(`寫入錨點：${styleGroup}`);
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
