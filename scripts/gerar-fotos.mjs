// Gera as ilustrações dos pratos em public/fotos/*.svg
// Uso: node scripts/gerar-fotos.mjs
// O nome de cada arquivo é o id do prato (nome em minúsculas, sem acento, com hífens).
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = new URL('../public/fotos/', import.meta.url);
mkdirSync(OUT, { recursive: true });

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(str) {
  let h = 2166136261;
  for (const c of str) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const f = (n) => Math.round(n * 10) / 10;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rep = (n, fn) => Array.from({ length: n }, (_, i) => fn(i)).join('');

/* ---------- primitivas ---------- */
const zone = (x, y, w, h) => ({ x, y, w, h, s: clamp(Math.min(w, h) / 60, 0.85, 1.5) });
const cnt = (z, base) => Math.max(3, Math.round((base * z.w * z.h) / (76 * 60)));

/** Ponto aleatório dentro da elipse da zona. */
function pt(z, r, inset = 6) {
  const a = r() * Math.PI * 2;
  const d = Math.sqrt(r());
  return [
    z.x + z.w / 2 + Math.cos(a) * d * Math.max(2, z.w / 2 - inset),
    z.y + z.h / 2 + Math.sin(a) * d * Math.max(2, z.h / 2 - inset),
  ];
}
const attrs = (fill, stroke, sw = 1) => `fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${sw}"` : ''}`;
const rect = (cx, cy, w, h, rot, fill, stroke, rx = 2.5) =>
  `<rect x="${f(cx - w / 2)}" y="${f(cy - h / 2)}" width="${f(w)}" height="${f(h)}" rx="${rx}" ${attrs(fill, stroke)} transform="rotate(${f(rot)} ${f(cx)} ${f(cy)})"/>`;
const circ = (cx, cy, r, fill, stroke) => `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" ${attrs(fill, stroke)}/>`;
const ell = (cx, cy, rx, ry, rot, fill, stroke) =>
  `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}" ${attrs(fill, stroke)} transform="rotate(${f(rot)} ${f(cx)} ${f(cy)})"/>`;
const blob = (z, fill, stroke, inset = 1) =>
  `<rect x="${f(z.x + inset)}" y="${f(z.y + inset)}" width="${f(z.w - 2 * inset)}" height="${f(z.h - 2 * inset)}" rx="${f(Math.min(z.w, z.h) * 0.36)}" ${attrs(fill, stroke, 1.5)}/>`;
const line = (x1, y1, x2, y2, stroke, w) =>
  `<path d="M${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" fill="none"/>`;
const curve = (z, r, stroke, w, len) => {
  const [x, y] = pt(z, r, 8);
  const a = r() * Math.PI * 2;
  const dx = Math.cos(a) * len;
  const dy = Math.sin(a) * len;
  const bend = (r() - 0.5) * len;
  return `<path d="M${f(x - dx / 2)} ${f(y - dy / 2)}Q${f(x + bend)} ${f(y - bend)} ${f(x + dx / 2)} ${f(y + dy / 2)}" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round" fill="none"/>`;
};

/* ---------- alimentos ---------- */
const arroz = (z, r, extra = '') =>
  blob(z, '#fffdf5', '#e5dbc3') +
  rep(cnt(z, 28), () => {
    const [x, y] = pt(z, r, 7 * z.s);
    return ell(x, y, 2.6 * z.s, 0.95 * z.s, r() * 180, '#eee3c9');
  }) +
  extra;

const arrozCenoura = (z, r) =>
  arroz(
    z,
    r,
    rep(cnt(z, 7), () => {
      const [x, y] = pt(z, r, 8 * z.s);
      return rect(x, y, 3 * z.s, 3 * z.s, r() * 90, '#f08c2e', null, 1);
    }),
  );

const feijao = (z, r) =>
  blob(z, '#9a6637', '#774a24') +
  rep(cnt(z, 12), () => {
    const [x, y] = pt(z, r, 7 * z.s);
    return ell(x, y, 3.3 * z.s, 2.2 * z.s, r() * 180, '#6f4322');
  }) +
  rep(cnt(z, 20), () => {
    const [x, y] = pt(z, r, 7 * z.s);
    return ell(x, y, 3 * z.s, 2 * z.s, r() * 180, '#c9955a', '#a97640');
  });

const cenoura = (z, r) =>
  rep(cnt(z, 7), () => {
    const [x, y] = pt(z, r, 9 * z.s);
    return circ(x, y, 6.5 * z.s, '#ef8a2c', '#cf6d14') + circ(x, y, 3 * z.s, '#f7b466');
  });

const mandioquinha = (z, r) =>
  rep(cnt(z, 6), () => {
    const [x, y] = pt(z, r, 10 * z.s);
    return rect(x, y, 11 * z.s, 9 * z.s, r() * 90, '#f3de92', '#d6bb5c', 3);
  });

const carneDePanela = (z, r) =>
  blob(z, '#8d4c27', '#6d3818') +
  rep(cnt(z, 9), () => {
    const [x, y] = pt(z, r, 14 * z.s);
    const rot = r() * 180;
    return rect(x, y, 15 * z.s, 10 * z.s, rot, '#a85f31', '#7c4120', 4) + ell(x - 1, y - 2, 4 * z.s, 1.6 * z.s, rot, '#c88049');
  });

const strogonoff = (z, r) =>
  blob(z, '#eab27c', '#cf935d') +
  rep(cnt(z, 9), () => {
    const [x, y] = pt(z, r, 12 * z.s);
    return rect(x, y, 13 * z.s, 8 * z.s, r() * 180, '#f6e0ba', '#d9bb8a', 3.5);
  }) +
  rep(cnt(z, 5), () => {
    const [x, y] = pt(z, r, 10 * z.s);
    return ell(x, y, 4 * z.s, 2.6 * z.s, r() * 180, '#cfa77b');
  });

const batataRustica = (z, r) =>
  rep(cnt(z, 5), () => {
    const [x, y] = pt(z, r, 11 * z.s);
    const rot = r() * 180;
    return (
      rect(x, y, 15 * z.s, 8 * z.s, rot, '#eac160', '#c79a33', 3.5) +
      circ(x + 2, y, 1 * z.s, '#a97520') +
      circ(x - 3, y + 1, 0.9 * z.s, '#a97520')
    );
  });

const ensopadoFrango = (z, r) =>
  blob(z, '#f1d08f', '#d9b269') +
  rep(cnt(z, 5), () => {
    const [x, y] = pt(z, r, 13 * z.s);
    return rect(x, y, 14 * z.s, 9 * z.s, r() * 180, '#fde9c4', '#e0c08a', 4);
  }) +
  rep(cnt(z, 6), () => {
    const [x, y] = pt(z, r, 10 * z.s);
    return circ(x, y, 5 * z.s, '#ef8a2c', '#cf6d14') + circ(x, y, 2 * z.s, '#f7b466');
  }) +
  rep(cnt(z, 5), () => {
    const [x, y] = pt(z, r, 10 * z.s);
    return rect(x, y, 7 * z.s, 7 * z.s, r() * 90, '#cfe6a8', '#a4c978', 1.5);
  }) +
  rep(cnt(z, 4), () => {
    const [x, y] = pt(z, r, 10 * z.s);
    return rect(x, y, 7 * z.s, 7 * z.s, r() * 90, '#f4d776', '#d3b13f', 1.5);
  });

const costela = (z, r) =>
  blob(z, '#6a3520', '#4b2312') +
  rep(cnt(z, 16), () => curve(z, r, '#9a5330', 3.4 * z.s, 22 * z.s)) +
  rep(cnt(z, 12), () => curve(z, r, '#c27b46', 2 * z.s, 18 * z.s)) +
  rep(cnt(z, 6), () => curve(z, r, '#53281a', 2.4 * z.s, 16 * z.s));

const pure = (z, r) => {
  const cx = z.x + z.w / 2;
  const cy = z.y + z.h / 2;
  const rad = Math.min(z.w, z.h) / 2 - 2;
  return (
    circ(cx, cy, rad, '#f7e7b8', '#dfc989') +
    `<path d="M${f(cx - rad * 0.55)} ${f(cy)}Q${f(cx)} ${f(cy - rad * 0.8)} ${f(cx + rad * 0.55)} ${f(cy)}M${f(cx - rad * 0.3)} ${f(cy + rad * 0.3)}Q${f(cx)} ${f(cy - rad * 0.2)} ${f(cx + rad * 0.3)} ${f(cy + rad * 0.3)}" stroke="#e8d398" stroke-width="${f(2 * z.s)}" stroke-linecap="round" fill="none"/>` +
    ell(cx, cy - rad * 0.1, 3.4 * z.s, 2.2 * z.s, 0, '#fad45c')
  );
};

const feijoada = (z, r) =>
  blob(z, '#2b1913', '#150a07') +
  rep(cnt(z, 26), () => {
    const [x, y] = pt(z, r, 8 * z.s);
    return ell(x, y, 3 * z.s, 2 * z.s, r() * 180, '#4a2c20', '#5e3a2c');
  }) +
  rep(cnt(z, 5), () => {
    const [x, y] = pt(z, r, 14 * z.s);
    return circ(x, y, 7 * z.s, '#b34630', '#7d2a1a') + circ(x - 1.5, y - 1.5, 2.2 * z.s, '#dc8671') + circ(x + 2, y + 2, 1.6 * z.s, '#dc8671');
  }) +
  rep(cnt(z, 4), () => {
    const [x, y] = pt(z, r, 12 * z.s);
    return rect(x, y, 11 * z.s, 7 * z.s, r() * 180, '#8b4a2c', '#5e2f18', 3);
  });

const couve = (z, r) =>
  blob(z, '#2c6a35', '#1d4d25') +
  rep(cnt(z, 12), () => curve(z, r, '#4f9150', 2.6 * z.s, 18 * z.s)) +
  rep(cnt(z, 8), () => curve(z, r, '#1d4d25', 2.2 * z.s, 14 * z.s));

const farofa = (z, r) =>
  rep(cnt(z, 60), () => {
    const [x, y] = pt(z, r, 5 * z.s);
    return circ(x, y, 1.7 * z.s, '#dba23e');
  }) +
  rep(cnt(z, 30), () => {
    const [x, y] = pt(z, r, 5 * z.s);
    return circ(x, y, 1.4 * z.s, '#b97a1e');
  }) +
  rep(cnt(z, 6), () => {
    const [x, y] = pt(z, r, 8 * z.s);
    return rect(x, y, 5 * z.s, 2.4 * z.s, r() * 180, '#b5402f', null, 1);
  });

const carneMoida = (z, r) =>
  blob(z, '#a65d36', '#82442a') +
  rep(cnt(z, 70), () => {
    const [x, y] = pt(z, r, 9 * z.s);
    return circ(x, y, 2 * z.s, r() > 0.5 ? '#5c2f1a' : '#744024');
  }) +
  rep(cnt(z, 8), () => {
    const [x, y] = pt(z, r, 11 * z.s);
    return rect(x, y, 6 * z.s, 6 * z.s, r() * 90, '#ef8a2c', '#cf6d14', 1.5);
  }) +
  rep(cnt(z, 7), () => {
    const [x, y] = pt(z, r, 11 * z.s);
    return rect(x, y, 6 * z.s, 6 * z.s, r() * 90, '#cfe6a8', '#a4c978', 1.5);
  });

const frangoGrelhado = (z, r) => {
  const cx = z.x + z.w / 2;
  const cy = z.y + z.h / 2;
  const rx = z.w * 0.43;
  const ry = z.h * 0.34;
  // marcas de grelha com altura limitada pela borda da elipse (não vazam do filé)
  const marks = rep(5, (i) => {
    const off = (i - 2) * (rx * 0.34);
    const hh = ry * Math.sqrt(Math.max(0, 1 - (off / rx) ** 2)) * 0.78;
    return line(cx + off - 3, cy - hh, cx + off + 3, cy + hh, '#8c5a22', 3.2 * z.s);
  });
  return (
    ell(cx, cy, rx, ry, -18, '#e8b56c', '#c48a3e') +
    `<g transform="rotate(-18 ${f(cx)} ${f(cy)})" opacity=".85">${marks}</g>` +
    ell(cx - rx * 0.25, cy - ry * 0.45, rx * 0.35, ry * 0.15, -18, '#f6d49b')
  );
};

const abobrinhaBacon = (z, r) =>
  rep(cnt(z, 5), () => {
    const [x, y] = pt(z, r, 10 * z.s);
    return circ(x, y, 6.5 * z.s, '#6fa043') + circ(x, y, 5 * z.s, '#cfe18f') + circ(x - 1, y, 1 * z.s, '#a7c868') + circ(x + 1.5, y + 1.5, 0.9 * z.s, '#a7c868');
  }) +
  rep(cnt(z, 5), () => {
    const [x, y] = pt(z, r, 8 * z.s);
    return rect(x, y, 8 * z.s, 3.4 * z.s, r() * 180, '#b5402f', '#8a2a1a', 1) + rect(x, y, 6 * z.s, 1 * z.s, 0, '#e9a393', null, 0.5);
  });

const iscaCarne = (z, r) =>
  blob(z, '#6b3a1e', '#4d2610') +
  rep(cnt(z, 9), () => {
    const [x, y] = pt(z, r, 12 * z.s);
    return rect(x, y, 22 * z.s, 5.5 * z.s, r() * 180, '#9a5a30', '#6f3c1c', 2.5);
  }) +
  rep(cnt(z, 8), () => curve(z, r, '#f3e6c8', 2.4 * z.s, 14 * z.s));

const brocolis = (z, r) =>
  rep(cnt(z, 3), () => {
    const [x, y] = pt(z, r, 12 * z.s);
    return (
      rect(x, y + 5 * z.s, 4 * z.s, 8 * z.s, 0, '#8ab86a', null, 2) +
      circ(x - 4 * z.s, y, 4.6 * z.s, '#3c8a3c') +
      circ(x + 4 * z.s, y, 4.6 * z.s, '#3c8a3c') +
      circ(x, y - 3.4 * z.s, 5 * z.s, '#4aa14a')
    );
  }) +
  rep(cnt(z, 3), () => {
    const [x, y] = pt(z, r, 10 * z.s);
    return circ(x, y, 4.2 * z.s, '#ef8a2c', '#cf6d14') + circ(x, y, 1.8 * z.s, '#f7b466');
  });

const fricasse = (z, r) =>
  blob(z, '#f6e3ad', '#dcc17c') +
  rep(cnt(z, 8), () => {
    const [x, y] = pt(z, r, 12 * z.s);
    return rect(x, y, 13 * z.s, 8 * z.s, r() * 180, '#fff3d6', '#e2c993', 3.5);
  }) +
  rep(cnt(z, 16), () => {
    const [x, y] = pt(z, r, 8 * z.s);
    return circ(x, y, 2.3 * z.s, '#f4c430', '#d6a519');
  }) +
  rep(cnt(z, 8), () => {
    const [x, y] = pt(z, r, 8 * z.s);
    return circ(x, y, 2.1 * z.s, '#7bb662', '#5a9444');
  });

const batataPalha = (z, r) =>
  rep(cnt(z, 40), () => {
    const [x, y] = pt(z, r, 8 * z.s);
    const a = r() * Math.PI;
    const l = (7 + r() * 8) * z.s;
    return line(x - Math.cos(a) * l / 2, y - Math.sin(a) * l / 2, x + Math.cos(a) * l / 2, y + Math.sin(a) * l / 2, r() > 0.5 ? '#e8b84a' : '#d49a2c', 1.6 * z.s);
  });

const picanha = (z, r) =>
  blob(z, '#8a4a2c', '#64301a') +
  rep(cnt(z, 7), () => {
    const [x, y] = pt(z, r, 14 * z.s);
    const rot = r() * 180;
    return rect(x, y, 24 * z.s, 10 * z.s, rot, '#cd8a66', '#a8623f', 4) + rect(x, y - 3.4 * z.s, 20 * z.s, 1.6 * z.s, rot, '#f1d2b8', null, 1);
  }) +
  rep(cnt(z, 7), () => curve(z, r, '#f3e6c8', 2.4 * z.s, 14 * z.s));

const lasanha = (z, r) => {
  // Vista de 3/4: parte de cima (molho e muçarela gratinada) e corte lateral mostrando as camadas.
  const topH = z.h * 0.6;
  const frontY = z.y + topH - 6;
  const frontH = z.h - topH + 6;
  const layers = ['#f4dc9c', '#c4452c', '#f4dc9c', '#d9523a', '#f4dc9c', '#c4452c'];
  const lh = frontH / layers.length;
  const top = { x: z.x + 8, y: z.y + 6, w: z.w - 16, h: topH - 12 };
  return (
    `<clipPath id="front"><rect x="${z.x}" y="${f(frontY)}" width="${z.w}" height="${f(frontH)}" rx="10"/></clipPath>` +
    `<rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="16" fill="#8f2a17"/>` +
    `<g clip-path="url(#front)">${layers.map((c, i) => `<rect x="${z.x}" y="${f(frontY + i * lh)}" width="${z.w}" height="${f(lh + 0.5)}" fill="${c}"/>`).join('')}` +
    rep(40, () => circ(z.x + r() * z.w, frontY + r() * frontH, 1.2, '#b8431f', null)) +
    `</g>` +
    `<rect x="${top.x}" y="${top.y}" width="${top.w}" height="${f(top.h)}" rx="14" fill="#c4452c" stroke="#a23520" stroke-width="2"/>` +
    // muçarela derretida: muitas manchas sobrepostas
    rep(26, () => {
      const [x, y] = pt(zone(top.x, top.y, top.w, top.h), r, 14);
      return ell(x, y, 10 + r() * 14, 6 + r() * 6, r() * 180, '#f7dc83');
    }) +
    rep(14, () => {
      const [x, y] = pt(zone(top.x, top.y, top.w, top.h), r, 12);
      return ell(x, y, 4 + r() * 5, 3 + r() * 3, r() * 180, '#e0a644');
    }) +
    rep(22, () => {
      const [x, y] = pt(zone(top.x, top.y, top.w, top.h), r, 10);
      return circ(x, y, 1.3, '#3f7a3a');
    })
  );
};

/* ---------- montagem ---------- */
const SIDE = { x: 34, y: 58 };

function plate(id, label, mainFn, rightFns) {
  const r = mulberry32(hash(id));
  const single = rightFns.length === 0;
  const main = single ? zone(34, 58, 172, 124) : zone(34, 58, 90, 124);
  const n = rightFns.length;
  const gap = 4;
  const h = (124 - gap * (n - 1)) / Math.max(1, n);
  const rights = rightFns.map((fn, i) => ({ fn, z: zone(130, SIDE.y + i * (h + gap), 76, h) }));

  let walls = '';
  if (!single) {
    walls += `<path d="M127 55V185" stroke="#e6dcc6" stroke-width="3"/>`;
    for (let i = 1; i < n; i++) {
      const y = SIDE.y + i * (h + gap) - gap / 2;
      walls += `<path d="M128 ${f(y)}H209" stroke="#e6dcc6" stroke-width="3"/>`;
    }
  }
  const body = mainFn(main, r) + rights.map(({ fn, z }) => fn(z, r)).join('');
  return wrap(label, walls + body);
}

const CREAM = '#f6eedd';
function wrap(label, inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" role="img" aria-label="${label}">
<rect width="240" height="240" rx="30" fill="${CREAM}"/>
<ellipse cx="120" cy="216" rx="88" ry="9" fill="#1f4030" opacity=".1"/>
<rect x="18" y="38" width="204" height="168" rx="24" fill="#1f4030"/>
<rect x="22" y="42" width="196" height="160" rx="21" fill="none" stroke="#2f5f47" stroke-width="2"/>
<rect x="30" y="52" width="180" height="136" rx="14" fill="#f9f4e8"/>
${inner}
<path d="M120 203C111 197 113 191.5 116.5 191.5C118.5 191.5 120 193 120 194C120 193 121.5 191.5 123.5 191.5C127 191.5 129 197 120 203Z" fill="#e8794a"/>
<g stroke="#7fb7d9" stroke-width="2.6" stroke-linecap="round"><path d="M208 12v20M199.3 17l17.4 10M199.3 27l17.4-10"/></g>
</svg>
`;
}

const dishes = [
  ['carne-de-panela', 'Carne de panela', carneDePanela, [mandioquinha, cenoura]],
  ['strogonoff-de-frango', 'Strogonoff de frango', strogonoff, [arroz, batataRustica]],
  ['frango-ensopado-com-legumes', 'Frango ensopado com legumes', ensopadoFrango, [arroz]],
  ['costela-desfiada', 'Costela desfiada', costela, [arroz, pure]],
  ['feijoada-leve', 'Feijoada leve', feijoada, [arroz, couve, farofa]],
  ['ensopado-de-carne-moida-com-legumes', 'Ensopado de carne moída com legumes', carneMoida, [arroz, feijao]],
  ['frango-grelhado', 'Frango grelhado', frangoGrelhado, [arrozCenoura, feijao, abobrinhaBacon]],
  ['isca-de-carne-acebolada', 'Isca de carne acebolada', iscaCarne, [arroz, feijao, brocolis]],
  ['lasanha-a-bolonhesa', 'Lasanha à bolonhesa', lasanha, []],
  ['fricasse-de-frango', 'Fricassê de frango', fricasse, [arroz, batataPalha]],
  ['picanha-suina-acebolada', 'Picanha suína acebolada', picanha, [arroz, feijao, couve]],
];

for (const [id, label, main, right] of dishes) {
  writeFileSync(new URL(`${id}.svg`, OUT), plate(id, label, main, right));
}

/* ---------- bolo de pote (imagem genérica das sobremesas) ---------- */
const boloDePote = wrap('Bolo de pote', '').replace(
  /<rect x="18"[\s\S]*<\/svg>/,
  `<clipPath id="jar"><rect x="66" y="74" width="108" height="124" rx="18"/></clipPath>
<rect x="66" y="74" width="108" height="124" rx="18" fill="#fffdf8" stroke="#d8cdb4" stroke-width="3"/>
<g clip-path="url(#jar)">
  <rect x="66" y="162" width="108" height="40" fill="#74412a"/>
  <rect x="66" y="144" width="108" height="20" fill="#fbf0dc"/>
  <rect x="66" y="124" width="108" height="22" fill="#8a5233"/>
  <rect x="66" y="106" width="108" height="20" fill="#fbf0dc"/>
  <path d="M66 106q14 12 27 0t27 0t27 0t27 0V96H66z" fill="#fbf0dc"/>
  <rect x="72" y="74" width="9" height="124" rx="4" fill="#fff" opacity=".35"/>
</g>
<circle cx="120" cy="86" r="14" fill="#d1304a"/>
<path d="M112 76q8-8 16 0q-8 4-16 0z" fill="#3f8a3e"/>
<circle cx="115" cy="85" r="1.4" fill="#f5b3bd"/><circle cx="124" cy="88" r="1.4" fill="#f5b3bd"/><circle cx="120" cy="92" r="1.4" fill="#f5b3bd"/>
<rect x="60" y="62" width="120" height="16" rx="7" fill="#b4451b"/>
<path d="M120 76C113 71 114 66.5 117 66.5C118.5 66.5 120 67.7 120 68.7C120 67.7 121.5 66.5 123 66.5C126 66.5 127 71 120 76Z" fill="#f6eedd" transform="translate(0 2)"/>
<g stroke="#7fb7d9" stroke-width="2.6" stroke-linecap="round"><path d="M208 12v20M199.3 17l17.4 10M199.3 27l17.4-10"/></g>
</svg>`,
);
writeFileSync(new URL('bolo-de-pote.svg', OUT), boloDePote);

console.log(`${dishes.length + 1} imagens geradas em public/fotos/`);
