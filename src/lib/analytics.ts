import { API_URL, isDemo } from './api';

// Contador próprio de visitas: sem cookies, sem rastreador de terceiros e sem dados pessoais.
// Envia só "evento" e "origem" para a planilha (aba Estatísticas). Cada evento conta uma vez por sessão.

export type Evento = 'visita' | 'sacola' | 'checkout';

const IGNORAR = 'sdc.sem-contagem';
const ORIGEM = 'sdc.origem';
const PREFIXO = 'sdc.ev.';

/** Mapeia o endereço de quem indicou o site para um nome curto. */
export function origemDeReferrer(referrer: string, ownHost: string): string {
  if (!referrer) return 'direto';
  let host = '';
  try {
    host = new URL(referrer).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return 'direto';
  }
  if (!host || host === ownHost) return 'direto';
  if (/instagram/.test(host)) return 'instagram';
  if (/facebook|fb\.com|fb\.me/.test(host)) return 'facebook';
  if (/whatsapp|wa\.me/.test(host)) return 'whatsapp';
  if (/google/.test(host)) return 'google';
  if (/^t\.co$|twitter|^x\.com$/.test(host)) return 'x';
  return host.replace(/[^a-z0-9.-]/g, '').slice(0, 30) || 'direto';
}

function sanitizeOrigem(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9.-]/g, '').slice(0, 30);
}

/**
 * Origem da visita: parâmetro utm_source do link (ex.: ?utm_source=instagram) ou o site de
 * onde a pessoa veio. Fixada na primeira chamada para valer a sessão toda.
 */
export function getOrigem(): string {
  try {
    const saved = sessionStorage.getItem(ORIGEM);
    if (saved) return saved;
    const utm = sanitizeOrigem(new URLSearchParams(location.search).get('utm_source') ?? '');
    const origem = utm || origemDeReferrer(document.referrer, location.hostname);
    sessionStorage.setItem(ORIGEM, origem);
    return origem;
  } catch {
    return 'direto';
  }
}

function desligado(): boolean {
  try {
    if (isDemo || API_URL === '') return true;
    if (navigator.doNotTrack === '1') return true;
    return localStorage.getItem(IGNORAR) === '1';
  } catch {
    return true;
  }
}

/**
 * Para a dona não contar as próprias visitas: abra o site com ?sem-contagem=1 no aparelho dela
 * (e ?sem-contagem=0 para voltar a contar).
 */
export function initAnalytics(): void {
  try {
    const flag = new URLSearchParams(location.search).get('sem-contagem');
    if (flag === '1') localStorage.setItem(IGNORAR, '1');
    if (flag === '0') localStorage.removeItem(IGNORAR);
  } catch {
    /* ignorado */
  }
}

export function track(evento: Evento): void {
  if (desligado()) return;
  try {
    const key = PREFIXO + evento;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
    const body = JSON.stringify({ action: 'evento', evento, origem: getOrigem() });
    // sendBeacon envia como text/plain (sem preflight CORS) e não atrasa a navegação.
    if (!navigator.sendBeacon?.(API_URL, body)) {
      void fetch(API_URL, { method: 'POST', body, keepalive: true }).catch(() => undefined);
    }
  } catch {
    /* estatística nunca atrapalha o cliente */
  }
}
