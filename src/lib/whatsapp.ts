import type { DeliveryMode, OrderResult, PricedOrder } from '../types';
import { fromISO, shortLabel } from './cycle';
import { brl } from './money';
import { orderText } from './pricing';

export function buildWhatsappMessage(args: {
  nome: string;
  modo: DeliveryMode;
  result: OrderResult;
  order: PricedOrder;
}): string {
  const { nome, modo, result, order } = args;
  const quando = shortLabel(fromISO(result.entregaISO));
  const linhas = [
    `Olá! Fiz o pedido *nº ${result.numero}* no site e estou enviando o comprovante do Pix.`,
    '',
    `*Cliente:* ${nome}`,
    `*${modo === 'entrega' ? 'Entrega' : 'Retirada'}:* ${quando}`,
    '*Itens:*',
    orderText(order),
    '',
    `*Total:* ${brl(result.totalCent)}`,
    `Código: ${result.id}`,
  ];
  return linhas.join('\n');
}

export function whatsappLink(phone: string, message: string): string {
  return `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;
}
