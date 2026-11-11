/**
 * web-tree-sitter + tree-sitter-java için tek seferlik (lazy) ayrıştırıcı başlatma.
 *
 * WebAssembly dosyaları iki düzende aranır:
 *  - Paketlenmiş (dist/server): `web-tree-sitter.wasm` ve `tree-sitter-java.wasm` bu modülün yanında durur;
 *    node_modules gerekmez.
 *  - Kaynaktan (tsx/vitest): çalışma zamanı `node_modules/web-tree-sitter` içinden, Java dil bilgisi depodaki
 *    `vendor/tree-sitter-java/` klasöründen gelir.
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Language, Parser } from 'web-tree-sitter';

const RUNTIME_WASM = 'web-tree-sitter.wasm';
const JAVA_WASM = 'tree-sitter-java.wasm';

let parserPromise: Promise<Parser> | undefined;

function besideModule(name: string): string {
  return fileURLToPath(new URL(`./${name}`, import.meta.url));
}

function runtimeWasmPath(): string {
  const local = besideModule(RUNTIME_WASM);
  if (existsSync(local)) return local;
  return createRequire(import.meta.url).resolve(`web-tree-sitter/${RUNTIME_WASM}`);
}

function javaWasmPath(): string {
  const candidates = [besideModule(JAVA_WASM), fileURLToPath(new URL(`../../../vendor/tree-sitter-java/${JAVA_WASM}`, import.meta.url))];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(`${JAVA_WASM} bulunamadı. Aranan yerler: ${candidates.join(', ')}`);
  return found;
}

async function createParser(): Promise<Parser> {
  const runtime = runtimeWasmPath();
  await Parser.init({ locateFile: () => runtime });
  const language = await Language.load(javaWasmPath());
  const parser = new Parser();
  parser.setLanguage(language);
  return parser;
}

/** Java ayrıştırıcısını döndürür; ilk çağrıda wasm yüklenir, sonrakiler aynı örneği paylaşır. */
export async function getJavaParser(): Promise<Parser> {
  if (!parserPromise) {
    parserPromise = createParser().catch((error: unknown) => {
      parserPromise = undefined;
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Java ayrıştırıcısı başlatılamadı: ${msg}`);
    });
  }
  return parserPromise;
}
