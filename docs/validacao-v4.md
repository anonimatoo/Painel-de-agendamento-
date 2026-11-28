# Validação da V4 Business Suite

Validação local em 28 de novembro de 2026 na branch `desenvolvimento-v4-business-suite`, partindo do commit V3 `045b97a9633112531d68ab13216e3a826deebd46`.

## Resultados executados

| Verificação | Resultado |
|---|---|
| `npm test` | 44 de 44 aprovados, incluindo os 36 cenários da V3. |
| Concorrência e isolamento | Uploads simultâneos com uma vaga nos limites de 10 e 30 fotos, downgrade sem exclusão, acesso cruzado a produtos e imagens, idempotência em compras e estornos, execução única de automação e resgate único de fidelidade. |
| `npx tsc --noEmit --incremental false` | Aprovado. |
| `npm run lint` | Aprovado. |
| `npx next build --webpack` | Build de produção aprovado, Next.js 16.4.6 e Node.js 24.22.3. |
| `npm audit` e `npm audit --omit=dev` | Nenhuma vulnerabilidade informada pelo registro nas duas auditorias. Prisma 7.10.1 e override do effect 3.22.1 preservados. |
| PostgreSQL vazio | 48 migrations aplicadas em banco dedicado criado para essa validação. |
| PostgreSQL a partir da V3 | 41 migrations V3 em banco independente, carga sintética, backup e restauração em outro banco, seguida das sete migrations V4. Conferidos estoque, SKU, foto legada, registro financeiro, contrato recorrente e existência do registro de recuperação. |
| HTTP | 11 requisições em build de produção, incluindo páginas públicas, sessão obrigatória, webhooks sem assinatura rejeitados e rota de saúde. |
| Chromium V4 | 13 vistas em 390 e 1280 px, com 26 capturas. Criação privada de produto, galeria, reordenação, proteção de acesso, compras, oferta, exportação PNG e editor de fluxo foram exercitados. [Evidências visuais](evidencias-v4/README.md) |
| Chromium regressão comercial | 125 verificações em cinco resoluções. Prévia, publicação, reserva, reagendamento, isolamento, confirmação simulada e pedido de estorno. |
| Chromium autenticação | Google simulado, state inválido, PKCE, reuso de autorização, cadastro lojista e consumidor, configuração pela página Super Admin e callback POST Apple com JWT simulado. Verificadas as larguras de 390 e 1280 px. Apple fica oculto em HTTP local. |
| Stripe Connect | Integração local aprovada com provedor simulado. Contas v2, recuperação de falhas, onboarding e idempotência isolada por estabelecimento. |
| Redis e BullMQ | Worker real com PostgreSQL e Redis de teste. Confirmados agendamento visual respeitando consentimento, descarte da execução inelegível e aceite de campanha WhatsApp pela Evolution simulada. |
| Armazenamento | Conteúdo enviado, lido, reordenado e removido nos testes com servidor HTTP local simulando o protocolo S3. |

A validação defensiva cobriu acesso por estabelecimento, permissões, proteção de mídia privada, 2FA e recuperação, expiração e uso único de autorização, e validação de assinatura das rotas financeiras. A auditoria npm avalia as dependências conhecidas pelo registro no momento da execução.

## Migrations da V4

- `202611280042_business_catalog` — preferência de ciclo, código de barras e ordem de fotos.
- `202611280043_automation_pro` — fluxos e execuções de automação por estabelecimento.
- `202611280044_business_operations` — compras, fornecedores, ofertas, custo do pedido e referência de pagamento.
- `202611280045_business_relationships` — feriados, fidelidade, campanhas, consentimento e classificação financeira.
- `202611280046_media_cleanup` — fila persistente de limpeza de imagens.
- `202611280047_automation_delivery_kind` — amplia a restrição de tipos de lembrete para o CS Automation Pro.
- `202611280048_order_financial_evidence` — evidência contábil de pedido pago e retorno de estoque.

## Pendências de homologação

- Google e Apple reais. Validar aplicativos cadastrados, callback HTTPS da Apple, tela de consentimento e fluxo ponta a ponta nos provedores.
- Stripe e Brasil. Validar provisionamento dos novos preços no sandbox autorizado, Checkout com ofertas, Pix, Connect Express, conciliação bancária, repasses e estornos com eventos reais de teste.
- WhatsApp, Resend e S3. Confirmar aceite e entrega reais, políticas do canal, armazenamento e recuperação de objetos no provedor escolhido.
- Windows 11, dispositivos físicos e Safari. As execuções registradas ocorreram em Linux com Chromium. O manual descreve configuração separada para Windows.
- Conciliação dos registros históricos sem comprovação de custo, taxa ou classificação, e revisão independente de segurança operacional.

O roteiro de operação, a matriz das 48 ferramentas e os limites de escopo estão na [documentação da Business Suite](business-suite-v4.md).
