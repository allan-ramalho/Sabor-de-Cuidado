// Pix "copia e cola" estático (BR Code / EMV-MPM) conforme o Manual do BCB.

/** CRC16-CCITT (poly 0x1021, init 0xFFFF), retorna 4 dígitos hexadecimais. */
export function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function tlv(id: string, value: string): string {
  if (value.length > 99) throw new Error(`Campo Pix ${id} excede 99 caracteres`);
  return id + String(value.length).padStart(2, '0') + value;
}

/** Remove acentos e caracteres fora do ASCII permitido, em maiúsculas. */
function clean(text: string, max: number): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, '')
    .toUpperCase()
    .trim()
    .slice(0, max);
}

export interface PixInput {
  chave: string;
  nome: string;
  cidade: string;
  valorCent: number;
  /** Identificador do pedido; apenas letras e números, até 25. */
  txid: string;
}

export function buildPix({ chave, nome, cidade, valorCent, txid }: PixInput): string {
  if (!chave.trim()) throw new Error('Chave Pix não configurada');
  if (!Number.isInteger(valorCent) || valorCent <= 0) throw new Error('Valor Pix inválido');
  const id = txid.replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***';
  const valor = `${Math.floor(valorCent / 100)}.${String(valorCent % 100).padStart(2, '0')}`;

  const body =
    tlv('00', '01') +
    tlv('26', tlv('00', 'br.gov.bcb.pix') + tlv('01', chave.trim())) +
    tlv('52', '0000') +
    tlv('53', '986') +
    tlv('54', valor) +
    tlv('58', 'BR') +
    tlv('59', clean(nome, 25) || 'LOJA') +
    tlv('60', clean(cidade, 15) || 'BRASIL') +
    tlv('62', tlv('05', id)) +
    '6304';

  return body + crc16(body);
}
