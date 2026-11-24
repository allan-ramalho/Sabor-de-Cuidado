// Todos os valores em dinheiro são inteiros em CENTAVOS (ex.: R$ 27,90 = 2790).

export interface Dish {
  id: string;
  categoria: string;
  nome: string;
  descricao: string;
  /** Valor somado ao preço da marmita avulsa (ex.: pratos Especiais = 500). */
  adicionalCent: number;
  foto?: string;
}

export interface Kit {
  id: string;
  nome: string;
  marmitas: number;
  precoCent: number;
  /** Máximo de pratos DIFERENTES dentro do kit. */
  maxPratos: number;
  /** Quantas sobremesas o kit inclui. */
  sobremesasGratis: number;
  /** Selo do card, ex.: "MAIS PEDIDO". */
  destaque?: string;
}

export interface Dessert {
  id: string;
  nome: string;
  descricao: string;
  precoCent: number;
  foto?: string;
}

export interface Store {
  nome: string;
  /** Somente dígitos com DDI, ex.: 5521979183105 */
  whatsapp: string;
  pixChave: string;
  pixNome: string;
  pixCidade: string;
  taxaEntregaCent: number;
  retirada: boolean;
  avisoEntrega: string;
  pedidosAbertos: boolean;
}

export interface Menu {
  loja: Store;
  precoAvulsaCent: number;
  pratos: Dish[];
  kits: Kit[];
  sobremesas: Dessert[];
}

export type OrderLine =
  | { tipo: 'kit'; uid: string; kitId: string; pratos: Record<string, number>; sobremesaId?: string }
  | { tipo: 'prato'; uid: string; pratoId: string; qtd: number }
  | { tipo: 'sobremesa'; uid: string; sobremesaId: string; qtd: number };

export type DeliveryMode = 'entrega' | 'retirada';

export interface PricedLine {
  line: OrderLine;
  titulo: string;
  detalhes: string[];
  totalCent: number;
}

export interface PricedOrder {
  lines: PricedLine[];
  subtotalCent: number;
  taxaCent: number;
  totalCent: number;
}

export interface OrderRequest {
  requestId: string;
  nome: string;
  whatsapp: string;
  modo: DeliveryMode;
  endereco: { rua: string; bairro: string; complemento: string; cep: string };
  obs: string;
  linhas: OrderLine[];
  /** Campo isca contra robôs; deve ir vazio. */
  website: string;
  /** Tempo, em ms, entre abrir o checkout e enviar. Robôs enviam na hora. */
  tempoMs: number;
  /** De onde veio a visita (instagram, whatsapp, google, direto...). */
  origem: string;
  /** Token do Cloudflare Turnstile, quando a verificação está ligada. */
  captcha?: string;
}

export interface OrderResult {
  /** Código do pedido mostrado ao cliente (ex.: SC-K7M4QX). Aleatório, sem ordem sequencial. */
  id: string;
  totalCent: number;
  subtotalCent: number;
  taxaCent: number;
  /** Data da entrega no formato AAAA-MM-DD. */
  entregaISO: string;
  /** Pedido criado em modo demonstração (sem planilha). */
  demo?: boolean;
}

/** Pedido gerado e aguardando comprovante; guardado no aparelho do cliente. */
export interface PendingOrder {
  result: OrderResult;
  nome: string;
  modo: DeliveryMode;
  pixCode: string;
  mensagemWhatsapp: string;
  criadoEm: number;
}
