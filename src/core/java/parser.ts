/**
 * web-tree-sitter + tree-sitter-java için tek seferlik (lazy) ayrıştırıcı başlatma.
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Language, Parser } from 'web-tree-sitter';

let parserPromise: Promise<Parser> | undefined;

async function createParser(): Promise<Parser> {
  await Parser.init();
  const require = createRequire(import.meta.url);
  const pkgDir = dirname(require.resolve('tree-sitter-java/package.json'));
  const wasmPath = join(pkgDir, 'tree-sitter-java.wasm');
  const language = await Language.load(wasmPath);
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
