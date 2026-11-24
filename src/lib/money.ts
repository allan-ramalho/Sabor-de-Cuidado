/** Formata centavos como "R$ 1.234,56". Implementação própria para ser idêntica à do Apps Script. */
export function brl(cent: number): string {
  const sign = cent < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cent));
  const reais = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const centavos = (abs % 100).toString().padStart(2, '0');
  return `${sign}R$ ${reais},${centavos}`;
}

export function cents(reais: number): number {
  return Math.round(reais * 100);
}
