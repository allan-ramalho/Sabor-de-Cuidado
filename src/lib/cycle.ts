// Ciclo de pedidos: de quinta 00:00 até quarta 23:59 (horário de Brasília).
// A entrega é sempre na segunda-feira seguinte à quarta de fechamento.
// A mesma regra existe em apps-script/Code.gs (deliveryDate_).

export interface YMD {
  y: number;
  m: number;
  d: number;
}

const TZ = 'America/Sao_Paulo';
const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** Data de hoje no fuso de Brasília, independente do fuso do aparelho. */
export function brazilToday(now: Date = new Date()): YMD {
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

export function addDays(date: YMD, days: number): YMD {
  const t = new Date(Date.UTC(date.y, date.m - 1, date.d + days));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

export function weekday(date: YMD): number {
  return new Date(Date.UTC(date.y, date.m - 1, date.d)).getUTCDay();
}

/** Segunda-feira de entrega do ciclo que contém a data informada. */
export function deliveryDateFor(today: YMD): YMD {
  const daysToWednesday = (3 - weekday(today) + 7) % 7;
  return addDays(today, daysToWednesday + 5);
}

/** Quarta-feira em que o ciclo fecha. */
export function cutoffDateFor(delivery: YMD): YMD {
  return addDays(delivery, -5);
}

export function toISO(date: YMD): string {
  return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
}

export function fromISO(iso: string): YMD {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

/** Ex.: "segunda, 09/06" */
export function shortLabel(date: YMD): string {
  return `${WEEKDAYS[weekday(date)]}, ${String(date.d).padStart(2, '0')}/${String(date.m).padStart(2, '0')}`;
}

export function currentCycle(now: Date = new Date()) {
  const delivery = deliveryDateFor(brazilToday(now));
  return { delivery, cutoff: cutoffDateFor(delivery) };
}
