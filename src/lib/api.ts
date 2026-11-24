import { demoMenu } from '../data/menu.demo';
import type { Menu, OrderRequest, OrderResult } from '../types';
import { currentCycle, toISO } from './cycle';
import { priceOrder } from './pricing';

/** URL do Web App do Apps Script. Definida no build via VITE_API_URL. */
export const API_URL: string = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').trim();
/** Sem API configurada o site roda em modo demonstração (nada é gravado). */
export const isDemo = API_URL === '';

const TIMEOUT_MS = 25_000;

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function looksLikeMenu(m: unknown): m is Menu {
  const x = m as Menu;
  return !!x && Array.isArray(x.pratos) && Array.isArray(x.kits) && Array.isArray(x.sobremesas) && !!x.loja;
}

export async function fetchMenu(): Promise<Menu> {
  if (isDemo) return demoMenu;
  const data = await call<{ ok: boolean; menu?: Menu; error?: string }>(`${API_URL}?action=menu`);
  if (!data.ok || !looksLikeMenu(data.menu)) throw new Error(data.error ?? 'Cardápio inválido');
  return data.menu;
}

export class OrderError extends Error {}

export async function submitOrder(menu: Menu, req: OrderRequest): Promise<OrderResult> {
  if (isDemo) {
    await new Promise((r) => setTimeout(r, 600));
    const priced = priceOrder(menu, req.linhas, req.modo);
    const entregaISO = toISO(currentCycle().delivery);
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const code = Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
    return {
      id: `SC-${code}`,
      totalCent: priced.totalCent,
      subtotalCent: priced.subtotalCent,
      taxaCent: priced.taxaCent,
      entregaISO,
      demo: true,
    };
  }

  const data = await call<{ ok: boolean; pedido?: OrderResult; error?: string }>(API_URL, {
    method: 'POST',
    // Sem cabeçalhos personalizados: evita o preflight CORS, que o Apps Script não responde.
    body: JSON.stringify({ action: 'order', ...req }),
  });
  if (!data.ok || !data.pedido) throw new OrderError(data.error ?? 'Não foi possível registrar o pedido.');
  return data.pedido;
}
