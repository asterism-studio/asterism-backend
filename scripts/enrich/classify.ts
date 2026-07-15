import type { Scorer } from './scorer';
import {
  STYLE_GROUP_ANCHORS,
  STYLE_VOCAB_BY_GROUP,
  MEDIUM_LABELS,
  SUBMEDIUM_PROMPTS_BY_MEDIUM,
  THRESHOLDS,
  STYLE_TOP_K
} from './taxonomy';

export interface ClassificationResult {
  styleGroup: string;
  medium: string;
  subMedium: string;
  style: string[];
  confidence: { styleGroup: number; medium: number; subMedium: number };
  needsReview: { styleGroup: boolean; medium: boolean; subMedium: boolean };
}

// subMedium 分類共用邏輯：丟完整 prompt 句給 CLIP，top-1 再對映回標籤
// （同 styleGroup 錨點 pattern）。enrich 新抓圖與 reclassify 回填都走這裡。
// medium 不在候選表時回 null，由呼叫端決定略過。
export async function classifySubMedium(
  scorer: Scorer,
  medium: string,
  imageRef: string
): Promise<{ label: string; score: number } | null> {
  const prompts = SUBMEDIUM_PROMPTS_BY_MEDIUM[medium];
  if (!prompts) return null;

  const labels = Object.keys(prompts);
  const scores = await scorer.classify(imageRef, labels.map((label) => prompts[label]));
  const top = scores[0];
  const label = labels.find((candidate) => prompts[candidate] === top.label) ?? labels[0];
  return { label, score: top.score };
}

export async function classifyImage(scorer: Scorer, imageRef: string): Promise<ClassificationResult> {
  // 第1層：styleGroup（用錨點文字比，再把文字對回群組名）
  const sgLabels = Object.keys(STYLE_GROUP_ANCHORS);
  const sgPrompts = sgLabels.map((label) => STYLE_GROUP_ANCHORS[label]);
  const sgScores = await scorer.classify(imageRef, sgPrompts);
  const topSg = sgScores[0];
  const matchedLabel = sgLabels.find((label) => STYLE_GROUP_ANCHORS[label] === topSg.label);
  const styleGroup = matchedLabel ?? sgLabels[0];
  const sgConfidence = topSg.score;

  // 第2層：medium
  const mdScores = await scorer.classify(imageRef, MEDIUM_LABELS);
  const medium = mdScores[0].label;
  const mdConfidence = mdScores[0].score;

  // 第3層：subMedium —— 在所選 medium 底下用 prompt 強制挑 top-1（4 個 medium 都有候選）。
  // 強制猜出來的結果一律送人工審核（見下方 needsReview.subMedium）。
  const sub = await classifySubMedium(scorer, medium, imageRef);
  const subMedium = sub?.label ?? '';
  const subConfidence = sub?.score ?? 0;

  // style[]：多標籤分類，候選池限定在所選 styleGroup 的詞庫
  const styleVocab = STYLE_VOCAB_BY_GROUP[styleGroup] ?? [];
  const styleScores = await scorer.classify(imageRef, styleVocab);
  const style = styleScores.slice(0, STYLE_TOP_K).map((entry) => entry.label);

  return {
    styleGroup,
    medium,
    subMedium,
    style,
    confidence: { styleGroup: sgConfidence, medium: mdConfidence, subMedium: subConfidence },
    needsReview: {
      styleGroup: sgConfidence < THRESHOLDS.styleGroup,
      medium: mdConfidence < THRESHOLDS.medium,
      // subMedium 是強制猜出來的，無論信心高低一律送人工審核
      subMedium: true
    }
  };
}
