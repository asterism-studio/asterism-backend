import type { ClassificationResult } from './classify';
import type { GalleryMeta, ImageSource } from './galleryMeta';

export interface ImageRow {
  id: string;
  url: string;
  title: string;
  style_group: string;
  style: string[];
  medium: string | null;
  sub_medium: string;
  color_palette: string[];
  attribution: string;
  source_url: string;
  confidence: { styleGroup: number; medium: number; subMedium: number };
  needs_review: { styleGroup: boolean; medium: boolean; subMedium: boolean };
  // GATE_MODE=off 抓圖時不算 embedding（衝量模式），欄位留空、之後 backfill:embeddings 補。
  embedding: number[] | null;
}

const GALLERY_LABEL: Record<ImageSource, string> = {
  pexels: 'Pexels',
  unsplash: 'Unsplash'
};

export function buildImageRow(
  classification: ClassificationResult,
  palette: string[],
  meta: GalleryMeta,
  embedding: number[] | null
): ImageRow {
  return {
    id: `ext-${meta.source}-${meta.externalId}`,
    url: meta.url,
    title: meta.description || `${classification.styleGroup} inspiration`,
    style_group: classification.styleGroup,
    style: classification.style,
    medium: classification.medium,
    sub_medium: classification.subMedium,
    color_palette: palette,
    attribution: `Photo by ${meta.photographer} / ${GALLERY_LABEL[meta.source]}`,
    source_url: meta.sourceUrl,
    confidence: classification.confidence,
    needs_review: classification.needsReview,
    embedding
  };
}
