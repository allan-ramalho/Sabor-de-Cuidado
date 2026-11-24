import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchMenu, isDemo } from './lib/api';
import { KEYS, load, save } from './lib/storage';
import { demoMenu } from './data/menu.demo';
import type { Menu } from './types';

export type MenuStatus = 'loading' | 'ready' | 'error';

/** Mostra o último cardápio salvo na hora e atualiza em segundo plano. */
export function useMenu() {
  const [menu, setMenu] = useState<Menu | null>(() => (isDemo ? demoMenu : load<Menu>(KEYS.menu)));
  const [status, setStatus] = useState<MenuStatus>(menu ? 'ready' : 'loading');
  const [offline, setOffline] = useState(false);
  const hasMenu = useRef(menu !== null);

  const refresh = useCallback(() => {
    setStatus((s) => (hasMenu.current ? s : 'loading'));
    fetchMenu()
      .then((m) => {
        hasMenu.current = true;
        setMenu(m);
        save(KEYS.menu, m);
        setStatus('ready');
        setOffline(false);
      })
      .catch(() => {
        if (hasMenu.current) setOffline(true);
        else setStatus('error');
      });
  }, []);

  useEffect(refresh, [refresh]);

  return { menu, status, offline, refresh };
}
