/**
 * Repo indeksi kurulamadığında kullanılan boş indeks: yalnızca verilen dosyalardaki tipleri bilir, ilişki sorguları boş döner.
 */
import type { CallRef } from '../../shared/types.js';
import type { JavaFileModel, JavaType, RepoIndexApi, ResolvedMember } from '../java/model.js';

export function createEmptyIndex(models: readonly JavaFileModel[]): RepoIndexApi {
  const files = new Map(models.map((m) => [m.path, m]));
  const types = new Map<string, { type: JavaType; file: JavaFileModel }>();
  for (const f of models) for (const t of f.types) if (!types.has(t.fqn)) types.set(t.fqn, { type: t, file: f });
  return {
    files,
    getType: (fqn) => types.get(fqn)?.type,
    getFileOfType: (fqn) => types.get(fqn)?.file,
    getMember: (id): ResolvedMember | undefined => {
      const owner = types.get(id.slice(0, id.indexOf('#')));
      const member = owner?.type.members.find((m) => m.id === id);
      return owner && member ? { member, type: owner.type, file: owner.file } : undefined;
    },
    resolveTypeName: () => undefined,
    superTypesOf: () => [],
    subTypesOf: () => [],
    overridesOf: () => [],
    overriddenBy: () => [],
    callersOf: (): CallRef[] => [],
    calleesOf: () => [],
    findCallsTo: (): CallRef[] => [],
    filesReferencingType: () => [],
    targetsOfCallSite: () => [],
    typesByFqn: (fqn) => {
      const e = types.get(fqn);
      return e ? [e] : [];
    },
  };
}
