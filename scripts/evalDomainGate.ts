import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createClipTextEmbedder } from './enrich/textEmbedder';
import { STYLE_GROUP_GATE_DESCRIPTIONS, MEDIUM_GATE_PHRASES, buildGatePrompt } from './enrich/taxonomy';

// Domain Gate 校準:拿 collectGateEvalSet.ts 產出的 gate-eval-set.json,對每張圖算
// 「跟 36 句 gate prompt(9 styleGroup x 4 medium)的最大 cosine」,掃過候選門檻算
// ROC / Precision / Recall,用 Youden Index(TPR-FPR 最大)挑最佳門檻——跟這個 repo
// 既有的 acceptance/boundary-margin 校準手法一致。
//
// 這 36 句 gate prompt 不是新設計的:taxonomy.ts 裡本來就是 enrich pipeline 抓圖時
// 用來擋離題候選圖的(RELEVANCE_THRESHOLD=0.22),這裡只是把同一套機制拿來測「校準
// 對象換成使用者上傳的搜尋圖,門檻還適不適用」——母體不同,不能直接沿用舊門檻。
//
// 用法:npx tsx scripts/evalDomainGate.ts
interface GateEvalItem {
  id: string;
  embedding: number[];
  label: boolean;
  source: string;
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

async function main(): Promise<void> {
  const items: GateEvalItem[] = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'evaluation', 'domain', 'gate-eval-set.json'), 'utf-8')
  );

  const styleGroups = Object.keys(STYLE_GROUP_GATE_DESCRIPTIONS);
  const mediums = Object.keys(MEDIUM_GATE_PHRASES);
  const prompts: { label: string; text: string }[] = [];
  for (const styleGroup of styleGroups) {
    for (const medium of mediums) {
      prompts.push({ label: `${styleGroup} / ${medium}`, text: buildGatePrompt(styleGroup, medium) });
    }
  }

  const textEmbedder = await createClipTextEmbedder();
  const promptEmbeddings = await textEmbedder.embedTexts(prompts.map((p) => p.text));

  const scored = items.map((item) => {
    let best = { label: '', score: -1 };
    for (let i = 0; i < promptEmbeddings.length; i++) {
      const score = cosineSimilarity(item.embedding, promptEmbeddings[i]);
      if (score > best.score) best = { label: prompts[i].label, score };
    }
    return { ...item, gateScore: best.score, bestPrompt: best.label };
  });

  const totalPositive = scored.filter((s) => s.label).length;
  const totalNegative = scored.filter((s) => !s.label).length;
  console.log(`共 ${scored.length} 筆(正樣本 ${totalPositive}／負樣本 ${totalNegative})\n`);

  // ROC：固定間距掃門檻，寫成 CSV 方便畫圖（報告用），console 只印摘要。
  const rocRows: { t: number; tpr: number; fpr: number }[] = [];
  let best = { threshold: 0, tpr: 0, fpr: 1, youden: -Infinity };
  for (let t = 0; t <= 1; t += 0.01) {
    const tp = scored.filter((s) => s.label && s.gateScore >= t).length;
    const fp = scored.filter((s) => !s.label && s.gateScore >= t).length;
    const tpr = tp / totalPositive;
    const fpr = fp / totalNegative;
    rocRows.push({ t, tpr, fpr });
    const youden = tpr - fpr;
    if (youden > best.youden) best = { threshold: t, tpr, fpr, youden };
  }

  const outDir = path.join(process.cwd(), 'evaluation', 'domain');
  const csvPath = path.join(outDir, 'roc.csv');
  const csv = ['threshold,tpr,fpr', ...rocRows.map((r) => `${r.t.toFixed(2)},${r.tpr.toFixed(4)},${r.fpr.toFixed(4)}`)].join('\n');
  fs.writeFileSync(csvPath, csv);
  console.log(`完整 ROC 座標(101 點)已寫入 ${csvPath}，可直接拿去畫圖。\n`);

  console.log(`最佳門檻(Youden Index)：T = ${best.threshold.toFixed(2)}`);
  console.log(`TPR = ${(best.tpr * 100).toFixed(1)}%　FPR = ${(best.fpr * 100).toFixed(1)}%`);

  // 產品成本不對稱:誤擋合法設計圖=使用者看到 no-match 死路,誤放離題圖=只是帶
  // weak-match 提示的結果。所以另給一個「誤擋成本 2 倍」的加權選點(TPR - 0.5*FPR)。
  let costBest = { threshold: 0, tpr: 0, fpr: 1, score: -Infinity };
  for (const r of rocRows) {
    const score = r.tpr - 0.5 * r.fpr;
    if (score > costBest.score) costBest = { threshold: r.t, tpr: r.tpr, fpr: r.fpr, score };
  }
  console.log(`\n成本加權門檻(誤擋成本 2x)：T = ${costBest.threshold.toFixed(2)}`);
  console.log(`TPR = ${(costBest.tpr * 100).toFixed(1)}%　FPR = ${(costBest.fpr * 100).toFixed(1)}%`);

  // 產品實際採用的是成本加權門檻（見上）,Precision/Recall/Confusion Matrix/誤殺清單
  // 這些診斷資訊要對照「真正上線的門檻」,不能算 Youden 門檻的、卻拿來當這次校準結果看。
  const tp = scored.filter((s) => s.label && s.gateScore >= costBest.threshold).length;
  const fn = totalPositive - tp;
  const fp = scored.filter((s) => !s.label && s.gateScore >= costBest.threshold).length;
  const tn = totalNegative - fp;
  const precision = tp / (tp + fp);
  const recall = tp / (tp + fn);
  console.log(`\n以下診斷對照成本加權門檻 T = ${costBest.threshold.toFixed(2)}（實際採用）：`);
  console.log(`Precision = ${(precision * 100).toFixed(1)}%　Recall = ${(recall * 100).toFixed(1)}%`);
  console.log('\nConfusion Matrix：');
  console.log(`              預測=設計圖   預測=離題`);
  console.log(`實際=設計圖   TP=${tp}          FN=${fn}`);
  console.log(`實際=離題     FP=${fp}          TN=${tn}`);

  console.log(`\n對照：現行 RELEVANCE_THRESHOLD=0.22（抓圖候選閘門，母體不同）套用在這份 eval set 上會怎樣：`);
  const tpAt022 = scored.filter((s) => s.label && s.gateScore >= 0.22).length;
  const fpAt022 = scored.filter((s) => !s.label && s.gateScore >= 0.22).length;
  console.log(
    `T=0.22：TPR=${((tpAt022 / totalPositive) * 100).toFixed(1)}%　FPR=${((fpAt022 / totalNegative) * 100).toFixed(1)}%`
  );

  console.log('\n被 Domain Gate 誤殺的正樣本（gate 分數 < 採用門檻，人工看合不合理）：');
  const missed = scored.filter((s) => s.label && s.gateScore < costBest.threshold);
  for (const s of missed.slice(0, 40)) {
    console.log(`  ${s.id} | source=${s.source} | score=${s.gateScore.toFixed(3)} | 最像=${s.bestPrompt}`);
  }
  if (missed.length > 40) console.log(`  ……還有 ${missed.length - 40} 筆(正樣本改圖庫全量後誤殺清單會變長,只印最前 40)`);
  console.log('\n漏放的負樣本（gate 分數 >= 採用門檻，被誤判成設計圖）：');
  for (const s of scored.filter((s) => !s.label && s.gateScore >= costBest.threshold)) {
    console.log(`  ${s.id} | score=${s.gateScore.toFixed(3)} | 最像=${s.bestPrompt}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
