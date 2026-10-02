/**
 * buildReview'in analiz adımları arasında paylaşılan iç bağlam.
 */
import type { CallRef, ChangeSetFile, FileChange } from '../../shared/types.js';
import type { JavaFileModel, MemberDiff, RepoIndexApi, TypeDiff } from '../java/model.js';
import type { ArchitectureIssue } from './risk.js';

export interface AnalyzedFile {
  file: FileChange;
  cs: ChangeSetFile;
  oldModel?: JavaFileModel;
  newModel?: JavaFileModel;
  typeDiffs: TypeDiff[];
  /** Diff'te eklenen satırlar (yeni satır no). */
  addedLines: Set<number>;
  /** Diff'te silinen satırlar (eski satır no). */
  removedLines: Set<number>;
  /** Java dosyası olup içeriği okunamadı/ayrıştırılamadı. */
  unanalyzed: boolean;
}

export interface MemberEntry {
  md: MemberDiff;
  td: TypeDiff;
  af: AnalyzedFile;
}

export interface TypeEntry {
  td: TypeDiff;
  af: AnalyzedFile;
}

export interface AnalysisContext {
  files: AnalyzedFile[];
  byPath: Map<string, AnalyzedFile>;
  typeDiffs: TypeDiff[];
  index: RepoIndexApi;
  hexagonal: boolean;
  /** Head'deki tüm dosya yolları (kaynak desteklemiyorsa yalnızca değişenler). */
  repoFiles: string[];
  repoFilesKnown: boolean;
  members: Map<string, MemberEntry>;
  types: Map<string, TypeEntry>;
  /** Üye id → head'de hâlâ eski ad/arity ile yapılan çağrılar. */
  staleCalls: Map<string, CallRef[]>;
  /** Üye id → alt tiplerde eski imzayla kalan (artık override etmeyen) metot id'leri. */
  brokenOverrides: Map<string, string[]>;
  /** Tip id → silinmiş/yeniden adlandırılmış tipe hâlâ referans veren head dosyaları. */
  staleTypeRefs: Map<string, string[]>;
  /** Sembol id (üye ya da tip) → bu değişiklikle gelen mimari ihlaller (risk katkısı için). */
  architecture: Map<string, ArchitectureIssue[]>;
  warnings: string[];
}
