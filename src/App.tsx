import { useCallback, useEffect, useState } from 'react';
import type { PendingOrder } from './types';
import { Checkout } from './components/Checkout';
import { CartSheet } from './components/CartSheet';
import { InfoSheet } from './components/InfoSheet';
import { KitBuilder } from './components/KitBuilder';
import { MenuView } from './components/MenuView';
import { PixPayment } from './components/PixPayment';
import { fetchOrderStatus, isDemo } from './lib/api';
import { initAnalytics, track } from './lib/analytics';
import { KEYS, load, remove, save } from './lib/storage';
import { whatsappLink } from './lib/whatsapp';
import { useCart } from './state/cart';
import { useMenu } from './useMenu';
import { useNav } from './useNav';

const PENDING_TTL_MS = 36 * 60 * 60 * 1000;
/** Status inicial gravado na planilha (igual a STATUS_LIST[0] em apps-script/Code.gs). */
const AWAITING = 'Aguardando comprovante';
/** Número da loja usado só se o cardápio não carregar (vem do folder). */
const FALLBACK_WHATSAPP = '5521979183105';

function loadPending(): PendingOrder | null {
  const p = load<PendingOrder>(KEYS.pending);
  if (!p) return null;
  if (Date.now() - p.criadoEm > PENDING_TTL_MS) {
    remove(KEYS.pending);
    return null;
  }
  return p;
}

export default function App() {
  const { menu, status, offline, refresh } = useMenu();
  const { lines, dispatch } = useCart();
  const { view, go, back } = useNav();
  const [pending, setPending] = useState<PendingOrder | null>(loadPending);

  useEffect(() => {
    if (menu) dispatch({ type: 'prune', menu });
  }, [menu, dispatch]);

  // Funil de visitas (cada etapa conta uma vez por sessão): visita > sacola > checkout > pedido.
  useEffect(() => {
    initAnalytics();
    track('visita');
  }, []);
  useEffect(() => {
    if (lines.length > 0) track('sacola');
  }, [lines.length]);
  useEffect(() => {
    if (view.name === 'checkout') track('checkout');
  }, [view.name]);

  useEffect(() => {
    document.body.style.overflow = view.name === 'menu' ? '' : 'hidden';
  }, [view.name]);

  // O aviso "aguardando comprovante" só vale enquanto o pedido existe e está em aberto na planilha.
  // Se foi apagado, cancelado, pago ou entregue, o aviso some. Sem internet, o aviso permanece.
  const pendingId = pending?.result.id;
  const pendingDelivery = pending?.result.entregaISO;
  useEffect(() => {
    if (!pendingId || !pendingDelivery) return;
    let alive = true;
    fetchOrderStatus(pendingId, pendingDelivery).then((status) => {
      if (alive && status !== null && status !== AWAITING) {
        remove(KEYS.pending);
        setPending(null);
      }
    });
    return () => {
      alive = false;
    };
  }, [pendingId, pendingDelivery]);

  // Telas que dependem de dados: se faltarem (ex.: página recarregada), volta ao cardápio.
  useEffect(() => {
    if (view.name === 'cart' && lines.length === 0) back();
    if (view.name === 'checkout' && lines.length === 0) back();
    if (view.name === 'pix' && !pending) go({ name: 'menu' }, { replace: true });
  }, [view.name, lines.length, pending, back, go]);

  const onOrderDone = useCallback(
    (order: PendingOrder) => {
      save(KEYS.pending, order);
      setPending(order);
      dispatch({ type: 'clear' });
      go({ name: 'pix' }, { replace: true });
    },
    [dispatch, go],
  );

  const onNewOrder = useCallback(() => {
    remove(KEYS.pending);
    setPending(null);
    go({ name: 'menu' }, { replace: true });
  }, [go]);

  if (!menu) {
    return (
      <div className="splash">
        <img src="./logo.svg" alt="Sabor de Cuidado" width={120} height={120} />
        {status === 'error' ? (
          <>
            <p>Não conseguimos carregar o cardápio agora.</p>
            <button className="btn" onClick={refresh}>
              Tentar novamente
            </button>
            <a className="link-btn" href={whatsappLink(FALLBACK_WHATSAPP, 'Olá! Quero fazer um pedido.')}>
              Pedir pelo WhatsApp
            </a>
          </>
        ) : (
          <p>Carregando cardápio...</p>
        )}
      </div>
    );
  }

  const kit = view.name === 'kit' ? menu.kits.find((k) => k.id === view.kitId) : undefined;
  const editing = view.name === 'kit' && view.uid ? lines.find((l) => l.uid === view.uid) : undefined;

  return (
    <div className="app">
      <MenuView menu={menu} lines={lines} dispatch={dispatch} go={go} pending={pending} offline={offline} demo={isDemo} />

      {view.name === 'info' && <InfoSheet menu={menu} onClose={back} />}
      {view.name === 'cart' && <CartSheet menu={menu} lines={lines} dispatch={dispatch} go={go} onClose={back} />}
      {view.name === 'kit' && kit && (
        <KitBuilder
          key={`${kit.id}-${view.uid ?? 'novo'}`}
          menu={menu}
          kit={kit}
          initial={editing?.tipo === 'kit' ? editing : undefined}
          onClose={back}
          onConfirm={(line) => {
            dispatch({ type: editing ? 'replace' : 'add', line });
            back();
          }}
        />
      )}
      {view.name === 'checkout' && lines.length > 0 && (
        <Checkout menu={menu} lines={lines} onBack={back} onDone={onOrderDone} />
      )}
      {view.name === 'pix' && pending && (
        <PixPayment
          order={pending}
          whatsapp={menu.loja.whatsapp}
          avisoEntrega={menu.loja.avisoEntrega}
          onMenu={() => go({ name: 'menu' }, { replace: true })}
          onNewOrder={onNewOrder}
        />
      )}
    </div>
  );
}
