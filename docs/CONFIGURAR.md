# Como colocar a loja no ar

São três etapas: planilha com backend, site no GitHub Pages e conferência final. Leva uns 15 minutos.

## 1. Planilha e backend (Google)

1. Entre com `allan.ramalho@gmail.com` em [sheets.new](https://sheets.new) e nomeie a planilha, por exemplo **Pedidos - Sabor de Cuidado**.
2. Menu **Extensões > Apps Script**.
3. No editor, apague o conteúdo de `Code.gs` e cole o conteúdo de [`apps-script/Code.gs`](../apps-script/Code.gs).
4. Clique no ícone de engrenagem (**Configurações do projeto**), marque **Mostrar arquivo de manifesto "appsscript.json"**, volte ao editor, abra `appsscript.json` e cole o conteúdo de [`apps-script/appsscript.json`](../apps-script/appsscript.json).
5. Selecione a função **configurarPlanilha** na barra superior e clique em **Executar**. O Google pede autorização (planilhas e gatilhos). Em "O Google não verificou este app", use **Avançado > Acessar (não seguro)**. O script é seu e roda só na sua conta.
6. Volte à planilha. Ela terá as abas `Config`, `Cardápio`, `Kits`, `Sobremesas` e a primeira aba de entrega (`Entrega AAAA-MM-DD`).
7. Na aba **Config**, preencha:
   - `pix_chave`: **obrigatório**, cole o e-mail da chave Pix. Sem ela o site não gera pedidos. A chave fica só na planilha, não no repositório.
   - `pix_nome` e `pix_cidade`: aparecem no app do banco do cliente.
   - `taxa_entrega`: deixe **0**. A entrega é por Uber e o valor é combinado com o cliente no dia, então o Pix cobre só os produtos. O texto de `aviso_entrega` explica isso ao cliente na sacola, no checkout e na tela do Pix.
8. Na aba **Sobremesas**, troque pelos sabores reais, o preço, e mude `Ativo` para **SIM**.
9. Publique: **Implantar > Nova implantação > tipo "App da Web"**.
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa**
10. Copie a **URL do app da Web** (termina em `/exec`).

Teste rápido: abra `URL?action=menu` no navegador. Deve aparecer um JSON com o cardápio.

> Ao alterar o `Code.gs` no futuro, use **Implantar > Gerenciar implantações > Editar > Nova versão**. Assim a URL continua a mesma.

## 2. Site no GitHub Pages

1. No repositório, **Settings > Pages > Build and deployment > Source: GitHub Actions**.
2. **Settings > Secrets and variables > Actions > aba Variables > New repository variable**:
   - Nome: `API_URL`
   - Valor: a URL `/exec` copiada acima
3. Envie o código para a branch `main`. O workflow **Publicar no GitHub Pages** roda os testes, gera o site e publica.
4. O endereço fica em `https://allan-ramalho.github.io/Sabor-de-Cuidado/`.

## 3. Conferência final

1. Abra o site no celular. Não deve aparecer o aviso amarelo de "Modo demonstração".
2. Faça um pedido de teste e confira a linha na aba da semana.
3. Gere o Pix com o menor valor possível e pague de verdade uma vez para confirmar que o app do banco mostra o nome e o valor certos.
4. Apague as linhas de teste da planilha.

## Uso no dia a dia

| Tarefa | Onde |
|---|---|
| Mudar pratos, preços, kits | Abas `Cardápio`, `Kits`, `Config`. Vale em até 1 minuto, sem publicar nada |
| Esconder prato esgotado | Coluna `Ativo` = NÃO |
| Pausar pedidos | `Config > pedidos_abertos` = NÃO |
| Confirmar pagamento | Aba da semana, coluna **Status**: Aguardando comprovante > Pago > Entregue |
| Ver o que cozinhar | Aba da semana (coluna Itens). A aba Produção com a contagem por prato é a próxima fase |

**Ciclo semanal:** pedidos de quinta 00:00 a quarta 23:59 entram na aba da segunda seguinte. Toda quinta de madrugada o gatilho cria a aba do novo ciclo. Se o gatilho falhar, a aba é criada no primeiro pedido.

## Imagens dos pratos

Os pratos do cardápio já têm uma ilustração em `public/fotos/`, com o nome do prato em minúsculas, sem acento e com hífens (`carne-de-panela.svg`). O site usa esse arquivo automaticamente, sem preencher nada na planilha. Os bolos de pote usam `bolo-de-pote.svg`.

- **Prato novo:** crie `public/fotos/<nome-do-prato>.jpg` (ou `.svg`) e escreva o nome do arquivo na coluna `Foto` do cardápio. Também aceita link `https://`. Sem imagem, o prato aparece só com texto.
- **Trocar por foto real:** salve a foto em `public/fotos/` e coloque o nome do arquivo na coluna `Foto`. Fotos quadradas, de uns 400x400 px e menores que 100 KB, carregam rápido no celular.
- **Regerar as ilustrações:** `node scripts/gerar-fotos.mjs`.

## Logo

A logo em `public/logo.svg` é uma recriação da sua marca. Para usar o arquivo original, salve-o como `public/logo.svg` (ou troque as referências por `logo.png`).

## Desenvolvimento local

```bash
npm install
npm run dev      # http://localhost:5173, em modo demonstração
npm test         # regras de preço, ciclo, Pix e backend
npm run build
```

Para testar com o backend real, copie `.env.example` para `.env.local` e preencha `VITE_API_URL`.
