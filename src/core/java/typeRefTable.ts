/**
 * Tip referansı konum tablosu: JavaFileModel.typeRefPositions'ın sıkıştırılmış biçimi ve çözücüsü.
 * Büyük repolarda (guava) dosya başına yüzlerce referans olduğundan nesne yerine Int32Array tutulur.
 */
import type { TypeRefTable } from './model.js';

export const TYPE_REF_STRIDE = 5;
/** İfade konumu (`Foo.bar()` alıcısı, `Foo::x`, `Foo.CONST`): değişken adı da olabilir, yalnız çözülürse anlamlı. */
export const TYPE_REF_EXPR = 1;
/** Anotasyon adı (`@Foo`). */
export const TYPE_REF_ANNOTATION = 2;

export interface TypeRefPosition {
  name: string;
  line: number; // 1 tabanlı
  col: number; // satır içi 0 tabanlı UTF-16, dahil
  endCol: number; // hariç
  expr: boolean;
  annotation: boolean;
}

/** Tablo kurucusu (ayrıştırma sırasında). */
export class TypeRefTableBuilder {
  private readonly names: string[] = [];
  private readonly nameIdx = new Map<string, number>();
  private readonly data: number[] = [];

  add(name: string, line: number, col: number, endCol: number, flags: number): void {
    let i = this.nameIdx.get(name);
    if (i === undefined) {
      i = this.names.length;
      this.names.push(name);
      this.nameIdx.set(name, i);
    }
    this.data.push(i, line, col, endCol, flags);
  }

  get size(): number {
    return this.data.length / TYPE_REF_STRIDE;
  }

  build(): TypeRefTable {
    return { names: this.names, data: Int32Array.from(this.data) };
  }
}

/** Tabloyu nesnelere açar (kaynak sırasıyla). */
export function decodeTypeRefPositions(table: TypeRefTable | undefined): TypeRefPosition[] {
  if (!table) return [];
  const out: TypeRefPosition[] = [];
  const d = table.data;
  for (let i = 0; i + TYPE_REF_STRIDE <= d.length; i += TYPE_REF_STRIDE) {
    const flags = d[i + 4] as number;
    out.push({
      name: table.names[d[i] as number] ?? '',
      line: d[i + 1] as number,
      col: d[i + 2] as number,
      endCol: d[i + 3] as number,
      expr: (flags & TYPE_REF_EXPR) !== 0,
      annotation: (flags & TYPE_REF_ANNOTATION) !== 0,
    });
  }
  return out;
}
