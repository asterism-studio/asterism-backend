import { AutoTokenizer, CLIPTextModelWithProjection } from '@huggingface/transformers';
import { l2Normalize } from './vectorMath';

// 文字 embedding 抽象：給一組文字，回傳各自 L2 normalize 過的 512 維向量。
// 只給 classification_anchors 的錨點文字（例如 styleGroup 的 9 組描述）用；
// 測試用假替身注入。
export interface TextEmbedder {
  embedTexts(texts: string[]): Promise<number[][]>;
}

// 注意：CLIP 的文字 embedding 必須用 CLIPTextModelWithProjection（有投影層），
// 不能用高階的 pipeline('feature-extraction', model)——那個讀的是未投影過的
// last_hidden_state，維度剛好也是 512 但語意跟圖片那邊的 image_embeds 對不上。
// 用法照套件文件（models/clip/modeling_clip.js 的 docstring 範例）。
export async function createClipTextEmbedder(
  model = 'Xenova/clip-vit-base-patch32'
): Promise<TextEmbedder> {
  const tokenizer = await AutoTokenizer.from_pretrained(model);
  const textModel = await CLIPTextModelWithProjection.from_pretrained(model);

  return {
    async embedTexts(texts: string[]): Promise<number[][]> {
      const textInputs = tokenizer(texts, { padding: true, truncation: true });
      const { text_embeds } = await textModel(textInputs);

      const [count, dimension] = text_embeds.dims as [number, number];
      const flat = Array.from(text_embeds.data as Float32Array);

      const embeddings: number[][] = [];
      for (let i = 0; i < count; i++) {
        const vector = flat.slice(i * dimension, (i + 1) * dimension);
        embeddings.push(l2Normalize(vector));
      }

      return embeddings;
    }
  };
}
