import hljs from 'highlight.js/lib/core';
import java from 'highlight.js/lib/languages/java';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import properties from 'highlight.js/lib/languages/properties';
import sql from 'highlight.js/lib/languages/sql';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import type { FileChange } from '../../../src/shared/types';

hljs.registerLanguage('java', java);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('properties', properties);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);

export type HlLang = 'java' | 'xml' | 'yaml' | 'properties' | 'sql' | 'json' | 'markdown';

/** Dosya dilini kayıtlı highlight.js diline eşler; kotlin/gradle için Java yaklaşık sonuç verir. */
export function langFor(language: FileChange['language']): HlLang | null {
  switch (language) {
    case 'java':
    case 'kotlin':
    case 'gradle':
      return 'java';
    case 'xml':
    case 'yaml':
    case 'properties':
    case 'sql':
    case 'json':
    case 'markdown':
      return language;
    default:
      return null;
  }
}

/** Metni HTML metni ve (tırnaklı) öznitelik değeri olarak güvenli hale getirir: & < > " ' kaçışlanır. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Tek parça kodu renklendirir (hljs çıktısı kaçışlanmış HTML'dir). */
export function highlightFragment(text: string, lang: HlLang | null): string {
  if (!lang || text === '') return escapeHtml(text);
  try {
    return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
  } catch (error) {
    console.warn('Sözdizimi renklendirme başarısız', error);
    return escapeHtml(text);
  }
}

const TOKEN_RE = /<span[^>]*>|<\/span>|\n|[^<\n]+/g;

/**
 * hljs HTML çıktısını satırlara böler; satır sonunda açık kalan span'leri kapatıp
 * sonraki satırda yeniden açar (çok satırlı yorum/metinlerde renk korunur).
 */
export function splitHighlighted(html: string): string[] {
  const lines: string[] = [];
  const stack: string[] = [];
  let current = '';
  for (const token of html.match(TOKEN_RE) ?? []) {
    if (token === '\n') {
      current += '</span>'.repeat(stack.length);
      lines.push(current);
      current = stack.join('');
    } else if (token.startsWith('<span')) {
      stack.push(token);
      current += token;
    } else if (token === '</span>') {
      stack.pop();
      current += token;
    } else {
      current += token;
    }
  }
  lines.push(current + '</span>'.repeat(stack.length));
  return lines;
}

/** Tüm dosyayı bağlamıyla renklendirip satır satır HTML döner. */
export function highlightLines(code: string, lang: HlLang | null): string[] {
  const normalized = code.replace(/\r\n/g, '\n');
  const body = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
  return splitHighlighted(highlightFragment(body, lang));
}
