import 'dotenv/config';
import { Pool } from 'pg';
import { createClipEmbedder } from './enrich/clipEmbedder';

// 補跑既有圖庫的 embedding：只處理 embedding IS NULL 的列，可重跑（已補過的不會重算）。
// 固定批次撈取 + FOR UPDATE SKIP LOCKED：同一批列被鎖住的期間，另一個並發執行的
// 程序會直接跳過去撈下一批，不會兩邊都對同一張圖重複打 CLIP。
const BATCH_SIZE = 100;

async function processBatch(pool: Pool, embedder: Awaited<ReturnType<typeof createClipEmbedder>>): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: string; url: string }>(
      `SELECT id, url FROM images WHERE embedding IS NULL ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [BATCH_SIZE]
    );

    for (const row of rows) {
      try {
        const embedding = await embedder.embedImage(row.url);
        await client.query('UPDATE images SET embedding = $1::vector WHERE id = $2', [
          `[${embedding.join(',')}]`,
          row.id
        ]);
      } catch (error) {
        console.warn(`跳過 ${row.id}：`, (error as Error).message);
      }
    }

    await client.query('COMMIT');
    return rows.length;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const embedder = await createClipEmbedder();

    let total = 0;
    while (true) {
      const count = await processBatch(pool, embedder);
      if (count === 0) break;
      total += count;
      console.log(`已處理一批（${count} 張），累計 ${total} 張`);
    }

    console.log(`共處理 ${total} 張`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
