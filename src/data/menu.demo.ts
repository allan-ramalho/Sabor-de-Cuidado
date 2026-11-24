import type { Menu } from '../types';

// Cardápio de DEMONSTRAÇÃO, usado só quando VITE_API_URL não está definida.
// O cardápio real vem da planilha (abas Config, Cardápio, Kits e Sobremesas).
export const demoMenu: Menu = {
  loja: {
    nome: 'Sabor de Cuidado',
    whatsapp: '5521979183105',
    pixChave: 'demo@exemplo.com',
    pixNome: 'Sabor de Cuidado',
    pixCidade: 'Rio de Janeiro',
    taxaEntregaCent: 0,
    retirada: true,
    avisoEntrega: 'A entrega é feita por Uber. O valor da corrida é combinado com você no dia da entrega.',
    pedidosAbertos: true,
  },
  precoAvulsaCent: 2790,
  pratos: [
    { id: 'carne-de-panela', categoria: 'Tradicionais', nome: 'Carne de panela', descricao: 'mandioquinha e cenoura', adicionalCent: 0 },
    { id: 'strogonoff-de-frango', categoria: 'Tradicionais', nome: 'Strogonoff de frango', descricao: 'arroz e batata rústica', adicionalCent: 0 },
    { id: 'frango-ensopado-com-legumes', categoria: 'Tradicionais', nome: 'Frango ensopado com legumes', descricao: 'arroz, chuchu, cenoura e batata', adicionalCent: 0 },
    { id: 'costela-desfiada', categoria: 'Tradicionais', nome: 'Costela desfiada', descricao: 'arroz branco e purê de batata', adicionalCent: 0 },
    { id: 'feijoada-leve', categoria: 'Tradicionais', nome: 'Feijoada leve', descricao: 'arroz, couve e farofa', adicionalCent: 0 },
    { id: 'ensopado-de-carne-moida-com-legumes', categoria: 'Dia a Dia', nome: 'Ensopado de carne moída com legumes', descricao: 'arroz branco e feijão carioquinha', adicionalCent: 0 },
    { id: 'frango-grelhado', categoria: 'Dia a Dia', nome: 'Frango grelhado', descricao: 'arroz com cenoura, feijão carioquinha e abobrinha com cubinhos de bacon', adicionalCent: 0 },
    { id: 'isca-de-carne-acebolada', categoria: 'Dia a Dia', nome: 'Isca de carne acebolada', descricao: 'arroz, feijão e brócolis com cenoura', adicionalCent: 0 },
    { id: 'lasanha-a-bolonhesa', categoria: 'Especiais', nome: 'Lasanha à bolonhesa', descricao: 'molho caseiro e muçarela', adicionalCent: 500 },
    { id: 'fricasse-de-frango', categoria: 'Especiais', nome: 'Fricassê de frango', descricao: 'arroz branco e batata palha à parte', adicionalCent: 500 },
    { id: 'picanha-suina-acebolada', categoria: 'Especiais', nome: 'Picanha suína acebolada', descricao: 'arroz, feijão e couve', adicionalCent: 500 },
  ],
  kits: [
    { id: 'kit-5', nome: 'Experimente', marmitas: 5, precoCent: 12990, maxPratos: 5, sobremesasGratis: 0 },
    { id: 'kit-7', nome: 'Semana Completa', marmitas: 7, precoCent: 17490, maxPratos: 7, sobremesasGratis: 0, destaque: 'MAIS PEDIDO' },
    { id: 'kit-10', nome: 'Despensa Cheia', marmitas: 10, precoCent: 23990, maxPratos: 7, sobremesasGratis: 1, destaque: 'MELHOR PREÇO' },
  ],
  sobremesas: [
    { id: 'bolo-de-pote-exemplo-1', nome: 'Bolo de pote (exemplo 1)', descricao: 'Sabor de exemplo', precoCent: 1200 },
    { id: 'bolo-de-pote-exemplo-2', nome: 'Bolo de pote (exemplo 2)', descricao: 'Sabor de exemplo', precoCent: 1200 },
  ],
};
