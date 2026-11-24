import { useMemo, useRef, useState, type FormEvent } from 'react';
import type { DeliveryMode, Menu, OrderLine, PendingOrder } from '../types';
import { OrderError, submitOrder } from '../lib/api';
import { currentCycle, shortLabel } from '../lib/cycle';
import { brl } from '../lib/money';
import { buildPix } from '../lib/pix';
import { PricingError, priceOrder } from '../lib/pricing';
import { KEYS, load, save } from '../lib/storage';
import { buildWhatsappMessage } from '../lib/whatsapp';

interface Props {
  menu: Menu;
  lines: OrderLine[];
  onBack: () => void;
  onDone: (order: PendingOrder) => void;
}

interface Saved {
  nome: string;
  whatsapp: string;
  modo: DeliveryMode;
  rua: string;
  bairro: string;
  complemento: string;
  cep: string;
}

function maskPhone(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function maskCep(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

function newRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function Checkout({ menu, lines, onBack, onDone }: Props) {
  const saved = useMemo(() => load<Saved>(KEYS.customer), []);
  const [nome, setNome] = useState(saved?.nome ?? '');
  const [whatsapp, setWhatsapp] = useState(saved?.whatsapp ?? '');
  const [modo, setModo] = useState<DeliveryMode>(saved?.modo === 'retirada' && menu.loja.retirada ? 'retirada' : 'entrega');
  const [rua, setRua] = useState(saved?.rua ?? '');
  const [bairro, setBairro] = useState(saved?.bairro ?? '');
  const [complemento, setComplemento] = useState(saved?.complemento ?? '');
  const [cep, setCep] = useState(saved?.cep ?? '');
  const [obs, setObs] = useState('');
  const [website, setWebsite] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const requestId = useRef(newRequestId());
  const cycle = useMemo(() => currentCycle(), []);

  const summary = useMemo(() => {
    try {
      return priceOrder(menu, lines, modo);
    } catch {
      return null;
    }
  }, [menu, lines, modo]);

  const pixReady = menu.loja.pixChave.trim() !== '';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy || !summary) return;
    setError('');

    const phoneDigits = whatsapp.replace(/\D/g, '');
    if (nome.trim().length < 2) return setError('Informe seu nome.');
    if (phoneDigits.length < 10 || phoneDigits.length > 11) return setError('Informe seu WhatsApp com DDD.');
    if (modo === 'entrega' && (rua.trim().length < 3 || bairro.trim().length < 2)) {
      return setError('Informe rua e número e o bairro para a entrega.');
    }

    setBusy(true);
    try {
      const priced = priceOrder(menu, lines, modo);
      const result = await submitOrder(menu, {
        requestId: requestId.current,
        nome: nome.trim(),
        whatsapp: phoneDigits,
        modo,
        endereco: { rua: rua.trim(), bairro: bairro.trim(), complemento: complemento.trim(), cep },
        obs: obs.trim(),
        linhas: lines,
        website,
      });
      save(KEYS.customer, { nome: nome.trim(), whatsapp, modo, rua, bairro, complemento, cep } satisfies Saved);
      const pixCode = buildPix({
        chave: menu.loja.pixChave,
        nome: menu.loja.pixNome || menu.loja.nome,
        cidade: menu.loja.pixCidade,
        valorCent: result.totalCent,
        txid: result.id,
      });
      onDone({
        result,
        nome: nome.trim(),
        modo,
        pixCode,
        mensagemWhatsapp: buildWhatsappMessage({ nome: nome.trim(), modo, result, order: priced }),
        criadoEm: Date.now(),
      });
    } catch (err) {
      if (err instanceof OrderError || err instanceof PricingError) {
        // Recusa definitiva do servidor: um novo envio precisa de novo identificador.
        requestId.current = newRequestId();
        setError(err.message);
      } else {
        // Falha de rede/tempo esgotado: mantém o identificador para o servidor não duplicar o pedido.
        setError('Não conseguimos confirmar o pedido. Verifique sua conexão e tente novamente.');
      }
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-bar">
          <button className="icon-btn" onClick={onBack} aria-label="Voltar">
            ‹
          </button>
          <h2>Finalizar pedido</h2>
        </div>

        <form onSubmit={onSubmit} noValidate>
          <section className="card">
            <h3>Seus dados</h3>
            <label className="field">
              Nome
              <input value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" maxLength={80} />
            </label>
            <label className="field">
              WhatsApp
              <input
                value={whatsapp}
                onChange={(e) => setWhatsapp(maskPhone(e.target.value))}
                inputMode="tel"
                autoComplete="tel-national"
                placeholder="(21) 99999-9999"
              />
            </label>
          </section>

          <section className="card">
            <h3>Como você quer receber?</h3>
            <div className="seg" role="radiogroup" aria-label="Entrega ou retirada">
              <button type="button" role="radio" aria-checked={modo === 'entrega'} className={modo === 'entrega' ? 'on' : ''} onClick={() => setModo('entrega')}>
                Entrega
              </button>
              {menu.loja.retirada && (
                <button type="button" role="radio" aria-checked={modo === 'retirada'} className={modo === 'retirada' ? 'on' : ''} onClick={() => setModo('retirada')}>
                  Retirada
                </button>
              )}
            </div>
            <p className="muted">
              {modo === 'entrega' ? 'Entrega' : 'Retirada'} na {shortLabel(cycle.delivery)}.
            </p>
            {modo === 'entrega' && (
              <>
                <label className="field">
                  Rua e número
                  <input value={rua} onChange={(e) => setRua(e.target.value)} autoComplete="street-address" maxLength={120} />
                </label>
                <div className="two">
                  <label className="field">
                    Bairro
                    <input value={bairro} onChange={(e) => setBairro(e.target.value)} maxLength={60} />
                  </label>
                  <label className="field">
                    CEP (opcional)
                    <input value={cep} onChange={(e) => setCep(maskCep(e.target.value))} inputMode="numeric" autoComplete="postal-code" />
                  </label>
                </div>
                <label className="field">
                  Complemento / ponto de referência (opcional)
                  <input value={complemento} onChange={(e) => setComplemento(e.target.value)} maxLength={120} />
                </label>
                {menu.loja.avisoEntrega && <p className="notice">{menu.loja.avisoEntrega}</p>}
              </>
            )}
          </section>

          <section className="card">
            <h3>Observações (opcional)</h3>
            <label className="field">
              <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={3} maxLength={300} placeholder="Alergias, restrições, horário..." />
            </label>
          </section>

          {/* Campo isca: pessoas não veem, robôs preenchem. */}
          <div className="hp" aria-hidden="true">
            <label>
              Site
              <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </label>
          </div>

          <section className="card">
            <h3>Resumo</h3>
            {summary ? (
              <>
                <ul className="cart-lines tight">
                  {summary.lines.map((l) => (
                    <li key={l.line.uid} className="cart-line">
                      <div className="cart-line-main">
                        <h4>{l.titulo}</h4>
                      </div>
                      <span>{brl(l.totalCent)}</span>
                    </li>
                  ))}
                </ul>
                <div className="sum small">
                  <span>Subtotal</span>
                  <span>{brl(summary.subtotalCent)}</span>
                </div>
                {modo === 'entrega' && (
                  <div className="sum small">
                    <span>Entrega</span>
                    <span>{summary.taxaCent > 0 ? brl(summary.taxaCent) : 'A combinar na entrega'}</span>
                  </div>
                )}
                <div className="sum">
                  <span>Total</span>
                  <b>{brl(summary.totalCent)}</b>
                </div>
              </>
            ) : (
              <p className="notice warn">Sua sacola tem itens indisponíveis. Volte e revise.</p>
            )}
          </section>

          {!pixReady && <p className="notice warn">O Pix da loja ainda não foi configurado. Fale conosco pelo WhatsApp.</p>}
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}

          <button className="btn wide" type="submit" disabled={busy || !summary || !pixReady}>
            {busy ? 'Registrando pedido...' : `Gerar Pix${summary ? ` · ${brl(summary.totalCent)}` : ''}`}
          </button>
          <p className="hint center">Você paga pelo app do seu banco e envia o comprovante pelo WhatsApp.</p>
        </form>
      </div>
    </div>
  );
}
