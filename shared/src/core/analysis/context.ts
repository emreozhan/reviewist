/**
 * buildReview'in analiz adımları arasında paylaşılan iç bağlam.
 */
import type { CallRef, ChangeSetFile, FileChange } from '../../shared/types.js';
import type { JavaFileModel, MemberDiff, RepoIndexApi, TypeDiff } from '../java/model.js';
import type { ImportRetarget } from './cosmetic.js';
import type { SymbolIds } from './symbolIds.js';
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
  /**
   * Üye id → name-only güvenle bulunan (alıcı tipi çözülemeyen) olası bayat çağrı sayısı. Bulgu/risk üretmez;
   * yalnızca tek bir özet bilgi bulgusunda sayılır.
   */
  unverifiedStaleCalls: Map<string, number>;
  /** Üye id → alt tiplerde eski imzayla kalan, @Override taşıyan ve artık hiçbir şeyi override etmeyen (derlenmez) metot id'leri. */
  brokenOverrides: Map<string, string[]>;
  /** Üye id → alt tiplerde eski imzayla kalan, @Override taşımayan ve artık hiçbir şeyi override etmeyen metot id'leri (bilgi). */
  orphanedOverrides: Map<string, string[]>;
  /** Tip id → import hedefi değişen basit adlar (javax.persistence.Entity → jakarta.persistence.Entity). */
  importRetargets: Map<string, ImportRetarget[]>;
  /** Model id ↔ indeks id dönüşümü (çift FQN'de '@kaynak kökü' soneki). */
  ids: SymbolIds;
  /** Tip id → silinmiş/yeniden adlandırılmış tipe hâlâ referans veren head dosyaları. */
  staleTypeRefs: Map<string, string[]>;
  /** Sembol id (üye ya da tip) → bu değişiklikle gelen mimari ihlaller (risk katkısı için). */
  architecture: Map<string, ArchitectureIssue[]>;
  /**
   * Silinen/yeniden adlandırılan örnek alanları (üye id): kullanımları güvenilir biçimde aranamadı (başka dosyalardaki
   * `x.alan` erişimlerinin alıcı tipi çözülmez). Bulgu "çağıranı kalmadı" demez; elle doğrulama ister.
   */
  untrackedFieldUses?: Set<string>;
  warnings: string[];
}
