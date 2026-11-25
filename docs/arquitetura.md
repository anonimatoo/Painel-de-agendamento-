# Arquitetura do CS Agenda Pro

O Next.js serve a página comercial, a agenda pública, os painéis e a API REST em Node.js. A publicação da aplicação está prevista na Vercel. O worker permanece em um processo Node.js dedicado com Redis e BullMQ. O PostgreSQL é a fonte de verdade e pode ser hospedado na Neon. As imagens ficam em armazenamento compatível com S3.

Cada usuário possui uma sessão revogável. O vínculo de usuário com estabelecimento define seu papel. A API obtém o estabelecimento a partir do vínculo autenticado. Agendamentos usam chaves estrangeiras compostas com o identificador do estabelecimento e uma restrição de exclusão GiST para impedir intervalos sobrepostos. Valores monetários são inteiros em centavos.

O Billing controla assinaturas da plataforma. A cobrança do agendamento usa Checkout na conta conectada. Eventos autenticados da Stripe são registrados por identificador e processados na mesma transação das alterações locais. Tarefas assíncronas devem partir de registros persistentes para permitir recuperação após indisponibilidade do Redis.

Referências consultadas

- [Next.js](https://nextjs.org/docs/app/getting-started/installation)
- [Prisma](https://www.prisma.io/docs/orm/reference/system-requirements)
- [Stripe Connect](https://docs.stripe.com/connect/direct-charges)
- [Webhooks Stripe](https://docs.stripe.com/webhooks)
