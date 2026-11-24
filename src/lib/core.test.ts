import { describe, expect, it } from 'vitest';
import { demoMenu } from '../data/menu.demo';
import { brl } from './money';
import { crc16, buildPix } from './pix';
import { addDays, deliveryDateFor, toISO, cutoffDateFor } from './cycle';
import { kitProblem, priceLine, priceOrder, PricingError } from './pricing';
import type { OrderLine } from '../types';

describe('brl', () => {
  it('formata centavos', () => {
    expect(brl(2790)).toBe('R$ 27,90');
    expect(brl(500)).toBe('R$ 5,00');
    expect(brl(5)).toBe('R$ 0,05');
    expect(brl(123456)).toBe('R$ 1.234,56');
  });
});

describe('pix', () => {
  it('CRC16 de referência', () => {
    expect(crc16('123456789')).toBe('29B1');
  });

  it('CRC16 do exemplo do manual do BCB', () => {
    const base =
      '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304';
    expect(crc16(base)).toBe('1D3D');
  });

  it('monta o código com valor, nome sem acento e CRC válido', () => {
    const code = buildPix({
      chave: 'loja@exemplo.com',
      nome: 'Sabor de Cuidado',
      cidade: 'São Paulo',
      valorCent: 17490,
      txid: 'SC2506090012',
    });
    expect(code).toContain('5406174.90');
    expect(code).toContain('5916SABOR DE CUIDADO');
    expect(code).toContain('6009SAO PAULO');
    expect(code).toContain('0512SC2506090012');
    const body = code.slice(0, -4);
    expect(code.slice(-4)).toBe(crc16(body));
    expect(body.endsWith('6304')).toBe(true);
  });

  it('recusa valor inválido e chave vazia', () => {
    expect(() => buildPix({ chave: '', nome: 'A', cidade: 'B', valorCent: 100, txid: 'X' })).toThrow();
    expect(() => buildPix({ chave: 'a', nome: 'A', cidade: 'B', valorCent: 0, txid: 'X' })).toThrow();
  });
});

describe('ciclo semanal', () => {
  const delivery = (y: number, m: number, d: number) => toISO(deliveryDateFor({ y, m, d }));

  it('segunda a quarta entregam na segunda seguinte à quarta', () => {
    // 2025-06-02 é segunda; quarta do ciclo = 04/06; entrega = 09/06
    expect(delivery(2025, 6, 2)).toBe('2025-06-09');
    expect(delivery(2025, 6, 3)).toBe('2025-06-09');
    expect(delivery(2025, 6, 4)).toBe('2025-06-09');
  });

  it('quinta a domingo caem no ciclo seguinte', () => {
    expect(delivery(2025, 6, 5)).toBe('2025-06-16');
    expect(delivery(2025, 6, 6)).toBe('2025-06-16');
    expect(delivery(2025, 6, 7)).toBe('2025-06-16');
    expect(delivery(2025, 6, 8)).toBe('2025-06-16');
  });

  it('virada de ano e quarta de fechamento', () => {
    expect(delivery(2025, 12, 31)).toBe('2026-01-05');
    expect(toISO(cutoffDateFor({ y: 2025, m: 6, d: 9 }))).toBe('2025-06-04');
    expect(toISO(addDays({ y: 2024, m: 2, d: 28 }, 2))).toBe('2024-03-01');
  });
});

describe('preços', () => {
  const kit = (id: string, pratos: Record<string, number>, sobremesaId?: string): OrderLine => ({
    tipo: 'kit',
    uid: 'u',
    kitId: id,
    pratos,
    sobremesaId,
  });

  it('kits batem com o folder', () => {
    const k5 = priceLine(demoMenu, kit('kit-5', { 'carne-de-panela': 5 }));
    expect(k5.totalCent).toBe(12990);
    const k7 = priceLine(demoMenu, kit('kit-7', { 'carne-de-panela': 4, 'feijoada-leve': 3 }));
    expect(k7.totalCent).toBe(17490);
  });

  it('prato Especial soma R$ 5 por unidade dentro do kit', () => {
    const k = priceLine(demoMenu, kit('kit-5', { 'carne-de-panela': 3, 'lasanha-a-bolonhesa': 2 }));
    expect(k.totalCent).toBe(12990 + 2 * 500);
  });

  it('kit de 10 exige sobremesa e no máximo 7 pratos diferentes', () => {
    const sete = {
      'carne-de-panela': 2, 'strogonoff-de-frango': 1, 'feijoada-leve': 1, 'costela-desfiada': 1,
      'frango-grelhado': 1, 'isca-de-carne-acebolada': 2, 'lasanha-a-bolonhesa': 2,
    };
    expect(priceLine(demoMenu, kit('kit-10', sete, 'bolo-de-pote-exemplo-1')).totalCent).toBe(23990 + 1000);
    expect(() => priceLine(demoMenu, kit('kit-10', sete))).toThrow(PricingError);
    const oito = { ...sete, 'carne-de-panela': 1, 'fricasse-de-frango': 1 };
    expect(kitProblem(demoMenu, demoMenu.kits[2], oito, 'bolo-de-pote-exemplo-1')).toMatch(/no máximo 7/);
  });

  it('rejeita kit incompleto ou excedente', () => {
    expect(kitProblem(demoMenu, demoMenu.kits[0], { 'carne-de-panela': 4 })).toMatch(/Falta 1 marmita\./);
    expect(kitProblem(demoMenu, demoMenu.kits[0], { 'carne-de-panela': 6 })).toMatch(/5 marmitas/);
    expect(kitProblem(demoMenu, demoMenu.kits[0], { inexistente: 5 })).toMatch(/disponível/);
  });

  it('avulsa: R$ 27,90, Especial R$ 32,90, taxa só na entrega', () => {
    const lines: OrderLine[] = [
      { tipo: 'prato', uid: 'a', pratoId: 'carne-de-panela', qtd: 2 },
      { tipo: 'prato', uid: 'b', pratoId: 'lasanha-a-bolonhesa', qtd: 1 },
    ];
    const menu = { ...demoMenu, loja: { ...demoMenu.loja, taxaEntregaCent: 800 } };
    expect(priceOrder(menu, lines, 'retirada').totalCent).toBe(2 * 2790 + 3290);
    expect(priceOrder(menu, lines, 'entrega').totalCent).toBe(2 * 2790 + 3290 + 800);
  });

  it('sacola vazia e quantidades inválidas dão erro', () => {
    expect(() => priceOrder(demoMenu, [], 'entrega')).toThrow(PricingError);
    expect(() => priceLine(demoMenu, { tipo: 'prato', uid: 'a', pratoId: 'carne-de-panela', qtd: 0 })).toThrow();
    expect(() => priceLine(demoMenu, { tipo: 'prato', uid: 'a', pratoId: 'carne-de-panela', qtd: 1.5 })).toThrow();
  });
});
