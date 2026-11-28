# Auditoria de segurança da V3

## Correções e regressões

- A prévia anterior à assinatura passou a verificar usuário, vínculo, permissão de marca e estado de suspensão. A mídia de estabelecimento inativo usa autorização por vínculo e resposta sem cache público.
- Leituras financeiras vinculam a conta Connect e o PaymentIntent antes de registrar estorno. Estados pendentes e recusados ficam separados dos valores devolvidos. Um estorno parcial mantém estoque e agenda no estado anterior enquanto a devolução integral não for confirmada.
- A automação de cancelamento e estorno exige política habilitada. A obrigação é gravada com a mudança de estado e o worker reutiliza uma chave de idempotência. Casos ambíguos permanecem sujeitos a conciliação.
- O webhook usa assinatura, ambiente e destino, limita o corpo e deduplica pelo ID. O callback Apple limita o corpo, e os fluxos OAuth mantêm validação de navegador, state, nonce, assinatura e audiência.
- O Resend guarda a chave cifrada com contexto próprio. A configuração requer sessão Super Admin com MFA e reconfirmação da senha. O teste usa o endereço da própria conta administrativa.
- O inicializador Windows recupera a chave existente, grava mensagens de etapa e restringe a porta ao loopback. A ferramenta de rotação verifica o banco pelo nome, protege a alteração em uma transação e preserva os fatores de autenticação.
- O aviso de `pg client.query()` foi reproduzido com stack trace. O Prisma carregava relações irmãs sobre um único cliente transacional na disponibilidade e na conclusão da agenda. A separação das leituras e a serialização das alterações de categoria eliminaram o aviso na suíte com `--trace-deprecation`. O SDK e as versões de dependência foram preservados.

## Evidências defensivas

| Controle | Evidência local | Limites |
|---|---|---|
| Isolamento de estabelecimentos e consumidores | FKs compostas, bloqueio de tentativa de vínculo cruzado, escopo da sessão, perfil, mídia, comprovante e renovação Connect. | Revisão adicional de toda a superfície em ambiente implantado. |
| Sessão, permissões e MFA | Proteção de rotas, permissões de leitura, revogação, controle de duplicidade e recuperação, state de OAuth de uso único e tokens fora de validade. | Sem auditoria externa de sequestro de sessão. |
| Preços e pagamentos | Preços persistidos no servidor, reservas e estoque concorrentes, validação do valor e moeda do Checkout e estorno limitado ao pagamento relacionado. | Sandbox Stripe autorizado ainda pendente. |
| Webhooks | Assinatura válida e inválida, duplicidade, limite de tamanho, roteamento snapshot e rejeição de evento thin na rota snapshot. | Thin events reais e eventos Stripe de ponta a ponta aguardam sandbox. |
| Injeção, XSS, CSRF e SSRF | Revisão de queries parametrizadas, renderização React, origem padrão das server actions, protocolos e destinos externos permitidos, limites de corpo e validações. | Sem varredura automatizada independente para toda a superfície. |
| Upload, arquivos e credenciais | Rejeição de arquivo inválido, reprocessamento em WebP, isolamento de mídia privada, persistência cifrada e recuperação com falha simulada. | Auditoria do bucket real, dos logs de hospedagem e dos controles de acesso da infraestrutura pendente. |
| Força bruta e reutilização | Rate limiting compartilhado, tokens por hash de uso único, sessões revogadas após redefinição e códigos MFA não reutilizáveis. | Políticas de proxy, WAF e monitoração dependem do ambiente escolhido. |

A auditoria de dependências completa e de produção reportou zero vulnerabilidades no executor. A validação local cobre os cenários acima. Testes de segurança externos exigem escopo e ambiente autorizados.
