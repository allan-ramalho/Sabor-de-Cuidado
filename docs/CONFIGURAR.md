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
| Ver o que cozinhar | Aba **Produção** (soma de cada prato da semana, separando pagos e aguardando) |
| Ver visitas e conversão | Aba **Estatísticas** |
| Saber de novo pedido | E-mail automático a cada pedido (ver abaixo) |

**Ciclo semanal:** pedidos de quinta 00:00 a quarta 23:59 entram na aba da segunda seguinte. Toda quinta de madrugada o gatilho cria a aba do novo ciclo. Se o gatilho falhar, a aba é criada no primeiro pedido.

## Aviso de pedido novo por e-mail

A cada pedido, chega um e-mail com cliente, WhatsApp (com link), endereço, itens, total e link da planilha.

- Quem recebe: aba `Config`, linha `email_pedidos`, coluna Valor. Para vários e-mails, separe por vírgula. Se estiver vazia, o e-mail vai para o dono da planilha. Em planilhas que já existem, adicione a linha na mão (`email_pedidos` na coluna Chave).
- Se o e-mail falhar (por exemplo, cota diária do Gmail esgotada), o pedido continua sendo gravado normalmente.

## Aba Produção

Soma as marmitas e sobremesas da semana por prato, com as colunas **Pagos** (Pago + Entregue), **Aguardando** e **Total**. Pedidos cancelados não entram. Atualiza sozinha a cada pedido e a cada mudança de status.

- Para ver outra semana, digite a data de entrega (`AAAA-MM-DD`) na célula amarela `B1`.
- Pedidos feitos antes desta versão não têm os dados para a soma e não entram na conta.

## Estatísticas de visitas

A aba **Estatísticas** mostra, por dia, quantas pessoas abriram o site, montaram a sacola, chegaram ao checkout e fizeram pedido, além da origem das visitas dos últimos 7 dias.

- É um contador próprio: sem cookies, sem rastreador de terceiros e sem dados pessoais. Cada etapa conta uma vez por navegador. Quem ativa "Não rastrear" no navegador não é contado.
- **Origem:** para saber de onde vem cada cliente, use links com a origem no endereço, como `https://allan-ramalho.github.io/Sabor-de-Cuidado/?utm_source=instagram` (na bio do Instagram) e `?utm_source=whatsapp` (no status ou na lista de transmissão). Sem isso, a origem fica como `direto`, pois o WhatsApp não informa de onde a pessoa veio.
- **Não contar as suas visitas:** no seu celular e no computador, abra uma vez o site com `?sem-contagem=1` no final do endereço. Para voltar a contar, use `?sem-contagem=0`.
- Os números brutos ficam na aba `Visitas (dados)`. Não edite a aba Estatísticas, que é só fórmulas.

## Proteção contra pedidos falsos

Já funciona sem configurar nada:
- O servidor recusa pedidos enviados rápido demais (robôs enviam na hora), com campo isca preenchido ou com itens que não existem no cardápio.
- Máximo de 5 pedidos por telefone em 10 minutos.
- Trava geral de 20 pedidos em 10 minutos e 60 por hora para a loja inteira. Se algum dia você precisar de mais (promoção grande), mude `GLOBAL_LIMIT_10MIN` e `GLOBAL_LIMIT_HOUR` no início do `Code.gs`.

**Opcional, reforço extra (Cloudflare Turnstile, grátis):** é uma verificação que fica invisível para a maioria dos clientes. Só ligue se aparecerem pedidos falsos.

1. Crie uma conta em [dash.cloudflare.com](https://dash.cloudflare.com), vá em **Turnstile > Add widget**, adicione o domínio `allan-ramalho.github.io` e escolha o modo **Managed**.
2. Copie a **Site Key** (pública) e a **Secret Key** (privada).
3. No GitHub: **Settings > Secrets and variables > Actions > Variables**, crie `TURNSTILE_SITE_KEY` com a Site Key. Rode o workflow de novo (aba Actions).
4. No Apps Script: **Configurações do projeto (engrenagem) > Propriedades do script > Adicionar propriedade**, nome `TURNSTILE_SECRET` e valor igual à Secret Key.

Ligue os dois lados: com só o segredo no Apps Script, o site não envia a verificação e todos os pedidos serão recusados. Para desligar, apague a propriedade `TURNSTILE_SECRET`.

## Atualizando o backend

Sempre que o `Code.gs` mudar:
1. No Apps Script, selecione tudo, apague, cole o novo `Code.gs` e salve.
2. Escolha a função **atualizarProducao** e clique em **Executar**. Na primeira vez, o Google pede nova autorização (envio de e-mail e acesso a endereços externos). Aceite. Isso também cria a aba Produção.
3. **Implantar > Gerenciar implantações > lápis > Nova versão > Implantar.**

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
