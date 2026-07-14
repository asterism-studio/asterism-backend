// clipScorer / clipEmbedder / textEmbedder 三個檔都載入同一顆 CLIP model，
// 集中在這裡宣告，換 model 只改一處，三邊不會走鐘。
export const CLIP_MODEL = 'Xenova/clip-vit-base-patch32';
