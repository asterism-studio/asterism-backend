// CLIP 的 image_embeds / text_embeds 都是未 normalize 過的原始投影輸出（查過套件原始碼
// 確認過），要自己做 L2 normalize 才能拿去跟前端算出來的向量做 cosine similarity 比對。
export function l2Normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  if (norm === 0) return vector
  return vector.map((value) => value / norm)
}
