import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { demoMenu } from '../data/menu.demo';
import type { Menu, OrderLine } from '../types';
import { deliveryDateFor, fromISO, toISO } from './cycle';
import { priceOrder } from './pricing';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---- Sandbox: roda o Code.gs real com mocks mínimos dos serviços do Google ----

class FakeSheet {
  cells = new Map<string, unknown>();
  formulas: string[] = [];
  value(r: number, c: number) {
    return this.cells.get(`${r},${c}`) ?? '';
  }
  rowValues(r: number, cols = 12) {
    return Array.from({ length: cols }, (_, i) => this.value(r, i + 1));
  }
  // Qualquer método de formatação/estilo do Google vira um no-op encadeável.
  asProxy(): any {
    const self = this;
    const chain: any = new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === 'getMaxRows') return () => 1000;
        if (prop === 'getSheetId') return () => 123;
        if (prop === 'getLastRow') return () => Math.max(3, ...[...self.cells.keys()].map((k) => +k.split(',')[0]));
        if (prop === 'getRange')
          return (r: unknown, c?: number, nr = 1, nc = 1) => {
            if (typeof r === 'number') return self.range(r, c!, nr, nc);
            // "B1", "N1:O3": o resumo/entrada de uma célula única precisa de valor real
            const m = typeof r === 'string' ? /^([A-Z])(\d+)$/.exec(r) : null;
            return m ? self.range(+m[2], m[1].charCodeAt(0) - 64, 1, 1) : chain;
          };
        if (prop === 'insertRowsAfter') return () => chain;
        return () => chain;
      },
    });
    return chain;
  }
  range(r: number, c: number, nr: number, nc: number): any {
    const self = this;
    const rng: any = new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === 'getValues')
          return () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => self.value(r + i, c + j)));
        if (prop === 'setValues')
          return (vals: unknown[][]) => {
            vals.forEach((row, i) => row.forEach((v, j) => self.cells.set(`${r + i},${c + j}`, v)));
            return rng;
          };
        if (prop === 'getValue' || prop === 'getDisplayValue') return () => self.value(r, c);
        if (prop === 'setValue')
          return (v: unknown) => {
            self.cells.set(`${r},${c}`, v);
            return rng;
          };
        if (prop === 'clearContent')
          return () => {
            for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) self.cells.delete(`${r + i},${c + j}`);
            return rng;
          };
        return () => rng;
      },
    });
    return rng;
  }
}

/** Builder encadeável do Google (newDataValidation().x().y().build()). */
function builder(): any {
  const b: any = new Proxy(function () {}, { get: (_t, p) => (p === 'build' ? () => ({}) : () => b) });
  return b;
}

function table(rows: unknown[][]) {
  return {
    getLastRow: () => rows.length,
    getDataRange: () => ({ getValues: () => rows }),
  };
}

function loadBackend(opts: { today?: string; tables?: Record<string, unknown[][]>; captchaOk?: (token: string) => boolean } = {}) {
  const store = new Map<string, string>();
  const props = new Map<string, string>();
  const weekSheets = new Map<string, FakeSheet>();
  const emails: Array<{ to: string; subject: string; body: string }> = [];
  const tables = opts.tables ?? {};
  const sandbox: any = {
    console,
    MailApp: { sendEmail: (m: { to: string; subject: string; body: string }) => void emails.push(m) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'dono@exemplo.com' }) },
    UrlFetchApp: {
      fetch: (_url: string, o: { payload: { response: string } }) => ({
        getContentText: () => JSON.stringify({ success: (opts.captchaOk ?? (() => true))(o.payload.response) }),
      }),
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text: string) => ({ getContent: () => text, setMimeType() { return this; } }),
    },
    Utilities: { formatDate: () => opts.today ?? '2025-06-04' },
    CacheService: {
      getScriptCache: () => ({
        get: (k: string) => store.get(k) ?? null,
        put: (k: string, v: string) => void store.set(k, v),
        remove: (k: string) => void store.delete(k),
      }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => props.get(k) ?? null,
        setProperty: (k: string, v: string) => void props.set(k, v),
      }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    SpreadsheetApp: {
      WrapStrategy: { WRAP: 'WRAP' },
      getActive: () => ({
        getUrl: () => 'https://docs.google.com/spreadsheets/d/XYZ/edit',
        getSheets: () => [...weekSheets.values()],
        getSheetByName: (name: string) => {
          if (tables[name]) return table(tables[name]);
          return weekSheets.get(name)?.asProxy() ?? null;
        },
        insertSheet: (name: string) => {
          const s = new FakeSheet();
          weekSheets.set(name, s);
          return s.asProxy();
        },
      }),
      newDataValidation: () => builder(),
      newConditionalFormatRule: () => builder(),
    },
  };
  createContext(sandbox);
  runInContext(readFileSync(join(process.cwd(), 'apps-script', 'Code.gs'), 'utf8'), sandbox);
  return { gs: sandbox, weekSheets, store, props, emails };
}

const roundtrip = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('Code.gs: independente do idioma da planilha', () => {
  it('não usa fórmulas (setFormula/setFormulas): elas mudam de sintaxe conforme o idioma e deram erro em planilha pt-BR', () => {
    const codigo = readFileSync(join(process.cwd(), 'apps-script', 'Code.gs'), 'utf8')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
      .join('\n');
    expect(codigo).not.toMatch(/setFormula|setFormulas|setFormulaR1C1|QUERY\(|SUMIFS?\(/);
  });
});

// ---- Testes ----

describe('Code.gs: ciclo semanal igual ao do site', () => {
  const { gs } = loadBackend();
  it('mesma data de entrega para 60 dias seguidos', () => {
    for (let i = 0; i < 60; i++) {
      const d = new Date(Date.UTC(2025, 11, 20 + i));
      const iso = d.toISOString().slice(0, 10);
      expect(gs.deliveryDate_(iso)).toBe(toISO(deliveryDateFor(fromISO(iso))));
    }
  });
});

describe('Code.gs: preço igual ao do site', () => {
  const { gs } = loadBackend();
  const sete = {
    'carne-de-panela': 2, 'strogonoff-de-frango': 1, 'feijoada-leve': 1, 'costela-desfiada': 1,
    'frango-grelhado': 1, 'isca-de-carne-acebolada': 2, 'lasanha-a-bolonhesa': 2,
  };
  const cenarios: Array<{ nome: string; linhas: OrderLine[] }> = [
    { nome: 'kit 5 simples', linhas: [{ tipo: 'kit', uid: '1', kitId: 'kit-5', pratos: { 'carne-de-panela': 5 } }] },
    {
      nome: 'kit 5 com Especiais',
      linhas: [{ tipo: 'kit', uid: '1', kitId: 'kit-5', pratos: { 'carne-de-panela': 3, 'lasanha-a-bolonhesa': 2 } }],
    },
    {
      nome: 'kit 10 com sobremesa',
      linhas: [{ tipo: 'kit', uid: '1', kitId: 'kit-10', pratos: sete, sobremesaId: 'bolo-de-pote-exemplo-1' }],
    },
    {
      nome: 'avulsas e sobremesa',
      linhas: [
        { tipo: 'prato', uid: '1', pratoId: 'carne-de-panela', qtd: 2 },
        { tipo: 'prato', uid: '2', pratoId: 'lasanha-a-bolonhesa', qtd: 1 },
        { tipo: 'sobremesa', uid: '3', sobremesaId: 'bolo-de-pote-exemplo-2', qtd: 3 },
      ],
    },
  ];

  for (const modo of ['entrega', 'retirada'] as const) {
    for (const c of cenarios) {
      it(`${c.nome} (${modo})`, () => {
        const menu: Menu = { ...demoMenu, loja: { ...demoMenu.loja, taxaEntregaCent: 700 } };
        const ts = priceOrder(menu, c.linhas, modo);
        const server = roundtrip(gs.priceOrder_(roundtrip(menu), roundtrip(c.linhas), modo));
        expect(server.totalCent).toBe(ts.totalCent);
        expect(server.subtotalCent).toBe(ts.subtotalCent);
        expect(server.taxaCent).toBe(ts.taxaCent);
        expect(server.lines.map((l: any) => [l.titulo, l.detalhes, l.totalCent])).toEqual(
          ts.lines.map((l) => [l.titulo, l.detalhes, l.totalCent]),
        );
      });
    }
  }

  it('recusa os mesmos pedidos inválidos', () => {
    const ruins: OrderLine[][] = [
      [{ tipo: 'kit', uid: '1', kitId: 'kit-5', pratos: { 'carne-de-panela': 4 } }],
      [{ tipo: 'kit', uid: '1', kitId: 'kit-10', pratos: sete }],
      [{ tipo: 'prato', uid: '1', pratoId: 'carne-de-panela', qtd: 0 }],
      [{ tipo: 'prato', uid: '1', pratoId: 'nao-existe', qtd: 1 }],
      [],
    ];
    for (const linhas of ruins) {
      expect(() => priceOrder(demoMenu, linhas, 'entrega')).toThrow();
      expect(() => gs.priceOrder_(roundtrip(demoMenu), roundtrip(linhas), 'entrega')).toThrow();
    }
  });
});

describe('Code.gs: leitura do cardápio da planilha', () => {
  it('converte as abas em cardápio com valores em centavos', () => {
    const { gs } = loadBackend({
      tables: {
        Config: [
          ['Chave', 'Valor', 'Descrição'],
          ['nome_loja', 'Sabor de Cuidado', ''],
          ['whatsapp', '(21) 97918-3105', ''],
          ['pix_chave', 'loja@exemplo.com', ''],
          ['preco_avulsa', '27,90', ''],
          ['taxa_entrega', 8, ''],
          ['retirada', 'NÃO', ''],
          ['pedidos_abertos', true, ''],
        ],
        'Cardápio': [
          ['Categoria', 'Nome', 'Descrição', 'Adicional', 'Foto', 'Ativo'],
          ['Tradicionais', 'Carne de panela', 'mandioquinha', 0, '', 'SIM'],
          ['Especiais', 'Lasanha à bolonhesa', 'molho', 5, 'lasanha.jpg', 'SIM'],
          ['Especiais', 'Prato escondido', '', 5, '', 'NÃO'],
          ['', '', '', '', '', ''],
        ],
        Kits: [
          ['Nome', 'Marmitas', 'Preço', 'Máx. pratos', 'Sobremesas grátis', 'Destaque', 'Ativo'],
          ['Despensa Cheia', 10, 239.9, 7, 1, 'MELHOR PREÇO', 'SIM'],
          ['Experimente', 5, '129,90', 9, 0, '', 'SIM'],
        ],
        'Sobremesas': [['Nome', 'Descrição', 'Preço', 'Foto', 'Ativo'], ['Brigadeiro', 'x', 12, '', 'NÃO']],
      },
    });
    const menu = roundtrip(gs.getMenu_());
    expect(menu.precoAvulsaCent).toBe(2790);
    expect(menu.loja).toMatchObject({ whatsapp: '5521979183105', taxaEntregaCent: 800, retirada: false, pedidosAbertos: true });
    expect(menu.pratos.map((p: any) => [p.id, p.adicionalCent, p.foto])).toEqual([
      ['carne-de-panela', 0, undefined],
      ['lasanha-a-bolonhesa', 500, 'lasanha.jpg'],
    ]);
    // ordenados por tamanho; máx. de pratos nunca passa do tamanho do kit
    expect(menu.kits.map((k: any) => [k.id, k.precoCent, k.maxPratos, k.sobremesasGratis])).toEqual([
      ['kit-5', 12990, 5, 0],
      ['kit-10', 23990, 7, 1],
    ]);
    expect(menu.sobremesas).toEqual([]);
  });
});

describe('Code.gs: atualização do cardápio', () => {
  const config = (preco: number) => [['Chave', 'Valor', ''], ['preco_avulsa', preco, '']];

  it('usa cache, e o gatilho de alteração faz a mudança aparecer na hora', () => {
    const tables: Record<string, unknown[][]> = { Config: config(27.9) };
    const { gs } = loadBackend({ tables });

    expect(roundtrip(gs.getMenu_()).precoAvulsaCent).toBe(2790);

    tables.Config = config(29.9); // dona edita o preço na planilha
    expect(roundtrip(gs.getMenu_()).precoAvulsaCent).toBe(2790); // ainda no cache

    gs.limparCacheDoCardapio(); // gatilho onChange da planilha
    expect(roundtrip(gs.getMenu_()).precoAvulsaCent).toBe(2990);
  });
});

describe('Code.gs: gravação do pedido', () => {
  const tables = {
    Config: [
      ['Chave', 'Valor', 'Descrição'],
      ['pix_chave', 'loja@exemplo.com', ''],
      ['preco_avulsa', 27.9, ''],
      ['taxa_entrega', 0, ''],
    ],
    'Cardápio': [
      ['Categoria', 'Nome', 'Descrição', 'Adicional', 'Foto', 'Ativo'],
      ['Tradicionais', 'Carne de panela', '', 0, '', 'SIM'],
      ['Especiais', 'Lasanha', '', 5, '', 'SIM'],
    ],
    Kits: [['Nome', 'Marmitas', 'Preço', 'Máx. pratos', 'Sobremesas grátis', 'Destaque', 'Ativo'], ['Experimente', 5, 129.9, 5, 0, '', 'SIM']],
    'Sobremesas': [['Nome', 'Descrição', 'Preço', 'Foto', 'Ativo']],
  };

  const base = (over: Record<string, unknown> = {}) => ({
    action: 'order',
    requestId: 'req-' + Math.random().toString(36).slice(2, 12),
    nome: 'Maria',
    whatsapp: '21999998888',
    modo: 'entrega',
    endereco: { rua: 'Rua A, 10', bairro: 'Centro', complemento: '', cep: '' },
    obs: '=HYPERLINK("http://x")',
    website: '',
    tempoMs: 8000,
    origem: 'instagram',
    linhas: [{ tipo: 'kit', uid: 'u', kitId: 'kit-5', pratos: { 'carne-de-panela': 3, lasanha: 2 } }],
    ...over,
  });

  it('cria a aba da semana, grava a linha e calcula o total no servidor', () => {
    const { gs, weekSheets } = loadBackend({ tables });
    const r1 = roundtrip(gs.createOrder_(base()));
    expect(r1).toMatchObject({ totalCent: 12990 + 1000, entregaISO: '2025-06-09' });
    // código aleatório: não revela a contagem de pedidos da loja
    expect(r1.id).toMatch(/^SC-[A-HJKMNP-Z2-9]{6}$/);
    expect(r1).not.toHaveProperty('numero');

    const sheet = weekSheets.get('Entrega 2025-06-09')!;
    expect(sheet).toBeDefined();
    const row = sheet.rowValues(2);
    expect(row[0]).toBe(r1.id);
    expect(row[2]).toBe('Maria');
    expect(row[7]).toBeCloseTo(139.9);
    expect(row[8]).toBe('Aguardando comprovante');
    expect(row[6]).toContain('Experimente (5 marmitas)');
    // texto do cliente vai como texto puro (a coluna é formatada como texto), sem virar fórmula
    expect(row[9]).toBe('=HYPERLINK("http://x")');

    const r2 = roundtrip(gs.createOrder_(base()));
    expect(r2.id).not.toBe(r1.id);
    expect(r2.id).toMatch(/^SC-[A-HJKMNP-Z2-9]{6}$/);
    expect(sheet.rowValues(3)[0]).toBe(r2.id);
  });

  it('é idempotente por requestId', () => {
    const { gs, weekSheets } = loadBackend({ tables });
    const body = base();
    const a = roundtrip(gs.createOrder_(body));
    const b = roundtrip(gs.createOrder_(body));
    expect(b).toEqual(a);
    expect(weekSheets.get('Entrega 2025-06-09')!.rowValues(3)[0]).toBe('');
  });

  it('pedido na quinta vai para a aba da segunda seguinte à próxima quarta', () => {
    const { gs, weekSheets } = loadBackend({ tables, today: '2025-06-05' });
    expect(roundtrip(gs.createOrder_(base())).entregaISO).toBe('2025-06-16');
    expect(weekSheets.has('Entrega 2025-06-16')).toBe(true);
  });

  it('rejeita robô, kit adulterado e dados inválidos', () => {
    const { gs } = loadBackend({ tables });
    const falha = (b: object) => {
      try {
        gs.createOrder_(b);
      } catch (e: any) {
        return e.user as string;
      }
      return null;
    };
    expect(falha(base({ website: 'http://spam' }))).toBeTruthy();
    expect(falha(base({ linhas: [{ tipo: 'kit', kitId: 'kit-5', pratos: { 'carne-de-panela': 1 } }] }))).toMatch(/Faltam 4/);
    expect(falha(base({ whatsapp: '123' }))).toMatch(/WhatsApp/);
    expect(falha(base({ nome: ' ' }))).toMatch(/nome/);
    expect(falha(base({ requestId: 'x' }))).toBeTruthy();
    expect(falha(base({ modo: 'drone' }))).toBeTruthy();
    expect(falha(base({ endereco: { rua: '', bairro: '' } }))).toMatch(/rua/i);
  });

  it('consulta a situação do pedido, sem expor dados do cliente', () => {
    const { gs, weekSheets } = loadBackend({ tables });
    const { id, entregaISO } = roundtrip(gs.createOrder_(base()));
    const consulta = (i: string, d: string) =>
      JSON.parse(gs.doGet({ parameter: { action: 'status', id: i, entrega: d } }).getContent());

    expect(consulta(id, entregaISO)).toEqual({ ok: true, status: 'Aguardando comprovante' });
    expect(consulta('SC-ZZZZZZ', entregaISO)).toEqual({ ok: true, status: 'nao_encontrado' });
    expect(consulta(id, '2030-01-01')).toEqual({ ok: true, status: 'nao_encontrado' }); // aba inexistente
    expect(consulta('x; DROP', entregaISO).ok).toBe(false);
    expect(consulta(id, 'ontem').ok).toBe(false);

    // quando a dona marca como Pago ou apaga a linha, a consulta reflete
    const sheet = weekSheets.get(`Entrega ${entregaISO}`)!;
    sheet.cells.set('2,9', 'Pago');
    expect(consulta(id, entregaISO).status).toBe('Pago');
    sheet.cells.delete('2,1');
    expect(consulta(id, entregaISO).status).toBe('nao_encontrado');

    const bruto = gs.doGet({ parameter: { action: 'status', id, entrega: entregaISO } }).getContent();
    expect(bruto).not.toMatch(/Maria|21999998888|Rua A/);
  });

  const falhou = (fn: () => unknown) => {
    try {
      fn();
    } catch (e: any) {
      return String(e.user ?? e.message ?? e);
    }
    return null;
  };

  it('exige tempo mínimo de preenchimento (robôs enviam na hora)', () => {
    const { gs } = loadBackend({ tables });
    expect(falhou(() => gs.createOrder_(base({ tempoMs: 100 })))).toMatch(/rápido demais/);
    expect(falhou(() => gs.createOrder_(base({ tempoMs: undefined })))).toMatch(/rápido demais/);
    expect(falhou(() => gs.createOrder_(base({ tempoMs: 'muito' })))).toMatch(/rápido demais/);
    expect(falhou(() => gs.createOrder_(base({ tempoMs: 2000 })))).toBeNull();
  });

  it('Turnstile: só é exigido quando o segredo está configurado', () => {
    const { gs, props } = loadBackend({ tables, captchaOk: (t) => t === 'token-bom' });
    expect(falhou(() => gs.createOrder_(base()))).toBeNull(); // sem segredo: não exige

    props.set('TURNSTILE_SECRET', 'segredo');
    expect(falhou(() => gs.createOrder_(base()))).toMatch(/verificação/);
    expect(falhou(() => gs.createOrder_(base({ captcha: 'token-ruim' })))).toMatch(/verificação/);
    expect(falhou(() => gs.createOrder_(base({ captcha: 'token-bom' })))).toBeNull();
  });

  it('reenvio do mesmo pedido não exige novo token (que só vale uma vez)', () => {
    const { gs, props } = loadBackend({ tables, captchaOk: (t) => t === 'token-bom' });
    props.set('TURNSTILE_SECRET', 'segredo');
    const body = base({ captcha: 'token-bom' });
    const a = roundtrip(gs.createOrder_(body));
    const b = roundtrip(gs.createOrder_({ ...body, captcha: undefined, tempoMs: 0 }));
    expect(b).toEqual(a);
  });

  it('trava de segurança: no máximo 20 pedidos da loja inteira em 10 minutos', () => {
    const { gs } = loadBackend({ tables });
    for (let i = 0; i < 20; i++) gs.createOrder_(base({ whatsapp: `2199999${1000 + i}` }));
    expect(falhou(() => gs.createOrder_(base({ whatsapp: '21988887777' })))).toMatch(/muitos pedidos/i);
  });

  it('avisa a dona por e-mail a cada pedido, sem expor erro se o e-mail falhar', () => {
    const { gs, emails } = loadBackend({ tables });
    const r = roundtrip(gs.createOrder_(base()));
    expect(emails).toHaveLength(1);
    expect(emails[0].to).toBe('dono@exemplo.com'); // padrão: dono da planilha
    expect(emails[0].subject).toContain(r.id);
    expect(emails[0].body).toContain('Maria');
    expect(emails[0].body).toContain('Experimente (5 marmitas)');
    expect(emails[0].body).toContain('(21) 99999-8888');
    expect(emails[0].body).toContain('R$ 139,90');

    gs.MailApp.sendEmail = () => {
      throw new Error('cota de e-mail esgotada');
    };
    expect(falhou(() => gs.createOrder_(base()))).toBeNull(); // pedido grava mesmo assim
  });

  it('usa os e-mails da aba Config (vários, só válidos)', () => {
    const cfg = [...tables.Config, ['email_pedidos', 'adriana@exemplo.com; invalido, outra@exemplo.com', '']];
    const { gs, emails } = loadBackend({ tables: { ...tables, Config: cfg } });
    gs.createOrder_(base());
    expect(emails[0].to).toBe('adriana@exemplo.com,outra@exemplo.com');
  });

  it('aba Produção soma pratos da semana, separa pagos de aguardando e ignora cancelados', () => {
    const { gs, weekSheets } = loadBackend({ tables });
    gs.createOrder_(base()); // kit 5: 3 carne + 2 lasanha (linha 2)
    gs.createOrder_(base({ whatsapp: '21977776666', linhas: [{ tipo: 'prato', uid: 'x', pratoId: 'lasanha', qtd: 2 }] })); // linha 3
    const week = weekSheets.get('Entrega 2025-06-09')!;
    week.cells.set('2,9', 'Pago');
    gs.atualizarProducao();

    const prod = weekSheets.get('Produção')!;
    const linha = (r: number) => [1, 2, 3, 4].map((c) => prod.value(r, c));
    expect(prod.value(1, 2)).toBe('2025-06-09');
    expect(prod.value(2, 2)).toBe('2 pedidos (1 pagos, 1 aguardando)');
    expect(linha(4)).toEqual(['Marmitas por prato', 'Pagos', 'Aguardando', 'Total']);
    expect(linha(5)).toEqual(['Carne de panela', 3, 0, 3]);
    expect(linha(6)).toEqual(['Lasanha', 2, 2, 4]);
    expect(linha(7)).toEqual(['TOTAL DE MARMITAS', 5, 2, 7]);

    // cancelar a segunda tira os 2 da lasanha; o gatilho de alteração recalcula
    week.cells.set('3,9', 'Cancelado');
    gs.limparCacheDoCardapio();
    expect(linha(6)).toEqual(['Lasanha', 2, 0, 2]);
    expect(prod.value(2, 2)).toBe('1 pedidos (1 pagos, 0 aguardando)');

    // outra data digitada em B1
    prod.cells.set('1,2', '2030-01-07');
    gs.atualizarProducao();
    expect(prod.value(2, 2)).toContain('nenhuma aba para esta data');
    expect(linha(5)).toEqual(['TOTAL DE MARMITAS', 0, 0, 0]); // semana sem pratos: só o total
    expect(linha(6)).toEqual(['', '', '', '']);
  });

  it('conta visitas por dia, origem e evento, sem aceitar lixo', () => {
    const { gs, weekSheets } = loadBackend({ tables });
    const evento = (e: unknown) => gs.doPost({ postData: { contents: JSON.stringify({ action: 'evento', ...(e as object) }) } });
    expect(JSON.parse(evento({ evento: 'visita', origem: 'Instagram' }).getContent())).toEqual({ ok: true });
    evento({ evento: 'visita', origem: 'instagram' });
    evento({ evento: 'sacola', origem: 'instagram' });
    evento({ evento: 'visita', origem: '' });
    evento({ evento: 'hackear', origem: 'x' }); // evento fora da lista: ignorado
    evento({ evento: 'visita', origem: '<script>alert(1)</script>' });

    const dados = weekSheets.get('Visitas (dados)')!;
    const rows = [2, 3, 4, 5].map((r) => [1, 2, 3, 4].map((c) => dados.value(r, c)));
    expect(rows[0]).toEqual(['2025-06-04', 'instagram', 'visita', 2]);
    expect(rows[1]).toEqual(['2025-06-04', 'instagram', 'sacola', 1]);
    expect(rows[2]).toEqual(['2025-06-04', 'direto', 'visita', 1]);
    expect(String(rows[3][1])).toMatch(/^[a-z0-9.-]+$/); // origem sanitizada
    expect(dados.value(6, 1)).toBe('');
    expect(weekSheets.has('Estatísticas')).toBe(true);

    // o pedido também entra no funil, com a origem enviada pelo site
    gs.createOrder_(base());
    expect([1, 2, 3, 4].map((c) => dados.value(6, c))).toEqual(['2025-06-04', 'instagram', 'pedido', 1]);
  });

  it('aba Estatísticas traz os números prontos (sem fórmulas) e a origem dos últimos 7 dias', () => {
    const { gs, weekSheets } = loadBackend({ tables });
    const evento = (e: object) => gs.doPost({ postData: { contents: JSON.stringify({ action: 'evento', ...e }) } });
    for (let i = 0; i < 3; i++) evento({ evento: 'visita', origem: 'instagram' });
    evento({ evento: 'visita', origem: '' });
    evento({ evento: 'sacola', origem: 'instagram' });
    evento({ evento: 'sacola', origem: 'direto' });
    evento({ evento: 'checkout', origem: 'instagram' });
    gs.createOrder_(base()); // conta como "pedido" (origem instagram)

    const st = weekSheets.get('Estatísticas')!;
    const linha = (r: number, cols = 6) => Array.from({ length: cols }, (_, i) => st.value(r, i + 1));
    expect(linha(1)).toEqual(['Dia', 'Visitas', 'Montaram sacola', 'Chegaram ao checkout', 'Pedidos', 'Pedidos / visitas']);
    expect(linha(2)).toEqual(['2025-06-04', 4, 2, 1, 1, 0.25]);
    expect(linha(3)).toEqual(['2025-06-03', 0, 0, 0, 0, '']);
    expect(linha(15)[0]).toBe('2025-05-22'); // 14 dias, do mais recente ao mais antigo
    expect(linha(18, 2)).toEqual(['Origem', 'Visitas']);
    expect(linha(19, 2)).toEqual(['instagram', 3]);
    expect(linha(20, 2)).toEqual(['direto', 1]);
  });

  it('resumo da semana (pedidos, total, recebido) acompanha os status, sem fórmulas', () => {
    const { gs, weekSheets } = loadBackend({ tables });
    gs.createOrder_(base()); // 139,90
    gs.createOrder_(base({ whatsapp: '21977776666', linhas: [{ tipo: 'prato', uid: 'x', pratoId: 'lasanha', qtd: 2 }] })); // 65,80
    const week = weekSheets.get('Entrega 2025-06-09')!;
    const resumo = () => [1, 2, 3].map((r) => [week.value(r, 14), week.value(r, 15)]);

    expect(resumo()).toEqual([['Pedidos', 2], ['Total (sem cancelados)', 205.7], ['Recebido (Pago + Entregue)', 0]]);

    week.cells.set('2,9', 'Pago');
    week.cells.set('3,9', 'Cancelado');
    gs.limparCacheDoCardapio(); // gatilho de alteração
    expect(resumo()).toEqual([['Pedidos', 2], ['Total (sem cancelados)', 139.9], ['Recebido (Pago + Entregue)', 139.9]]);
  });

  it('limita 5 pedidos por telefone em 10 minutos', () => {
    const { gs } = loadBackend({ tables });
    for (let i = 0; i < 5; i++) gs.createOrder_(base());
    expect(() => gs.createOrder_(base())).toThrow();
  });

  it('bloqueia pedido sem Pix configurado ou com loja fechada', () => {
    const semPix = loadBackend({ tables: { ...tables, Config: [['Chave', 'Valor', ''], ['preco_avulsa', 27.9, '']] } });
    expect(() => semPix.gs.createOrder_(base())).toThrow();
    const fechada = loadBackend({ tables: { ...tables, Config: [...tables.Config, ['pedidos_abertos', 'NÃO', '']] } });
    expect(() => fechada.gs.createOrder_(base())).toThrow();
  });
});
