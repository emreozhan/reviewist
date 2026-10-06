/**
 * Hexagonal düzen tespiti: düz Spring MVC projesinde tek bir `adapters/` ya da Java dışı `ports/` klasörü tüm repoyu
 * hexagonal yapmaz; controller'ın somut servisi enjekte etmesi mimari ihlal sayılmaz.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isHexagonalRepo } from './analysis/layers.js';
import { buildReview } from './buildReview.js';
import { createMemoryChangeSet } from './testing/memoryChangeSet.js';

const M = 'src/main/java/com/acme';

const CONTROLLER = (extra: string) => `package com.acme.web;

import com.acme.service.OrderService;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class OrderController {
    private final OrderService service;

    public OrderController(OrderService service) {
        this.service = service;
    }

    public String get() {
        return service.find()${extra};
    }
}
`;

describe('hexagonal tespiti', () => {
  it('düz Spring MVC repo (+ Java dışı adapters/ports klasörü, tek adapter paketi) → mimari ihlal yok', async () => {
    const cs = createMemoryChangeSet({
      old: { [`${M}/web/OrderController.java`]: CONTROLLER('') },
      new: { [`${M}/web/OrderController.java`]: CONTROLLER('.trim()') },
      extraNewFiles: {
        [`${M}/service/OrderService.java`]: 'package com.acme.service;\n\nimport org.springframework.stereotype.Service;\n\n@Service\npublic class OrderService {\n    public String find() { return "x"; }\n}\n',
        [`${M}/legacy/adapter/CsvAdapter.java`]: 'package com.acme.legacy.adapter;\n\npublic class CsvAdapter {}\n',
        'frontend/src/adapters/http.ts': 'export {};\n',
        'frontend/src/ports/api.ts': 'export {};\n',
      },
    });
    const model = await buildReview(cs);
    expect(model.findings.filter((f) => f.category === 'architecture' && f.severity !== 'info')).toEqual([]);
    expect(model.files.find((f) => f.path.endsWith('OrderController.java'))?.layer).toBe('controller');
  });

  const FIXTURE = join(process.cwd(), 'fixtures', 'sample-repo');
  it.skipIf(!existsSync(join(FIXTURE, 'src')))('fikstür (hexagonal Maven projesi) hexagonal kalır', async () => {
    const { readdirSync, statSync } = await import('node:fs');
    const paths: string[] = [];
    const walk = (dir: string, rel: string): void => {
      for (const n of readdirSync(dir)) {
        if (n === '.git') continue;
        const full = join(dir, n);
        const r = rel ? `${rel}/${n}` : n;
        if (statSync(full).isDirectory()) walk(full, r);
        else paths.push(r);
      }
    };
    walk(FIXTURE, '');
    expect(isHexagonalRepo(paths)).toBe(true);
  });
});
