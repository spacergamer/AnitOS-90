# AnitOS '90

**AnitOS '90** é uma plataforma da **Anitope Science** para organizar campanhas e jogar RPG online. O site reúne gerenciamento de personagens, ferramentas para Mestres e Jogadores e salas de jogo com comunicação em tempo real.

## Recursos

- **ANITOPEBOARD (AnitOS '89):** painel para organizar campanhas e fichas de personagens.
- **Salas de RPG (RGN):** criação de salas por código, chat integrado e rolagem de dados de D4 a D100.
- **Contas de usuário:** perfis de Mestre e Jogador, com atribuição de fichas e permissões por campanha.
- **AnitOS '90 Pro:** acesso adicional ativado por chave de membro.

## Acessar o site

- **Início:** [AnitOS '90](https://anitos-rgn-system-91.onrender.com/)
- **Conta:** `/account`
- **ANITOPEBOARD:** `/anitopeboard/`
- **Salas RGN:** `/rgn`

## Tecnologias

Node.js, Express, Socket.IO e PostgreSQL. O banco de dados pode ser hospedado no Supabase.

## Executar localmente

Requer Node.js 20 ou superior.

```bash
npm install
npm start
```

Configure `DATABASE_URL` com uma conexão PostgreSQL para persistir contas e dados. Não armazene credenciais ou chaves privadas no código-fonte.

---

**Anitope Science · AnitOS '90**
