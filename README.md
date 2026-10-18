# AnitOS '90

O AnitOS '90 nasceu pra deixar as sessões de RPG mais fáceis de organizar — sem precisar abrir um monte de ferramentas diferentes. Aqui ficam o painel das campanhas e as salas pra jogar com a galera, tudo no mesmo projeto.

## O que tem por aqui?

### ANITOPEBOARD — AnitOS '89
O painel das campanhas **Light Fade**. É onde Mestres e Jogadores podem acompanhar as campanhas e trabalhar com as fichas dos personagens. O acesso ao painel integrado é feito pela conta e pela campanha selecionada.

### RGN — salas de RPG
Uma sala online pra jogar junto, conversar pelo chat e rolar dados sem depender de cada pessoa calcular o resultado por conta própria.

- Crie uma sala e compartilhe o código com o grupo.
- Role D4, D6, D8, D10, D12, D20 ou D100.
- Acompanhe as rolagens e as mensagens em tempo real.
- Se a conexão cair, dá pra tentar voltar à sala durante a janela de reconexão.

### Contas e campanhas
Existem dois perfis: **Mestre** e **Jogador**. As campanhas ficam salvas no banco de dados, e o Mestre pode organizar as fichas e atribuí-las aos jogadores. Cada jogador só deve conseguir ver as fichas que foram atribuídas a ele.

### AnitOS '90 Pro
O acesso Pro é ativado por **chave de membro**. A ativação é feita dentro do site; a distribuição ou venda das chaves acontece separadamente.

## Como acessar

- `/` — página de entrada
- `/account` — cadastro e login
- `/anitopeboard/` — painel de campanhas
- `/rgn` — salas de RPG
- `/health` — verifica se o servidor está respondendo

## Rodar no seu computador

Você vai precisar do **Node.js 20 ou superior**.

1. Baixe ou clone este repositório.
2. Abra um terminal na pasta do projeto.
3. Instale as dependências:

   ```bash
   npm install
   ```

4. Inicie o servidor:

   ```bash
   npm start
   ```

5. Abra [http://localhost:3000](http://localhost:3000).

Para usar contas e manter os dados salvos entre reinicializações, configure a variável de ambiente `DATABASE_URL` com a conexão PostgreSQL. O projeto pode usar um banco do [Supabase](https://supabase.com/). **Não coloque credenciais no código nem publique essas informações no GitHub.**

## Tecnologias

- Node.js e Express
- Socket.IO para comunicação em tempo real
- PostgreSQL para contas, campanhas e dados persistentes
- Supabase como opção de hospedagem do banco

## Um projeto em construção

O AnitOS '90 continua recebendo ajustes. Algumas partes podem mudar conforme os testes e as sessões de jogo; por isso, se encontrar algo quebrado, anote o que aconteceu e em qual tela. Isso ajuda muito mais do que um simples “não funciona” :)

---

Feito para as sessões do nosso grupo. **“Eu só queria uma sessão.”**
