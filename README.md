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
- **Contas:** `/account` — criação de conta e login com perfil Mestre ou Jogador.
- **Saúde do serviço:** `/health`.

As interfaces são servidas separadamente. O login usa cookies de sessão HTTP-only e senhas derivadas com scrypt; as contas/campanhas exigem `DATABASE_URL` configurado no servidor. Sem banco, o RGN continua disponível em memória, mas os endpoints de contas/campanhas respondem com indisponibilidade.

## Persistência com Supabase

1. Crie um projeto no [Supabase](https://supabase.com/) e abra **Connect** no painel.
2. Copie a string PostgreSQL. Para ambientes IPv4, prefira o **Session pooler** se a conexão direta não estiver disponível.
3. Configure `DATABASE_URL` como variável de ambiente no serviço Node.js. Nunca coloque essa string no frontend nem a envie ao GitHub.
4. O servidor cria as tabelas automaticamente na inicialização. O esquema também está em `supabase/schema.sql`.

O banco mantém:
- `anitos_state`: estado atual das salas RGN (JSONB), com jogadores, tokens de reconexão e histórico de rolagens/chat.
- `anitos_users` e `anitos_sessions`: contas, perfil Mestre/Jogador e sessões autenticadas.
- `anitos_campaigns` e `anitos_campaign_members`: campanhas persistentes e participação por código.
- `anitos_characters`: fichas de personagem e atribuição a jogadores.

As sessões RGN desconectadas podem ser recuperadas durante uma janela de 30 segundos. As sessões de conta duram 30 dias. Nunca publique a variável `DATABASE_URL`.

## Funcionalidades do RGN mantidas

- Salas com códigos gerados no servidor e entrada por código
- Limites de frequência para criação/entrada, reconexão, rolagens e encerramento
- Limite de 200 salas simultâneas e 20 jogadores por sala
- Jogadores, rolagens e chat sincronizados em tempo real
- D4, D6, D8, D10, D12, D20 e D100
- Resultados calculados no servidor com `crypto.randomInt`
- Moderação de chat e rolagens, banimento por nome e encerramento pelo administrador
- Reconexão temporária por token, sem exigir conta para usar o RGN legado

## Estado da integração

**Implementado nesta branch:** rotas separadas, tela de conta, autenticação básica, perfis Mestre/Jogador, persistência de campanhas e endpoints protegidos para fichas e atribuições.

**Ainda pendente:** conectar o estado real do dashboard `MGR_DATA` às APIs persistentes, listar/atribuir fichas pela interface, sincronizar alterações em tempo real e testar o ciclo completo no Render/Supabase. O dashboard original continua usando `localStorage` até a etapa de migração; nenhum dado local foi importado ou apagado por estas mudanças.

## Segurança e dados

- O backend verifica a sessão e o proprietário/membro da campanha em cada endpoint.
- Jogadores só recebem fichas atribuídas a eles e não podem editá-las via API.
- O backup JSON exportado pelo dashboard deve ser preservado até a migração e validação dos dados reais.
