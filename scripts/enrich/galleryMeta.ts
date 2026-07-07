export type ImageSource = 'pexels' | 'unsplash';

export interface GalleryMeta {
  source: ImageSource;
  externalId: string;
  url: string;
  sourceUrl: string; // 這張圖在來源平台上的原始頁面連結（不是圖片素材網址）→ images.source_url
  description: string; // → title（可能是空字串）
  photographer: string; // → attribution
}
