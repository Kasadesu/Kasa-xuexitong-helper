import { Typr, md5 } from './typr-md5';
import tableData from './table.json';

const fontTable = tableData as Record<string, number | string>;

// Global cache of decoded character mapping: { [encryptedCharCode: number]: realChar: string }
let currentMatchMap: Record<number, string> = {};

export function clearChaoxingFontMap(): void {
  currentMatchMap = {};
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString =
    typeof atob !== 'undefined'
      ? atob(base64)
      : typeof (globalThis as any).Buffer !== 'undefined'
      ? (globalThis as any).Buffer.from(base64, 'base64').toString('binary')
      : '';
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Extracts and decodes ChaoXing font-cxsecret font from document
 */
export function decodeChaoxingFont(doc: Document): Record<number, string> {
  try {
    currentMatchMap = {};
    const styleEls = Array.from(doc.querySelectorAll('style'));
    const fontStyle = styleEls.find((s) => s.textContent?.includes('font-cxsecret'));
    if (!fontStyle || !fontStyle.textContent) {
      return {};
    }

    const match = fontStyle.textContent.match(/base64,([a-zA-Z0-9+/=\s]+)/);
    if (!match || !match[1]) {
      return {};
    }

    const base64Str = match[1].replace(/\s+/g, '');
    const fontBytes = base64ToUint8Array(base64Str);
    const font = Typr.parse(fontBytes)[0];
    if (!font) {
      return {};
    }

    const matchMap: Record<number, string> = {};

    // Standard Chinese Unicode range: 19968 (0x4E00) ~ 40869 (0x9FA5)
    for (let code = 19968; code < 40870; code++) {
      const glyph = Typr.U.codeToGlyph(font, code);
      if (!glyph) continue;

      const path = Typr.U.glyphToPath(font, glyph);
      const hash = md5(JSON.stringify(path)).slice(24);
      const realVal = fontTable[hash];
      if (realVal !== undefined) {
        matchMap[code] = typeof realVal === 'number' ? String.fromCharCode(realVal) : String(realVal);
      }
    }

    currentMatchMap = matchMap;
    return matchMap;
  } catch (err) {
    console.warn('[FontDecoder] Failed to decode font-cxsecret', err);
    return {};
  }
}

/**
 * Decrypts a string using the current font mapping table
 */
export function decryptString(text: string, customMap?: Record<number, string>): string {
  if (!text) return text;
  const map = customMap || currentMatchMap;
  if (!map || Object.keys(map).length === 0) return text;

  let result = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (map[code]) {
      result += map[code];
    } else {
      result += text[i];
    }
  }
  return result;
}

/**
 * Traverses and decrypts text inside .font-cxsecret DOM nodes in-place exactly once
 */
export function decryptDomElement(rootEl: HTMLElement, customMap?: Record<number, string>) {
  const map = customMap || currentMatchMap;
  if (!map || Object.keys(map).length === 0 || !rootEl || !rootEl.ownerDocument) return;

  const decryptNodeText = (targetRoot: Element) => {
    if (targetRoot.getAttribute('data-kasa-decrypted') === '1') return;
    try {
      const walker = rootEl.ownerDocument!.createTreeWalker(
        targetRoot,
        NodeFilter.SHOW_TEXT,
        null
      );
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (node.nodeValue) {
          node.nodeValue = decryptString(node.nodeValue, map);
        }
      }
    } catch {
      if (targetRoot.childNodes.length === 1 && targetRoot.firstChild?.nodeType === 3) {
        targetRoot.textContent = decryptString(targetRoot.textContent || '', map);
      }
    }
    targetRoot.classList.remove('font-cxsecret');
    targetRoot.setAttribute('data-kasa-decrypted', '1');
  };

  try {
    const secretEls = Array.from(
      rootEl.querySelectorAll('.font-cxsecret, [class*="font-cxsecret"], [style*="font-cxsecret"]')
    );
    if (secretEls.length > 0) {
      for (const el of secretEls) {
        decryptNodeText(el);
      }
    } else if (rootEl.classList?.contains('font-cxsecret')) {
      decryptNodeText(rootEl);
    }
  } catch (e) {
    console.warn('[FontDecoder] decryptDomElement error', e);
  }
}
