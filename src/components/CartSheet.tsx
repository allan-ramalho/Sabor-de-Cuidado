import type { Dispatch } from 'react';
import type { Menu, OrderLine } from '../types';
import type { CartAction } from '../state/cart';
import type { View } from '../useNav';
import { brl } from '../lib/money';
import { priceLine } from '../lib/pricing';
import { Sheet } from './Sheet';
import { Stepper } from './Stepper';

interface Props {
  menu: Menu;
  lines: OrderLine[];
  dispatch: Dispatch<CartAction>;
  go: (v: View) => void;
  onClose: () => void;
}

export function CartSheet({ menu, lines, dispatch, go, onClose }: Props) {
  const priced = lines.flatMap((l) => {
    try {
      return [priceLine(menu, l)];
    } catch {
      return [];
    }
  });
  const subtotal = priced.reduce((a, l) => a + l.totalCent, 0);

  return (
    <Sheet
      title="Sua sacola"
      onClose={onClose}
      footer={
        priced.length > 0 ? (
          <>
            <div className="sum">
              <span>Subtotal</span>
              <b>{brl(subtotal)}</b>
            </div>
            <p className="hint">
              {menu.loja.taxaEntregaCent > 0
                ? 'A taxa de entrega é somada no próximo passo.'
                : menu.loja.avisoEntrega || 'Confira a entrega no próximo passo.'}
            </p>
            <button className="btn wide" onClick={() => go({ name: 'checkout' })} disabled={!menu.loja.pedidosAbertos}>
              Continuar
            </button>
          </>
        ) : undefined
      }
    >
      {priced.length === 0 ? (
        <p className="empty">Sua sacola está vazia. Escolha um kit ou marmitas avulsas.</p>
      ) : (
        <ul className="cart-lines">
          {priced.map(({ line, titulo, detalhes, totalCent }) => (
            <li key={line.uid} className="cart-line">
              <div className="cart-line-main">
                <h3>{line.tipo === 'kit' ? titulo : titulo.replace(/^\d+x /, '')}</h3>
                {detalhes.length > 0 && (
                  <ul className="details">
                    {detalhes.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                )}
                <div className="cart-line-actions">
                  {line.tipo === 'kit' ? (
                    <>
                      <button className="link-btn" onClick={() => go({ name: 'kit', kitId: line.kitId, uid: line.uid })}>
                        Editar
                      </button>
                      <button className="link-btn danger" onClick={() => dispatch({ type: 'remove', uid: line.uid })}>
                        Remover
                      </button>
                    </>
                  ) : (
                    <Stepper
                      value={line.qtd}
                      label={titulo}
                      onChange={(qtd) =>
                        dispatch({
                          type: 'setQty',
                          tipo: line.tipo,
                          id: line.tipo === 'prato' ? line.pratoId : line.sobremesaId,
                          qtd,
                        })
                      }
                    />
                  )}
                </div>
              </div>
              <b>{brl(totalCent)}</b>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
