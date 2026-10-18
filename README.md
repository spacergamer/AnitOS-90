# AnitOS '90
### ANITOPE SCIENCE · Sistemas Operacionais e Ambientes de Pesquisa

**Um ambiente. Uma sessão. Tudo no lugar.**

O AnitOS '90 é o ambiente digital da Anitope Science desenvolvido para dar suporte às operações de campanha, às fichas de personagens e às sessões de RPG. Ele reúne ferramentas que normalmente ficariam espalhadas em diferentes páginas em um só lugar, com acesso por conta e comunicação em tempo real.

> **ANITOPE SCIENCE — “Eu só queria uma sessão.”**

---

## Módulos do sistema

### ANITOPEBOARD · AnitOS '89
Painel de controle das campanhas, com foco na organização de Mestres, Jogadores e fichas de personagens. O acesso às informações depende da conta e das permissões da campanha.

### RGN · Salas de RPG
Ambientes online para reunir o grupo durante a sessão.

- Criação e entrada em salas por código.
- Chat integrado para conversar durante o jogo.
- Rolagens de D4, D6, D8, D10, D12, D20 e D100.
- Atualização das mensagens e rolagens em tempo real.
- Reconexão após uma queda de conexão, dentro do período permitido pelo sistema.

### Contas e campanhas
O sistema possui perfis de **Mestre** e **Jogador**. Os Mestres podem organizar campanhas, gerenciar fichas e atribuí-las aos jogadores. O acesso às fichas deve respeitar as permissões de cada personagem e campanha.

### AnitOS '90 Pro
Uma modalidade de acesso adicional, ativada por **chave de membro**. A chave é inserida no próprio site; a distribuição ou venda das chaves é feita separadamente.

Os recursos disponíveis no Pro podem evoluir conforme o desenvolvimento do sistema.

---

## Acesso rápido

| Endereço | Função |
| --- | --- |
| `/` | Página inicial |
| `/account` | Cadastro e login |
| `/anitopeboard/` | Painel de campanhas |
| `/rgn` | Salas de RPG |
| `/health` | Verificação de disponibilidade do servidor |

---

## Instalação local

Para executar uma cópia do projeto, você precisará de **Node.js 20 ou superior**.

1. Clone ou baixe este repositório.
2. Abra um terminal na pasta do projeto.
3. Instale as dependências:

   ```bash
   npm install
   ```

4. Configure as variáveis de ambiente necessárias para sua instalação.
5. Inicie o servidor:

   ```bash
   npm start
   ```

6. Acesse [http://localhost:3000](http://localhost:3000).

### Banco de dados

Para manter contas e dados entre reinicializações, configure `DATABASE_URL` com uma conexão PostgreSQL. O projeto pode usar um banco hospedado no [Supabase](https://supabase.com/).

Não publique senhas, tokens, chaves de membro ou outras credenciais no repositório. Configure segredos por meio das variáveis de ambiente do ambiente em que o servidor estiver hospedado.

---

## Base tecnológica

- **Node.js** — execução do servidor.
- **Express** — rotas e endpoints da aplicação.
- **Socket.IO** — comunicação em tempo real.
- **PostgreSQL** — persistência dos dados.
- **Supabase** — opção de hospedagem para o banco de dados.

---

## Estado do projeto

O AnitOS '90 está em desenvolvimento. A estrutura e os recursos podem mudar à medida que novos módulos são integrados e os fluxos existentes são testados. Se encontrar um problema, informe a tela, os passos que levaram ao erro e o que aconteceu.

---

**ANITOPE SCIENCE**  
*AnitOS '90 · Ambiente de operações para campanhas e sessões de RPG*  
© Anitope Science. Todos os direitos reservados.

*“Eu só queria uma sessão.”*
