/**
 * Sabor de Cuidado - backend (Google Apps Script vinculado à planilha de pedidos).
 *
 * - GET  ?action=menu  -> devolve o cardápio lido das abas Config, Cardápio, Kits e Sobremesas
 * - POST {action:'order', ...} -> valida, recalcula o preço e grava o pedido na aba da semana
 *
 * Passo a passo de instalação: docs/CONFIGURAR.md
 * A regra de preço (priceLine_) e a de ciclo (deliveryDate_) espelham src/lib/pricing.ts e
 * src/lib/cycle.ts. O teste src/lib/parity.test.ts garante que as duas versões calculam igual.
 */

var TZ = 'America/Sao_Paulo';
var TAB_CONFIG = 'Config';
var TAB_MENU = 'Cardápio';
var TAB_KITS = 'Kits';
var TAB_DESSERTS = 'Sobremesas';
var WEEK_PREFIX = 'Entrega ';
var MAX_QTY = 50;
var MAX_LINES = 30;
var MENU_CACHE_SECONDS = 60;
var RATE_LIMIT_ORDERS = 5; // pedidos por telefone...
var RATE_LIMIT_SECONDS = 600; // ...a cada 10 minutos
var GLOBAL_LIMIT_10MIN = 20; // teto de pedidos da loja inteira em 10 minutos (normal: poucos por dia)
var GLOBAL_LIMIT_HOUR = 60; // e em 1 hora
var MIN_FILL_MS = 1500; // tempo mínimo entre abrir o checkout e enviar (robôs enviam na hora)

var TAB_PROD = 'Produção';
var TAB_STATS = 'Estatísticas';
var TAB_STATS_DATA = 'Visitas (dados)';
var STAT_EVENTS = ['visita', 'sacola', 'checkout', 'pedido'];

var ORDER_HEADERS = [
  'Pedido', 'Data/hora', 'Cliente', 'WhatsApp', 'Tipo', 'Endereço', 'Itens',
  'Total', 'Status', 'Obs. do cliente', 'Obs. internas', 'Dados (JSON)'
];
var STATUS_LIST = ['Aguardando comprovante', 'Pago', 'Entregue', 'Cancelado'];
var COL = { id: 1, when: 2, name: 3, phone: 4, type: 5, address: 6, items: 7, total: 8, status: 9, obs: 10, internal: 11, json: 12 };

/* ========================== Entrada HTTP ========================== */

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'menu';
  if (action === 'menu') {
    try {
      return json_({ ok: true, menu: getMenu_() });
    } catch (err) {
      console.error(err);
      return json_({ ok: false, error: 'Cardápio indisponível.' });
    }
  }
  if (action === 'status') {
    var status = getOrderStatus_(e.parameter.id, e.parameter.entrega);
    return status === null ? json_({ ok: false, error: 'Consulta inválida.' }) : json_({ ok: true, status: status });
  }
  return json_({ ok: false, error: 'Ação inválida.' });
}

/**
 * Situação de um pedido, para o site saber se ainda deve cobrar o comprovante.
 * Devolve apenas o status (nunca dados do cliente). O código do pedido é aleatório.
 * Retorna null se os parâmetros forem inválidos e 'nao_encontrado' se não existir na planilha.
 */
function getOrderStatus_(id, entregaISO) {
  id = str_(id);
  entregaISO = str_(entregaISO);
  if (!/^SC[-A-Z0-9]{4,20}$/.test(id) || !/^\d{4}-\d{2}-\d{2}$/.test(entregaISO)) return null;
  var sh = SpreadsheetApp.getActive().getSheetByName(WEEK_PREFIX + entregaISO);
  if (!sh) return 'nao_encontrado';
  var ids = sh.getRange(1, COL.id, sh.getMaxRows(), 1).getValues();
  for (var i = 1; i < ids.length; i++) {
    if (String(ids[i][0]) === id) {
      return str_(sh.getRange(i + 1, COL.status, 1, 1).getValues()[0][0]) || 'nao_encontrado';
    }
  }
  return 'nao_encontrado';
}

function doPost(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) || '';
    if (raw.length > 20000) throw { user: 'Pedido grande demais.' };
    var body = JSON.parse(raw);
    if (body.action === 'evento') {
      registrarEvento_(str_(body.evento), str_(body.origem));
      return json_({ ok: true });
    }
    if (body.action !== 'order') throw { user: 'Ação inválida.' };
    return json_({ ok: true, pedido: createOrder_(body) });
  } catch (err) {
    if (err && err.user) return json_({ ok: false, error: err.user });
    console.error(err && err.stack ? err.stack : err);
    return json_({ ok: false, error: 'Não foi possível registrar o pedido. Tente novamente.' });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ========================== Utilidades ========================== */

function pad2_(n) { return (n < 10 ? '0' : '') + n; }

function normKey_(text) {
  return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function slug_(text) {
  return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function str_(v) { return v === null || v === undefined ? '' : String(v).trim(); }

/** Texto livre vindo do cliente: sem caracteres de controle e com tamanho limitado. */
function clip_(v, max) {
  return str_(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);
}

function yes_(v, whenBlank) {
  if (v === true) return true;
  if (v === false) return false;
  var s = normKey_(v);
  if (s === '') return !!whenBlank;
  return ['sim', 's', 'true', 'verdadeiro', '1', 'yes', 'x'].indexOf(s) >= 0;
}

/** Converte "27,90", 27.9 ou "R$ 1.234,50" em centavos. */
function toCents_(v) {
  if (typeof v === 'number') return Math.round(v * 100);
  var s = str_(v).replace(/[R$\s]/g, '');
  if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
  var n = parseFloat(s);
  return isNaN(n) ? 0 : Math.round(n * 100);
}

function toInt_(v, fallback) {
  var n = parseInt(str_(v), 10);
  return isNaN(n) ? fallback : n;
}

function brl_(cent) {
  var sign = cent < 0 ? '-' : '';
  var abs = Math.abs(Math.round(cent));
  var reais = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return sign + 'R$ ' + reais + ',' + pad2_(abs % 100);
}

function uniqueId_(base, used) {
  var id = base || 'item';
  var n = 2;
  while (used[id]) { id = base + '-' + n; n++; }
  used[id] = true;
  return id;
}

/* ========================== Ciclo semanal ========================== */

/**
 * Ciclo: quinta 00:00 até quarta 23:59. Entrega na segunda seguinte à quarta de fechamento.
 * Recebe e devolve datas no formato AAAA-MM-DD.
 */
function deliveryDate_(todayISO) {
  var p = todayISO.split('-');
  var t = Date.UTC(+p[0], +p[1] - 1, +p[2]);
  var dow = new Date(t).getUTCDay();
  var add = ((3 - dow + 7) % 7) + 5;
  var r = new Date(t + add * 86400000);
  return r.getUTCFullYear() + '-' + pad2_(r.getUTCMonth() + 1) + '-' + pad2_(r.getUTCDate());
}

function todayISO_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

/* ========================== Leitura do cardápio ========================== */

function readTable_(sheetName) {
  var sh = SpreadsheetApp.getActive().getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2) return [];
  var values = sh.getDataRange().getValues();
  var keys = values[0].map(normKey_);
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var obj = {};
    for (var c = 0; c < keys.length; c++) if (keys[c]) obj[keys[c]] = values[i][c];
    rows.push(obj);
  }
  return rows;
}

function readConfig_() {
  var cfg = {};
  readTable_(TAB_CONFIG).forEach(function (r) {
    var k = normKey_(r.chave);
    if (k) cfg[k] = r.valor;
  });
  return cfg;
}

function normalizePhone_(v) {
  var d = str_(v).replace(/\D/g, '');
  return d.length === 10 || d.length === 11 ? '55' + d : d;
}

/** Monta o cardápio (valores em centavos) a partir das abas. Usa cache curto. */
function getMenu_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('menu');
  if (hit) return JSON.parse(hit);

  var cfg = readConfig_();
  var usedDish = {};
  var pratos = readTable_(TAB_MENU)
    .filter(function (r) { return str_(r.nome) && yes_(r.ativo, true); })
    .map(function (r) {
      var d = {
        id: uniqueId_(slug_(r.nome), usedDish),
        categoria: str_(r.categoria) || 'Pratos',
        nome: str_(r.nome),
        descricao: str_(r.descricao),
        adicionalCent: toCents_(r.adicional)
      };
      if (str_(r.foto)) d.foto = str_(r.foto);
      return d;
    });

  var usedKit = {};
  var kits = readTable_(TAB_KITS)
    .filter(function (r) { return toInt_(r.marmitas, 0) > 0 && yes_(r.ativo, true); })
    .map(function (r) {
      var marmitas = toInt_(r.marmitas, 0);
      var k = {
        id: uniqueId_('kit-' + marmitas, usedKit),
        nome: str_(r.nome) || (marmitas + ' marmitas'),
        marmitas: marmitas,
        precoCent: toCents_(r.preco),
        maxPratos: Math.min(toInt_(r.max_pratos, marmitas), marmitas),
        sobremesasGratis: toInt_(r.sobremesas_gratis, 0)
      };
      if (str_(r.destaque)) k.destaque = str_(r.destaque);
      return k;
    })
    .sort(function (a, b) { return a.marmitas - b.marmitas; });

  var usedDessert = {};
  var sobremesas = readTable_(TAB_DESSERTS)
    .filter(function (r) { return str_(r.nome) && yes_(r.ativo, true); })
    .map(function (r) {
      var s = {
        id: uniqueId_(slug_(r.nome), usedDessert),
        nome: str_(r.nome),
        descricao: str_(r.descricao),
        precoCent: toCents_(r.preco)
      };
      if (str_(r.foto)) s.foto = str_(r.foto);
      return s;
    });

  var menu = {
    loja: {
      nome: str_(cfg.nome_loja) || 'Sabor de Cuidado',
      whatsapp: normalizePhone_(cfg.whatsapp),
      pixChave: str_(cfg.pix_chave),
      pixNome: str_(cfg.pix_nome) || str_(cfg.nome_loja),
      pixCidade: str_(cfg.pix_cidade),
      taxaEntregaCent: toCents_(cfg.taxa_entrega),
      retirada: yes_(cfg.retirada, true),
      avisoEntrega: str_(cfg.aviso_entrega),
      pedidosAbertos: yes_(cfg.pedidos_abertos, true)
    },
    precoAvulsaCent: toCents_(cfg.preco_avulsa),
    pratos: pratos,
    kits: kits,
    sobremesas: sobremesas
  };

  cache.put('menu', JSON.stringify(menu), MENU_CACHE_SECONDS);
  return menu;
}

/* ========================== Preço (espelha src/lib/pricing.ts) ========================== */

function userError_(msg) { return { user: msg }; }

function findBy_(list, id) {
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}

function isQty_(q) { return typeof q === 'number' && isFinite(q) && Math.floor(q) === q; }

function sumQty_(pratos) {
  var s = 0;
  Object.keys(pratos).forEach(function (k) { s += pratos[k]; });
  return s;
}

function kitProblem_(menu, kit, pratos, sobremesaId) {
  var ids = Object.keys(pratos);
  for (var i = 0; i < ids.length; i++) {
    var q = pratos[ids[i]];
    if (!isQty_(q) || q < 0 || q > MAX_QTY) return 'Quantidade inválida.';
    if (q > 0 && !findBy_(menu.pratos, ids[i])) return 'Um dos pratos não está mais disponível.';
  }
  var total = sumQty_(pratos);
  if (total < kit.marmitas) {
    var falta = kit.marmitas - total;
    return falta === 1 ? 'Falta 1 marmita.' : 'Faltam ' + falta + ' marmitas.';
  }
  if (total > kit.marmitas) return 'O kit tem ' + kit.marmitas + ' marmitas.';
  var distinct = ids.filter(function (id) { return pratos[id] > 0; }).length;
  if (distinct > kit.maxPratos) return 'Escolha no máximo ' + kit.maxPratos + ' pratos diferentes.';
  if (kit.sobremesasGratis > 0 && menu.sobremesas.length > 0) {
    if (!sobremesaId) return 'Escolha a sobremesa grátis.';
    if (!findBy_(menu.sobremesas, sobremesaId)) return 'Sobremesa indisponível.';
  }
  return null;
}

function priceLine_(menu, line) {
  if (!line || typeof line !== 'object') throw userError_('Item inválido.');

  if (line.tipo === 'kit') {
    var kit = findBy_(menu.kits, line.kitId);
    if (!kit) throw userError_('Kit indisponível.');
    var pratos = line.pratos;
    if (!pratos || typeof pratos !== 'object' || Array.isArray(pratos)) throw userError_('Item inválido.');
    var problem = kitProblem_(menu, kit, pratos, line.sobremesaId);
    if (problem) throw userError_(problem);
    var detalhes = [];
    var extra = 0;
    menu.pratos.forEach(function (d) {
      var q = pratos[d.id] || 0;
      if (q <= 0) return;
      detalhes.push(q + 'x ' + d.nome + (d.adicionalCent > 0 ? ' (+' + brl_(d.adicionalCent) + ' cada)' : ''));
      extra += d.adicionalCent * q;
    });
    if (kit.sobremesasGratis > 0 && line.sobremesaId) {
      var s = findBy_(menu.sobremesas, line.sobremesaId);
      if (s) detalhes.push('Sobremesa grátis: ' + s.nome);
    }
    return { titulo: kit.nome + ' (' + kit.marmitas + ' marmitas)', detalhes: detalhes, totalCent: kit.precoCent + extra };
  }

  if (line.tipo === 'prato') {
    var dish = findBy_(menu.pratos, line.pratoId);
    if (!dish) throw userError_('Prato indisponível.');
    if (!isQty_(line.qtd) || line.qtd < 1 || line.qtd > MAX_QTY) throw userError_('Quantidade inválida.');
    return {
      titulo: line.qtd + 'x ' + dish.nome + ' (avulsa)',
      detalhes: [],
      totalCent: (menu.precoAvulsaCent + dish.adicionalCent) * line.qtd
    };
  }

  if (line.tipo === 'sobremesa') {
    var dessert = findBy_(menu.sobremesas, line.sobremesaId);
    if (!dessert) throw userError_('Sobremesa indisponível.');
    if (!isQty_(line.qtd) || line.qtd < 1 || line.qtd > MAX_QTY) throw userError_('Quantidade inválida.');
    return { titulo: line.qtd + 'x ' + dessert.nome, detalhes: [], totalCent: dessert.precoCent * line.qtd };
  }

  throw userError_('Item inválido.');
}

function priceOrder_(menu, linhas, modo) {
  if (!Array.isArray(linhas) || linhas.length === 0) throw userError_('A sacola está vazia.');
  if (linhas.length > MAX_LINES) throw userError_('Itens demais no pedido.');
  var lines = linhas.map(function (l) { return priceLine_(menu, l); });
  var subtotalCent = 0;
  lines.forEach(function (l) { subtotalCent += l.totalCent; });
  var taxaCent = modo === 'entrega' ? menu.loja.taxaEntregaCent : 0;
  return { lines: lines, subtotalCent: subtotalCent, taxaCent: taxaCent, totalCent: subtotalCent + taxaCent };
}

function itemsText_(priced) {
  return priced.lines.map(function (l) {
    return '• ' + l.titulo + (l.detalhes.length ? '\n' + l.detalhes.map(function (d) { return '   ' + d; }).join('\n') : '');
  }).join('\n');
}

/* ========================== Gravação do pedido ========================== */

function createOrder_(body) {
  if (str_(body.website)) throw userError_('Pedido recusado.');

  var requestId = str_(body.requestId);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) throw userError_('Pedido inválido.');

  // Reenvio do mesmo pedido (resposta perdida): devolve o que já foi gravado, sem nova verificação.
  var earlier = CacheService.getScriptCache().get('req_' + requestId);
  if (earlier) return JSON.parse(earlier);

  // Filtros anti-robô: tempo mínimo de preenchimento e (se configurado) Cloudflare Turnstile.
  if (typeof body.tempoMs !== 'number' || body.tempoMs < MIN_FILL_MS) throw userError_('Envio rápido demais. Tente de novo.');
  if (!verifyCaptcha_(body.captcha)) {
    throw userError_('Não conseguimos confirmar a verificação de segurança. Recarregue a página e tente de novo.');
  }

  var nome = clip_(body.nome, 80);
  if (nome.length < 2) throw userError_('Informe seu nome.');
  var phone = str_(body.whatsapp).replace(/\D/g, '');
  if (phone.length < 10 || phone.length > 11) throw userError_('Informe seu WhatsApp com DDD.');
  var modo = body.modo;
  if (modo !== 'entrega' && modo !== 'retirada') throw userError_('Escolha entrega ou retirada.');

  var menu = getMenu_();
  if (!menu.loja.pedidosAbertos) throw userError_('Os pedidos estão pausados no momento.');
  if (!menu.loja.pixChave) throw userError_('O Pix da loja ainda não foi configurado.');
  if (modo === 'retirada' && !menu.loja.retirada) throw userError_('Retirada indisponível.');

  var end = body.endereco || {};
  var endereco = '';
  if (modo === 'entrega') {
    var rua = clip_(end.rua, 120);
    var bairro = clip_(end.bairro, 60);
    if (rua.length < 3 || bairro.length < 2) throw userError_('Informe rua, número e bairro para a entrega.');
    var complemento = clip_(end.complemento, 120);
    var cep = clip_(end.cep, 9);
    endereco = rua + ' - ' + bairro + (complemento ? ' - ' + complemento : '') + (cep ? ' - CEP ' + cep : '');
  }

  var priced = priceOrder_(menu, body.linhas, modo);
  var obs = clip_(body.obs, 300);
  var result = null;
  var gid = 0;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw userError_('Estamos com muitos pedidos agora. Tente novamente em instantes.');
  try {
    var cache = CacheService.getScriptCache();

    // Reenvio do mesmo pedido (ex.: resposta perdida): devolve o resultado já gravado.
    var done = cache.get('req_' + requestId);
    if (done) return JSON.parse(done);

    // Limites por janela fixa: por telefone e para a loja inteira (trava de segurança contra spam).
    var bucket10 = Math.floor(Date.now() / 600000);
    var bucketHour = Math.floor(Date.now() / 3600000);
    var rlKey = 'rl_' + phone + '_' + bucket10;
    var g10Key = 'g10_' + bucket10;
    var gHourKey = 'gh_' + bucketHour;
    var count = parseInt(cache.get(rlKey) || '0', 10);
    var g10 = parseInt(cache.get(g10Key) || '0', 10);
    var gHour = parseInt(cache.get(gHourKey) || '0', 10);
    if (count >= RATE_LIMIT_ORDERS) throw userError_('Muitos pedidos em pouco tempo. Aguarde alguns minutos.');
    if (g10 >= GLOBAL_LIMIT_10MIN || gHour >= GLOBAL_LIMIT_HOUR) {
      throw userError_('Estamos com muitos pedidos agora. Tente novamente em alguns minutos.');
    }

    var entregaISO = deliveryDate_(todayISO_());
    var sheet = getOrCreateWeekSheet_(entregaISO);

    var existing = readOrderIds_(sheet);
    var id = newOrderId_(existing);
    var row = existing.lastRow + 1;
    if (row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 200);
    var formats = ['@', 'dd/MM/yyyy HH:mm', '@', '@', '@', '@', '@', '"R$" #,##0.00', '@', '@', '@', '@'];
    sheet.getRange(row, 1, 1, ORDER_HEADERS.length).setNumberFormats([formats]);
    sheet.getRange(row, 1, 1, ORDER_HEADERS.length).setValues([[
      id,
      new Date(),
      nome,
      phone,
      modo === 'entrega' ? 'Entrega' : 'Retirada',
      endereco,
      itemsText_(priced),
      priced.totalCent / 100,
      STATUS_LIST[0],
      obs,
      '',
      JSON.stringify({
        requestId: requestId, modo: modo, linhas: body.linhas, totalCent: priced.totalCent,
        itens: flattenItems_(menu, body.linhas) // base da aba Produção
      })
    ]]);

    result = {
      id: id,
      totalCent: priced.totalCent,
      subtotalCent: priced.subtotalCent,
      taxaCent: priced.taxaCent,
      entregaISO: entregaISO
    };
    cache.put('req_' + requestId, JSON.stringify(result), 21600);
    cache.put(rlKey, String(count + 1), RATE_LIMIT_SECONDS);
    cache.put(g10Key, String(g10 + 1), 660);
    cache.put(gHourKey, String(gHour + 1), 3700);
    gid = sheet.getSheetId();
  } finally {
    lock.releaseLock();
  }

  // Efeitos secundários fora do lock. Se falharem, o pedido já está gravado e não é perdido.
  try { notifyOwner_(result, nome, phone, modo, endereco, obs, priced, gid); } catch (e) { console.error(e); }
  try { atualizarProducao(); } catch (e) { console.error(e); }
  try { registrarEvento_('pedido', clip_(body.origem, 30)); } catch (e) { console.error(e); }
  return result;
}

/** Linhas simples (prato/sobremesa, nome, quantidade) para somar na aba Produção. */
function flattenItems_(menu, linhas) {
  var out = [];
  linhas.forEach(function (l) {
    if (l.tipo === 'kit') {
      menu.pratos.forEach(function (d) {
        var q = l.pratos[d.id] || 0;
        if (q > 0) out.push({ tipo: 'prato', nome: d.nome, qtd: q });
      });
      var kit = findBy_(menu.kits, l.kitId);
      var s = l.sobremesaId ? findBy_(menu.sobremesas, l.sobremesaId) : null;
      if (kit && kit.sobremesasGratis > 0 && s) out.push({ tipo: 'sobremesa', nome: s.nome, qtd: 1 });
    } else if (l.tipo === 'prato') {
      out.push({ tipo: 'prato', nome: findBy_(menu.pratos, l.pratoId).nome, qtd: l.qtd });
    } else if (l.tipo === 'sobremesa') {
      out.push({ tipo: 'sobremesa', nome: findBy_(menu.sobremesas, l.sobremesaId).nome, qtd: l.qtd });
    }
  });
  return out;
}

/**
 * Verificação anti-robô (Cloudflare Turnstile). Só é exigida se a Propriedade do script
 * TURNSTILE_SECRET estiver preenchida; sem ela, retorna true (ver docs/CONFIGURAR.md).
 * Se a Cloudflare estiver fora do ar, não bloqueia os clientes.
 */
function verifyCaptcha_(token) {
  var secret = PropertiesService.getScriptProperties().getProperty('TURNSTILE_SECRET');
  if (!secret) return true;
  if (!token || String(token).length > 4096) return false;
  try {
    var res = UrlFetchApp.fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'post',
      payload: { secret: secret, response: String(token) },
      muteHttpExceptions: true
    });
    return JSON.parse(res.getContentText()).success === true;
  } catch (err) {
    console.error(err);
    return true;
  }
}

/* ========================== Aviso por e-mail ========================== */

function dateLabel_(iso) {
  var p = iso.split('-');
  var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  var dias = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  return dias[d.getUTCDay()] + ', ' + p[2] + '/' + p[1];
}

function formatPhone_(d) {
  return d.length === 11 ? '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7) : '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
}

/** Destinatários: coluna Valor de email_pedidos na aba Config (vários separados por vírgula); senão, o dono da planilha. */
function ownerEmails_() {
  var raw = str_(readConfig_().email_pedidos);
  var list = raw.split(/[,;\s]+/).filter(function (m) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m); }).slice(0, 5);
  if (list.length === 0) {
    var self = Session.getEffectiveUser().getEmail();
    if (self) list = [self];
  }
  return list;
}

function notifyOwner_(result, nome, phone, modo, endereco, obs, priced, sheetGid) {
  var to = ownerEmails_();
  if (to.length === 0) return;
  var lines = [
    'Novo pedido ' + result.id + ' - ' + brl_(result.totalCent),
    '',
    'Cliente: ' + nome,
    'WhatsApp: ' + formatPhone_(phone) + '  https://wa.me/55' + phone,
    (modo === 'entrega' ? 'Entrega' : 'Retirada') + ' em ' + dateLabel_(result.entregaISO),
  ];
  if (endereco) lines.push('Endereço: ' + endereco);
  lines.push('', 'Itens:', itemsText_(priced), '', 'Total: ' + brl_(result.totalCent));
  if (obs) lines.push('Observações do cliente: ' + obs);
  lines.push('', 'Status: aguardando comprovante do Pix.',
    'Planilha: ' + SpreadsheetApp.getActive().getUrl() + '#gid=' + sheetGid);
  MailApp.sendEmail({
    to: to.join(','),
    subject: 'Novo pedido ' + result.id + ' - ' + brl_(result.totalCent) + ' - ' + dateLabel_(result.entregaISO),
    body: lines.join('\n'),
    name: 'Sabor de Cuidado'
  });
}

/* ========================== Abas semanais ========================== */

function getOrCreateWeekSheet_(entregaISO) {
  var ss = SpreadsheetApp.getActive();
  var name = WEEK_PREFIX + entregaISO;
  var sh = ss.getSheetByName(name);
  if (sh) return sh;

  sh = ss.insertSheet(name, 0); // a semana mais recente fica sempre na primeira posição
  var headerRange = sh.getRange(1, 1, 1, ORDER_HEADERS.length);
  headerRange.setValues([ORDER_HEADERS])
    .setFontWeight('bold').setBackground('#1f4030').setFontColor('#ffffff').setVerticalAlignment('middle');
  sh.setFrozenRows(1);

  // Texto puro nas colunas com dados do cliente: nada digitado vira fórmula.
  var maxRows = sh.getMaxRows();
  [COL.id, COL.name, COL.phone, COL.type, COL.address, COL.items, COL.status, COL.obs, COL.internal, COL.json]
    .forEach(function (c) { sh.getRange(2, c, maxRows - 1, 1).setNumberFormat('@'); });
  sh.getRange(2, COL.when, maxRows - 1, 1).setNumberFormat('dd/MM/yyyy HH:mm');
  sh.getRange(2, COL.total, maxRows - 1, 1).setNumberFormat('"R$" #,##0.00');
  sh.getRange(2, 1, maxRows - 1, ORDER_HEADERS.length).setVerticalAlignment('top');
  sh.getRange(2, COL.items, maxRows - 1, 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  sh.getRange(2, COL.address, maxRows - 1, 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);

  var widths = [130, 120, 160, 120, 80, 260, 360, 90, 170, 220, 220, 60];
  widths.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.hideColumns(COL.json);

  // Lista suspensa e cores do status
  var statusRange = sh.getRange(2, COL.status, maxRows - 1, 1);
  statusRange.setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(STATUS_LIST, true).setAllowInvalid(false).build()
  );
  var colors = { 'Aguardando comprovante': '#fff2cc', 'Pago': '#d9ead3', 'Entregue': '#cfe2f3', 'Cancelado': '#f4cccc' };
  sh.setConditionalFormatRules(Object.keys(colors).map(function (status) {
    return SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(status).setBackground(colors[status]).setRanges([statusRange]).build();
  }));

  // Resumo da semana
  sh.getRange('N1:O3').setValues([
    ['Pedidos', ''],
    ['Total (sem cancelados)', ''],
    ['Recebido (Pago + Entregue)', '']
  ]).setFontWeight('bold');
  sh.getRange('O1').setFormula('=COUNTA(A2:A)');
  sh.getRange('O2').setFormula('=SUMIF(I2:I,"<>Cancelado",H2:H)');
  sh.getRange('O3').setFormula('=SUMIF(I2:I,"Pago",H2:H)+SUMIF(I2:I,"Entregue",H2:H)');
  sh.getRange('O2:O3').setNumberFormat('"R$" #,##0.00');
  sh.setColumnWidth(14, 190);
  sh.setColumnWidth(15, 110);
  return sh;
}

/**
 * Lê a coluna A (Pedido): devolve os códigos já usados e a última linha preenchida.
 * Não usa getLastRow(), pois o resumo da semana (colunas N:O) também conta como conteúdo.
 */
function readOrderIds_(sheet) {
  var values = sheet.getRange(1, COL.id, sheet.getMaxRows(), 1).getValues();
  var used = {};
  var last = 1;
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] !== '') { used[String(values[i][0])] = true; last = i + 1; }
  }
  return { used: used, lastRow: last };
}

/**
 * Código do pedido mostrado ao cliente, ex.: SC-K7M4QX. É aleatório de propósito:
 * não revela quantos pedidos a loja recebeu. Sem letras/números parecidos (0/O, 1/I).
 */
function newOrderId_(existing) {
  var alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  for (var attempt = 0; attempt < 20; attempt++) {
    var code = '';
    for (var i = 0; i < 6; i++) code += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    var id = 'SC-' + code;
    if (!existing.used[id]) return id;
  }
  throw new Error('Não foi possível gerar um código de pedido único');
}

/**
 * Gatilho de alteração da planilha: descarta o cache do cardápio para que mudanças em
 * preços, pratos e kits apareçam no site na hora (sem esperar o cache expirar).
 */
function limparCacheDoCardapio() {
  CacheService.getScriptCache().remove('menu');
  // Mudou status, cancelou um pedido ou trocou a data na aba Produção: recalcula a contagem.
  try { atualizarProducao(); } catch (e) { console.error(e); }
}

/* ========================== Aba Produção ========================== */

function getOrCreateProducaoSheet_(ss) {
  var sh = ss.getSheetByName(TAB_PROD);
  if (sh) return sh;
  sh = ss.insertSheet(TAB_PROD, Math.min(1, ss.getSheets().length));
  sh.getRange('A1').setValue('Entrega (AAAA-MM-DD)').setFontWeight('bold');
  sh.getRange('B1').setNumberFormat('@').setValue(deliveryDate_(todayISO_()))
    .setBackground('#fff2cc').setFontWeight('bold')
    .setNote('Troque a data (AAAA-MM-DD) para ver a produção de outra semana. Use o nome da aba "Entrega ..." sem a palavra Entrega.');
  sh.getRange('A2').setValue('Pedidos').setFontWeight('bold');
  sh.setColumnWidth(1, 300); sh.setColumnWidth(2, 130); sh.setColumnWidth(3, 130); sh.setColumnWidth(4, 130);
  return sh;
}

/**
 * Soma as marmitas e sobremesas da semana escolhida em B1 (padrão: o ciclo atual).
 * Ignora pedidos cancelados. "Pagos" = Pago + Entregue; "Aguardando" = ainda sem comprovante.
 * Roda sozinha a cada pedido e a cada alteração na planilha.
 */
function atualizarProducao() {
  var ss = SpreadsheetApp.getActive();
  var sh = getOrCreateProducaoSheet_(ss);

  var raw = sh.getRange('B1').getValue();
  var entrega = raw instanceof Date ? Utilities.formatDate(raw, TZ, 'yyyy-MM-dd') : str_(raw);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entrega)) {
    entrega = deliveryDate_(todayISO_());
    sh.getRange('B1').setValue(entrega);
  }

  var agg = { prato: {}, sobremesa: {} };
  var pedidos = { pagos: 0, aguardando: 0 };
  var week = ss.getSheetByName(WEEK_PREFIX + entrega);
  var last = week ? readOrderIds_(week).lastRow : 1;
  if (week && last >= 2) {
    week.getRange(2, 1, last - 1, ORDER_HEADERS.length).getValues().forEach(function (r) {
      if (r[COL.id - 1] === '') return;
      var status = str_(r[COL.status - 1]);
      if (status === 'Cancelado') return;
      var pago = status === 'Pago' || status === 'Entregue';
      if (pago) pedidos.pagos++; else pedidos.aguardando++;
      var itens = [];
      try { itens = JSON.parse(str_(r[COL.json - 1])).itens || []; } catch (e) { itens = []; }
      itens.forEach(function (it) {
        var bucket = agg[it.tipo];
        if (!bucket) return;
        var cell = bucket[it.nome] || (bucket[it.nome] = { pago: 0, aberto: 0 });
        if (pago) cell.pago += it.qtd; else cell.aberto += it.qtd;
      });
    });
  }

  // Ordem do cardápio primeiro; pratos que saíram do cardápio vão ao fim.
  var menu = getMenu_();
  function ordered(bucket, menuNames) {
    var names = menuNames.filter(function (n) { return bucket[n]; });
    Object.keys(bucket).sort().forEach(function (n) { if (names.indexOf(n) < 0) names.push(n); });
    return names;
  }

  var rows = [];
  var headerRows = [];
  var totalRows = [];
  function block(title, bucket, menuNames, totalLabel) {
    headerRows.push(rows.length);
    rows.push([title, 'Pagos', 'Aguardando', 'Total']);
    var pago = 0, aberto = 0;
    ordered(bucket, menuNames).forEach(function (n) {
      rows.push([n, bucket[n].pago, bucket[n].aberto, bucket[n].pago + bucket[n].aberto]);
      pago += bucket[n].pago; aberto += bucket[n].aberto;
    });
    totalRows.push(rows.length);
    rows.push([totalLabel, pago, aberto, pago + aberto]);
    rows.push(['', '', '', '']);
  }
  block('Marmitas por prato', agg.prato, menu.pratos.map(function (d) { return d.nome; }), 'TOTAL DE MARMITAS');
  block('Sobremesas', agg.sobremesa, menu.sobremesas.map(function (s) { return s.nome; }), 'TOTAL DE SOBREMESAS');

  sh.getRange('B2').setValue(
    (pedidos.pagos + pedidos.aguardando) + ' pedidos (' + pedidos.pagos + ' pagos, ' + pedidos.aguardando + ' aguardando)' +
    (week ? '' : ' - nenhuma aba para esta data')
  );
  sh.getRange(4, 1, Math.max(sh.getMaxRows() - 3, 1), 4).clearContent().setFontWeight('normal').setFontColor('#000000').setBackground(null);
  sh.getRange(4, 1, rows.length, 4).setValues(rows);
  headerRows.forEach(function (i) {
    sh.getRange(4 + i, 1, 1, 4).setFontWeight('bold').setBackground('#1f4030').setFontColor('#ffffff');
  });
  totalRows.forEach(function (i) { sh.getRange(4 + i, 1, 1, 4).setFontWeight('bold').setBackground('#d9ead3'); });
}

/* ========================== Estatísticas de visitas ========================== */

function lastFilledRow_(sheet, col) {
  var values = sheet.getRange(1, col, sheet.getMaxRows(), 1).getValues();
  for (var i = values.length - 1; i >= 1; i--) if (values[i][0] !== '') return i + 1;
  return 1;
}

function getOrCreateStatsDataSheet_(ss) {
  var sh = ss.getSheetByName(TAB_STATS_DATA);
  if (sh) return sh;
  sh = ss.insertSheet(TAB_STATS_DATA);
  sh.getRange(1, 1, 1, 4).setValues([['Dia', 'Origem', 'Evento', 'Quantidade']]).setFontWeight('bold');
  sh.getRange(2, 1, sh.getMaxRows() - 1, 3).setNumberFormat('@'); // dia como texto AAAA-MM-DD
  sh.setFrozenRows(1);
  return sh;
}

/** Aba Estatísticas: tabela dos últimos 14 dias e origem das visitas, calculadas por fórmulas. */
function getOrCreateStatsSheet_(ss) {
  var sh = ss.getSheetByName(TAB_STATS);
  if (sh) return sh;
  getOrCreateStatsDataSheet_(ss);
  sh = ss.insertSheet(TAB_STATS);
  var d = "'" + TAB_STATS_DATA + "'!";
  sh.getRange(1, 1, 1, 6).setValues([['Dia', 'Visitas', 'Montaram sacola', 'Chegaram ao checkout', 'Pedidos', 'Pedidos / visitas']])
    .setFontWeight('bold').setBackground('#1f4030').setFontColor('#ffffff');
  var formulas = [];
  for (var n = 0; n < 14; n++) {
    var r = n + 2;
    var count = function (ev) {
      return '=SUMIFS(' + d + '$D:$D,' + d + '$A:$A,$A' + r + ',' + d + '$C:$C,"' + ev + '")';
    };
    formulas.push(['=TEXT(TODAY()-' + n + ',"yyyy-mm-dd")', count('visita'), count('sacola'), count('checkout'), count('pedido'),
      '=IF(B' + r + '=0,"",E' + r + '/B' + r + ')']);
  }
  sh.getRange(2, 1, 14, 6).setFormulas(formulas);
  sh.getRange(2, 6, 14, 1).setNumberFormat('0.0%');
  sh.getRange('A17').setValue('Origem das visitas (últimos 7 dias)').setFontWeight('bold');
  sh.getRange('A18').setFormula(
    '=IFERROR(QUERY(' + d + 'A:D,"select B, sum(D) where C = \'visita\' and A >= \'"&TEXT(TODAY()-6,"yyyy-mm-dd")&"\' group by B order by sum(D) desc label B \'Origem\', sum(D) \'Visitas\'",1),"Sem visitas ainda")'
  );
  sh.getRange('H1').setValue('Visita = uma abertura do site por navegador (sem cookies e sem dados pessoais).').setFontStyle('italic');
  [110, 90, 140, 170, 90, 130].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  return sh;
}

/** Soma 1 ao contador do dia/origem/evento. Falhas são ignoradas: estatística nunca atrapalha o cliente. */
function registrarEvento_(evento, origem) {
  if (STAT_EVENTS.indexOf(evento) < 0) return;
  var origin = String(origem || '').toLowerCase().replace(/[^a-z0-9.-]/g, '').slice(0, 30) || 'direto';
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) return;
  try {
    var ss = SpreadsheetApp.getActive();
    getOrCreateStatsSheet_(ss);
    var sh = getOrCreateStatsDataSheet_(ss);
    var day = todayISO_();
    var last = lastFilledRow_(sh, 1);
    var start = Math.max(2, last - 299);
    if (last >= 2) {
      var rows = sh.getRange(start, 1, last - start + 1, 4).getValues();
      for (var i = rows.length - 1; i >= 0; i--) {
        if (String(rows[i][0]) === day && String(rows[i][1]) === origin && String(rows[i][2]) === evento) {
          sh.getRange(start + i, 4, 1, 1).setValues([[Number(rows[i][3]) + 1]]);
          return;
        }
      }
    }
    var next = last + 1;
    if (next > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 500);
    sh.getRange(next, 1, 1, 4).setValues([[day, origin, evento, 1]]);
  } finally {
    lock.releaseLock();
  }
}

/** Executada toda quinta pelo gatilho: cria a aba do novo ciclo antes do primeiro pedido. */
function criarAbaDaSemana() {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    getOrCreateWeekSheet_(deliveryDate_(todayISO_()));
  } finally {
    lock.releaseLock();
  }
}

/* ========================== Instalação (rodar uma vez) ========================== */

function configurarPlanilha() {
  var ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone(TZ);

  seedSheet_(ss, TAB_CONFIG, ['Chave', 'Valor', 'Descrição'], [
    ['nome_loja', 'Sabor de Cuidado', 'Nome exibido no site'],
    ['whatsapp', '5521979183105', 'WhatsApp que recebe os comprovantes (DDI + DDD + número, só dígitos)'],
    ['pix_chave', '', 'OBRIGATÓRIO: chave Pix que recebe os pagamentos (CPF, CNPJ, e-mail, celular com +55 ou chave aleatória)'],
    ['pix_nome', 'Sabor de Cuidado', 'Nome do recebedor que aparece no Pix (até 25 letras, sem acento)'],
    ['pix_cidade', 'Rio de Janeiro', 'Cidade do recebedor (até 15 letras)'],
    ['preco_avulsa', 27.9, 'Preço da marmita avulsa, em reais'],
    ['taxa_entrega', 0, 'Taxa fixa em reais somada ao Pix quando o cliente escolhe entrega. Deixe 0: o Uber é combinado direto com o cliente na hora da entrega'],
    ['retirada', 'SIM', 'SIM permite retirada; NÃO deixa só entrega'],
    ['aviso_entrega', 'A entrega é feita por Uber. O valor da corrida é combinado com você no dia da entrega.', 'Aviso mostrado ao cliente na sacola, no checkout e no Pix'],
    ['pedidos_abertos', 'SIM', 'NÃO pausa os pedidos no site'],
    ['email_pedidos', '', 'E-mail(s) que recebem aviso de cada pedido novo (separe vários por vírgula). Vazio = dono da planilha']
  ]);
  var cfg = ss.getSheetByName(TAB_CONFIG);
  cfg.getRange('B2:B').setNumberFormat('@'); // chaves Pix e telefones como texto
  cfg.getRange('B7:B8').setNumberFormat('0.00');
  cfg.setColumnWidth(1, 150); cfg.setColumnWidth(2, 260); cfg.setColumnWidth(3, 520);

  seedSheet_(ss, TAB_MENU, ['Categoria', 'Nome', 'Descrição', 'Adicional', 'Foto', 'Ativo'], [
    ['Tradicionais', 'Carne de panela', 'mandioquinha e cenoura', 0, '', 'SIM'],
    ['Tradicionais', 'Strogonoff de frango', 'arroz e batata rústica', 0, '', 'SIM'],
    ['Tradicionais', 'Frango ensopado com legumes', 'arroz, chuchu, cenoura e batata', 0, '', 'SIM'],
    ['Tradicionais', 'Costela desfiada', 'arroz branco e purê de batata', 0, '', 'SIM'],
    ['Tradicionais', 'Feijoada leve', 'arroz, couve e farofa', 0, '', 'SIM'],
    ['Dia a Dia', 'Ensopado de carne moída com legumes', 'arroz branco e feijão carioquinha', 0, '', 'SIM'],
    ['Dia a Dia', 'Frango grelhado', 'arroz com cenoura, feijão carioquinha e abobrinha com cubinhos de bacon', 0, '', 'SIM'],
    ['Dia a Dia', 'Isca de carne acebolada', 'arroz, feijão e brócolis com cenoura', 0, '', 'SIM'],
    ['Especiais', 'Lasanha à bolonhesa', 'molho caseiro e muçarela', 5, '', 'SIM'],
    ['Especiais', 'Fricassê de frango', 'arroz branco e batata palha à parte', 5, '', 'SIM'],
    ['Especiais', 'Picanha suína acebolada', 'arroz, feijão e couve', 5, '', 'SIM']
  ]);
  var menuSheet = ss.getSheetByName(TAB_MENU);
  menuSheet.getRange('D1').setNote('Valor em reais somado ao preço da marmita (ex.: 5 para os pratos Especiais).');
  menuSheet.getRange('E1').setNote('Opcional: nome do arquivo em public/fotos (ex.: lasanha.jpg) ou link https.');
  menuSheet.getRange('F1').setNote('SIM mostra o prato no site; NÃO esconde (esgotado).');
  menuSheet.getRange('D2:D').setNumberFormat('0.00');
  [140, 280, 420, 90, 140, 70].forEach(function (w, i) { menuSheet.setColumnWidth(i + 1, w); });

  seedSheet_(ss, TAB_KITS, ['Nome', 'Marmitas', 'Preço', 'Máx. pratos', 'Sobremesas grátis', 'Destaque', 'Ativo'], [
    ['Experimente', 5, 129.9, 5, 0, '', 'SIM'],
    ['Semana Completa', 7, 174.9, 7, 0, 'MAIS PEDIDO', 'SIM'],
    ['Despensa Cheia', 10, 239.9, 7, 1, 'MELHOR PREÇO', 'SIM']
  ]);
  var kitsSheet = ss.getSheetByName(TAB_KITS);
  kitsSheet.getRange('D1').setNote('Máximo de pratos DIFERENTES que o cliente pode escolher no kit.');
  kitsSheet.getRange('C2:C').setNumberFormat('0.00');
  [160, 90, 90, 100, 130, 150, 70].forEach(function (w, i) { kitsSheet.setColumnWidth(i + 1, w); });

  seedSheet_(ss, TAB_DESSERTS, ['Nome', 'Descrição', 'Preço', 'Foto', 'Ativo'], [
    ['Bolo de pote - sabor 1', 'EDITE: descrição do sabor', 12, '', 'NÃO'],
    ['Bolo de pote - sabor 2', 'EDITE: descrição do sabor', 12, '', 'NÃO'],
    ['Bolo de pote - sabor 3', 'EDITE: descrição do sabor', 12, '', 'NÃO']
  ]);
  var dessertSheet = ss.getSheetByName(TAB_DESSERTS);
  dessertSheet.getRange('C2:C').setNumberFormat('0.00');
  dessertSheet.getRange('A1').setNote('Troque pelos sabores reais e mude Ativo para SIM. Sem sobremesas ativas, o kit de 10 não pede sobremesa.');
  [220, 320, 90, 140, 70].forEach(function (w, i) { dessertSheet.setColumnWidth(i + 1, w); });

  // Lista suspensa SIM/NÃO nas colunas "Ativo" e nas chaves de liga/desliga
  var yesNo = SpreadsheetApp.newDataValidation().requireValueInList(['SIM', 'NÃO'], true).build();
  menuSheet.getRange('F2:F200').setDataValidation(yesNo);
  kitsSheet.getRange('G2:G50').setDataValidation(yesNo);
  dessertSheet.getRange('E2:E200').setDataValidation(yesNo);
  cfg.getRange('B9').setDataValidation(yesNo);
  cfg.getRange('B11').setDataValidation(yesNo);

  // Remove a aba em branco padrão
  ['Página1', 'Sheet1', 'Planilha1'].forEach(function (n) {
    var s = ss.getSheetByName(n);
    if (s && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s);
  });

  criarAbaDaSemana();
  instalarGatilho_();
  instalarAtualizacaoInstantanea();
  getOrCreateStatsSheet_(ss);
  atualizarProducao();
  CacheService.getScriptCache().remove('menu');
  SpreadsheetApp.flush();
  console.log('Planilha configurada. Preencha pix_chave na aba Config e publique o Web App.');
}

/** Cria a aba com cabeçalho e dados iniciais, sem sobrescrever se ela já existir. */
function seedSheet_(ss, name, headers, rows) {
  if (ss.getSheetByName(name)) return;
  var sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#1f4030').setFontColor('#ffffff');
  if (rows.length) sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
  sh.setFrozenRows(1);
}

function instalarGatilho_() {
  var exists = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'criarAbaDaSemana';
  });
  if (exists) return;
  ScriptApp.newTrigger('criarAbaDaSemana')
    .timeBased().onWeekDay(ScriptApp.WeekDay.THURSDAY).atHour(0).inTimezone(TZ).create();
}

/**
 * Rodar UMA vez em planilhas já configuradas (escolha esta função e clique em Executar).
 * Liga a atualização instantânea do cardápio. Pode rodar de novo sem duplicar o gatilho.
 */
function instalarAtualizacaoInstantanea() {
  var exists = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'limparCacheDoCardapio';
  });
  if (!exists) {
    ScriptApp.newTrigger('limparCacheDoCardapio').forSpreadsheet(SpreadsheetApp.getActive()).onChange().create();
  }
  CacheService.getScriptCache().remove('menu');
}
