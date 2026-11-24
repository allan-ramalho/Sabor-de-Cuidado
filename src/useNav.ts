import { useCallback, useEffect, useState } from 'react';

export type View =
  | { name: 'menu' }
  | { name: 'cart' }
  | { name: 'info' }
  | { name: 'kit'; kitId: string; uid?: string }
  | { name: 'checkout' }
  | { name: 'pix' };

const MENU: View = { name: 'menu' };

/** Navegação por histórico: o botão "voltar" do celular fecha sheets e telas. */
export function useNav() {
  const [view, setView] = useState<View>(MENU);

  useEffect(() => {
    history.replaceState(MENU, '');
    const onPop = (e: PopStateEvent) => setView((e.state as View | null) ?? MENU);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const go = useCallback((next: View, opts?: { replace?: boolean }) => {
    if (opts?.replace) history.replaceState(next, '');
    else history.pushState(next, '');
    setView(next);
  }, []);

  /** Volta uma tela; se não houver histórico (página recarregada), vai ao cardápio. */
  const back = useCallback(() => {
    if (history.length > 1 && history.state && (history.state as View).name !== 'menu') history.back();
    else {
      history.replaceState(MENU, '');
      setView(MENU);
    }
  }, []);

  return { view, go, back };
}
