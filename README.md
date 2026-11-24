# Sabor de Cuidado

Loja online de marmitas congeladas e bolos de pote. O cliente monta o kit, paga por Pix (QR Code e copia e cola) e envia o comprovante pelo WhatsApp. O pedido é gravado em uma planilha do Google Sheets, com uma aba por semana de entrega.

```
GitHub Pages (React + Vite)  ──►  Google Apps Script (Web App)  ──►  Google Sheets
```

- `src/`: site (cardápio, kits, sacola, checkout, Pix)
- `apps-script/`: backend publicado no Google (valida o pedido, recalcula o preço, cria as abas semanais)
- `docs/CONFIGURAR.md`: passo a passo para colocar no ar e operar no dia a dia

Regras principais: [`src/lib/pricing.ts`](src/lib/pricing.ts) (preços e kits), [`src/lib/cycle.ts`](src/lib/cycle.ts) (ciclo de quinta a quarta, entrega na segunda) e [`src/lib/pix.ts`](src/lib/pix.ts) (BR Code). O teste `src/lib/parity.test.ts` garante que o backend calcula igual ao site.
