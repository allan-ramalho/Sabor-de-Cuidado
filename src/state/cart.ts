import { useEffect, useReducer } from 'react';
import type { Menu, OrderLine } from '../types';
import { priceLine } from '../lib/pricing';
import { KEYS, load, save } from '../lib/storage';

export type CartAction =
  | { type: 'add'; line: OrderLine }
  | { type: 'replace'; line: OrderLine }
  | { type: 'remove'; uid: string }
  | { type: 'setQty'; tipo: 'prato' | 'sobremesa'; id: string; qtd: number }
  | { type: 'clear' }
  | { type: 'prune'; menu: Menu };

let counter = 0;
export function newUid(): string {
  counter += 1;
  return `${Date.now().toString(36)}${counter}`;
}

function refId(l: OrderLine): string {
  return l.tipo === 'prato' ? l.pratoId : l.tipo === 'sobremesa' ? l.sobremesaId : '';
}

function reducer(lines: OrderLine[], action: CartAction): OrderLine[] {
  switch (action.type) {
    case 'add':
      return [...lines, action.line];
    case 'replace':
      return lines.map((l) => (l.uid === action.line.uid ? action.line : l));
    case 'remove':
      return lines.filter((l) => l.uid !== action.uid);
    case 'setQty': {
      const idx = lines.findIndex((l) => l.tipo === action.tipo && refId(l) === action.id);
      if (action.qtd <= 0) return idx < 0 ? lines : lines.filter((_, i) => i !== idx);
      if (idx >= 0) return lines.map((l, i) => (i === idx ? ({ ...l, qtd: action.qtd } as OrderLine) : l));
      const uid = newUid();
      return [
        ...lines,
        action.tipo === 'prato'
          ? { tipo: 'prato', uid, pratoId: action.id, qtd: action.qtd }
          : { tipo: 'sobremesa', uid, sobremesaId: action.id, qtd: action.qtd },
      ];
    }
    case 'clear':
      return [];
    case 'prune':
      // Remove linhas que deixaram de existir/valer no cardápio atual (ex.: prato desativado).
      return lines.filter((l) => {
        try {
          priceLine(action.menu, l);
          return true;
        } catch {
          return false;
        }
      });
  }
}

export function useCart() {
  const [lines, dispatch] = useReducer(reducer, null, () => load<OrderLine[]>(KEYS.cart) ?? []);
  useEffect(() => save(KEYS.cart, lines), [lines]);
  return { lines, dispatch };
}
