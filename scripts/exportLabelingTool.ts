import 'dotenv/config';
import { Pool } from 'pg';
import fs from 'node:fs';
import path from 'node:path';

// 產生一個單一 HTML 檔案，本機開啟用來人工標記 benchmark 測試集：
// 依 style_group 分組顯示圖庫縮圖，人工勾選「真的屬於這組」的圖片，
// 匯出成 scripts/benchmarkClassifier.ts 可以直接吃的 JSON。
// **只有 SELECT，不寫資料庫。**
//
// 用法：npx tsx scripts/exportLabelingTool.ts [既有 labeled-test-set.json 路徑]
// 有帶既有標記檔的話，會自動勾好已選的圖、還沒補滿 30 張的組別排在最前面，
// 補標時不用重新標一次、也不用滑過已經標滿的組。
async function main(): Promise<void> {
  const existingPath = process.argv[2];
  const existing: { imageId: string; groundTruthStyleGroup: string }[] = existingPath
    ? JSON.parse(fs.readFileSync(existingPath, 'utf-8'))
    : [];

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const res = await pool.query(
    `SELECT id, url, title, style_group AS "styleGroup", medium
     FROM images WHERE excluded = false ORDER BY style_group, medium`
  );
  await pool.end();

  const outPath = path.join(process.cwd(), 'scripts', 'labeling-tool.html');
  fs.writeFileSync(outPath, buildHtml(res.rows, existing));
  console.log(`已產生 ${outPath}（${res.rowCount} 張圖，已預先勾選 ${existing.length} 張既有標記），用瀏覽器直接開啟這個檔案`);
}

interface ImageRow {
  id: string;
  url: string;
  title: string;
  styleGroup: string;
  medium: string | null;
}

// 跟前端 src/data/styleLabels.ts 同一份對照表，僅供顯示用；匯出的 JSON
// 裡 groundTruthStyleGroup 還是英文原值，跟 DB／benchmarkClassifier.ts 對得起來。
const STYLE_GROUP_ZH: Record<string, string> = {
  'Future Tech & Digital Psychedelia': '未來科技與數位迷幻',
  'Y2K & Internet Aesthetics': 'Y2K 千禧網路美學',
  'Decorative & Opulent Art': '裝飾與華麗藝術',
  'Minimal & Structured Modern': '極簡與結構現代',
  'Earth & Organic Humanism': '大地與有機人文',
  'Romantic & Pastoral Living': '浪漫與田園生活',
  'Retro & Nostalgia': '復古與懷舊',
  'Experimental & Avant-Garde': '實驗與前衛',
  'Street & Youth Culture': '街頭與青年文化'
};

const MEDIUM_ZH: Record<string, string> = {
  Outfit: '服裝',
  'Graphic Design': '平面設計',
  'Interior Design': '室內設計',
  Architecture: '建築'
};

function buildHtml(images: ImageRow[], existing: { imageId: string; groundTruthStyleGroup: string }[]): string {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<title>Style Group 標記工具</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; background: #111; color: #eee; }
  header { position: sticky; top: 0; background: #1a1a1a; padding: 12px 16px; z-index: 10; display: flex; gap: 16px; align-items: center; border-bottom: 1px solid #333; }
  header button { padding: 8px 16px; cursor: pointer; }
  h2 { padding: 16px; margin: 0; background: #1a1a1a; position: sticky; top: 56px; z-index: 9; }
  .count { font-weight: bold; }
  .count.done { color: #4ade80; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px; padding: 16px; }
  .card { position: relative; border: 2px solid transparent; border-radius: 4px; overflow: hidden; cursor: pointer; }
  .card.checked { border-color: #4ade80; }
  .card img { width: 100%; height: 160px; object-fit: cover; display: block; }
  .card .medium { position: absolute; bottom: 0; left: 0; right: 0; background: rgba(0,0,0,.6); font-size: 11px; padding: 2px 6px; }
  .card input { position: absolute; top: 4px; right: 4px; width: 20px; height: 20px; }
</style>
</head>
<body>
<header>
  <span>已勾選 <span id="total-count" class="count">0</span> 張</span>
  <button id="export-btn">匯出 labeled-test-set.json</button>
</header>
<div id="root"></div>
<script>
const IMAGES = ${JSON.stringify(images)};
const STYLE_GROUP_ZH = ${JSON.stringify(STYLE_GROUP_ZH)};
const MEDIUM_ZH = ${JSON.stringify(MEDIUM_ZH)};
const EXISTING = ${JSON.stringify(existing)};
const existingSet = new Set(EXISTING.map((e) => e.imageId + '||' + e.groundTruthStyleGroup));

const byGroup = new Map();
for (const img of IMAGES) {
  if (!byGroup.has(img.styleGroup)) byGroup.set(img.styleGroup, []);
  byGroup.get(img.styleGroup).push(img);
}

// 還沒補滿 30 張的組別排最前面，標滿的組別排後面，補標時不用滑過去
const groupsSorted = Array.from(byGroup.entries()).sort((a, b) => {
  const doneA = a[1].filter((img) => existingSet.has(img.id + '||' + a[0])).length >= 30;
  const doneB = b[1].filter((img) => existingSet.has(img.id + '||' + b[0])).length >= 30;
  return Number(doneA) - Number(doneB);
});

const root = document.getElementById('root');
for (const [styleGroup, imgs] of groupsSorted) {
  const h2 = document.createElement('h2');
  h2.innerHTML = (STYLE_GROUP_ZH[styleGroup] || styleGroup) + '（<span class="count" data-group="' + styleGroup + '">0</span> / 30）';
  root.appendChild(h2);

  const grid = document.createElement('div');
  grid.className = 'grid';
  for (const img of imgs) {
    const card = document.createElement('label');
    card.className = 'card';
    const mediumZh = MEDIUM_ZH[img.medium] || img.medium || '';
    const isChecked = existingSet.has(img.id + '||' + styleGroup);
    if (isChecked) card.classList.add('checked');
    card.innerHTML =
      '<img src="' + img.url + '" loading="lazy" title="' + (img.title || '') + '">' +
      '<div class="medium">' + mediumZh + '</div>' +
      '<input type="checkbox" data-id="' + img.id + '" data-group="' + styleGroup + '"' + (isChecked ? ' checked' : '') + '>';
    grid.appendChild(card);
  }
  root.appendChild(grid);
}

function updateCounts() {
  const checked = document.querySelectorAll('input[type=checkbox]:checked');
  document.getElementById('total-count').textContent = checked.length;

  const perGroup = new Map();
  for (const cb of checked) {
    const g = cb.dataset.group;
    perGroup.set(g, (perGroup.get(g) || 0) + 1);
  }
  for (const span of document.querySelectorAll('.count[data-group]')) {
    const n = perGroup.get(span.dataset.group) || 0;
    span.textContent = n;
    span.classList.toggle('done', n >= 30);
  }
}

root.addEventListener('change', (e) => {
  if (e.target.matches('input[type=checkbox]')) {
    e.target.closest('.card').classList.toggle('checked', e.target.checked);
    updateCounts();
  }
});
updateCounts();

// 匯出的 JSON 用英文原值，跟 DB／benchmarkClassifier.ts 對得起來，中文只給人眼看。
document.getElementById('export-btn').addEventListener('click', () => {
  const checked = document.querySelectorAll('input[type=checkbox]:checked');
  const testSet = Array.from(checked).map((cb) => ({
    imageId: cb.dataset.id,
    groundTruthStyleGroup: cb.dataset.group
  }));
  const blob = new Blob([JSON.stringify(testSet, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'labeled-test-set.json';
  a.click();
});
</script>
</body>
</html>
`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
