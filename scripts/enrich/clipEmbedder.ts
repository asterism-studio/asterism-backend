import { pipeline } from '@huggingface/transformers';
import { l2Normalize } from './vectorMath';
import { CLIP_MODEL } from './clipModel';

// 圖片 embedding 抽象：給一張圖的 URL，回傳 L2 normalize 過的 512 維向量。
// 真實實作是 CLIP 的 image-feature-extraction pipeline；測試用假替身注入。
export interface Embedder {
  embedImage(imageRef: string): Promise<number[]>;
}

// 首次呼叫會下載模型權重，之後離線可用。跟 clipScorer.ts 用同一顆 model（見 clipModel.ts），
// 且必須跟前端 asterism repo 的 clipEmbedding.service.ts 用同一種抽取方式
// （image-feature-extraction + 手動 L2 normalize），向量空間才會一致。
export async function createClipEmbedder(model = CLIP_MODEL): Promise<Embedder> {
  const extractor = await pipeline('image-feature-extraction', model);

  return {
    async embedImage(imageRef: string): Promise<number[]> {
      const output = await extractor(imageRef);
      const flat = Array.from(output.data as Float32Array);
      return l2Normalize(flat);
    }
  };
}
