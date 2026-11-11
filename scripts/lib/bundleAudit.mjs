/**
 * Paket denetimi: derlenen her uygulamanın içine NE girdiğini ve ağ/süreç yeteneklerini bir izin listesiyle
 * karşılaştırır. Beklenmeyen bir kütüphane, beklenmeyen bir yetenek ya da yanlış yerde bir ağ çağrısı bulunursa
 * derleme durur. Amaç: bir bağımlılık güncellemesiyle (ya da dikkatsiz bir değişiklikle) pakete sessizce
 * "dışarıya konuşan" kod girmesini engellemek.
 *
 * Bu statik bir denetimdir; gizlenmiş kötü amaçlı kodu yakalamayı garanti etmez. Çalışma anında çıkış bekçisi
 * (shared/src/runtime/egressGuard.ts) ve tarayıcıda içerik güvenlik politikası ikinci ve üçüncü katmandır.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Bir Node modülünün içe aktarımı: `from 'x'`, `require('x')`, `import('x')` (isteğe bağlı `node:` önekiyle). */
const imports = (names) => new RegExp(`(?:from\\s*|require\\(\\s*|import\\(\\s*)["'](?:node:)?(?:${names})["']`, 'g');

/** Kaynak metninde aranan yetenekler (sunucu tarafı). */
const SERVER_CAPS = {
  fetch: /\bfetch\s*\(/g,
  http: imports('https?'),
  socket: imports('net|tls|dgram|dns|dns/promises|http2'),
  websocket: /\bWebSocket\b/g,
  process: imports('child_process'),
  eval: /\beval\s*\(|new Function\s*\(/g,
};

/**
 * Pakete girmesine izin verilen kütüphaneler ve her birinde bulunmasına izin verilen yetenekler.
 * Yeni bir kütüphane ya da yetenek eklemek bilinçli bir karardır: kaynağı inceleyip bu listeyi güncelleyin.
 */
const THIRD_PARTY = {
  hono: ['fetch', 'websocket'], // `app.fetch` (istek işleyici adı) ve WebSocket yardımcı tipleri; istemci değil
  '@hono/node-server': ['http', 'socket', 'websocket'], // yerel HTTP sunucusu
  zod: [],
  diff: [],
  'web-tree-sitter': ['fetch', 'eval'], // tarayıcıda wasm yükleme yolu ve emscripten; Node'da dosyadan okur
};

/** Proje kodunda (node_modules dışı) yeteneklere yalnız bu dosyalarda izin verilir. */
const PROJECT_RULES = {
  local: {
    forbiddenPaths: [/^github\//],
    allowed: {
      process: ['shared/src/sources/git.ts', 'shared/src/sources/gitBinary.ts', 'shared/src/server/openBrowser.ts'],
      socket: ['shared/src/runtime/egressGuard.ts'], // bağlantıları ENGELLEMEK için yamalar
      fetch: [], // yerel uygulama hiçbir dış istek yapmaz
      http: [],
      websocket: [],
      eval: [],
    },
  },
  github: {
    forbiddenPaths: [],
    allowed: {
      process: ['shared/src/sources/git.ts', 'shared/src/sources/gitBinary.ts', 'shared/src/server/openBrowser.ts'],
      socket: ['shared/src/runtime/egressGuard.ts'],
      fetch: ['github/src/prInfo.ts'], // tek dış istek: PR bilgisi
      http: [],
      websocket: [],
      eval: [],
    },
  },
};

/** Arayüz paketinde bulunmaması gereken tarayıcı API'leri. */
const WEB_FORBIDDEN = {
  XMLHttpRequest: /\bXMLHttpRequest\b/,
  WebSocket: /\bnew WebSocket\b/,
  EventSource: /\bEventSource\b/,
  sendBeacon: /\bsendBeacon\b/,
  Worker: /\bnew (?:Shared)?Worker\b|\bimportScripts\b/,
  eval: /\beval\s*\(|new Function\s*\(/,
  serviceWorker: /serviceWorker\.register/,
};

/** Arayüz paketindeki metinlerde geçmesine izin verilen alan adları (bağlantı ve ad alanı sabitleri; istek değil). */
const WEB_HOSTS = new Set([
  'www.w3.org', // SVG/XHTML ad alanları
  'react.dev', // React hata iletisi bağlantıları
  'reactflow.dev', // etki haritası kütüphanesinin atıf bağlantısı
  'github.com', // örnek adresler
  'maven.apache.org', // örnek veri (pom.xml)
  '127.0.0.1',
  'localhost',
]);

const count = (s, re) => (s.match(re) || []).length;

function packageOf(input) {
  const norm = input.split('\\').join('/');
  const i = norm.lastIndexOf('node_modules/');
  if (i < 0) return undefined;
  const rest = norm.slice(i + 'node_modules/'.length).split('/');
  const name = rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
  return { name, dir: `${norm.slice(0, i)}node_modules/${name}` };
}

/** Yorumları kabaca atar (proje kodunda yorumda geçen "fetch(" yanlış alarm vermesin). */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'`\\])\/\/[^\n]*/g, '$1');
}

/**
 * Sunucu paketini denetler.
 * @param {string} root depo kökü
 * @param {'local'|'github'} edition
 * @param {string[]} inputs esbuild metafile girdileri (depo köküne göre yollar)
 * @returns {{ packages: {name: string, version: string}[], problems: string[] }}
 */
export function auditServerBundle(root, edition, inputs) {
  const problems = [];
  const rules = PROJECT_RULES[edition];
  const packages = new Map();
  const caps = new Map(); // paket -> Set(yetenek)

  for (const input of inputs) {
    const rel = input.split('\\').join('/');
    const src = readFileSync(join(root, rel), 'utf8');
    const pkg = packageOf(rel);
    if (pkg) {
      if (!packages.has(pkg.name)) {
        const meta = JSON.parse(readFileSync(join(root, pkg.dir, 'package.json'), 'utf8'));
        packages.set(pkg.name, meta.version);
      }
      const set = caps.get(pkg.name) ?? new Set();
      for (const [cap, re] of Object.entries(SERVER_CAPS)) if (count(src, re) > 0) set.add(cap);
      caps.set(pkg.name, set);
      continue;
    }
    for (const bad of rules.forbiddenPaths) {
      if (bad.test(rel)) problems.push(`${edition}: pakete girmemesi gereken dosya: ${rel}`);
    }
    const code = stripComments(src);
    for (const [cap, re] of Object.entries(SERVER_CAPS)) {
      if (count(code, re) === 0) continue;
      if (!(rules.allowed[cap] ?? []).includes(rel)) {
        problems.push(`${edition}: proje kodunda izinsiz yetenek "${cap}": ${rel}`);
      }
    }
  }

  for (const [name, set] of caps) {
    const allowed = THIRD_PARTY[name];
    if (!allowed) {
      problems.push(`${edition}: izin listesinde olmayan kütüphane pakete girdi: ${name}@${packages.get(name)}`);
      continue;
    }
    for (const cap of set) {
      if (!allowed.includes(cap)) problems.push(`${edition}: ${name}@${packages.get(name)} içinde yeni yetenek: "${cap}"`);
    }
  }

  const list = [...packages].map(([name, version]) => ({ name, version })).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  return { packages: list, problems };
}

/**
 * Derlenmiş arayüz paketini denetler (yasak tarayıcı API'leri, beklenmeyen alan adları, satır içi betik).
 * @returns {string[]} sorunlar
 */
export function auditWebBundle(webDir, edition) {
  const problems = [];
  const html = readFileSync(join(webDir, 'index.html'), 'utf8');
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) problems.push(`${edition}: index.html içinde satır içi <script> var (CSP ile çalışmaz)`);
  if (/(?:src|href)=["']https?:\/\//i.test(html)) problems.push(`${edition}: index.html dış adresten kaynak yüklüyor`);
  let all = html;
  const assets = join(webDir, 'assets');
  for (const f of readdirSync(assets)) {
    if (!/\.(js|css)$/.test(f)) continue;
    const s = readFileSync(join(assets, f), 'utf8');
    all += s;
    for (const [name, re] of Object.entries(WEB_FORBIDDEN)) {
      if (re.test(s)) problems.push(`${edition}: arayüz paketinde yasak tarayıcı API'si "${name}": assets/${f}`);
    }
    if (/@import\s+(?:url\()?["']?https?:/i.test(s) || /url\(\s*["']?https?:/i.test(s)) {
      problems.push(`${edition}: arayüz stili dış adresten kaynak yüklüyor: assets/${f}`);
    }
    if (/url\(\s*["']?data:(?:font|application\/(?:x-)?font)/i.test(s)) {
      problems.push(`${edition}: arayüz stili yazı tipini data: adresiyle gömüyor (CSP font-src 'self' engeller): assets/${f}`);
    }
  }
  const hosts = new Set((all.match(/https?:\/\/[a-zA-Z0-9.-]+/g) || []).map((u) => u.replace(/^https?:\/\//, '').toLowerCase()));
  for (const h of hosts) if (!WEB_HOSTS.has(h)) problems.push(`${edition}: arayüz paketinde beklenmeyen alan adı: ${h}`);
  return problems;
}
