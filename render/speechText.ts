import fs from "fs";
import path from "path";

const DIGITS_TH = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
const DIGITS_INT_TH = ["", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
const POSITIONS_TH = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน", "ล้าน"];

export const DEFAULT_THAI_PRONUNCIATION_MAP: Record<string, string> = {
  "DODOLOVE": "ดูดูเลิฟ",
  "Tyeso": "ไทโซ",
  "MamyPoko": "มามี่โพโค",
  "Mama's Choice": "มาม่าส์ช้อยส์",
  "Clevamama": "คลีวามาม่า",
  "ClevaFoam": "คลีวาโฟม",
  "Madame Fin": "มาดามฟิน",
  "Baby Wipes": "เบบี้ไวพส์",
  "Wipes": "ไวพส์",
  "Shower Gel": "ชาวเวอร์เจล",
  "Head to Toe": "เฮดทูโท",
  "Active Rush": "แอคทีฟรัช",
  "Element Of Energy": "เอเลเมนต์ออฟเอเนอร์จี้",
  "Shopee": "ช้อปปี้",
  "TikTok": "ติ๊กต็อก",
  "Flash Sale": "แฟลชเซลล์",
  "Bluetooth": "บลูทูธ",
  "Type-C": "ไทป์ซี",
  "USB": "ยูเอสบี",
  "ANC": "เอเอ็นซี",
  "Hi-Fi": "ไฮไฟ",
  "Food Grade": "ฟู้ดเกรด",
  "Organic": "ออร์แกนิค",
  "pH": "พีเอช",
  "UV": "ยูวี",
  "SPF": "เอสพีเอฟ",
  "PA++++": "พีเอ สี่บวก",
  "PA+++": "พีเอ สามบวก",
  "BGM": "บีจีเอ็ม",
  "SFX": "เอสเอฟเอ็กซ์",
  "LUFS": "ลัฟส์",
  "mAh": "มิลลิแอมป์",
  "ml": "มิลลิลิตร",
  "kg": "กิโลกรัม",
  "cm": "เซนติเมตร",
  "mm": "มิลลิเมตร",
  "oz": "ออนซ์",
  "NB-S": "เอ็นบี ถึง เอส",
};

/**
 * Converts an integer number string (up to 99,999,999) to Thai spoken words
 */
export function numberToThaiWords(numStr: string): string {
  const clean = numStr.replace(/,/g, "").replace(/^0+/, "");
  if (!clean) return "ศูนย์";
  const n = parseInt(clean, 10);
  if (isNaN(n)) return numStr;
  if (n === 0) return "ศูนย์";

  function chunkToThai(val: number): string {
    if (val === 0) return "";
    let result = "";
    const digits = val.toString().split("").map(Number);
    const len = digits.length;

    for (let i = 0; i < len; i++) {
      const d = digits[i];
      const pos = len - i - 1;

      if (d === 0) continue;

      if (pos === 1) {
        if (d === 1) {
          result += "สิบ";
        } else if (d === 2) {
          result += "ยี่สิบ";
        } else {
          result += DIGITS_INT_TH[d] + "สิบ";
        }
      } else if (pos === 0) {
        if (d === 1 && len > 1) {
          result += "เอ็ด";
        } else {
          result += DIGITS_INT_TH[d];
        }
      } else {
        result += DIGITS_INT_TH[d] + POSITIONS_TH[pos];
      }
    }
    return result;
  }

  if (n >= 1000000) {
    const millions = Math.floor(n / 1000000);
    const remainder = n % 1000000;
    return chunkToThai(millions) + "ล้าน" + chunkToThai(remainder);
  }

  return chunkToThai(n);
}

/**
 * Converts digit-by-digit code (e.g., 304 -> สามศูนย์สี่)
 */
export function digitsToThaiWords(numStr: string): string {
  return numStr
    .split("")
    .map((ch) => {
      const d = parseInt(ch, 10);
      return !isNaN(d) ? DIGITS_TH[d] : ch;
    })
    .join("");
}

/**
 * Loads pronunciation map from data/pronunciation-map.json merged with defaults
 */
export function loadPronunciationMap(): Record<string, string> {
  const filePath = path.join(process.cwd(), "data", "pronunciation-map.json");
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(content);
      // Fix legacy "โดโดเลิฟ" if still present in file
      if (parsed.DODOLOVE === "โดโดเลิฟ") {
        parsed.DODOLOVE = "ดูดูเลิฟ";
      }
      return { ...DEFAULT_THAI_PRONUNCIATION_MAP, ...parsed };
    }
  } catch (err: any) {
    console.debug("[speechText] Failed to load pronunciation map:", err?.message);
  }
  return { ...DEFAULT_THAI_PRONUNCIATION_MAP };
}

export function savePronunciationMap(map: Record<string, string>): void {
  const filePath = path.join(process.cwd(), "data", "pronunciation-map.json");
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(map, null, 2), "utf-8");
}

/**
 * Strips emojis and symbols that should not be spoken aloud
 */
export function removeEmojisAndSymbols(text: string): string {
  return text
    .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1FA00}-\u{1FAFF}]/gu, "")
    .replace(/[★☆✦✧✨🔥⚡📦🛒📍🏷️•●▪️■▶️◀️™®©]/g, "")
    .replace(/[~_#`^*+=|\\\[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface NormalizeSpeechResult {
  textForSpeech: string;
  unverifiedWords: string[];
  appliedReplacements?: Array<{ from: string; to: string }>;
}

/**
 * Normalizes text for natural Thai TTS:
 * - Campaign double-days: 10.10 -> "สิบเดือนสิบ", 11.11 -> "สิบเอ็ดเดือนสิบเอ็ด", 12.12 -> "สิบสองเดือนสิบสอง", 9.9 -> "เก้าเดือนเก้า"
 * - Stainless steel / grade codes: สแตนเลส 304 -> "สแตนเลส สามศูนย์สี่", SUS 316 -> "เอสยูเอส สามหนึ่งหก"
 * - Prices: ฿199 -> "หนึ่งร้อยเก้าสิบเก้าบาท", 1,290 บาท -> "หนึ่งพันสองร้อยเก้าสิบบาท"
 * - Ranges: 0-12 เดือน -> "ศูนย์ถึงสิบสองเดือน", 1-3 ระดับ -> "หนึ่งถึงสามระดับ"
 * - Percentages: 50% -> "ห้าสิบเปอร์เซ็นต์"
 * - Decimals: pH 5.5 -> "พีเอช ห้าจุดห้า", 12.5 -> "สิบสองจุดห้า"
 * - Brand & English dictionary: DODOLOVE -> "ดูดูเลิฟ"
 */
export function normalizeForSpeech(
  rawText: string,
  customMap?: Record<string, string>
): NormalizeSpeechResult {
  if (!rawText || !rawText.trim()) {
    return { textForSpeech: "", unverifiedWords: [], appliedReplacements: [] };
  }

  const map = { ...loadPronunciationMap(), ...(customMap || {}) };
  const appliedReplacements: Array<{ from: string; to: string }> = [];
  let processed = removeEmojisAndSymbols(rawText);

  // 0. Replace known multi-word & single-word dictionary terms FIRST (sorted by longest key first)
  // This ensures terms like "NB-S", "Type-C", "Mama's Choice", "DODOLOVE" are converted cleanly
  const sortedEntries = Object.entries(map)
    .filter(([k, v]) => k.trim() && v.trim())
    .sort((a, b) => b[0].length - a[0].length);

  for (const [key, thaiReplacement] of sortedEntries) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Boundary: not preceded or followed by ASCII alphanumeric if the key starts/ends with ASCII alphanumeric
    const prefix = /[A-Za-z0-9]/.test(key[0]) ? "(?<![A-Za-z0-9])" : "";
    const suffix = /[A-Za-z0-9]/.test(key[key.length - 1]) ? "(?![A-Za-z0-9])" : "";
    const regex = new RegExp(`${prefix}${escaped}${suffix}`, "gi");
    if (regex.test(processed)) {
      appliedReplacements.push({ from: key, to: thaiReplacement });
      processed = processed.replace(regex, ` ${thaiReplacement} `);
    }
  }

  // 1. Campaign Double-Days (e.g., 1.1, 2.2, ..., 9.9, 10.10, 11.11, 12.12, 15.15, 25.25)
  // Exclude when preceded by pH / พีเอช (e.g. "พีเอช 5.5" is a pH value, not May 5th)
  processed = processed.replace(
    /(?<!พีเอช\s*)(?<!pH\s*)\b(1[0-2]|[1-9]|15|25)\.\1\b/gi,
    (match, numStr) => {
      const w = numberToThaiWords(numStr);
      const spoken = `${w}เดือน${w}`;
      appliedReplacements.push({ from: match, to: spoken });
      return ` ${spoken} `;
    }
  );

  // 2. Stainless steel / material codes (e.g., 304, 316) -> read digit-by-digit ("สามศูนย์สี่")
  processed = processed.replace(
    /(สแตนเลส|สเตนเลส|เกรด|รุ่น|SUS)\s*(304|316|430)\b/gi,
    (match, prefixWord, codeStr) => {
      const spokenCode = digitsToThaiWords(codeStr);
      appliedReplacements.push({ from: match, to: `${prefixWord} ${spokenCode}` });
      return `${prefixWord} ${spokenCode}`;
    }
  );
  processed = processed.replace(/\b(304|316)\b/g, (match) => {
    const spokenCode = digitsToThaiWords(match);
    appliedReplacements.push({ from: match, to: spokenCode });
    return spokenCode;
  });

  // 3. Convert Prices e.g. ฿199, 1,290 บาท, ฿ 250
  processed = processed.replace(
    /(?:฿\s*(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s*บาท)/g,
    (match, p1, p2) => {
      const amountStr = (p1 || p2).replace(/,/g, "");
      let spoken = "";
      if (amountStr.includes(".")) {
        const [intPart, decPart] = amountStr.split(".");
        spoken =
          decPart === "00" || decPart === "0"
            ? `${numberToThaiWords(intPart)}บาท`
            : `${numberToThaiWords(intPart)}บาท${numberToThaiWords(decPart)}สตางค์`;
      } else {
        spoken = `${numberToThaiWords(amountStr)}บาท`;
      }
      appliedReplacements.push({ from: match, to: spoken });
      return ` ${spoken} `;
    }
  );

  // 4. Convert Percentages e.g. 100%, 50 %
  processed = processed.replace(/(\d+)\s*%/g, (match, p1) => {
    const spoken = p1 === "100" ? "ร้อยเปอร์เซ็นต์" : `${numberToThaiWords(p1)}เปอร์เซ็นต์`;
    appliedReplacements.push({ from: match, to: spoken });
    return ` ${spoken} `;
  });

  // 5. Convert Range numbers e.g. 100-200, 0-12, 100–200, or "ไซส์ 0 12 เดือน"
  processed = processed.replace(/(\d+)\s*[-–—]\s*(\d+)/g, (match, p1, p2) => {
    const spoken = `${numberToThaiWords(p1)}ถึง${numberToThaiWords(p2)}`;
    appliedReplacements.push({ from: match, to: spoken });
    return ` ${spoken} `;
  });
  processed = processed.replace(/\b0\s+12\s*เดือน/g, () => {
    const spoken = "ศูนย์ถึงสิบสองเดือน";
    appliedReplacements.push({ from: "0 12 เดือน", to: spoken });
    return spoken;
  });

  // 6. Convert Decimals e.g. 12.5, 3.5, 5.5
  processed = processed.replace(/(\d+)\.(\d+)/g, (match, p1, p2) => {
    const decDigits = p2
      .split("")
      .map((d: string) => DIGITS_TH[parseInt(d, 10)] || d)
      .join("");
    const spoken = `${numberToThaiWords(p1)}จุด${decDigits}`;
    appliedReplacements.push({ from: match, to: spoken });
    return ` ${spoken} `;
  });

  // 7. Convert Standalone remaining numbers (with optional commas) e.g. 80 แผ่น -> แปดสิบแผ่น
  processed = processed.replace(/\b(\d[\d,]*)\b/g, (_match, p1) => {
    return numberToThaiWords(p1);
  });

  // 8. Find remaining unmapped English words (2+ characters)
  const unverifiedSet = new Set<string>();
  const remainingEnglishWords = processed.match(/\b[A-Za-z]{2,}\b/g);
  if (remainingEnglishWords) {
    for (const word of remainingEnglishWords) {
      unverifiedSet.add(word);
    }
  }

  processed = processed.replace(/\s+/g, " ").trim();

  return {
    textForSpeech: processed,
    unverifiedWords: Array.from(unverifiedSet),
    appliedReplacements,
  };
}
