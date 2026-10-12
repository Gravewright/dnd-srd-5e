# DnD 5e SRD

Sistema de quinta edição para o Gravewright VTT, com escolha entre **2014 / SRD 5.1** e **2024 / SRD 5.2.1**. Primeira versão **0.1.0 Alpha**.

[English](README.md) · [Baixar a versão 0.1.0](https://github.com/Gravewright/dnd-srd-5e/releases/tag/v0.1.0) · [Notas da versão](docs/releases/0.1.0.md) · [Automações e limites](AUTOMATION.md) · [Reportar problema](https://github.com/Gravewright/dnd-srd-5e/issues)

A ficha Noturno combina fundo escuro, tipografia em marfim, molduras douradas e um cabeçalho ilustrado. Inclui fichas próprias de personagem, monstro e 11 tipos de itens, salvamento automático e compêndios licenciados separados por edição. Este projeto adapta o framework legado Gravewright 5e SRD 0.3.1; o nome público atual é **DnD 5e SRD**.

Projeto independente, sem afiliação ou endosso da Wizards of the Coast ou do Foundry VTT. Não inclui artes oficiais, livros ou conteúdo premium.

## Instalar e escolher uma edição

Requisitos: [Gravewright VTT 0.2.1 ou mais recente](https://github.com/Gravewright/gravewright/releases/tag/v0.2.1), SDK 1.x, [Translator oficial 0.1.2 ou mais recente](https://github.com/Gravewright/translator) para português/espanhol e o companion de servidor desta mesma versão. O idioma de fallback é inglês.

1. No Marketplace oficial, instale **DnD 5e SRD** em **Sistemas**. Para instalação local, baixe `gravewright-5e-srd-0.1.0.zip` na release e selecione-o nessa área.
2. Como proprietário do host, instale também **DnD 5e SRD - Server Rules** (`gravewright-5e-srd-server-0.1.0.zip`) em **Módulos** e ative sua extensão Django confiável. Essa ativação executa código Python do sistema e reinicia o servidor pelo Runner gerenciado; instalar apenas o sistema de navegador não a ativa. Veja [a documentação do companion](server/README.md).
3. Instale e ative o Translator oficial para usar português ou espanhol. Crie uma mesa usando **DnD 5e SRD** e ative o Translator também nas extensões da mesa.
4. Em **Configurações → Extensões → Personalizar**, o mestre define a edição padrão para novas fichas.
5. Cada ficha mantém uma escolha explícita: **2014 / SRD 5.1** ou **2024 / SRD 5.2.1**. Itens também identificam sua edição. Trocar a edição não converte classes, magias ou descrições existentes.

Todas as regras ficam neste sistema: a interface usa `rules.js` e o backend
usa `server/gravewright_5e/combat.py`. O core do VTT apenas fornece contratos
genéricos para registro, dados, permissões, transações e persistência. Não há
perfil D&D embutido no host. Sem a extensão de servidor, o combate informa a
dependência ausente. Consulte [o backend](server/README.md) para instalação por
código-fonte e testes isolados.

O mínimo é **VTT 0.2.1**, que oferece `system.combat`, `content.compendiums`, a API oficial de tradução e gravação antes de fechar fichas de item. O instalador VTT 0.2.0 não fornece todos esses contratos. O SDK permanece 1.0.0; o intervalo de SDK sozinho não identifica a versão mínima do VTT.

Os nomes técnicos dos ZIPs e os IDs `gravewright.5e-srd` e `gravewright.5e-srd-server` foram preservados para manter a identidade de instalações e documentos existentes. A versão do sistema e do companion é **0.1.0**; ela é independente da versão 0.2.1 do VTT.

## Implementado

- Fichas de personagem e monstro; fichas dos 11 tipos de itens do legado.
- Retrato e imagem do token enviados pela API nativa; opções de exibição das barras e tamanho do token, com tamanho reservado ao mestre.
- Atributos, proficiências, especialização, salvaguardas, perícias, valores passivos e conjuração derivados.
- Rolagens públicas ou para o mestre; vantagem/desvantagem, dados e modificadores extras.
- Vida e PV temporários nas barras nativas. Dano consome PV temporários primeiro. Ficha, token e gerenciador usam os mesmos recursos.
- Iniciativa pelo gerenciador nativo, preparada pelo backend do sistema com os dados atuais da ficha e do token.
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

Execute na raiz do checkout de [Gravewright/dnd-srd-5e](https://github.com/Gravewright/dnd-srd-5e), com **Node.js 22+**. As ferramentas de build e validação, feitas apenas com a biblioteca padrão, requerem **Python 3.12+**. Os testes de integração JavaScript e a suíte do backend precisam de um **checkout separado do VTT 0.2.1+**; o backend do VTT exige **Python 3.14+** e suas próprias dependências. Não há dependências de npm.

Exemplo em PowerShell, preparando um checkout do host ao lado deste repositório:

```powershell
git clone --branch v0.2.1 --depth 1 https://github.com/Gravewright/gravewright.git ../gravewright
$env:GRAVEWRIGHT_TEST_HOST_ROOT = (Resolve-Path ../gravewright).Path
uv sync --project "$env:GRAVEWRIGHT_TEST_HOST_ROOT" --locked
npm test
& "$env:GRAVEWRIGHT_TEST_HOST_ROOT\.venv\Scripts\python.exe" -X utf8 server/run_tests.py
python scripts/validate_locales.py
python scripts/build.py
python scripts/validate_package.py
```

Reutilize um checkout compatível já existente em vez de clonar, se disponível. Em shells POSIX, use `export GRAVEWRIGHT_TEST_HOST_ROOT=/caminho/do/gravewright` antes de `npm test` e o `.venv/bin/python` desse host para `server/run_tests.py`. A integração importa a API real do host; `npm test` não é independente do código-fonte do VTT. Veja também [server/README.md](server/README.md).

O build agrega os catálogos, layouts e schemas em `system.json` para carregamento por uma única requisição. Python, testes e ferramentas de desenvolvimento ficam fora do ZIP. `dist/` recebe os pacotes e os SHA-256. Não edite `system.json` manualmente. As datas internas dos ZIPs usam `SOURCE_DATE_EPOCH`, com padrão `1791849600`, permitindo artefatos determinísticos para fontes iguais. Depois do build, `validate_package.py` confere offline os arquivos gerados, dados compilados e procedência do conteúdo.

Os testes opcionais de conversão e a reconstrução do catálogo precisam também das fontes licenciadas fixadas e dependências de ferramentas indicadas em [compendiums/README.md](compendiums/README.md), com overrides `GRAVEWRIGHT_SRD_CACHE` e `GRAVEWRIGHT_SRD_TOOLS`. Esses downloads não são necessários para os testes JavaScript/backend nem para empacotar os JSONs já versionados.

O Foundry foi consultado como referência de arquitetura e é a fonte estruturada licenciada dos compêndios adaptados. Não foram incorporados seu runtime, recursos gráficos ou traduções. Veja [NOTICE.md](NOTICE.md) para a procedência, licenças e créditos de conteúdo, e [LICENSE.md](LICENSE.md) para o código original.

## Apresentação da ficha

A ficha noturna organiza perícias à esquerda e atributos, combate e recursos à direita. Cada atributo tem um checkbox de proficiência em salvaguardas; ao rolar, escolha entre teste de atributo e salvaguarda. Os indicadores de combate usam toda a largura da coluna, com PV e magia na linha seguinte. A barra de PV reflete as barras nativas, incluindo alterações feitas pelos controles rápidos. Espaços de magia podem ser usados ou recuperados pelos marcadores na visão geral; sua configuração fica na aba Magias. Identidade, regras e imagens têm editores próprios para manter a visão geral focada no jogo.

Ao lado das abas, **Descanso curto** e **Descanso longo** abrem a confirmação dos benefícios conforme a edição da ficha. No curto, escolha quais Dados de Vida gastar, por classe; as rolagens aparecem no chat e a cura fica em prévia até confirmar. Cancelar descarta a prévia. Concluir aplica e salva os PV, Dados de Vida, espaços de Magia de Pacto e recursos com recuperação declarada. O longo recupera também os espaços comuns de magia, encerra PV temporários e aplica as demais recuperações da edição. O relógio do mundo e a conclusão do descanso são confirmados pela mesa. A escolha de edição e os ajustes de exaustão, inspiração, armadura e Dados de Vida ficam em **Editar identidade → Configurações do DnD 5e SRD**.

O layout acompanha a largura da própria janela, reorganizando os quadros ao redimensionar e mantendo rolagem vertical interna. Não reduz toda a ficha para caber em uma tela pequena. Retratos vêm das imagens do personagem; o fundo decorativo é original, criado com assistência de IA para o Gravewright.

O retrato no cabeçalho alinha pelo topo por padrão. Em **Token → Enquadramento do cabeçalho**, os ajustes horizontal e vertical mostram uma prévia e salvam o recorte na ficha. Isso não altera o arquivo enviado nem o enquadramento do token no mapa.

Magias ficam agrupadas por círculo, com busca, filtros de preparação/ritual/concentração e espaços de magia próximos ao resumo de conjuração. **Configurar espaços** mostra os nove círculos para edição; no uso normal aparecem apenas os que têm espaços. O inventário reúne armas e equipamentos por tipo, com quantidade, peso, equipado e moedas. A biografia organiza identidade, história, personalidade e proficiências em painéis de leitura; descrições de itens podem ser expandidas nas listas. Efeitos são separados entre ativos e inativos, com duração informativa e ativação manual pelo mestre.

Campos da ficha, itens independentes e itens incorporados salvam automaticamente após uma breve pausa na digitação. O rodapé informa alterações pendentes, salvamento, sucesso ou erro. Trocar de aba e fechar a janela aguardam as gravações; **Concluir** nos editores apenas aguarda e fecha. Erros mantêm as alterações em memória e impedem o fechamento pelo editor. O controle de revisões rejeita gravações conflitantes, sem sobrescrever silenciosamente outra edição. Nas durações 5e, a contagem é manual por padrão. Uma duração em rodadas com expiração explícita no início ou fim de turno usa o turno da origem configurada; editar a duração ou reativar o efeito reinicia sua contagem.

## Biblioteca e editor de itens

O diretório de Itens usa linhas compactas, busca integrada e pastas hierárquicas. **Criar item** abre uma modal para nome e tipo; após a criação, abre o editor completo. Clique no nome para abrir a ficha. Duplicar, mover, permissões e excluir ficam no menu de ações, respeitando o acesso do usuário.

O editor Noturno é compartilhado entre os documentos da biblioteca e as cópias da ficha. **Descrição** apresenta o texto e um resumo das propriedades; **Detalhes** reúne os campos próprios de cada um dos 11 tipos. Efeitos também têm uma aba de modificadores. As janelas acompanham a tela, com rolagem interna e salvamento automático, inclusive ao fechar com Escape.

Editores, rolagens, configurações e confirmações usam o componente de modal do VTT por `api.ui.openModal`, sem elementos HTML `<dialog>`. Uma confirmação abre sobre sua janela de origem, preservando os dados e devolvendo o foco ao fechar; o fechamento aguarda o salvamento automático.

Arraste um item da biblioteca para qualquer área da ficha, inclusive o cabeçalho ou uma aba diferente. Armas e equipamentos vão para o inventário, magias para Magias, talentos, características, espécies, antecedentes e classes para a lista da Biografia, e efeitos para Efeitos. Armas também aparecem na visão geral; nos monstros, armas vão para Ataques e talentos/características para Características. A ficha abre a aba correspondente, limpa a busca e o filtro dessa lista e destaca a nova cópia. Não há botões de adicionar itens na ficha.

O mestre também pode arrastar uma entrada do compêndio diretamente para a ficha; tipo, mesa, permissão e edições suportadas são verificados antes da inclusão. Uma ficha de 2024 aceita itens de 2014, e uma ficha de 2014 aceita itens de 2024. O arraste preserva a edição, as regras e a procedência do item; não converte o conteúdo nem muda o perfil de regras do personagem. Quando o item possui avanços, a aplicação apresenta as escolhas e os benefícios antes de concluir. Alterar a cópia não modifica o original. Jogadores precisam ter leitura do item e edição da ficha; copiar entradas diretamente dos compêndios e adicionar efeitos continuam reservados ao mestre. Tipos sem uma coleção correspondente no layout são rejeitados. Fechar a ficha aguarda a inclusão e seu salvamento.

Os avanços carregam somente suas dependências recursivas e alternativas de escolha, em lotes autorizados de até 100 documentos. As cópias lidas são reutilizadas durante a sessão da mesa e invalidadas quando o catálogo visível muda. Não é necessário carregar as duas edições completas para aplicar uma raça ou um equipamento. A leitura do item de origem continua sendo verificada a cada arraste; os dados enviados no gesto não concedem acesso.

Os nomes traduzidos e os ícones dos tipos de item são declarados pelo sistema em `manifest.json` (`labelKey` e `icon`). O diretório nativo consulta o catálogo de tradução registrado pelo módulo, inclusive quando ele é registrado após a montagem do diretório ou removido ao desativar a extensão.

Armas dos compêndios usam cálculo automático do atributo: Força para corpo a corpo, Destreza para ataques à distância e o maior modificador nas armas com acuidade. O editor permite escolher um atributo explícito ou o modo manual e indicar proficiência com a arma. Classes aplicadas podem fornecer proficiências por grupo ou arma; uma alteração explícita no checkbox mantém a escolha manual daquele item. Bônus mágicos se somam ao ataque e ao dano, respeitando a sintonia declarada; a proficiência afeta apenas o ataque. Itens antigos mantêm o modo manual até serem configurados. Os detalhes da rolagem permitem dano versátil com duas mãos e segunda arma; mãos disponíveis, ataques secundários e demais exceções continuam exigindo contexto da mesa.

A ficha de monstros compartilha o cabeçalho e o estilo Noturno. Perícias ficam à esquerda; atributos, indicadores de combate, PV e ataques ficam à direita. Tipo, tamanho, alinhamento, desafio, proficiência, deslocamento, sentidos, idiomas e defesas são ajustados na modal **Detalhes da criatura**. Traços e ações em texto têm leitura própria e edição em modal; recursos lendários podem ser expandidos quando necessários. Ataques e características continuam aceitando itens arrastados, com cópias independentes e salvamento automático.

## Verificação do compêndio

Na pasta deste módulo, execute `node --test tests/*.test.mjs`. A suíte inclui todas as 2.535 entradas, nas duas edições de ficha (5.070 arrastes), e compara os planos de avanços com o catálogo completo. Os 93 documentos com avanços também são conferidos nos níveis 1, 5, 11 e 20, com diferentes escolhas e conteúdo de ambas as edições. O roteamento para monstros verifica tanto inclusões aceitas quanto rejeições.

Os scripts em `tests/e2e/` usam Playwright e exigem um VTT descartável já preparado com este sistema e usuários de teste. Eles foram criados para o ambiente de revisão da base; não criam nem protegem uma instância de produção. Defina `GRAVEWRIGHT_REVIEW_URL` com o endereço dessa instância e consulte os requisitos de cada script antes de executar. `compendium_roundtrip.py` lê todas as entradas pela API autorizada e compara os dados; `compendium_performance.py` mede amostras representativas e com mais dependências de cada tipo e edição, com cache vazio e reutilizado, conferindo persistência, reabertura e cancelamento. O tempo de preencher escolhas é registrado separadamente. Como não há efeitos publicados nos compêndios, essa categoria usa documentos sintéticos identificados. `type_presentation.py` verifica os nomes e ícones fornecidos pelo módulo no diretório nativo.

## Atualizar, dados e problemas comuns

Faça backup da base de dados, mídia e configuração do VTT antes de atualizar o sistema e o companion. Atualize os dois para a mesma versão, confirme a ativação do código de servidor e recarregue as páginas. Cópias de itens já incorporadas nas fichas mantêm seus dados; uma atualização do catálogo não reescreve essas cópias. Não existe conversão automática de campanhas do framework legado nem entre edições das regras.

- **Compêndios ausentes:** confira se a mesa usa este sistema ativo e aprovado; o mestre precisa conceder leitura aos jogadores nas permissões dos compêndios.
- **Iniciativa ou efeitos informam dependência ausente:** o proprietário do host deve instalar e ativar o companion de servidor e concluir o reinício do Runner.
- **Interface permanece em inglês:** ative o Translator oficial para a mesa, selecione o idioma na conta e recarregue. Os textos de itens do catálogo continuam em inglês nesta versão.
- **Uma regra não é aplicada:** confira a edição da ficha, equipamento/sintonia e os metadados declarados do item. Consulte [AUTOMATION.md](AUTOMATION.md) para os limites; importar a descrição não executa todos os seus efeitos.
- **Falha ao salvar:** a ficha conserva as alterações em memória e mostra uma opção de tentar novamente. Restabeleça a conexão e resolva o erro antes de fechar ou recarregar.

Ao [reportar um problema](https://github.com/Gravewright/dnd-srd-5e/issues), informe as versões do VTT, sistema, companion e Translator, a edição escolhida e passos para reproduzir. Omitir segredos e dados pessoais dos logs.

## Licenças

Código original sob [MIT](LICENSE.md); conteúdo derivado dos SRDs sob **CC BY 4.0**, com as atribuições e modificações em [NOTICE.md](NOTICE.md). Os dados adaptados do Foundry preservam o [aviso MIT de sua representação](compendiums/FOUNDRY-DATA-LICENSE.txt). A licença MIT do código não concede direitos sobre marcas, artes ou conteúdo externo. Veja também [CONTENT_POLICY.md](CONTENT_POLICY.md).
