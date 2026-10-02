/**
 * Çift FQN (aynı tam adı bildiren birden çok kaynak kökü; ör. guava'nın `guava/` ve `android/guava/` flavor'ları) için
 * benzersiz model id'leri.
 *
 * Yalnızca çakışma olduğunda (aynı TypeChange.id'yi farklı kaynak köklerindeki dosyalar üretiyorsa) id'ye kaynak kökü eklenir:
 *  - tip:  `com.google.common.base.Preconditions@android/guava/src`
 *  - üye:  `com.google.common.base.Preconditions@android/guava/src#checkNotNull(T)`
 * Repo indeksi (RepoIndexApi) soneksiz id'lerle çalışır: indekse giderken `toIndex`, indeksten gelen id'yi modele
 * bağlarken `toModel(id, bağlamDosyası)` kullanılır (bağlam dosyasının kaynak kökündeki varyant seçilir; o kökte
 * değişen varyant yoksa soneksiz id döner, yani diff dışı bir sembol olarak kalır).
 */
import type { TypeDiff } from '../java/model.js';
import { sourceRootOf } from '../java/index.js';

export interface SymbolIds {
  /** Çakışan (soneklenen) FQN'ler. */
  readonly collided: ReadonlySet<string>;
  /** Model id → indeks id (`@kök` soneki atılır). */
  toIndex(id: string): string;
  /** İndeks id → model id; `contextPath` (çağıranın / ilişkili tipin dosyası) kaynak köküne göre varyant seçilir. */
  toModel(id: string, contextPath: string | undefined): string;
}

/**
 * Dosyanın kaynak kökü (A1 `sourceRootOf` ile aynı kural; RepoIndex'in kaynak kökü tercihiyle tutarlı):
 * `android/guava/src/com/google/common/base/X.java` + `com.google.common.base` → `android/guava/src`.
 * Repo kökündeyse '.' (id sonekinde boş kalmasın diye).
 */
export function sourceRootFor(path: string, packageName: string | undefined): string {
  return sourceRootOf(path, packageName ?? '') || '.';
}

function ownerPart(id: string): { owner: string; rest: string } {
  const i = id.indexOf('#');
  return i < 0 ? { owner: id, rest: '' } : { owner: id.slice(0, i), rest: id.slice(i) };
}

/** Model id'sindeki kaynak kökü ('a.B@x/src#m()' → 'x/src'); sonek yoksa undefined. */
export function rootOfModelId(id: string): string | undefined {
  const { owner } = ownerPart(id);
  const at = owner.indexOf('@');
  return at < 0 ? undefined : owner.slice(at + 1);
}

export function stripRootSuffix(id: string): string {
  const { owner, rest } = ownerPart(id);
  const at = owner.indexOf('@');
  return at < 0 ? id : `${owner.slice(0, at)}${rest}`;
}

const IDENTITY: SymbolIds = {
  collided: new Set(),
  toIndex: (id) => id,
  toModel: (id) => id,
};

export function identitySymbolIds(): SymbolIds {
  return IDENTITY;
}

function typeRoot(td: TypeDiff): string {
  const model = td.newFile ?? td.oldFile;
  return sourceRootFor(td.change.file, model?.packageName);
}

/**
 * Çakışan TypeChange id'lerini (ve üyelerini) yerinde sonekler. `rootOfPath`: bir dosya yolunun kaynak kökü
 * (indeksteki/değişen dosya modelinden paket adıyla); toModel için kullanılır ve çağrı anında değerlendirilir.
 */
export function assignUniqueIds(diffs: readonly TypeDiff[], rootOfPath: (path: string) => string | undefined): SymbolIds {
  const byId = new Map<string, TypeDiff[]>();
  for (const td of diffs) {
    const list = byId.get(td.change.id);
    if (list) list.push(td);
    else byId.set(td.change.id, [td]);
  }
  /** fqn → soneklenen kökler */
  const variants = new Map<string, Set<string>>();
  for (const [fqn, list] of byId) {
    if (list.length < 2) continue;
    const roots = new Map<string, TypeDiff[]>();
    for (const td of list) {
      const r = typeRoot(td);
      const l = roots.get(r);
      if (l) l.push(td);
      else roots.set(r, [td]);
    }
    if (roots.size < 2) continue; // aynı kökte (ör. tespit edilmemiş taşıma): eski davranış, head tarafı tutulur
    variants.set(fqn, new Set(roots.keys()));
    for (const [root, tds] of roots) {
      const suffixed = `${fqn}@${root}`;
      for (const td of tds) {
        td.change.id = suffixed;
        for (const md of td.members) {
          const mc = md.change;
          if (mc.id.startsWith(`${fqn}#`)) mc.id = `${suffixed}${mc.id.slice(fqn.length)}`;
          if (mc.oldId?.startsWith(`${fqn}#`)) mc.oldId = `${suffixed}${mc.oldId.slice(fqn.length)}`;
          if (mc.ownerTypeId === fqn) mc.ownerTypeId = suffixed;
        }
      }
    }
  }
  if (variants.size === 0) return IDENTITY;
  return {
    collided: new Set(variants.keys()),
    toIndex: stripRootSuffix,
    toModel(id, contextPath) {
      const { owner, rest } = ownerPart(id);
      const roots = variants.get(owner);
      if (!roots || contextPath === undefined) return id;
      const root = rootOfPath(contextPath);
      return root !== undefined && roots.has(root) ? `${owner}@${root}${rest}` : id;
    },
  };
}
