# Migração para Vercel + Supabase

O projeto usa o Supabase para autenticação por e-mail/senha e para armazenar agenda, pagamentos, equipe e histórico. A Vercel executa o site e as rotas protegidas do servidor.

## 1. Criar o banco

1. Crie um projeto no Supabase.
2. Abra **SQL Editor**.
3. Copie e execute todo o arquivo [`supabase/schema.sql`](supabase/schema.sql).

As tabelas criadas são:

- `profiles`: usuários, nível de acesso e a flag `can_access`;
- `clients` e `pets`: cadastro rápido, serviços favoritos e últimas preferências;
- `appointments`: banhos avulsos e sessões dos planos;
- `payment_settings`: taxas de crédito e débito;
- `audit_logs`: histórico de ações;
- `plan_renewals`: controle de renovações já realizadas.

## 2. Criar o primeiro administrador

1. No Supabase, abra **Authentication > Users > Add user**.
2. Crie seu usuário com e-mail e senha e marque o e-mail como confirmado.
3. Volte ao **SQL Editor** e execute, trocando os valores:

```sql
update public.profiles
set can_access = true,
    role = 'admin',
    name = 'Seu nome'
where lower(email) = lower('seu@email.com');
```

Depois disso, você cria os demais funcionários diretamente na tela **Equipe** do sistema. Cada pessoa terá e-mail, senha, permissão e a flag de acesso.

## 3. Configurar as variáveis

No Supabase, abra **Project Settings > API** e copie as chaves. Para desenvolvimento, duplique `.env.example` como `.env.local` e preencha:

```env
NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxxxxxxxxxxxxxx
SUPABASE_SERVICE_ROLE_KEY=sb_secret_xxxxxxxxxxxxxxxxx
```

Nunca exponha ou envie a `SUPABASE_SERVICE_ROLE_KEY`. Ela deve existir somente em `.env.local` e nas variáveis protegidas da Vercel.

## 4. Publicar na Vercel

1. Envie o projeto para um repositório Git.
2. Na Vercel, selecione **Add New > Project** e importe o repositório.
3. Em **Environment Variables**, cadastre as três variáveis acima para Production, Preview e Development.
4. Publique. O framework será reconhecido como Next.js.

## 5. Sobre os dados atuais

O arquivo SQL cria a estrutura vazia. Os registros do banco antigo não são copiados automaticamente. Antes de encerrar o site atual, exporte e importe esses dados em uma etapa separada.

## Atualização de uma instalação existente

Se você já executou o `schema.sql` antes da inclusão do cadastro rápido, execute também [`supabase/migrations/20260925_quick_registration.sql`](supabase/migrations/20260925_quick_registration.sql) no SQL Editor.
