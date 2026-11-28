# Desempenho local da V3

Medições no Linux isolado com três CPUs visíveis, limite de memória de 8 GiB, Next.js em modo de produção e PostgreSQL local. O gerador consultou a página pública de um estabelecimento sintético. Cada etapa manteve concorrência por cinco segundos, aguardando as últimas respostas em seguida. Nenhum provedor externo recebeu tráfego do teste.

| Usuários simultâneos | Requisições | Erros | Latência média | p95 | p99 | Conexões PostgreSQL observadas | RSS final do web | CPU média do web |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 403 | 0 | 125 ms | 237 ms | 463 ms | 11 | 382 MiB | 1,24 núcleo |
| 50 | 672 | 0 | 380 ms | 525 ms | 555 ms | 11 | 543 MiB | 1,24 núcleo |
| 100 | 743 | 0 | 718 ms | 865 ms | 934 ms | 11 | 580 MiB | 1,18 núcleo |
| 500 | 1.001 | 0 | 3.360 ms | 4.745 ms | 4.842 ms | 11 | 644 MiB | 1,14 núcleo |

A CPU do processo web foi medida em ticks do Linux convertidos usando 100 ticks por segundo e divididos pelo tempo efetivo de cada etapa. O RSS foi lido antes e depois de cada etapa. As conexões foram amostradas no PostgreSQL a cada 500 ms e incluem o observador. O Redis foi medido separadamente com 2.000 operações por modo e 10 conexões. O PING inline registrou 43.478 operações/s e p50 de 0,103 ms. O PING multibulk registrou 20.833 operações/s e p50 de 0,095 ms.

Depois da bateria HTTP, 100 tentativas concorrentes disputaram o mesmo horário. O PostgreSQL registrou exatamente **uma reserva confirmada**, sem pagamentos. Em integração funcional separada, BullMQ e Redis verificaram retentativa e deduplicação, e o worker registrou dois avisos ao comerciante e um aviso ao consumidor que autorizou o envio, com Evolution simulada.

O p95 chegou a 4,75 s na etapa de 500. O resultado mede uma carga curta com uma única rota em um ambiente local. Saturação sustentada, volume de filas, capacidade com múltiplos estabelecimentos e latência na Vercel e no Neon precisam de medição própria antes de definir uma meta comercial.
