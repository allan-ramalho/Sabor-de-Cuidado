import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { PendingOrder } from '../types';
import { fromISO, shortLabel } from '../lib/cycle';
import { brl } from '../lib/money';
import { whatsappLink } from '../lib/whatsapp';

interface Props {
  order: PendingOrder;
  whatsapp: string;
  onMenu: () => void;
  onNewOrder: () => void;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

export function PixPayment({ order, whatsapp, onMenu, onNewOrder }: Props) {
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);
  const { result } = order;

  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(order.pixCode, { margin: 1, width: 320, errorCorrectionLevel: 'M' })
      .then((url) => alive && setQr(url))
      .catch(() => alive && setQr(''));
    return () => {
      alive = false;
    };
  }, [order.pixCode]);

  const copy = async () => {
    if (await copyText(order.pixCode)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-bar">
          <button className="icon-btn" onClick={onMenu} aria-label="Voltar ao cardápio">
            ‹
          </button>
          <h2>Pedido nº {result.numero}</h2>
        </div>

        {result.demo && <p className="notice warn">Modo demonstração: este Pix é de teste, não pague.</p>}

        <section className="card center">
          <p className="muted">
            {order.modo === 'entrega' ? 'Entrega' : 'Retirada'} na {shortLabel(fromISO(result.entregaISO))}
          </p>
          <p className="pix-total">{brl(result.totalCent)}</p>
          {qr ? <img className="qr" src={qr} alt="QR Code do Pix" width={260} height={260} /> : <div className="qr skeleton" />}
          <button className="btn wide" onClick={copy}>
            {copied ? 'Código copiado!' : 'Copiar código Pix'}
          </button>
          <p className="hint">Pix copia e cola. Abra o app do seu banco, escolha "Pix copia e cola" e cole o código.</p>
        </section>

        <section className="card">
          <h3>Agora é só mais um passo</h3>
          <ol className="steps">
            <li>Pague o Pix no app do seu banco.</li>
            <li>Toque no botão verde para abrir o WhatsApp.</li>
            <li>Anexe o comprovante na conversa e envie.</li>
          </ol>
          <a className="btn wa wide" href={whatsappLink(whatsapp, order.mensagemWhatsapp)} target="_blank" rel="noopener noreferrer">
            Enviar comprovante no WhatsApp
          </a>
          <p className="hint">Seu pedido só é confirmado depois que conferimos o comprovante.</p>
        </section>

        <div className="page-actions">
          <button className="link-btn" onClick={onMenu}>
            Voltar ao cardápio
          </button>
          <button
            className="link-btn danger"
            onClick={() => {
              if (window.confirm('Fazer um novo pedido? Este Pix deixará de aparecer aqui, mas o pedido continua registrado.')) onNewOrder();
            }}
          >
            Fazer novo pedido
          </button>
        </div>
      </div>
    </div>
  );
}
