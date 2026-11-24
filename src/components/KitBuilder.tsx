import { useMemo, useState } from 'react';
import type { Kit, Menu, OrderLine } from '../types';
import { newUid } from '../state/cart';
import { brl } from '../lib/money';
import { distinctCount, kitExtraCent, kitProblem, sumQty } from '../lib/pricing';
import { Sheet } from './Sheet';
import { Stepper } from './Stepper';

interface Props {
  menu: Menu;
  kit: Kit;
  /** Linha existente ao editar um kit que já está na sacola. */
  initial?: Extract<OrderLine, { tipo: 'kit' }>;
  onConfirm: (line: Extract<OrderLine, { tipo: 'kit' }>) => void;
  onClose: () => void;
}

export function KitBuilder({ menu, kit, initial, onConfirm, onClose }: Props) {
  const [pratos, setPratos] = useState<Record<string, number>>(initial?.pratos ?? {});
  const [sobremesaId, setSobremesaId] = useState<string | undefined>(initial?.sobremesaId);

  const categories = useMemo(() => [...new Set(menu.pratos.map((d) => d.categoria))], [menu.pratos]);
  const total = sumQty(pratos);
  const distinct = distinctCount(pratos);
  const full = total >= kit.marmitas;
  const needsDessert = kit.sobremesasGratis > 0 && menu.sobremesas.length > 0;
  const problem = kitProblem(menu, kit, pratos, sobremesaId);
  const price = kit.precoCent + kitExtraCent(menu, pratos);

  const set = (id: string, qtd: number) =>
    setPratos((prev) => {
      const next = { ...prev };
      if (qtd <= 0) delete next[id];
      else next[id] = qtd;
      return next;
    });

  const confirm = () => {
    if (problem) return;
    onConfirm({ tipo: 'kit', uid: initial?.uid ?? newUid(), kitId: kit.id, pratos, sobremesaId: needsDessert ? sobremesaId : undefined });
  };

  return (
    <Sheet
      title={`${kit.nome} · ${kit.marmitas} marmitas`}
      subtitle={`Escolha ${kit.marmitas} marmitas, até ${kit.maxPratos} pratos diferentes.`}
      onClose={onClose}
      footer={
        <>
          {problem && total > 0 && <p className="hint">{problem}</p>}
          <button className="btn wide" disabled={problem !== null} onClick={confirm}>
            {initial ? 'Salvar alterações' : 'Adicionar à sacola'} · {brl(price)}
          </button>
        </>
      }
    >
      <div className="progress" aria-label={`${total} de ${kit.marmitas} marmitas`}>
        <div className="bar">
          <i style={{ width: `${Math.min(100, (total / kit.marmitas) * 100)}%` }} />
        </div>
        <span>
          {total} de {kit.marmitas} marmitas
          {distinct > 0 && ` · ${distinct}/${kit.maxPratos} pratos`}
        </span>
      </div>

      {categories.map((cat) => (
        <div key={cat} className="group">
          <h3>{cat}</h3>
          <ul className="rows compact">
            {menu.pratos
              .filter((d) => d.categoria === cat)
              .map((d) => {
                const q = pratos[d.id] ?? 0;
                const blockedByVariety = q === 0 && distinct >= kit.maxPratos;
                return (
                  <li key={d.id} className="row">
                    <div className="row-main">
                      <h4>{d.nome}</h4>
                      {d.descricao && <p className="muted">{d.descricao}</p>}
                      {d.adicionalCent > 0 && <p className="row-extra">+ {brl(d.adicionalCent)} por marmita</p>}
                    </div>
                    <Stepper
                      value={q}
                      onChange={(n) => set(d.id, n)}
                      max={kit.marmitas}
                      lockPlus={full || blockedByVariety}
                      label={d.nome}
                    />
                  </li>
                );
              })}
          </ul>
        </div>
      ))}

      {needsDessert && (
        <div className="group">
          <h3>Sobremesa grátis</h3>
          <p className="muted">Este kit inclui 1 bolo de pote.</p>
          <div className="radios" role="radiogroup" aria-label="Sobremesa grátis">
            {menu.sobremesas.map((s) => (
              <label key={s.id} className={sobremesaId === s.id ? 'radio on' : 'radio'}>
                <input type="radio" name="sobremesa" checked={sobremesaId === s.id} onChange={() => setSobremesaId(s.id)} />
                <span>
                  {s.nome}
                  {s.descricao && <small>{s.descricao}</small>}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </Sheet>
  );
}
