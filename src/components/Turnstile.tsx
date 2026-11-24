import { useEffect, useRef } from 'react';

/** Chave pública do Cloudflare Turnstile. Vazia = verificação desligada (nada é carregado). */
export const TURNSTILE_SITE_KEY: string = ((import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ?? '').trim();

interface TurnstileApi {
  render: (el: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile indisponível')));
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error('turnstile bloqueado'));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

interface Props {
  onToken: (token: string | null) => void;
  /** Mude este número para pedir uma nova verificação (o token vale uma única vez). */
  resetSignal: number;
  onError: () => void;
}

/** Verificação anti-robô. Fica invisível, e só aparece se a Cloudflare precisar de interação. */
export function Turnstile({ onToken, resetSignal, onError }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | undefined>(undefined);
  const cb = useRef({ onToken, onError });
  cb.current = { onToken, onError };

  useEffect(() => {
    let cancelled = false;
    loadTurnstile()
      .then((api) => {
        if (cancelled || !box.current) return;
        widget.current = api.render(box.current, {
          sitekey: TURNSTILE_SITE_KEY,
          appearance: 'interaction-only',
          language: 'pt-br',
          callback: (t: string) => cb.current.onToken(t),
          'expired-callback': () => cb.current.onToken(null),
          'error-callback': () => {
            cb.current.onToken(null);
            cb.current.onError();
          },
        });
      })
      .catch(() => !cancelled && cb.current.onError());
    return () => {
      cancelled = true;
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = undefined;
    };
  }, []);

  useEffect(() => {
    if (resetSignal > 0 && widget.current) window.turnstile?.reset(widget.current);
  }, [resetSignal]);

  return <div ref={box} className="turnstile" />;
}
