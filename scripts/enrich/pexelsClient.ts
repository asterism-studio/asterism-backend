import type { GalleryMeta } from './galleryMeta';

const PEXELS_ENDPOINT = 'https://api.pexels.com/v1/search';

interface PexelsPhoto {
  id: number;
  alt: string | null;
  photographer: string | null;
  // Pexels 這張圖在 pexels.com 上的原始頁面連結，跟 src.large（圖片素材網址）是不同欄位。
  url: string;
  src: { large: string };
}

// 需要環境變數 PEXELS_API_KEY（Pexels 免費申請）。
export async function searchPexels(query: string, perPage = 15, page = 1): Promise<GalleryMeta[]> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) {
    throw new Error('PEXELS_API_KEY 未設定');
  }

  const url = `${PEXELS_ENDPOINT}?query=${encodeURIComponent(query)}&per_page=${perPage}&page=${page}`;
  const response = await fetch(url, { headers: { Authorization: apiKey } });
  if (!response.ok) {
    throw new Error(`Pexels API 失敗：${response.status}`);
  }

  const data = (await response.json()) as { photos: PexelsPhoto[] };
  return data.photos.map((photo) => ({
    source: 'pexels' as const,
    externalId: String(photo.id),
    url: photo.src.large,
    sourceUrl: photo.url,
    description: photo.alt ?? '',
    photographer: photo.photographer ?? 'Unknown'
  }));
}
