// 9 個 styleGroup 的 CLIP 錨點文字（給 zero-shot 分類比對用的英文描述）。
// 對齊 docs/superpowers/specs/2026-06-16-issue22-frontend-demo-design.md §4。
export const STYLE_GROUP_ANCHORS: Record<string, string> = {
  'Future Tech & Digital Psychedelia': 'cyberpunk futurism glitch art techwear neo-tokyo',
  'Y2K & Internet Aesthetics': 'Y2K frutiger aero McBling chrome design bubblegum futurism',
  'Decorative & Opulent Art': 'art deco baroque rococo maximalism ornate luxury',
  'Minimal & Structured Modern': 'minimalism quiet luxury scandinavian modernism swiss design',
  'Earth & Organic Humanism': 'wabi-sabi japandi biophilic design organic modern',
  'Romantic & Pastoral Living': 'cottagecore romanticism grandmillennial vintage floral',
  'Retro & Nostalgia': 'vintage retro mid-century modern americana',
  'Experimental & Avant-Garde':
    'brutalism anti-design deconstructivism avant-garde experimental typography',
  'Street & Youth Culture': 'streetwear hypebeast graffiti urban contemporary skate culture'
};

// 每個 styleGroup 的 style[] 候選詞 —— CLIP 多標籤分類只在對應群組的詞庫裡比。
// 前 3 組沿用 src/data/style-data.json 既有資料；其餘 6 組從上面的錨點文字萃取代表詞
// （demo 用詞庫，未來校準可直接改這裡，不影響其他檔案）。
export const STYLE_VOCAB_BY_GROUP: Record<string, string[]> = {
  'Future Tech & Digital Psychedelia': [
    'Cyberpunk',
    'Neo Tokyo',
    'Future Tech',
    'Digital Psychedelia',
    'Glitch Aesthetic'
  ],
  'Y2K & Internet Aesthetics': [
    'Y2K',
    'Frutiger Aero',
    'McBling',
    'Chrome Design',
    'Bubblegum Futurism'
  ],
  'Decorative & Opulent Art': [
    'Baroque',
    'Rococo',
    'Art Deco',
    'Gilded Ornament',
    'Opulent Classicism'
  ],
  'Minimal & Structured Modern': [
    'Minimalism',
    'Quiet Luxury',
    'Scandinavian Modernism',
    'Swiss Design'
  ],
  'Earth & Organic Humanism': ['Wabi-Sabi', 'Japandi', 'Biophilic Design', 'Organic Modernism'],
  'Romantic & Pastoral Living': [
    'Cottagecore',
    'Romanticism',
    'Grandmillennial',
    'Vintage Floral'
  ],
  'Retro & Nostalgia': ['Vintage', 'Retro', 'Mid-Century Modern', 'Americana'],
  'Experimental & Avant-Garde': [
    'Brutalism',
    'Anti-Design',
    'Deconstructivism',
    'Experimental Typography'
  ],
  'Street & Youth Culture': ['Streetwear', 'Hypebeast', 'Graffiti', 'Skate Culture']
};

export const MEDIUM_LABELS: string[] = [
  'Outfit',
  'Graphic Design',
  'Interior Design',
  'Architecture'
];

// 4 個 medium 全部都有子分類（每 medium 4 個、跨 styleGroup 一致）。
// issue #137：物件型細分類（桌/椅/窗/樓梯）常同框，改成場景型大分類。
// CLIP 分類不丟裸標籤，丟完整英文句（值），分完再對映回標籤（key）——同 styleGroup 錨點 pattern。
// 注意：Outfit 的 "...Focus" 標籤只用於抓圖分類（幫 CLIP 判斷畫面重點），前端顯示時會拿掉 Focus。
export const SUBMEDIUM_PROMPTS_BY_MEDIUM: Record<string, Record<string, string>> = {
  'Graphic Design': {
    'Brand Identity':
      'a brand identity design, logo system, business card, brand guideline, or visual identity mockup',
    'Poster Design':
      'a poster design, event poster, exhibition poster, promotional graphic, or single-page visual layout',
    'Editorial Design':
      'an editorial design, magazine layout, book spread, catalog layout, or publication design',
    'Packaging Design':
      'a packaging design, product box, bottle label, pouch, bag, or branded product container'
  },
  Outfit: {
    'Full Look':
      'a full outfit, complete fashion look, lookbook photo, street style, or full body styling',
    'Top Focus':
      'a fashion image focused on tops, shirts, jackets, coats, sweaters, or upper body clothing',
    'Bottom Focus':
      'a fashion image focused on pants, skirts, shorts, shoes, or lower body styling',
    'Accessory Focus':
      'a fashion image focused on accessories, bags, jewelry, hats, glasses, shoes, or styling details'
  },
  'Interior Design': {
    'Living & Dining Space':
      'a living room, dining room, sofa and coffee table area, dining table setting, kitchen island, or open shared living space for daily life and gathering',
    Bedroom:
      'a bedroom, bed, headboard, bedding, nightstand, sleeping area, or private resting space',
    Lighting:
      'interior lighting as the main subject, a pendant lamp, chandelier, floor lamp, wall sconce, or decorative light fixture',
    'Decor Detail':
      'a close-up of interior decor, vase, wall art, ornament, shelf styling, material or texture detail, or a single decorative object'
  },
  Architecture: {
    'Building Exterior':
      'a full exterior view of a building, house, architectural structure, or street architecture',
    Facade:
      'a building facade, exterior wall, front elevation, window rhythm, architectural surface, or decorative exterior',
    Entrance:
      'an entrance, doorway, gate, portal, front door, storefront entrance, or access point into a building or space',
    Passage:
      'a passageway, corridor, walkway, path, arcade, garden path, stair path, or transitional architectural space'
  }
};

// 標籤清單由 prompts 的 key 導出，保證兩者永不脫鉤（單一事實來源）。
export const SUBMEDIUM_BY_MEDIUM: Record<string, string[]> = Object.fromEntries(
  Object.entries(SUBMEDIUM_PROMPTS_BY_MEDIUM).map(([medium, prompts]) => [medium, Object.keys(prompts)])
);

// styleGroup/medium 仍用門檻判斷是否送審；subMedium 因為是強制猜出來的，一律送人工審核，
// 不再用 THRESHOLDS.subMedium 判斷（保留此值僅供參考/排序）。
export const THRESHOLDS = {
  styleGroup: 0.6,
  medium: 0.5,
  subMedium: 0.35
} as const;

export const STYLE_TOP_K = 4;

// ── Relevance gate（抓圖相關性把關）────────────────────────────
// 抓圖仍用關鍵字 query 搜圖庫 API（那邊是關鍵字比對）；gate 另外用句子式 prompt
// 算 CLIP cosine —— CLIP 吃自然語言，句子比關鍵字堆疊穩。
// 描述寫「完整但寬」：gate 只刷掉不相關的圖，美學判斷留給 classify 層，
// 塞太多具體形容詞會誤殺長相不同但合法的圖。
export const STYLE_GROUP_GATE_DESCRIPTIONS: Record<string, string> = {
  'Future Tech & Digital Psychedelia':
    'a futuristic cyberpunk scene with neon lights, digital glitch effects and a high-tech atmosphere',
  'Y2K & Internet Aesthetics':
    'a Y2K style visual with glossy chrome, bubbly shapes and early-2000s internet aesthetics',
  'Decorative & Opulent Art':
    'an ornate and luxurious scene with baroque or art deco decoration, gilded details and grand classical elegance',
  'Minimal & Structured Modern':
    'a minimal and structured modern scene with clean lines, neutral tones and quiet refined simplicity',
  'Earth & Organic Humanism':
    'a calm organic scene with natural materials, earthy tones and a wabi-sabi or japandi feeling',
  'Romantic & Pastoral Living':
    'a romantic and pastoral scene with a cozy, vintage countryside atmosphere',
  'Retro & Nostalgia':
    'a retro nostalgic scene with vintage mid-century style and old-fashioned charm',
  'Experimental & Avant-Garde':
    'an experimental avant-garde work with brutalist, deconstructed or unconventional design',
  'Street & Youth Culture':
    'a streetwear and urban youth culture scene with graffiti, skate or hypebeast style'
};

export const MEDIUM_GATE_PHRASES: Record<string, string> = {
  Outfit: 'a fashion photo of',
  'Graphic Design': 'a graphic design work of',
  'Interior Design': 'an interior design photo of',
  Architecture: 'an architecture photo of'
};

// 搜尋 query 走關鍵字，gate 走句子——兩者拆開，各司其職（見上方註解）。
export function buildGatePrompt(styleGroup: string, medium: string): string {
  const description = STYLE_GROUP_GATE_DESCRIPTIONS[styleGroup];
  const phrase = MEDIUM_GATE_PHRASES[medium];
  if (!description) throw new Error(`未知的 styleGroup: ${styleGroup}`);
  if (!phrase) throw new Error(`未知的 medium: ${medium}`);
  return `${phrase} ${description}`;
}

// 低於此 cosine 不入庫。2026-07-09 校準（100 張離題負樣本 vs 乾淨圖庫）:
// 0.22 保留 97.7% 合法圖、擋掉 ≥57% 離題圖（貓狗風景等；負樣本取 36 prompt max 為保守下限，
// crawl 時每張只比單一 prompt，實際擋掉率更高）。依「誤殺比漏放貴」（gate 後仍有人工審）取保守值。
// 改 gate prompt 要重跑 calibrate:gate（門檻與 prompt 綁定）。
export const RELEVANCE_THRESHOLD = 0.22;
