/**
 * Açık haritalarla beslenen sahte RepoIndexApi. Birim testlerinde A1'in gerçek RepoIndex'ine bağımlı olmamak için.
 * Verilmeyen sorgular boş sonuç döner.
 */
import type { CallRef } from '../../shared/types.js';
import type { JavaFileModel, JavaType, RepoIndexApi, ResolvedMember } from '../java/model.js';
import { simpleTypeName } from '../analysis/util.js';

export interface FakeRepoIndexInit {
  files?: JavaFileModel[];
  /** fqn → doğrudan alt tipler */
  subTypes?: Record<string, string[]>;
  overrides?: Record<string, string[]>;
  overriddenBy?: Record<string, string[]>;
  callers?: Record<string, CallRef[]>;
  callees?: Record<string, string[]>;
  /** `${owner}#${name}/${argCount}` → çağrılar */
  callsTo?: Record<string, CallRef[]>;
  referencing?: Record<string, string[]>;
  /** `${fromId}|${line}|${name}` → çağrı yerinin bağlandığı hedef id'ler (targetsOfCallSite). */
  callSiteTargets?: Record<string, string[]>;
}

export class FakeRepoIndex implements RepoIndexApi {
  readonly files: ReadonlyMap<string, JavaFileModel>;
  private readonly types = new Map<string, { type: JavaType; file: JavaFileModel }>();
  private readonly allTypes = new Map<string, { type: JavaType; file: JavaFileModel }[]>();

  constructor(private readonly init: FakeRepoIndexInit = {}) {
    const files = new Map<string, JavaFileModel>();
    for (const f of init.files ?? []) {
      files.set(f.path, f);
      for (const t of f.types) {
        // Yinelenen FQN: ilk kazanır (gerçek RepoIndex gibi); hepsi typesByFqn'de.
        if (!this.types.has(t.fqn)) this.types.set(t.fqn, { type: t, file: f });
        const list = this.allTypes.get(t.fqn);
        if (list) list.push({ type: t, file: f });
        else this.allTypes.set(t.fqn, [{ type: t, file: f }]);
      }
    }
    this.files = files;
  }

  getType(fqn: string): JavaType | undefined {
    return this.types.get(fqn)?.type;
  }

  getFileOfType(fqn: string): JavaFileModel | undefined {
    return this.types.get(fqn)?.file;
  }

  getMember(id: string): ResolvedMember | undefined {
    for (const { type, file } of this.types.values()) {
      const member = type.members.find((m) => m.id === id);
      if (member) return { member, type, file };
    }
    return undefined;
  }

  resolveTypeName(name: string, fromFile: JavaFileModel): string | undefined {
    if (this.types.has(name)) return name;
    const imp = fromFile.imports.find((i) => !i.wildcard && simpleTypeName(i.name) === name);
    if (imp) return imp.name;
    const samePkg = fromFile.packageName ? `${fromFile.packageName}.${name}` : name;
    if (this.types.has(samePkg)) return samePkg;
    for (const fqn of this.types.keys()) if (simpleTypeName(fqn) === name) return fqn;
    return undefined;
  }

  superTypesOf(fqn: string): string[] {
    const entry = this.types.get(fqn);
    if (!entry) return [];
    const raw = [...(entry.type.superclass ? [entry.type.superclass] : []), ...entry.type.interfaces];
    return raw.map((n) => this.resolveTypeName(n, entry.file) ?? n);
  }

  subTypesOf(fqn: string, transitive = false): string[] {
    const direct = this.init.subTypes?.[fqn] ?? [];
    if (!transitive) return [...direct];
    const out = new Set<string>();
    const stack = [...direct];
    while (stack.length) {
      const s = stack.pop() as string;
      if (out.has(s)) continue;
      out.add(s);
      stack.push(...(this.init.subTypes?.[s] ?? []));
    }
    return [...out];
  }

  overridesOf(memberId: string): string[] {
    return [...(this.init.overrides?.[memberId] ?? [])];
  }

  overriddenBy(memberId: string): string[] {
    return [...(this.init.overriddenBy?.[memberId] ?? [])];
  }

  callersOf(memberId: string): CallRef[] {
    return (this.init.callers?.[memberId] ?? []).map((c) => ({ ...c, inChangedCode: false }));
  }

  calleesOf(memberId: string): string[] {
    return [...(this.init.callees?.[memberId] ?? [])];
  }

  findCallsTo(ownerFqn: string, name: string, argCount?: number): CallRef[] {
    return (this.init.callsTo?.[`${ownerFqn}#${name}/${argCount ?? '*'}`] ?? []).map((c) => ({ ...c, inChangedCode: false }));
  }

  filesReferencingType(fqn: string): string[] {
    return [...(this.init.referencing?.[fqn] ?? [])];
  }

  targetsOfCallSite(fromId: string, line: number, name: string): string[] {
    return [...(this.init.callSiteTargets?.[`${fromId}|${line}|${name}`] ?? [])];
  }

  typesByFqn(fqn: string): { type: JavaType; file: JavaFileModel }[] {
    return [...(this.allTypes.get(fqn) ?? [])];
  }
}
