import type { ImpactEdge, ImpactGraph, ImpactNode, Layer, TypeChange } from '../../../src/shared/types';
import { findDeclarationLine } from '../lib/locate';
import { S, T } from './ids';
import { sampleFiles } from './sampleFiles';
import { PATHS as P } from './samplePaths';

interface External {
  id: string;
  label: string;
  kind: ImpactNode['kind'];
  file: string;
  typeId: string;
  layer: Layer;
  status?: ImpactNode['status'];
}

/** Diff dışında kalan ama değişen sembollere bağımlı olanlar. */
const EXTERNAL: External[] = [
  { id: T.EMAIL, label: 'EmailNotifier', kind: 'class', file: P.emailNotifier, typeId: T.EMAIL, layer: 'adapter-out' },
  { id: T.SMS, label: 'SmsNotifier', kind: 'class', file: P.smsNotifier, typeId: T.SMS, layer: 'adapter-out' },
  { id: T.PUSH, label: 'PushNotifier', kind: 'class', file: P.pushNotifier, typeId: T.PUSH, layer: 'adapter-out' },
  { id: S.emailSend, label: 'EmailNotifier.send()', kind: 'method', file: P.emailNotifier, typeId: T.EMAIL, layer: 'adapter-out' },
  { id: S.smsSend, label: 'SmsNotifier.send()', kind: 'method', file: P.smsNotifier, typeId: T.SMS, layer: 'adapter-out' },
  { id: S.pushSend, label: 'PushNotifier.send()', kind: 'method', file: P.pushNotifier, typeId: T.PUSH, layer: 'adapter-out' },
  { id: S.emailFormat, label: 'EmailNotifier.format()', kind: 'method', file: P.emailNotifier, typeId: T.EMAIL, layer: 'adapter-out' },
  { id: S.smsFormat, label: 'SmsNotifier.format()', kind: 'method', file: P.smsNotifier, typeId: T.SMS, layer: 'adapter-out' },
  { id: S.pushFormat, label: 'PushNotifier.format()', kind: 'method', file: P.pushNotifier, typeId: T.PUSH, layer: 'adapter-out' },
  { id: S.oelOn, label: 'OrderEventListener.onOrderPlaced()', kind: 'method', file: P.eventListener, typeId: T.OEL, layer: 'application' },
  { id: S.invPrint, label: 'InvoicePrinter.print()', kind: 'method', file: P.invoicePrinter, typeId: T.INV, layer: 'adapter-out' },
  { id: S.refCompensate, label: 'RefundService.compensate()', kind: 'method', file: P.refundService, typeId: T.REF, layer: 'application' },
  { id: T.MT, label: 'MoneyTest', kind: 'class', file: P.moneyTest, typeId: T.MT, layer: 'test', status: 'unchanged' },
];

/**
 * Sunucu diff dışı düğümlere bildirim aralığı (range) verir; mock'ta içerikten hesaplanır.
 * MoneyTest kasıtlı olarak aralıksız bırakılır (arayüzün içerikte arama yedeği için).
 */
function externalRange(e: External): Pick<ImpactNode, 'range' | 'rangeSide'> {
  if (e.id === T.MT) return {};
  const content = sampleFiles[e.file]?.new;
  const start = content ? findDeclarationLine(content.split('\n'), e.id) : undefined;
  return start ? { range: { startLine: start, endLine: start }, rangeSide: 'new' } : {};
}

export function buildGraph(types: TypeChange[]): ImpactGraph {
  const nodes = new Map<string, ImpactNode>();
  const edges = new Map<string, ImpactEdge>();
  const addEdge = (kind: ImpactEdge['kind'], from: string, to: string) => {
    if (from === to) return;
    const id = `${kind}:${from}->${to}`;
    if (!edges.has(id)) edges.set(id, { id, from, to, kind });
  };

  for (const t of types) {
    nodes.set(t.id, { id: t.id, label: t.name, kind: t.kind, status: t.status, file: t.file, typeId: t.id, layer: t.layer, riskLevel: t.risk.level });
    for (const m of t.members) {
      const relevant = m.status !== 'unchanged' || m.overriddenBy.length > 0;
      if (!relevant) continue;
      nodes.set(m.id, {
        id: m.id,
        label: m.kind === 'field' ? `${t.name}.${m.name}` : `${t.name}.${m.name}()`,
        kind: m.kind,
        status: m.status,
        file: t.file,
        typeId: t.id,
        layer: t.layer,
        riskLevel: m.risk.level,
      });
    }
  }
  for (const e of EXTERNAL) {
    nodes.set(e.id, { id: e.id, label: e.label, kind: e.kind, status: e.status ?? 'impacted', file: e.file, typeId: e.typeId, layer: e.layer, riskLevel: e.status ? 'low' : 'medium', ...externalRange(e) });
  }

  for (const t of types) {
    for (const m of t.members) {
      if (!nodes.has(m.id)) continue;
      addEdge('contains', t.id, m.id);
      for (const c of m.callers) if (nodes.has(c.fromId)) addEdge('calls', c.fromId, m.id);
      for (const callee of m.callees) if (nodes.has(callee)) addEdge('calls', m.id, callee);
      for (const o of m.overrides) if (nodes.has(o)) addEdge('overrides', m.id, o);
      for (const o of m.overriddenBy) if (nodes.has(o)) addEdge('overrides', o, m.id);
    }
    for (const sub of t.subTypes) {
      if (!nodes.has(sub)) continue;
      addEdge(t.kind === 'interface' ? 'implements' : 'extends', sub, t.id);
    }
  }
  for (const e of EXTERNAL) {
    if (e.kind !== 'class' && nodes.has(e.typeId)) addEdge('contains', e.typeId, e.id);
  }
  addEdge('tests', T.POST, T.POS);
  addEdge('tests', T.MT, T.MONEY);

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
