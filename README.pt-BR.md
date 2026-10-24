# DnD 5e SRD

Sistema de quinta edição para o Gravewright VTT, com escolha entre **2014 / SRD 5.1** e **2024 / SRD 5.2.1**. **0.1.6 Alpha**.

[English](README.md) · [Baixar 0.1.6](https://github.com/Gravewright/dnd-srd-5e/releases/tag/v0.1.6) · [Notas da release](docs/releases/0.1.6.md) · [Automações e limites](AUTOMATION.md) · [Reportar problema](https://github.com/Gravewright/dnd-srd-5e/issues)

A ficha Noturno combina fundo escuro, tipografia em marfim, molduras douradas e um cabeçalho ilustrado. Inclui fichas próprias de personagem, monstro e 11 tipos de itens, salvamento automático e compêndios licenciados separados por edição. Este projeto adapta o framework legado Gravewright 5e SRD 0.3.1; o nome público atual é **DnD 5e SRD**.

Projeto independente, sem afiliação ou endosso da Wizards of the Coast ou do Foundry VTT. Não inclui artes oficiais, livros ou conteúdo premium.

## Instalar e escolher uma edição

Funciona no [Gravewright VTT **0.2.3 já publicado**](https://github.com/Gravewright/gravewright/releases/tag/v0.2.3),
com SDK 1.x. Para português/espanhol, use o [Translator oficial 0.1.2 ou mais
recente](https://github.com/Gravewright/translator). Inglês é o padrão. Não é
necessário alterar o core do VTT nem instalar um módulo separado de regras.

1. Como proprietário do host, baixe
   [`gravewright-5e-srd-0.1.6.zip`](https://github.com/Gravewright/dnd-srd-5e/releases/download/v0.1.6/gravewright-5e-srd-0.1.6.zip)
   da release no GitHub e instale pelo instalador local nativo de sistemas do
   host em execução. A versão do Marketplace pode ser diferente até a atualização
   de seu catálogo.
2. Crie uma mesa com **DnD 5e SRD**. Mesas existentes podem selecionar a nova
   versão exata do pacote em **Configurações → Extensões**.
3. O mestre define a edição padrão para novas fichas em **Configurações →
   Extensões → Personalizar**. Cada ficha mantém sua edição explícita: **2014 /
   SRD 5.1** ou **2024 / SRD 5.2.1**. Trocar a edição não converte itens existentes.
4. Para usar português ou espanhol, instale e ative o Translator e escolha o
   idioma na conta. O mestre concede leitura dos compêndios pelas permissões nativas.

Um único ZIP reúne fichas de personagens, monstros e itens, compêndios,
traduções, configurações, iniciativa e automações de turno. O download inclui
checksum SHA-256. Use o instalador do VTT, sem extrair o pacote no código-fonte.
O ID `gravewright.5e-srd`, os dados das fichas, as configurações e as cópias
incorporadas permanecem no namespace original.

A versão 0.1.6 instala ao lado das anteriores, incluindo os builds locais
0.1.3–0.1.5. Selecione 0.1.6 nas extensões da mesa e recarregue as páginas abertas
para carregar a correção; reiniciar o servidor sozinho não altera essa seleção.
Mantenha a versão anterior instalada para poder selecioná-la em uma reversão.
O mesmo ID/versão é imutável e não pode ser sobrescrito com bytes diferentes.

Confirme que os scripts do pacote selecionado carregam corretamente no navegador.
Instalar pelo host em execução permite que o processo do servidor acesse os
arquivos extraídos; copiar a pasta do fonte ou somente reiniciar não valida os
assets instalados. Os menus de três pontos dos combatentes ficam dentro da área
visível e permitem rolagem interna quando necessário, inclusive na última linha
de um tracker baixo. Eles permanecem abertos quando o navegador termina de
trazer a linha selecionada para a área visível. Use as setas, Home ou End para
navegar e Escape para fechar e devolver o foco ao botão. Clicar fora, rolar
novamente ou redimensionar fecha o menu.

Fichas de personagens, monstros e tokens abrem inicialmente com até 1000 × 760px,
adaptando-se à tela. O redimensionamento manual nativo continua disponível. Se
uma janela maior já estava salva, use **Redefinir layout da janela (↺)** na barra
do título para aplicar o novo padrão. A visão geral usa cabeçalho mais baixo,
cartões compactos de atributos e combate e controles de vida junto dos valores
relacionados. O texto visível mantém no mínimo 12px; conteúdo longo permite rolagem.

As perícias aparecem em ordem alfabética pelo nome traduzido nas fichas de
personagem e monstro. O seletor de atributo em cada linha salva o padrão daquela
perícia. A janela de rolagem permite escolher outro atributo apenas para aquele
teste, mantendo proficiência, especialização e efeitos aplicáveis. Fichas
existentes mantêm o vínculo habitual até uma escolha ser salva. Janelas de
rolagem abrem com a altura necessária aos controles, agrupam campos e permitem
rolagem em telas menores.

Editores de itens usam cabeçalho menor, grupos de detalhes sem molduras internas
e campos de texto compactos que crescem com o conteúdo escrito. Resumos laterais
vazios desaparecem. Listas ordenam nomes dentro dos grupos existentes de tipo ou
nível de magia, considerando o idioma ativo; a ordem salva e as cópias de itens
são preservadas. Janelas nativas mantêm redimensionamento e o botão de redefinir
na barra de título. O VTT fornece a apresentação compartilhada do diretório de
itens e do navegador de compêndios.

Antes de desativar o complemento antigo, selecione **DnD 0.1.1 ou mais recente em cada mesa de
DnD** que o utiliza; versões antigas do sistema ainda precisam desse módulo.
Se o antigo Server Rules estiver instalado, **Personalizar → Instalação anterior**
permite ao proprietário revisar e desativar o complemento pelos controles já
existentes do VTT. Essa desativação histórica reinicia o host; remover o módulo
exige outra confirmação após ver as mesas afetadas. Uma instalação nova da 0.1.1
não exige ativação de código de servidor.

## Implementado

- Fichas de personagem e monstro; fichas dos 11 tipos de itens do legado.
- Retrato e imagem do token enviados pela API nativa; opções de exibição das barras e tamanho do token, com tamanho reservado ao mestre.
- Atributos, proficiências, especialização, salvaguardas, perícias, valores passivos e conjuração derivados.
- Rolagens públicas ou para o mestre; vantagem/desvantagem, dados e modificadores extras.
- Vida e PV temporários nas barras nativas. Dano consome PV temporários primeiro. Ficha, token e gerenciador usam os mesmos recursos.
- Iniciativa e automações de turnos pelo tracker do próprio sistema, com os dados atuais da ficha e do token e as permissões nativas.
- Armas, inventário, características, magias e efeitos por cópias incorporadas de itens da biblioteca. Arrastar e soltar em qualquer área da ficha verifica acesso de leitura pelo servidor e encaminha o item à coleção correspondente. Itens de 2014, de 2024 e sem edição podem ser usados nas fichas das duas versões, mantendo seus dados e sua edição de origem.
- Modificadores de efeitos para rolagens, CA e dano recebido. Efeitos ativos são editados pelo mestre. Aplicação de uma condição ao token usa a descrição do efeito, exibida pelos tooltips nativos.
- Perfis de exaustão: 2014 impõe desvantagens conforme o nível; 2024 aplica penalidade de duas vezes o nível a testes de d20. Deslocamento efetivo reflete os perfis distintos.
- Inspiração e inspiração heroica com regras distintas por edição; os controles de rolagem e recursos respeitam essa escolha.
- Descanso curto com escolha dos Dados de Vida de cada classe; descanso longo recupera vida, espaços e Dados de Vida conforme a edição. Recursos seguem sua recuperação explícita, sem presumir que todo poder recarrega no descanso.
- Origens e classes com avanços declarativos: escolhas de atributos, perícias, idiomas, treinos, concessões de características e magias, equipamento inicial, subclasse e progressão de níveis. O plano registra a procedência dos benefícios e preserva alterações manuais ao reaplicar ou remover uma origem.
- PV por nível com Constituição, reservas de Dados de Vida por classe, espaços de multiclasse e Magia de Pacto. Aumentos de atributo podem oferecer talentos elegíveis do catálogo; pré-requisitos declarados restringem as opções.
- Armadura e escudo, Defesa sem Armadura declarada, propriedades de armas, sintonia e passivos seguros de equipamentos. Atributos efetivos não sobrescrevem os valores base da ficha.
- Resultados no chat nativo, com controles de aplicar na ficha e Inspiração Heroica enquanto a ficha de origem está aberta; não há uma segunda modal de resultado.
- Salvamento com revisão, erros sem descarte silencioso e espera ao fechar; tokens independentes mantêm sua própria ficha.
- Interface em inglês, português brasileiro e espanhol pela API oficial do Translator, respeitando o idioma escolhido na conta. Não traduz conteúdo escrito pelos usuários nem os textos ingleses dos compêndios.
- Compêndios separados por edição, disponíveis na interface nativa: 1.259 entradas de 2014 e 1.276 de 2024, incluindo 319 e 338 magias, respectivamente. São 2.535 entradas: 2.524 registros adaptados e 11 características originais derivadas dos textos licenciados de seus pais no SRD. Armas, armaduras, equipamentos, consumíveis, talentos, características, raças/espécies, antecedentes e classes têm dados próprios para a ficha.
- Cópia direta do compêndio para a ficha pelo mestre, após leitura autorizada. A inclusão mantém a procedência sem criar um documento adicional na biblioteca; cancelar as escolhas não deixa itens órfãos. Jogadores veem apenas compêndios com leitura concedida.

## Tradução pelo módulo oficial

Instale e ative o [Translator oficial](https://github.com/Gravewright/translator) em **Módulos instalados**. Cada usuário escolhe seu idioma em **Configurações → Preferências** dentro da mesa. O idioma pertence à conta, não à edição de regras nem à configuração da ficha. Recarregue páginas abertas após ativar ou desativar o Translator.

O sistema registra `locales/en.json`, `locales/pt-BR.json` e `locales/es.json` durante `start(context)` por `context.i18n.register`. Fichas, modais e ações próprias no chat consultam `api.i18n.t(key, params)`; nomes e textos dos documentos permanecem dados dos usuários. Os elementos controlados pelo sistema usam `translate="no"` para impedir que o tradutor legado do DOM reinterprete esses textos.

Não há motor de tradução próprio, importação de código do Translator, serviço externo ou catálogo de D&D no core. O adaptador oficial do host controla parâmetros, fallback, isolamento por ID de módulo e descarte dos catálogos ao encerrar a ativação. Sem um pacote de idiomas ativo, a interface usa inglês. Hosts sem a API `context.i18n` precisam ser atualizados; instalar somente o ZIP do Translator não acrescenta essa API a um host antigo. Veja a [referência oficial](https://github.com/Gravewright/translator/blob/main/gravewright_translator/package/docs/API.md).

Para contribuir, altere os três catálogos com as mesmas chaves e marcadores, como `{ability}` ou `{count}`. O build rejeita chaves ausentes e parâmetros divergentes antes de gerar o pacote. Os testes de tradução em `tests/i18n.test.mjs` usam o adaptador real do host.

## Escopo de conteúdo e automação

Os compêndios de `compendiums/` são uma seleção rastreável dos SRDs 5.1 e 5.2.1, adaptada dos dados públicos licenciados do sistema D&D5e do Foundry e conferida com os PDFs oficiais. São **parciais**, incluem variantes e não representam todo o SRD. As descrições das magias vêm dos PDFs; outras descrições foram convertidas para texto simples, sem macros nem notas de automação do Foundry. Conteúdo e nomes permanecem em inglês. Não inclui monstros, efeitos prontos, livros, PDFs, logotipos ou artes oficiais. Os modelos antigos de `content/` não são registrados como compêndios. Veja [cobertura, fontes, exclusões e reconstrução](compendiums/README.md).

As coleções só aparecem nas mesas que usam a versão instalada, aprovada e ativa deste sistema. O mestre define leitura para os jogadores pelas permissões nativas dos compêndios; a importação permanece reservada ao mestre. Trocar a edição da ficha não converte dados importados.

O perfil de edição não implementa automaticamente todas as regras das duas edições. Origens, talentos, características e classes aplicam somente avanços e passivos declarados; as escolhas obrigatórias são resolvidas antes de confirmar o plano. As fórmulas estruturadas dos compêndios preservam atributo de conjuração, cura, PV temporários e incrementos explícitos por nível do personagem ou do espaço usado. Não somam um atributo universal nem multiplicam o dano de um raio pelos demais projéteis. Magias antigas e fórmulas personalizadas mantêm seu modo manual. Maestrias, componentes consumidos, efeitos secundários, áreas/alvos, pré-requisitos não declarados e exceções contextuais continuam exigindo decisão da mesa. Veja [automações, compatibilidade de dados e limites](AUTOMATION.md).

Equipamento inicial usa grupos declarativos: **AND** entrega o conjunto, **OR** pede uma alternativa, referências vinculadas criam cópias dos itens e moedas são somadas na moeda indicada. Quando há uma alternativa de riqueza com valor declarado, ela substitui o pacote de equipamentos. Opções por categoria pedem a escolha de itens compatíveis. A primeira classe e o antecedente podem conceder esse equipamento; uma classe adicional não recebe novamente o pacote inicial. Reaplicar a progressão preserva quantidades consumidas e moedas gastas. Riqueza que exige uma rolagem sem valor declarado e referências não resolvidas permanecem manuais, com aviso.

As fórmulas e mapeamentos declarativos originais estão preservados para consulta em `rules/` e `mappings/`. O runtime novo executa somente sua implementação explícita em `rules.js`; não avalia expressões JavaScript vindas desses JSONs. Não há importação automática de bancos de dados ou campanhas da versão antiga.

## Desenvolver e empacotar

Use **Node.js 22+** e **Python 3.12+** nas ferramentas. A integração nativa exige
o ambiente **Python 3.14+** de um checkout separado e inalterado do **VTT 0.2.3**.
Não há dependências de npm.

```powershell
git clone --branch v0.2.3 --depth 1 https://github.com/Gravewright/gravewright.git ../gravewright
$env:GRAVEWRIGHT_TEST_HOST_ROOT = (Resolve-Path ../gravewright).Path
uv sync --project "$env:GRAVEWRIGHT_TEST_HOST_ROOT" --locked
python scripts/validate_locales.py
python scripts/build.py
python scripts/validate_package.py
npm test
& "$env:GRAVEWRIGHT_TEST_HOST_ROOT\.venv\Scripts\python.exe" -X utf8 tests/run_host_tests.py
```

Reutilize um checkout existente quando disponível. Em POSIX, exporte a mesma
variável e use o `.venv/bin/python` do host. Os testes de integração importam o
adaptador real de tradução; não há código do host dentro deste sistema.

O build valida os catálogos, regenera `system.json` a partir dos schemas,
layouts, traduções e ações e gera **um único ZIP de sistema para navegador** com
checksum SHA-256. Python, ferramentas, testes, fixtures e o diretório histórico
`server/` são excluídos. Os timestamps usam `SOURCE_DATE_EPOCH`, com padrão
`1791849600`, para produzir artefatos determinísticos. A validação confere bytes,
dados compilados, licenças e a procedência original dos compêndios offline.

Testes opcionais de conversão exigem o cache licenciado fixado descrito em
[compendiums/README.md](compendiums/README.md). Esses downloads não são necessários
para testar regras, contratos nativos ou empacotar. O código Python histórico
de [server/README.md](server/README.md) é apenas referência de desenvolvimento.

`tests/e2e/review_server.py` cria mesas descartáveis com banco, mídia, módulos
e contas sintéticas isolados. Scripts antigos exigem o seed e a URL local
documentados; não devem ser apontados para uma mesa de produção.

## Verificação do compêndio

Na pasta deste módulo, execute `node --test tests/*.test.mjs`. A suíte inclui todas as 2.535 entradas, nas duas edições de ficha (5.070 arrastes), e compara os planos de avanços com o catálogo completo. Os 93 documentos com avanços também são conferidos nos níveis 1, 5, 11 e 20, com diferentes escolhas e conteúdo de ambas as edições. O roteamento para monstros verifica tanto inclusões aceitas quanto rejeições.

Os scripts em `tests/e2e/` usam Playwright e exigem um VTT descartável já preparado com este sistema e usuários de teste. Eles foram criados para o ambiente de revisão da base; não criam nem protegem uma instância de produção. Defina `GRAVEWRIGHT_REVIEW_URL` com o endereço dessa instância e consulte os requisitos de cada script antes de executar. `compendium_roundtrip.py` lê todas as entradas pela API autorizada e compara os dados; `compendium_performance.py` mede amostras representativas e com mais dependências de cada tipo e edição, com cache vazio e reutilizado, conferindo persistência, reabertura e cancelamento. O tempo de preencher escolhas é registrado separadamente. Como não há efeitos publicados nos compêndios, essa categoria usa documentos sintéticos identificados. `type_presentation.py` verifica os nomes e ícones fornecidos pelo módulo no diretório nativo.

## Atualizar, dados e problemas comuns

Preserve a base de dados, mídia e configuração do VTT ao atualizar o sistema.
Recarregue as páginas após selecionar a versão nova. Uma atualização do catálogo
não altera cópias já incorporadas nas fichas, nem converte campanhas ou edições.

O mestre avança os turnos pelo tracker do pacote. Após cada conclusão de
**Rolar todas as iniciativas**, o combate ativo seleciona o primeiro participante
da ordem final do servidor. Isso inclui participantes ocultos ou derrotados;
empates mantêm a ordem existente do servidor. Rolagens individuais, somente de
PNJs ou somente de iniciativas ausentes preservam o participante atual. Rolar
antes de iniciar o combate não o inicia. Selecionar o primeiro participante
mantém a rodada atual e não avança os relógios de efeitos.

Mensagens como **Rolando iniciativas…** e **Avançando turno…** indicam trabalho
normal em andamento; a ação de tentar novamente fica oculta durante a execução
local. Uma marca compartilhada de operação, sozinha, não indica falha. O aviso
de operação incompleta fica reservado a operações que falharam, com recuperação
disponível ao mestre responsável quando há trabalho retomável. Planos de
operação persistidos, revisões de documentos e recibos reutilizam o UUID de cada
etapa nas tentativas, permitindo retomar sem repetir rolagens ou seleções de
turno já concluídas. Gravações em fichas diferentes são etapas recuperáveis, e
não uma transação única. Voltar no combate não desfaz os resultados resolvidos.
A automação não executa em segundo plano após todos fecharem a mesa.

- **Compêndios ausentes:** confira o sistema ativo da mesa e as permissões de leitura.
- **Módulo de servidor anterior detectado:** o proprietário pode revisar a migração em Personalizar → Instalação anterior.
- **Interface permanece em inglês:** ative o Translator e selecione o idioma na conta; os textos dos compêndios continuam em inglês.
- **Operação de combate interrompida:** restabeleça a conexão e use a ação de tentar novamente antes de avançar outro turno.
- **Falha ao salvar:** mantenha a ficha aberta e resolva o erro visível antes de fechar ou recarregar.

Ao [reportar um problema](https://github.com/Gravewright/dnd-srd-5e/issues), informe
as versões do VTT, sistema e Translator, a edição escolhida e passos para reproduzir.
Remova segredos e dados pessoais dos logs.

## Licenças

Código original sob [MIT](LICENSE.md); conteúdo derivado dos SRDs sob **CC BY 4.0**, com as atribuições e modificações em [NOTICE.md](NOTICE.md). Os dados adaptados do Foundry preservam o [aviso MIT de sua representação](compendiums/FOUNDRY-DATA-LICENSE.txt). A licença MIT do código não concede direitos sobre marcas, artes ou conteúdo externo. Veja também [CONTENT_POLICY.md](CONTENT_POLICY.md).
