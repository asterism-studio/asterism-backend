import 'dotenv/config';
import { Pool } from 'pg';
import { createClipEmbedder } from './enrich/clipEmbedder';

// 補跑既有圖庫的 embedding：只處理 embedding IS NULL 的列，可重跑（已補過的不會重算）。
// 固定批次撈取（省記憶體），但每張圖算完立刻各自 commit——這是人工手動跑的一次性
// 腳本，不會真的有兩個程序同時跑；犧牲即時 commit 換 FOR UPDATE SKIP LOCKED 並發保護
// 不划算，中途斷線（網路/手動中斷）會讓一整批已經算好的 embedding 白算。
// UPDATE 加 AND embedding IS NULL 當保險：真的不小心跑兩份，頂多重複打一次 CLIP，
// 不會互相覆蓋或壞資料。
const BATCH_SIZE = 100;

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const embedder = await createClipEmbedder();

    let total = 0;
    let skipped = 0;
    let lastId = '';
    while (true) {
      // id > lastId：keyset pagination，每批一定往前推進。單純用 embedding IS NULL
      // 當條件會讓持續失敗的那張圖每輪都被重新撈到，永遠不會離開待補清單，腳本就卡死
      // 在無窮迴圈；失敗的圖這次先跳過，下次重跑腳本時再試。
      const { rows } = await pool.query<{ id: string; url: string }>(
        `SELECT id, url FROM images WHERE embedding IS NULL AND id > $1 ORDER BY id LIMIT $2`,
        [lastId, BATCH_SIZE]
      );
      if (rows.length === 0) break;

      for (const row of rows) {
        try {
          const embedding = await embedder.embedImage(row.url);
          await pool.query('UPDATE images SET embedding = $1::vector WHERE id = $2 AND embedding IS NULL', [
            `[${embedding.join(',')}]`,
            row.id
          ]);
          total += 1;
        } catch (error) {
          skipped += 1;
          console.warn(`跳過 ${row.id}：`, (error as Error).message);
        }
      }
      lastId = rows[rows.length - 1].id;
      console.log(`已處理一批（${rows.length} 張），累計完成 ${total} 張`);
    }

    console.log(`共完成 ${total} 張，略過 ${skipped} 張`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
