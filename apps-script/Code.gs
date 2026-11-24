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
  return json_({ ok: false, error: 'Ação inválida.' });
}

function doPost(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) || '';
    if (raw.length > 20000) throw { user: 'Pedido grande demais.' };
    var body = JSON.parse(raw);
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

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw userError_('Estamos com muitos pedidos agora. Tente novamente em instantes.');
  try {
    var cache = CacheService.getScriptCache();

    // Reenvio do mesmo pedido (ex.: resposta perdida): devolve o resultado já gravado.
    var done = cache.get('req_' + requestId);
    if (done) return JSON.parse(done);

    var rlKey = 'rl_' + phone;
    var count = parseInt(cache.get(rlKey) || '0', 10);
    if (count >= RATE_LIMIT_ORDERS) throw userError_('Muitos pedidos em pouco tempo. Aguarde alguns minutos.');

    var entregaISO = deliveryDate_(todayISO_());
    var sheet = getOrCreateWeekSheet_(entregaISO);

    var props = PropertiesService.getScriptProperties();
    var seqKey = 'seq_' + entregaISO;
    var numero = parseInt(props.getProperty(seqKey) || '0', 10) + 1;
    props.setProperty(seqKey, String(numero));
    var id = 'SC' + entregaISO.slice(2).replace(/-/g, '') + ('00' + numero).slice(-3);

    var row = nextOrderRow_(sheet);
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
      JSON.stringify({ requestId: requestId, modo: modo, linhas: body.linhas, totalCent: priced.totalCent })
    ]]);

    var result = {
      id: id,
      numero: numero,
      totalCent: priced.totalCent,
      subtotalCent: priced.subtotalCent,
      taxaCent: priced.taxaCent,
      entregaISO: entregaISO
    };
    cache.put('req_' + requestId, JSON.stringify(result), 21600);
    cache.put(rlKey, String(count + 1), RATE_LIMIT_SECONDS);
    return result;
  } finally {
    lock.releaseLock();
  }
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
 * Próxima linha livre pela coluna A (Pedido). Não usa getLastRow(), pois o resumo
 * da semana (colunas N:O) também conta como conteúdo.
 */
function nextOrderRow_(sheet) {
  var max = sheet.getMaxRows();
  var ids = sheet.getRange(1, COL.id, max, 1).getValues();
  var last = 1;
  for (var i = ids.length - 1; i >= 1; i--) {
    if (ids[i][0] !== '') { last = i + 1; break; }
  }
  var row = last + 1;
  if (row > max) sheet.insertRowsAfter(max, 200);
  return row;
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
    ['taxa_entrega', 0, 'Taxa de entrega em reais (0 = sem taxa). Somada ao total quando o cliente escolhe entrega'],
    ['retirada', 'SIM', 'SIM permite retirada; NÃO deixa só entrega'],
    ['aviso_entrega', 'Atendemos algumas regiões. Confirmamos sua entrega pelo WhatsApp.', 'Aviso mostrado na tela de entrega'],
    ['pedidos_abertos', 'SIM', 'NÃO pausa os pedidos no site']
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
