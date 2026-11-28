# Matriz de implementação e homologação da V3

Base `0c180f91988b6a99dfbb2bf9de4ffdd17388885a` na branch local `homologacao-stripe-v2`. Os testes usaram PostgreSQL e Redis isolados, dados sintéticos e transporte simulado para os provedores. Nenhuma execução usou o banco `agenda_auditoria`.

## Matriz

| Requisito | Classificação e evidência | Cobertura restante |
|---|---|---|
| 1. Auditoria integral | Implementada para os fluxos exercitados. Leitura de módulos, revisão de rotas, migrations e dependências. O aviso de concorrência em `pg` foi reproduzido, localizado e eliminado na suíte sem mudança de versão. | Revisão externa da configuração real e auditoria independente dos demais cenários. |
| 2. Interface | Implementada e testada nas vistas capturadas. O calendário público passou a ter seleção mensal. Assinatura, equipe, WhatsApp e comissões usam a navegação comum. Os indicadores mantêm dados do banco. | As referências foram adaptadas à estrutura funcional. Avaliações dependem de fonte real. |
| 3. Super Admin | Testada e aprovada no ambiente local para login e MFA, recuperação de uso único, configuração Stripe, Google e callback Apple simulados. Criação, edição e desativação de plano foram exercitadas em PostgreSQL com Stripe simulada. Resend cifrado e auditoria administrativa implementados. | Homologação dos formulários com provedores autorizados, entrega de e-mail, Evolution e operações comerciais reais. |
| 4. Comerciante | Testada localmente para cadastro, slug, edição de jornada, equipe, catálogo, imagens, prévia privada, publicação, agenda, financeiro, exportação e permissões. Billing conserva o preço histórico e o isolamento. | Contratação, renovação e cobrança recusada com Stripe real aguardam credenciais de sandbox. |
| 5. Consumidor | Cadastro distinto, perfil, calendários, reserva, reagendamento, cancelamento e isolamento testados no Chromium. O estado de pagamento foi validado por evento Connect assinado com chave fictícia e enviado pela rota HTTP real em ambiente de testes. O relatório distingue acompanhamento de estornos integrais, parciais e pendentes. | Checkout com cartão ou Pix, comprovantes de provedor, login externo e entrega ao dispositivo aguardam homologação autorizada. |
| 6. Agenda inteligente | Testada e aprovada para conflitos, fuso, bloqueios, feriados aplicados à equipe ativa, edição de jornada, lista de espera com consentimento e liberação após cancelamento. Cem disputas no mesmo horário geraram uma reserva. | A agenda trata feriados por bloqueio definido pelo comerciante. |
| 7. Financeiro | Implementada e testada em fixtures para consulta v2, política de estorno, conciliação local, pagamento tardio, deduplicação e processamento parcial. O relatório financeiro registrou recebimento tardio sem retomar a vaga. | Homologar conta bancária, repasse, taxas e Express no sandbox real. A operação manual de estorno parcial é feita na Stripe e conciliada pela aplicação. |
| 8. Automações | Testada com Redis e BullMQ locais e Evolution simulada. Consentimento, destino, referência do provedor, falhas ambíguas, retentativa e deduplicação verificados. A fila de estorno guarda obrigação após falha e a lista de espera registra aceite separado de entrega. | Recebimento em dispositivo real, continuidade sob indisponibilidade prolongada e fluxo completo com Stripe e Evolution autorizadas. |
| 9. Segurança | Verificações defensivas locais aprovadas nos cenários descritos em `seguranca-v3.md`. | Pentest independente, log operacional externo, WAF e auditoria de infraestrutura permanecem não homologados. |
| 10. Infraestrutura | PostgreSQL, Prisma, Redis, BullMQ e worker exercitados. S3, Resend e fornecedores financeiros e OAuth simulados. Inicializador DPAPI e procedimento de rotação implementados. | Windows 11, Vercel e Neon pendentes de ambiente. O formato do DPAPI existente precisa ser confirmado na instalação Windows. |
| 11. Backup e recuperação | Testada e aprovada em fixture. Dump em formato custom restaurado em banco separado. Usuários, vínculos, assinatura, produto, agendamento, movimento financeiro, TOTP e credenciais cifradas verificados. Falha de rotação causada por dado inválido levou a rollback integral. | Validar retenção, restauração S3 e recuperação de desastre com a configuração real da operação. |
| 12. Desempenho | Testada em 10, 50, 100 e 500 clientes concorrentes no Linux. Latências, CPU, memória, conexões e Redis em `desempenho-v3.md`. | A carga de 500 teve p95 de 4,745 s. Capacidade sustentada e meta comercial não estabelecidas. |
| 13. Testes automatizados | 36 aprovados, incluindo os 31 anteriores, além dos testes de integração, HTTP e navegador descritos abaixo. TypeScript, ESLint, Prisma e build aprovados. Auditorias npm completas sem alertas reportados. | Cobertura exaustiva de todas as combinações e integrações reais permanece parcial. |
| 14. Visual | Comparação com as referências e com as 55 capturas anteriores. Foram produzidas 125 capturas de 25 vistas. Comparação dimensional e diferenças RGB medidas em 55 pares anteriores. O navegador exerceu fluxos e verificou ausência de overflow global nas cinco resoluções. | Revisão em dispositivos físicos, Safari e avaliação formal de acessibilidade não homologadas. |
| 15. Correção e revalidação | Status de prévia, sessão, disponibilidade, estorno e aviso PostgreSQL foram corrigidos e retestados. | Incidentes externos precisam de um ambiente autorizado reproduzível. |
| 16. Entrega | Código no commit local, docs Windows e Vercel, scripts, matrizes, registros de teste, desempenho, segurança e capturas. | A versão comercial continua em homologação. |

## Comparação visual

| Referência | Evidência da V3 |
|---|---|
| Checkout e automação | Revisão e confirmação em rota pública. Cartão continua no provedor oficial e a linha do tempo lê resultados persistidos. |
| Página de estabelecimento | Banner, blocos de serviço, profissional, calendário em português, botões de horários e painel de informações. Carrinho e histórico permanecem acessíveis pela navegação. |
| Catálogo | Tabelas e editor lado a lado em desktop. Serviços, produtos, categorias e preço BRL têm componentes próprios. Media e disponibilidade usam as preferências do comerciante. |
| Dashboard | Menu roxo, cartões, chart, agenda por período e próximos horários. Edição de jornada, bloqueios da equipe e política de cancelamento aparecem nas rotas correspondentes. |
| Login e cadastro | Um formulário por rota, design comercial em desktop e controles próprios no celular. Botões sociais aparecem somente quando o provedor está habilitado. |
| Comerciante e consumidor | Rotas, dados e ações separados. A prévia de estabelecimento inativo exige vínculo e autorização. O consumidor só acompanha seus próprios dados. |

## Migrations e dependências

Mantidas as 37 migrations originais. Foram acrescentadas `202611280038_plan_prices`, `202611280039_connected_refunds`, `202611280040_waitlist_notice` e `202611280041_mail_setting`. O banco dedicado recebeu as atualizações sobre a base anterior e o status do Prisma registrou 41 migrations atuais. O backup de teste também foi recriado com a árvore completa.

As dependências foram preservadas. O Prisma permanece em 7.10.1 e o override do `effect` mantém 3.22.1.

## Execução registrada

- `npm test` com `NODE_OPTIONS=--trace-deprecation`. 36 aprovados e nenhuma ocorrência do aviso investigado.
- `prisma generate`, `prisma migrate deploy`, `prisma migrate status`, TypeScript, ESLint e build de produção.
- `npm audit` e `npm audit --omit=dev`. Zero vulnerabilidades reportadas.
- Integração Connect simulada. Onboarding, retomada, idempotência, separação de estabelecimentos e consulta da conta de teste.
- Redefinição de senha e persistência Resend via resposta simulada. Rejeição de falha no envio e nenhuma credencial retornada na interface.
- PostgreSQL `pg_dump` e `pg_restore` pelo cliente do contêiner. Rotação e rollback com chaves fictícias.
- Smoke HTTP, fluxo de cadastro e reserva, exportações CSV/XLSX, permissões, webhooks assinados e invalidados e verificações de interface.
- Chromium em 390 × 844, 768 × 1024, 1280 × 800, 1440 × 900 e 1920 × 1080. Dados de vitrine fictícios no banco isolado.
- Worker, Redis e S3. Confirmação de consentimento e destino, retentativa, espera, substituição e exclusão de imagens.
