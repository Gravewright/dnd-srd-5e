# Desempenho do combate

[English](performance.md)

## Iniciativa em lote nativo

O DnD 0.2.1 usa `typeof api.combat.rollInitiativeBatch === 'function'` para
selecionar a capacidade opcional do VTT 0.3.8 em novas iniciativas. As regras
DnD ficam no pacote: ele lê fichas atuais, resolve fórmulas, visibilidade e
revisões de ator/ficha/token e congela o plano antes do envio. Tokens vinculados
ao mesmo ator reutilizam uma leitura somente durante a preparação; tokens
independentes mantêm dados separados. Há no máximo quatro leituras simultâneas.

Um checkpoint durável do lote substitui checkpoints de rolagem/gravação por
participante. O host valida permissões e revisões antes de rolar, confirma
resultados e ordem atomicamente e agrupa o chat por visibilidade pública ou
do mestre. Participantes ocultos não se tornam públicos por argumentos do
cliente. Vinte rolagens públicas geram uma mensagem com vinte resultados.
O limite do chat continua valendo para as mensagens criadas.

Uma resposta perdida reutiliza o mesmo plano e UUID. Uma revisão rejeitada exige
novas leituras de combate, atores, tokens e fichas antes de outro plano e UUID.
O tracker preserva verificações de propriedade, pausa, mestre e encerramento.
Encerrar não desfaz um lote já confirmado. Repetir um recibo devolve o combate
atual. A intenção privada confirmada é mantida e substituída pela próxima
operação usando sua revisão.

Hosts 0.2.3 e 0.3.7 usam o caminho sequencial, assim como registros iniciados
em versões anteriores. Um lote nativo pendente exige essa capacidade para
retomar; voltar o host nunca o converte silenciosamente em rolagens novas.
O contrato nativo aceita até 64 entradas; lotes maiores falham de forma visível,
sem rolar parcialmente. Não há cache de fichas entre operações.

## Medições em navegador real

Foram usados Chromium, SQLite local, mestre e jogador e vinte participantes
com fichas 2014/2024 e tokens vinculados/independentes. Cada fórmula tem três
amostras. As medições nativas usaram a implementação do VTT 0.3.8 e o runtime
DnD empacotado antes de seus metadados passarem de 0.2.0 para 0.2.1; a atualização
de versão e documentação não mudou o comportamento medido.

`fullFlowMilliseconds` começa no evento real de clique. Termina no último dos
frames de mestre e jogador com a ordem e os resultados de chat esperados; o
mestre também precisa sair do estado ocupado e habilitar o botão de rolagem.
Os vinte resumos de resultado são conferidos nos dois chats. Isso inclui HTTP,
entrega por WebSocket e renderização, além da aceitação do servidor.

| Fórmula | Amostras do fluxo completo | Mediana | Intervalo entre lotes |
| --- | --- | ---: | ---: |
| `@init` | 842,6; 798,7; 781,0 ms | 798,7 ms | 10,1 s |
| `1d20 + @init` | 947,9; 924,7; 883,3 ms | 924,7 ms | 0,5 s |

As execuções não tiveram erros de navegador ou requisições HTTP rejeitadas.
Cada lote gerou uma mensagem pública. As chamadas HTTP do lote levaram 25–51 ms;
as leituras das vinte fichas ocuparam 342–396 ms. A execução aleatória observou
43, 39 e 39 requisições de módulo/armazenamento até liberar o mestre, incluindo
leituras de eventos e limpeza anterior. O custo restante inclui preparação e
persistência.

São resultados locais, sem garantia de menos de um segundo em hosts remotos,
fichas grandes ou outras máquinas. Três amostras por fórmula não estabelecem um
percentil confiável para os casos mais lentos. Avançar turno permanece separado:
sua mediana de fluxo completo foi 1.057 ms na execução aleatória, sem efeitos.

A medição anterior começava na chamada do Playwright e terminava ao liberar
os controles do mestre, incluindo esperas da automação. Preserve essa métrica ao
comparar relatórios antigos; a nova métrica não tem base histórica:

| Operação, `@init` determinístico | Pacote original, VTT 0.3.7 | Sequencial otimizado, VTT 0.3.7 | Lote nativo, VTT 0.3.8 |
| --- | ---: | ---: | ---: |
| Rolar todas as iniciativas | 13.360 ms | 7.605 ms | 941 ms |
| Avançar sem efeitos | 1.476 ms | 1.449 ms | 1.438 ms |

A iniciativa sequencial melhorou 43%; o lote nativo reduziu essa medição em mais
87,6%. As pequenas diferenças de turno não demonstram ganho relevante. Os ajustes
sequenciais reduziram leituras de combate de 66 para 24, de atores de 23 para
duas e alterações na lista de filhos do tracker de 143 para 11 por operação.

## Compatibilidade sequencial e atualizações da interface

O controlador sequencial lê seu estado inicial uma vez e usa a revisão devolvida
por cada comando aceito. Registra nomes de checkpoints juntos e evita ler os que
ainda não existem. Operações retomadas continuam lendo checkpoints antes de
repetir a requisição. Fórmulas e argumentos privados ficam no armazenamento do
usuário. A limpeza opcional ocorre após liberar os controles.

Hosts anteriores permitem 20 envios de chat/dados por membro em dez segundos.
O controlador consulta o histórico autorizado e espaça rolagens quando o limite
está ocupado. A espera preserva UUIDs, permite descarte e reconfere propriedade.
Outras cenas, mensagens apagadas ou outro cliente podem consumir limite não
observado. Erros genéricos de validação não são repetidos como respostas de limite.
Até uma rolagem aceita identificar o autor, a contagem é conservadora; depois
conta mensagens daquele autor e seus recibos locais em memória.

O tracker aproveita projeções autorizadas, agrupa atualizações durante comandos
e preserva controles quando a apresentação não muda. Fichas compartilham uma
assinatura de atores por instância, ignoram revisões irrelevantes e serializam
leituras. Fichas de tokens revalidam dados independentes e permissões. Leituras
atrasadas não substituem gravações locais recentes; edições adiam atualizações
até ser seguro. Assinaturas e projeções em cache são liberadas no descarte.

Uma medição separada no Chromium usou ficha sintética de 205 KB, dez eventos em
100 ms e atraso de 80 ms por leitura. Eventos de outros atores caíram de dez
leituras para zero; rajadas relevantes caíram de dez para três, com concorrência
máxima de nove para uma. Isso mede carga de requisições, não o tempo de toda mesa.

## Reproduzir

Gere o pacote e execute o cenário de navegador em um host descartável:

```sh
python scripts/build.py
python tests/e2e/combat_performance.py --host-root /caminho/para/gravewright \
  --archive dist/gravewright-5e-srd-0.2.1.zip --output /caminho/para/gravewright/data/perf-run \
  --browser-executable /caminho/para/chromium --participants 20 --repetitions 3 \
  --formula '1d20 + @init' --roll-interval 0.5
```

Cada execução usa contas sintéticas, banco separado e pacotes instalados isolados.
Campanhas existentes e `.env` não são usados. Use um diretório novo e o mesmo
host/navegador ao comparar arquivos. O JSON inclui tempos por chamada, contagens,
alterações do tracker, tempos entre clique e frame e validação do jogador.
O padrão usa `@init` e intervalo de 10,1 segundos. Para espaçamento no fluxo
legado, use mais de vinte participantes com `--roll-interval 0.5`.

O simulador do controlador isola a sequência de chamadas, acrescentando 10 ms
por API/armazenamento; não mede rede, banco de dados ou navegador reais:

```sh
node tests/combat-performance.mjs legacy.json 3 10 legacy independent
node tests/combat-performance.mjs batch.json 3 10 batch independent
```

Com vinte fichas independentes, os ajustes sequenciais reduziram a mediana de
3.145 para 2.944, 2.784 e então 1.947 ms. A preparação do lote nativo mediu 272 ms;
remover leituras redundantes reduziu para 200 ms. As chamadas caíram de 209
no sequencial otimizado para 38 com lote, e os bytes dos SETs privados de 71.827
para 12.433. Esses valores sintéticos apenas explicam a redução de chamadas.

Os testes cobrem rolagens interrompidas, respostas perdidas de checkpoints/lotes,
conflitos, mestres simultâneos, encerramento, pausa, registros antigos, downgrade,
dados de tokens, permissões, descarte e respostas atrasadas de fichas.
