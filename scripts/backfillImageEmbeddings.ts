import 'dotenv/config';
import { Pool } from 'pg';
import { createClipEmbedder } from './enrich/clipEmbedder';

// 補跑既有圖庫的 embedding：只處理 embedding IS NULL 的列，可重跑（已補過的不會重算）。
async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const embedder = await createClipEmbedder();
    const { rows } = await pool.query<{ id: string; url: string }>(
      'SELECT id, url FROM images WHERE embedding IS NULL'
    );

    console.log(`待補 embedding：${rows.length} 張`);

    let done = 0;
    let skipped = 0;

    for (const row of rows) {
      try {
        const embedding = await embedder.embedImage(row.url);
        await pool.query('UPDATE images SET embedding = $1::vector WHERE id = $2', [
          `[${embedding.join(',')}]`,
          row.id
        ]);
        done += 1;
      } catch (error) {
        skipped += 1;
        console.warn(`跳過 ${row.id}：`, (error as Error).message);
      }
    }

    console.log(`補完 ${done} / ${rows.length} 張，略過 ${skipped} 張`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
