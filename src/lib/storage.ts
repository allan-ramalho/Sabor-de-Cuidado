// localStorage pode estar indisponível (modo privado, cota cheia); falhas são ignoradas.

export function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignorado */
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignorado */
  }
}

export const KEYS = {
  cart: 'sdc.cart.v1',
  menu: 'sdc.menu.v1',
  pending: 'sdc.pedido.v1',
  customer: 'sdc.cliente.v1',
};
