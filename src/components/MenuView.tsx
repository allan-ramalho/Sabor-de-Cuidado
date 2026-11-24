import { useEffect, useMemo, useRef, useState, type Dispatch } from 'react';
import type { Dish, Kit, Menu, OrderLine, PendingOrder } from '../types';
import type { CartAction } from '../state/cart';
import type { View } from '../useNav';
import { currentCycle, shortLabel } from '../lib/cycle';
import { brl } from '../lib/money';
import { dishPriceCent, kitListPriceCent, priceLine } from '../lib/pricing';
import { AddButton, Stepper } from './Stepper';

interface Props {
  menu: Menu;
  lines: OrderLine[];
  dispatch: Dispatch<CartAction>;
  go: (v: View) => void;
  pending: PendingOrder | null;
  offline: boolean;
  demo: boolean;
}

function slug(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function photoUrl(foto: string): string {
  return /^https?:\/\//.test(foto) ? foto : `./fotos/${foto}`;
}

function qtyOf(lines: OrderLine[], tipo: 'prato' | 'sobremesa', id: string): number {
  for (const l of lines) {
    if (l.tipo === 'prato' && tipo === 'prato' && l.pratoId === id) return l.qtd;
    if (l.tipo === 'sobremesa' && tipo === 'sobremesa' && l.sobremesaId === id) return l.qtd;
  }
  return 0;
}

export function MenuView({ menu, lines, dispatch, go, pending, offline, demo }: Props) {
  const cycle = useMemo(() => currentCycle(), []);
  const categories = useMemo(() => [...new Set(menu.pratos.map((d) => d.categoria))], [menu.pratos]);
  const tabs = useMemo(
    () => [
      ...(menu.kits.length ? [{ key: 'kits', label: 'Kits' }] : []),
      ...categories.map((c) => ({ key: slug(c), label: c })),
      ...(menu.sobremesas.length ? [{ key: 'sobremesas', label: 'Sobremesas' }] : []),
    ],
    [menu.kits.length, menu.sobremesas.length, categories],
  );
  const [active, setActive] = useState(tabs[0]?.key ?? '');
  const tabsRef = useRef<HTMLDivElement>(null);
  const closed = !menu.loja.pedidosAbertos;

  // Destaca a aba da seção visível.
  const tabKeys = tabs.map((t) => t.key).join('|');
  useEffect(() => {
    const els = tabKeys
      .split('|')
      .map((k) => document.getElementById(`sec-${k}`))
      .filter((el): el is HTMLElement => el !== null);
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id.slice(4));
      },
      { rootMargin: '-120px 0px -65% 0px' },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [tabKeys]);

  useEffect(() => {
    const bar = tabsRef.current;
    const el = bar?.querySelector<HTMLElement>(`[data-tab="${active}"]`);
    if (bar && el) bar.scrollTo({ left: el.offsetLeft - bar.clientWidth / 2 + el.clientWidth / 2, behavior: 'smooth' });
  }, [active]);

  const scrollTo = (key: string) =>
    document.getElementById(`sec-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const count = lines.reduce((n, l) => n + (l.tipo === 'kit' ? 1 : l.qtd), 0);
  const subtotal = lines.reduce((sum, l) => {
    try {
      return sum + priceLine(menu, l).totalCent;
    } catch {
      return sum;
    }
  }, 0);

  return (
    <>
      <header className="hero">
        <img className="hero-logo" src="./logo.svg" alt="" width={72} height={72} />
        <div className="hero-text">
          <h1>{menu.loja.nome}</h1>
          <p>Comida caseira congelada · 400g de sabor de verdade</p>
        </div>
        <button className="link-btn" onClick={() => go({ name: 'info' })}>
          Como funciona
        </button>
      </header>

      <div className="chips">
        <span className="chip">
          <b>Entrega:</b> {shortLabel(cycle.delivery)}
        </span>
        <span className="chip">
          <b>Pedidos até:</b> {shortLabel(cycle.cutoff)}
        </span>
      </div>

      {demo && (
        <div className="notice warn">
          Modo demonstração: nenhum pedido é gravado e o Pix é de teste. Configure o backend para publicar.
        </div>
      )}
      {closed && <div className="notice warn">Os pedidos estão pausados no momento. Volte em breve!</div>}
      {offline && <div className="notice">Não foi possível atualizar o cardápio. Mostrando a última versão salva.</div>}

      {pending && (
        <button className="pending-banner" onClick={() => go({ name: 'pix' })}>
          <span>
            Pedido nº {pending.result.numero} aguardando comprovante
            <small>Toque para ver o Pix e enviar o comprovante</small>
          </span>
          <b>Ver Pix ›</b>
        </button>
      )}

      <nav className="tabs" aria-label="Categorias" ref={tabsRef}>
        {tabs.map((t) => (
          <button
            key={t.key}
            data-tab={t.key}
            className={t.key === active ? 'tab on' : 'tab'}
            onClick={() => {
              setActive(t.key);
              scrollTo(t.key);
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="menu">
        {menu.kits.length > 0 && (
          <section id="sec-kits" className="section">
            <h2>Monte seu kit</h2>
            <p className="muted">Escolha seus pratos e economize. Avulsa: {brl(menu.precoAvulsaCent)}</p>
            <div className="kits">
              {menu.kits.map((kit) => (
                <KitCard key={kit.id} kit={kit} menu={menu} disabled={closed} onPick={() => go({ name: 'kit', kitId: kit.id })} />
              ))}
            </div>
          </section>
        )}

        {categories.map((cat) => {
          const dishes = menu.pratos.filter((d) => d.categoria === cat);
          const extra = Math.max(...dishes.map((d) => d.adicionalCent));
          return (
            <section key={cat} id={`sec-${slug(cat)}`} className="section">
              <h2>
                {cat} {extra > 0 && <span className="pill">+ {brl(extra)}</span>}
              </h2>
              <p className="muted">Marmita avulsa de 400g</p>
              <ul className="rows">
                {dishes.map((d) => (
                  <DishRow
                    key={d.id}
                    dish={d}
                    price={dishPriceCent(menu, d)}
                    qty={qtyOf(lines, 'prato', d.id)}
                    disabled={closed}
                    onChange={(qtd) => dispatch({ type: 'setQty', tipo: 'prato', id: d.id, qtd })}
                  />
                ))}
              </ul>
            </section>
          );
        })}

        {menu.sobremesas.length > 0 && (
          <section id="sec-sobremesas" className="section">
            <h2>Sobremesas</h2>
            <p className="muted">Bolos de pote</p>
            <ul className="rows">
              {menu.sobremesas.map((s) => (
                <DishRow
                  key={s.id}
                  dish={{ id: s.id, categoria: '', nome: s.nome, descricao: s.descricao, adicionalCent: 0, foto: s.foto }}
                  price={s.precoCent}
                  qty={qtyOf(lines, 'sobremesa', s.id)}
                  fallbackFoto="bolo-de-pote.svg"
                  disabled={closed}
                  onChange={(qtd) => dispatch({ type: 'setQty', tipo: 'sobremesa', id: s.id, qtd })}
                />
              ))}
            </ul>
          </section>
        )}

        <footer className="foot">
          <p className="tagline">Porque comer bem também é se cuidar.</p>
          <p>
            Até 30 dias no freezer. Depois de descongelada, consuma em até 24 horas e não congele de novo.
          </p>
        </footer>
      </main>

      {count > 0 && (
        <button className="cart-bar" onClick={() => go({ name: 'cart' })}>
          <span className="cart-count">{count}</span>
          <span>Ver sacola</span>
          <b>{brl(subtotal)}</b>
        </button>
      )}
    </>
  );
}

function KitCard({ kit, menu, onPick, disabled }: { kit: Kit; menu: Menu; onPick: () => void; disabled: boolean }) {
  const list = kitListPriceCent(menu, kit);
  const saving = list - kit.precoCent;
  const tone = !kit.destaque ? 'plain' : /melhor/i.test(kit.destaque) ? 'dark' : 'hot';
  const hasDessert = kit.sobremesasGratis > 0;
  return (
    <article className={`kit ${tone}`}>
      {kit.destaque && <span className="badge">{kit.destaque}</span>}
      <h3>{kit.marmitas} marmitas</h3>
      <p className="kit-name">{kit.nome}</p>
      <p className="kit-sub">Escolha até {kit.maxPratos} pratos diferentes</p>
      {saving > 0 && <p className="kit-old">de {brl(list)}</p>}
      <p className="kit-price">{brl(kit.precoCent)}</p>
      <p className="kit-each">{brl(Math.round(kit.precoCent / kit.marmitas))} cada</p>
      {saving > 0 && (
        <p className="kit-save">
          Economize {brl(saving)}
          {hasDessert && ' + 1 sobremesa grátis'}
        </p>
      )}
      <button className="btn" onClick={onPick} disabled={disabled}>
        Montar kit
      </button>
    </article>
  );
}

/**
 * Foto do item: usa a coluna "Foto" da planilha; se vazia, procura public/fotos/<id>.svg.
 * Se o arquivo não existir, a imagem simplesmente não aparece.
 */
function Photo({ foto, fallback }: { foto?: string; fallback: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      className="row-photo"
      src={foto ? photoUrl(foto) : `./fotos/${fallback}`}
      alt=""
      width={84}
      height={84}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function DishRow(props: {
  dish: Dish;
  price: number;
  qty: number;
  disabled: boolean;
  onChange: (q: number) => void;
  fallbackFoto?: string;
}) {
  const { dish, price, qty, disabled, onChange, fallbackFoto } = props;
  return (
    <li className="row">
      <div className="row-main">
        <h3>{dish.nome}</h3>
        {dish.descricao && <p className="muted">{dish.descricao}</p>}
        <p className="row-price">{brl(price)}</p>
      </div>
      <Photo foto={dish.foto} fallback={fallbackFoto ?? `${dish.id}.svg`} />

      <div className="row-action">
        {qty > 0 ? (
          <Stepper value={qty} onChange={onChange} label={dish.nome} />
        ) : (
          <AddButton onClick={() => onChange(1)} label={dish.nome} disabled={disabled} />
        )}
      </div>
    </li>
  );
}
