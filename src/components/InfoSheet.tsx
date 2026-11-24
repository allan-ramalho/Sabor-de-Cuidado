import type { Menu } from '../types';
import { Sheet } from './Sheet';

export function InfoSheet({ menu, onClose }: { menu: Menu; onClose: () => void }) {
  return (
    <Sheet title="Como funciona" onClose={onClose}>
      <dl className="info">
        <dt>Como pedir</dt>
        <dd>Monte seu kit ou escolha marmitas avulsas, informe seus dados e gere o Pix. Depois é só enviar o comprovante pelo WhatsApp.</dd>
        <dt>Prazo</dt>
        <dd>Pedidos até quarta-feira para entrega na segunda-feira seguinte.</dd>
        <dt>Conservação</dt>
        <dd>Até 30 dias no freezer. Depois de descongelada, consuma em até 24 horas e não congele de novo.</dd>
        {menu.loja.avisoEntrega && (
          <>
            <dt>Entrega</dt>
            <dd>{menu.loja.avisoEntrega}</dd>
          </>
        )}
      </dl>
    </Sheet>
  );
}
