# banho-em-dia

Sistema de agenda e gestão de planos de banho do HEIN PET SALON, preparado para Vercel e Supabase.

Consulte [`MIGRACAO_VERCEL_SUPABASE.md`](MIGRACAO_VERCEL_SUPABASE.md) para configurar o banco, o primeiro administrador e a publicação.

## Análises financeiras

Acesse **Análises** no cabeçalho da agenda (administradores), ou `/analises`.

- Recebimentos são contabilizados pela data do pagamento em `America/Sao_Paulo`, uma vez por `group_id`. A data dos banhos é usada apenas nas análises de atendimento.
- Cada pagamento salva um comprovante lógico em `appointments.payment_details.receipt`: identificador, data informada, instante do registro, forma e, se conjunto, identificador do lote. O mesmo comprovante é replicado nas sessões do plano; a análise agrupa antes de somar. Não é necessária migração de banco para este recurso.
- Valor e forma são obrigatórios ao marcar como pago. Corrigir um pagamento preserva sua data e taxa original quando a forma não muda. Para mudar a data, use **Editar pagamento**. Alterar datas, serviços ou a ficha do cliente não modifica o registro financeiro.
- Desmarcar pago é uma correção: exclui o recebimento dos relatórios e mantém os detalhes anteriores no registro de auditoria. Não implementa reembolso nem estorno bancário. Renovar gera um plano pendente, sem reaproveitar o comprovante.
- Pagamentos conjuntos distribuem o total entre os planos, preservando os centavos do total cobrado. A contagem e o ticket médio são por plano/avulso, não por transação de cartão.
- Taxas e líquido são estimativas usando a taxa salva no pagamento. Não há conciliação de repasses, despesas, impostos ou cálculo de lucro.
- Registros pagos sem data/comprovante consistente são excluídos com aviso; não há preenchimento automático de histórico antigo.
- A API `/api/analytics` exige administrador, pagina as leituras do Supabase e não usa cache. Aceita `start`, `end` (até 366 dias, sem futuro), `plan`, `method`, `page` ou `format=csv`. O CSV contém todos os recebimentos filtrados, mesmo quando a tabela está paginada.
- Comparações usam um período imediatamente anterior de mesma duração. Médias por dia da semana incluem dias sem pagamento. Melhor mês e gráfico histórico respeitam tipo/forma, mas abrangem o histórico inteiro. Pendências são o saldo atual de todas as datas e não usam o filtro de forma de pagamento.

Validação local (Node 22+): `node --test tests/*.test.mjs` e `npm run build`.
