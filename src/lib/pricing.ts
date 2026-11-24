import type { DeliveryMode, Dish, Kit, Menu, OrderLine, PricedLine, PricedOrder } from '../types';
import { brl } from './money';

// IMPORTANTE: a mesma regra existe em apps-script/Code.gs (priceLine_). O teste
// src/lib/parity.test.ts garante que as duas versões calculem igual.

export class PricingError extends Error {}

export const MAX_QTD = 50;

export function sumQty(pratos: Record<string, number>): number {
  return Object.values(pratos).reduce((a, b) => a + b, 0);
}

export function distinctCount(pratos: Record<string, number>): number {
  return Object.values(pratos).filter((q) => q > 0).length;
}

export function kitExtraCent(menu: Menu, pratos: Record<string, number>): number {
  let extra = 0;
  for (const dish of menu.pratos) {
    const q = pratos[dish.id] ?? 0;
    if (q > 0) extra += dish.adicionalCent * q;
  }
  return extra;
}

export function dishPriceCent(menu: Menu, dish: Dish): number {
  return menu.precoAvulsaCent + dish.adicionalCent;
}

/** Mensagem do que falta para fechar o kit, ou null se o kit está válido. */
export function kitProblem(menu: Menu, kit: Kit, pratos: Record<string, number>, sobremesaId?: string): string | null {
  for (const [id, q] of Object.entries(pratos)) {
    if (!Number.isInteger(q) || q < 0 || q > MAX_QTD) return 'Quantidade inválida.';
    if (q > 0 && !menu.pratos.some((d) => d.id === id)) return 'Um dos pratos não está mais disponível.';
  }
  const total = sumQty(pratos);
  if (total < kit.marmitas) {
    const falta = kit.marmitas - total;
    return falta === 1 ? 'Falta 1 marmita.' : `Faltam ${falta} marmitas.`;
  }
  if (total > kit.marmitas) return `O kit tem ${kit.marmitas} marmitas.`;
  if (distinctCount(pratos) > kit.maxPratos) return `Escolha no máximo ${kit.maxPratos} pratos diferentes.`;
  if (kit.sobremesasGratis > 0 && menu.sobremesas.length > 0) {
    if (!sobremesaId) return 'Escolha a sobremesa grátis.';
    if (!menu.sobremesas.some((s) => s.id === sobremesaId)) return 'Sobremesa indisponível.';
  }
  return null;
}

export function priceLine(menu: Menu, line: OrderLine): PricedLine {
  if (line.tipo === 'kit') {
    const kit = menu.kits.find((k) => k.id === line.kitId);
    if (!kit) throw new PricingError('Kit indisponível.');
    const problem = kitProblem(menu, kit, line.pratos, line.sobremesaId);
    if (problem) throw new PricingError(problem);
    const detalhes: string[] = [];
    for (const dish of menu.pratos) {
      const q = line.pratos[dish.id] ?? 0;
      if (q <= 0) continue;
      detalhes.push(`${q}x ${dish.nome}${dish.adicionalCent > 0 ? ` (+${brl(dish.adicionalCent)} cada)` : ''}`);
    }
    if (kit.sobremesasGratis > 0 && line.sobremesaId) {
      const s = menu.sobremesas.find((x) => x.id === line.sobremesaId);
      if (s) detalhes.push(`Sobremesa grátis: ${s.nome}`);
    }
    return {
      line,
      titulo: `${kit.nome} (${kit.marmitas} marmitas)`,
      detalhes,
      totalCent: kit.precoCent + kitExtraCent(menu, line.pratos),
    };
  }

  if (line.tipo === 'prato') {
    const dish = menu.pratos.find((d) => d.id === line.pratoId);
    if (!dish) throw new PricingError('Prato indisponível.');
    if (!Number.isInteger(line.qtd) || line.qtd < 1 || line.qtd > MAX_QTD) throw new PricingError('Quantidade inválida.');
    return {
      line,
      titulo: `${line.qtd}x ${dish.nome} (avulsa)`,
      detalhes: [],
      totalCent: dishPriceCent(menu, dish) * line.qtd,
    };
  }

  const s = menu.sobremesas.find((x) => x.id === line.sobremesaId);
  if (!s) throw new PricingError('Sobremesa indisponível.');
  if (!Number.isInteger(line.qtd) || line.qtd < 1 || line.qtd > MAX_QTD) throw new PricingError('Quantidade inválida.');
  return { line, titulo: `${line.qtd}x ${s.nome}`, detalhes: [], totalCent: s.precoCent * line.qtd };
}

export function priceOrder(menu: Menu, lines: OrderLine[], modo: DeliveryMode): PricedOrder {
  if (lines.length === 0) throw new PricingError('A sacola está vazia.');
  const priced = lines.map((l) => priceLine(menu, l));
  const subtotalCent = priced.reduce((a, l) => a + l.totalCent, 0);
  const taxaCent = modo === 'entrega' ? menu.loja.taxaEntregaCent : 0;
  return { lines: priced, subtotalCent, taxaCent, totalCent: subtotalCent + taxaCent };
}

/** Preço de tabela de um kit se as marmitas fossem avulsas (preço "de"). */
export function kitListPriceCent(menu: Menu, kit: Kit): number {
  return menu.precoAvulsaCent * kit.marmitas;
}

/** Linhas em texto simples, usadas na mensagem do WhatsApp. */
export function orderText(order: PricedOrder): string {
  return order.lines
    .map((l) => [`• ${l.titulo}`, ...l.detalhes.map((d) => `   ${d}`)].join('\n'))
    .join('\n');
}
