/**
 * Bağlam üzerindeki tüm tip/üye/dosyalara katman ve risk atar.
 */
import type { RiskInfo } from '../../shared/types.js';
import type { JavaFileModel, TypeDiff } from '../java/model.js';
import type { AnalysisContext, AnalyzedFile } from './context.js';
import { isMeaningfulImport } from './cosmetic.js';
import { outsideCallerIds } from './enrich.js';
import { detectLayer } from './layers.js';
import { isSemanticChange, scoreJavaFile, scoreMember, scoreNonJavaFile, scoreType } from './risk.js';
import { basename } from './util.js';

export function assignLayers(ctx: AnalysisContext): void {
  for (const af of ctx.files) {
    for (const td of af.typeDiffs) {
      const t = td.newType ?? td.oldType;
      const model = td.newFile ?? td.oldFile;
      td.change.layer = detectLayer({
        path: af.file.path,
        packageName: model?.packageName || af.file.packageName,
        annotations: t?.annotations ?? td.change.annotations,
        superTypes: td.change.superTypes,
        typeKind: td.change.kind,
        typeName: td.change.name,
        hexagonal: ctx.hexagonal,
      });
    }
    const primary = primaryType(af.typeDiffs, af.file.path);
    af.file.layer = primary
      ? primary.change.layer
      : detectLayer({ path: af.file.path, packageName: af.file.packageName, hexagonal: ctx.hexagonal });
  }
}

/** Dosyanın ana tipi: dosya adıyla aynı adlı üst düzey tip, yoksa ilk üst düzey tip. */
export function primaryType(tds: readonly TypeDiff[], path: string): TypeDiff | undefined {
  const stem = basename(path).replace(/\.\w+$/, '');
  const top = tds.filter((td) => !(td.newType ?? td.oldType)?.outerFqn);
  return top.find((td) => td.change.name === stem) ?? top[0] ?? tds[0];
}

function hookNamesOf(ctx: AnalysisContext, td: TypeDiff): Set<string> {
  const out = new Set<string>();
  const t = td.newType;
  if (!t) return out;
  for (const m of t.members) {
    if (m.kind !== 'method') continue;
    if (m.modifiers.includes('abstract')) out.add(m.name);
    else if (m.visibility !== 'private' && !m.modifiers.includes('static') && !m.modifiers.includes('final') && ctx.index.overriddenBy(m.id).length > 0) out.add(m.name);
  }
  return out;
}

export function scoreAll(ctx: AnalysisContext): void {
  for (const af of ctx.files) scoreFile(ctx, af);
}

function scoreFile(ctx: AnalysisContext, af: AnalyzedFile): void {
  const isTest = af.file.isTest;
  if (af.typeDiffs.length === 0) {
    af.file.risk = scoreNonJavaFile(af.file, { unanalyzedJava: af.unanalyzed });
    return;
  }
  const typeRisks: RiskInfo[] = [];
  const memberRisks: RiskInfo[] = [];
  for (const td of af.typeDiffs) {
    const ch = td.change;
    const owner = td.newType ?? td.oldType;
    const implementationCount = td.newType ? ctx.index.subTypesOf(ctx.ids.toIndex(ch.id), true).length : ch.subTypes.length;
    const changedSiblingNames = new Set(td.members.filter((m) => isSemanticChange(m.change.status)).map((m) => m.change.name));
    const needsHooks = td.members.some((m) => m.change.status === 'modified' || m.change.status === 'signatureChanged');
    const hookNames = needsHooks && implementationCount > 0 ? hookNamesOf(ctx, td) : undefined;
    const risks: RiskInfo[] = [];
    for (const md of td.members) {
      const mc = md.change;
      mc.risk = scoreMember({
        md,
        ownerType: owner,
        ownerKind: ch.kind,
        ownerVisibility: owner?.visibility ?? ch.visibility,
        implementationCount,
        outsideCallers: outsideCallerIds(ctx, mc.callers, 'exact').length,
        outsideLikelyCallers: outsideCallerIds(ctx, mc.callers, 'likely').length,
        staleCalls: ctx.staleCalls.get(mc.id) ?? [],
        brokenOverrides: ctx.brokenOverrides.get(mc.id) ?? [],
        orphanedOverrides: ctx.orphanedOverrides.get(mc.id) ?? [],
        ownerAdded: ch.status === 'added',
        isTest,
        changedSiblingNames,
        hookNames,
        architecture: ctx.architecture.get(mc.id),
      });
      risks.push(mc.risk);
    }
    ch.risk = scoreType({ td, memberRisks: risks, isTest, staleTypeRefs: ctx.staleTypeRefs.get(ch.id) ?? [], subTypeCount: implementationCount,
      architecture: ctx.architecture.get(ch.id),
      importRetargets: ctx.importRetargets.get(ch.id),
      meaningfulImport: isMeaningfulImport,
    });
    typeRisks.push(ch.risk);
    memberRisks.push(...risks);
  }
  af.file.risk = af.file.cosmeticOnly
    ? scoreNonJavaFile(af.file)
    : scoreJavaFile(typeRisks, memberRisks);
}

export function fileModelOf(af: AnalyzedFile): JavaFileModel | undefined {
  return af.newModel ?? af.oldModel;
}
