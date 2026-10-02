/**
 * ReviewModel iç tutarlılığı (B3): modeldeki her sembol referansı modelde var olan bir id'ye ya da graf'ta 'impacted'
 * düğüme çıkmalı; tip/üye id'leri benzersiz olmalı; FileChange.typeIds ile TypeChange.file uyumlu olmalı.
 * Boş dizi dönerse model tutarlıdır.
 */
import type { ReviewModel } from '../../shared/types.js';

export function modelInconsistencies(model: ReviewModel): string[] {
  const out: string[] = [];
  const typeIds = new Set<string>();
  const memberIds = new Set<string>();
  for (const t of model.types) {
    if (typeIds.has(t.id)) out.push(`yinelenen tip id: ${t.id}`);
    typeIds.add(t.id);
  }
  for (const t of model.types) {
    for (const m of t.members) {
      if (m.ownerTypeId !== t.id) out.push(`üye sahibi uyumsuz: ${m.id} → ${m.ownerTypeId} (tip ${t.id})`);
      memberIds.add(m.id);
    }
  }
  const nodes = new Map(model.graph.nodes.map((n) => [n.id, n]));
  const inModel = (id: string) => typeIds.has(id) || memberIds.has(id);
  const known = (id: string) => inModel(id) || nodes.get(id)?.status === 'impacted';
  const files = new Map(model.files.map((f) => [f.path, f]));
  for (const f of model.files) for (const id of f.typeIds) if (!typeIds.has(id)) out.push(`file.typeIds: ${f.path} → ${id}`);
  for (const t of model.types) {
    const f = files.get(t.file);
    if (!f) out.push(`tip dosyası yok: ${t.id} → ${t.file}`);
    else if (!f.typeIds.includes(t.id)) out.push(`dosya tipi listelemiyor: ${t.file} ∌ ${t.id}`);
  }
  for (const g of model.groups) for (const id of g.symbolIds) if (!inModel(id)) out.push(`grup ${g.id}: ${id}`);
  for (const s of model.reviewPlan) for (const id of s.symbolIds) if (!inModel(id)) out.push(`plan ${s.order}: ${id}`);
  for (const f of model.findings) for (const id of f.symbolIds ?? []) if (!known(id)) out.push(`bulgu ${f.id}: ${id}`);
  for (const n of model.graph.nodes) if (n.status !== 'impacted' && !inModel(n.id)) out.push(`düğüm: ${n.id}`);
  for (const e of model.graph.edges) {
    if (!nodes.has(e.from)) out.push(`kenar ${e.id}: from ${e.from}`);
    if (!nodes.has(e.to)) out.push(`kenar ${e.id}: to ${e.to}`);
  }
  for (const t of model.types) {
    for (const m of t.members) {
      // Değişen üyelerin çağıranları graf'ta (kırpılmadıysa) ya da modelde olmalı; kırpma uyarısı varsa yalnız modeldekiler.
      for (const c of m.callers) if (!known(c.fromId) && nodes.size > 0 && !model.warnings.some((w) => w.startsWith('Etki grafiği'))) out.push(`çağıran ${m.id}: ${c.fromId}`);
    }
  }
  return out;
}
