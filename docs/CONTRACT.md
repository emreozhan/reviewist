# Reviewist — geliştirme sözleşmesi

Reviewist; git diff veya GitHub PR'ını alıp Java kodunu **sembol düzeyinde** analiz eden, yerelde çalışan bir web arayüzüyle reviewer'a
"ne değişti, nereye yayılıyor, hangi sırayla okumalıyım, nereler riskli, neyi atlayabilirim" sorularının cevabını veren araçtır.

## Mimari

```
ReviewRequest ──> sources (git | worktree | github | patch) ──> ChangeSet
ChangeSet ──> core/buildReview ──> ReviewModel ──> server (Hono, /api) ──> web (React)
```

- Ortak tipler: `src/shared/types.ts` (ChangeSet, ReviewModel, API uçları). **Değiştirme**; gerekirse rapora yaz.
- Core iç tipleri: `src/core/java/model.ts` (JavaFileModel, TypeDiff, RepoIndexApi). **Değiştirme**; gerekirse rapora yaz.

## Şeritler ve dosya sahipliği

| Şerit | Sahip olduğu yollar | Ana çıktı |
| --- | --- | --- |
| A1 Java çekirdeği | `src/core/java/**` (model.ts hariç) | `parseJavaFile`, `diffJavaFile`, `detectCrossFileMoves`, `memberSimilarity`, `RepoIndex` |
| A2 Analiz | `src/core/analysis/**`, `src/core/buildReview.ts`, `src/core/testing/**` | `buildReview(cs, opts): Promise<ReviewModel>` |
| B Kaynak + sunucu | `src/sources/**`, `src/server/**` | git/worktree/github/patch → ChangeSet; Hono API; CLI |
| C Arayüz | `web/**` | React SPA |
| D Fikstür | `scripts/make-fixture.mjs`, `fixtures/**` | Örnek Java reposu + beklenen sonuçlar |

## Ortak kurallar

- Node 22, ESM, TypeScript strict. Sunucu tarafında göreli importlar **`.js` uzantılı** (NodeNext): `import { x } from './y.js'`.
- `node:` önekli built-in modüller. `async/await`. `any` yok. Named export.
- Testler Vitest, kaynağın yanında `*.test.ts`. Çalıştırma: `npx vitest run <yol>`.
- Tip kontrolü: `npx tsc -p tsconfig.check.json` (sunucu), `npx tsc -p web/tsconfig.json` (web).
- Kullanıcıya dönük tüm metinler (UI, hata, details, risk mesajları, bulgular) **Türkçe**.
- Dosyalar UTF-8 + LF.
- `package.json`'a dokunma, paket kurma, commit atma. Eksik paket/script varsa rapora yaz.
- Kurulu paketler: hono, @hono/node-server, web-tree-sitter (0.27), tree-sitter-java (wasm: `tree-sitter-java/tree-sitter-java.wasm`),
  diff (v9, kendi tipleri var), zod (v4), tar, open; dev: vite, @vitejs/plugin-react, react 19, @tanstack/react-query, zustand,
  @xyflow/react, @dagrejs/dagre, highlight.js, vitest, tsx, typescript 7.
- Gizli dosyalar (`.env*`, `secrets/`, `auth.json`, `.credentials.json`) okunmaz.

## core API (A2 → B)

```ts
// src/core/buildReview.ts
export interface BuildReviewOptions {
  id?: string;                 // verilmezse üretilir
  maxIndexFiles?: number;      // repo indeksi için en fazla .java dosyası (varsayılan 5000)
  onProgress?: (msg: string) => void;
  onTimings?: (timings: Record<string, number>) => void; // aşama süreleri (ms)
}
export async function buildReview(cs: ChangeSet, opts?: BuildReviewOptions): Promise<ReviewModel>;
```

## Fikstür

`npm run fixture` → `fixtures/sample-repo` (git deposu). `main` dalı taban, `feature/ai-refactor` dalı büyük AI tarzı değişiklik,
`feature/small-fix` küçük değişiklik. Beklenen analiz sonuçları `fixtures/EXPECTED.md` içinde.

## Tur 2 eklemeleri

- `ReviewSourceInfo.stableKey`: görüldü/not kalıcılığı için kaynak başına kararlı anahtar (`git:<repo>:<base>...<head>:<mode>`, `worktree:…`, `github:<host>/<o>/<r>#<n>`, `patch:<sha1>`).
- İş API'si: `POST /api/jobs` → `ReviewJob` (202), `GET /api/jobs/:id` ile ilerleme sorgulanır. Aynı anda en çok 2 analiz.
- `ImpactNode.range` / `rangeSide`: diff dışı önizleme için bildirim aralığı. `rangeSide === 'old'` ise dosya `FileChange.oldPath ?? path` ile old tarafından okunur.
- `CallSite.args?: string[]` (model.ts): argüman metinleri; tip uyuşmazlığı tespiti için.
- `ChangeFlag 'supertypes'`, `ApiError.field`, `DELETE /api/reviews/:id`.

## Tur 4 eklemeleri (kod gezinme)

- `GET /api/reviews/:id/outline?path&side` → `FileOutline` (bildirimler + tıklanabilir referanslar, hedefler ReviewModel id biçiminde). side=old'da yeniden adlandırılmış dosya için `path = FileChange.oldPath`.
- `GET /api/reviews/:id/locate?id` → `SymbolLocation` (diff içi/dışı, silinmiş, `@kök`, `$anon`).
- core: `BuildReviewOptions.onArtifacts` → `ReviewArtifacts { index, newFiles, oldFiles, ids }`; `buildArtifacts(cs, opts)` model üretmeden artefaktları yeniden kurar. Gezinme mantığı `src/core/navigation.ts` (`ReviewNavigator`).
- Sunucu artefaktları en son 3 review için tutar (`NavigatorCache`); düşenler ilk istekte yeniden kurulur (ayrıştırma önbelleği sayesinde ucuz).
- model.ts opsiyonel ekler: `CallSite.col/endCol/nameLine`, üye/tip `nameLine/nameCol/nameEndCol`, `JavaFileModel.typeRefPositions` (sıkıştırılmış tablo, `decodeTypeRefPositions`).
