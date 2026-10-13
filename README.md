# AnitOS '90

Plataforma modular da Anitope Science: o **ANITOPEBOARD** (painel de campanhas Light Fade) e o **RGN** (salas de RPG com dados e chat) compartilham o mesmo serviço Node.js, mas mantêm interfaces separadas.

## Executar localmente

Requer Node.js 20+. Dentro da pasta do projeto:

1. `npm install`
2. `npm start`
3. Abra `http://localhost:3000`

## Módulos

- **RGN:** `/` ou `/rgn` — lobby multiplayer existente.
- **ANITOPEBOARD:** `/anitopeboard/` — dashboard AnitOS '89, incluindo os recursos locais em `img/` e `aud/`.
- **Saúde do serviço:** `/health`.

As interfaces são servidas separadamente. Nesta primeira etapa, o dashboard original ainda usa `localStorage` do navegador para guardar os dados da campanha; autenticação, persistência centralizada e permissões de Mestre/Jogador serão integradas em etapas seguintes. O RGN continua usando o mecanismo atual de salas e reconexão.

## Persistência do RGN com Supabase

1. Crie um projeto no [Supabase](https://supabase.com/) e abra **Connect** no painel.
2. Copie a string PostgreSQL. Para ambientes IPv4, prefira o **Session pooler** se a conexão direta não estiver disponível.
3. Configure `DATABASE_URL` como variável de ambiente no serviço Node.js. Nunca coloque essa string no frontend nem a envie ao GitHub.
4. Reinicie o serviço. O servidor cria a tabela `anitos_state` automaticamente e carrega o estado salvo.

O banco atual guarda o estado das salas em `anitos_state` (JSONB): salas, jogadores, tokens de recuperação e histórico de rolagens/chat. Depois de reiniciar o servidor, as sessões salvas podem ser recuperadas durante uma janela de 30 segundos. Sem `DATABASE_URL`, o projeto funciona em memória, mas perde o estado ao reiniciar.

## Funcionalidades atuais do RGN

- Salas com códigos gerados no servidor e entrada por código
- Limites de frequência para criação/entrada, reconexão, rolagens e encerramento
- Limite de 200 salas simultâneas e 20 jogadores por sala
- Jogadores, rolagens e chat sincronizados em tempo real
- D4, D6, D8, D10, D12, D20 e D100
- Resultados calculados no servidor com `crypto.randomInt`
- Moderação de chat e rolagens, banimento por nome e encerramento pelo administrador
- Reconexão temporária por token, sem contas ou senhas

## Próximas etapas da integração

1. Autenticação e escolha de perfil (Mestre/Jogador).
2. Persistência de campanhas e fichas no PostgreSQL.
3. Migração segura do formato `MGR_DATA` do ANITOPEBOARD.
4. Atribuição de fichas a jogadores e sincronização em tempo real.
5. Integração das campanhas com salas RGN e testes de isolamento de permissões.
