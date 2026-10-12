# Automações, avanços e limites — 0.1.0

As regras são implementadas exclusivamente neste sistema: `rules.js` na ficha
e `server/gravewright_5e/combat.py` no servidor. O host executa callbacks
registrados para o ID selecionado, sem conhecer atributos, condições, edições,
sintonia, resistências, morte ou concentração. As regressões específicas de 5e
ficam em `tests/` e `server/gravewright_5e/tests.py` deste módulo.

O sistema conserva a edição de cada item em `data.rulesEdition`. A edição da
ficha controla regras gerais, como exaustão e descanso; não converte o texto nem
a fórmula de uma magia importada de outra edição. Campos antigos e fórmulas
manuais continuam válidos. Não há avaliação de macros ou código do Foundry.

O suporte abrange os onze tipos do sistema, com comportamentos diferentes por
tipo. Importar uma descrição não significa executar todas as regras contidas
nela. A automação depende de dados declarativos reconhecidos; escolhas,
exceções e efeitos não representados continuam visíveis para resolução manual.

## Cobertura da revisão

| Área | Automatizado com metadados compatíveis | Ainda depende da mesa |
| --- | --- | --- |
| Raça/espécie e antecedente | Atributos, tamanho, deslocamento, sentidos, proficiências, idiomas, resistências e concessões de itens/magias; escolhas antes de aplicar | Conteúdo personalizado sem avanços, exceções narrativas e requisitos contextuais não declarados |
| Classe e subclasse | Níveis, pré-requisitos de vínculo da subclasse, aumentos de atributos, escolhas de características, PV por nível, Dados de Vida e tabelas de espaços normais/de Pacto | Elegibilidade narrativa, requisitos de multiclasse não declarados, seleção completa de magias de classe e substituições opcionais não representadas |
| Talento e característica | Concessões e escolhas declaradas, passivos seguros, recursos e progressões numéricas | Ativação de poderes, custos/contextos especiais e efeitos não reconhecidos |
| Arma | Atributo, proficiência, bônus mágico, Acuidade, dano versátil, segunda arma, crítico e diferença de Pesada entre edições | Munição, mãos ocupadas, Recarga, alcance/cobertura do mapa, Maestria, ataques adicionais e gatilhos de dano extra |
| Armadura | Uma armadura e um escudo, Destreza permitida, treino, furtividade, requisito de Força, Defesa sem Armadura declarada de Bárbaro/Monge e bônus mágicos | Outras fórmulas de CA sem representação e requisitos especiais não declarados |
| Equipamento mágico | Passivos declarados, sintonia, atributos efetivos, deslocamentos, sentidos e condições simples de uso | Efeitos ativados, restrições não declaradas, maldições e relações específicas com outros itens |
| Consumível | Quantidade e usos explicitamente consumidos | Aplicar os efeitos particulares da descrição, escolher alvos e componentes necessários |
| Magia | Fórmulas tipadas, progressão explícita, ataque/CD, espaço escolhido, ritual, concessão com usos e concentração | Áreas, múltiplos alvos, salvaguardas dos alvos, condições, invocações, componentes, custo material e particularidades de cada magia |
| Efeito | Modificadores seguros, condições canônicas, passivos com requisitos reconhecidos e expiração declarada | Aplicação inicial e efeitos condicionais sem contrato; duração textual sem expiração explícita |
| PV, morte e concentração | Dano/cura/PV temporários, resistências, imunidades, vulnerabilidades, morte, estabilidade e fila de salvaguardas | Ressurreição, recuperação de estabilidade com passagem de horas e causas especiais de morte |
| Descansos e recursos | Recuperação por edição e regras explícitas de recursos | Tempo real, interrupções, alimentação, frequência e exceções das características |

## Aplicação de origens e progressão

`data.advancement` conserva uma representação declarativa de aumentos de
atributos, traços, tamanho, concessões, escolhas, PV e escalas. As referências
apontam para IDs estáveis de conteúdo. O plano só é aplicado após resolver as
escolhas obrigatórias; cancelar não concede parte dos benefícios.

`advancementLedger` registra a origem de cada contribuição e as escolhas feitas.
Reaplicar uma mesma origem não duplica seus itens. Trocar ou remover uma origem
retira suas contribuições; concessões compartilhadas permanecem enquanto outra
origem as possuir. Um item concedido e depois editado manualmente pode permanecer
como item independente. Alterações manuais dos campos são preservadas pelo
registro de contribuições, em vez de restaurar cegamente valores antigos.

A primeira classe concede os treinos iniciais; uma classe adicional usa seus
avanços de multiclasse. Classes e subclasses têm identidades próprias, limites
de nível e reservas de Dados de Vida. As escolhas de PV guardam o dado de cada
nível e aplicam Constituição, com mínimo de 1 PV por nível. Constituição efetiva
é recalculada retroativamente apenas para fichas que possuem esses metadados;
uma ficha manual ou um bloco de monstro conserva seu máximo informado.

Quando um aumento de atributo de classe permite talento, o plano oferece os
talentos elegíveis da mesma edição, respeitando os pré-requisitos declarados.
Escolhas opcionais de substituição posteriores ainda são apresentadas como
aviso; não trocam automaticamente uma escolha antiga.

Equipamento inicial resolve grupos `AND`/`OR`, referências vinculadas,
quantidades, categorias elegíveis e moedas. Classe adicional não recebe seu
pacote inicial. Uma alternativa de riqueza só é automática quando há um valor
fixo declarado; riqueza por fórmula e referências fora do catálogo permanecem
manuais. Recalcular não devolve moedas gastas nem itens consumidos.

Classes com progressão declarada calculam espaços de conjuração e Magia de
Pacto separadamente. Na soma de multiclasse, metade dos níveis usa o
arredondamento da edição da classe. Aumentar uma reserva preserva os usos já
gastos; subir de nível não equivale a descansar. Magias conhecidas/preparadas
não são escolhidas automaticamente por uma tabela genérica de espaços.

O Sopro de Dragão de 2014 inclui uma definição derivada da tabela e do texto
licenciados: ancestralidade, tipo de dano, forma, salvaguarda e progressão
`2d6`/`3d6`/`4d6`/`5d6` nos níveis 1/6/11/16. `feature.damage` rola essa parcela
no chat, sem somar atributo de arma nem duplicar os dados por crítico. Rolar
não consome o recurso; seu uso é explícito. Área, alvos, CD e dano reduzido pela
salvaguarda continuam exigindo resolução da mesa. Outras características só
rolam fórmulas declaradas, sem deduzir efeitos do nome ou da descrição.

A arquitetura foi comparada com o [sistema de avanços do Foundry](https://github.com/foundryvtt/dnd5e/wiki/Advancement)
e seus [traços](https://github.com/foundryvtt/dnd5e/wiki/Advancement-Type-Trait).
No código de [Item Grant](https://github.com/foundryvtt/dnd5e/blob/87e94dbd9f930135e0694cd7e7d49f210603cd2c/module/documents/advancement/item-grant.mjs),
concessões e sua procedência são registradas para permitir aplicação e reversão.
O Gravewright usa um plano e registro próprios; não executa o runtime do Foundry.

## Fórmulas de magia

Os compêndios fornecem `data.formulaProfile` quando uma parcela numérica pode
ser representada com segurança:

```json
{
  "version": 1,
  "kind": "healing",
  "base": {
    "dice": [{"number": 2, "faces": 8}],
    "constant": 0,
    "spellModifier": true
  },
  "critical": false,
  "scaling": {
    "mode": "slot",
    "dice": [{"number": 2, "faces": 8}],
    "constant": 0,
    "interval": 1
  }
}
```

Esse exemplo representa **Cure Wounds de 2024**. Na versão de 2014, os dados
base e o incremento são `1d8`. O modificador de conjuração se soma uma única
vez; a progressão não o multiplica. `data.spell_ability` permite escolher um
atributo da magia; `default` usa o atributo configurado na ficha. Esse campo é
útil para personagens com mais de uma origem de conjuração. Classes e níveis
de multiclasse seguem os avanços e escolhas descritos acima. Itens antigos sem
esses metadados continuam exigindo configuração manual.

`kind` distingue `damage`, `healing` e `temporary`. `base.dice` contém pares
numéricos `number`/`faces`; `base.constant` contém o bônus fixo.
`base.spellModifier` indica expressamente quando somar o atributo. Não existe
um modificador de conjuração universal para dano de magias.

Na progressão `slot`, o incremento se repete a cada `interval` níveis do espaço
acima de `data.level`. Na progressão `cantrip`, ele se repete por limiar atingido
em `thresholds`, normalmente `[5, 11, 17]`, usando o nível total do personagem.
Fire Bolt usa essa progressão em ambas as edições. Flame Blade usa `3d6`, sem
atributo e com incremento a cada dois níveis de espaço em 2014; em 2024 soma
o atributo e aumenta a cada nível. Spiritual Weapon também conserva a diferença
de intervalo entre as edições.

`critical` só habilita a duplicação de dados quando a atividade permite acerto
crítico. Bônus constantes e o atributo não são duplicados. Uma magia com
salvaguarda não recebe crítico só porque sua fórmula contém dados.

`unit: "beam"` ou `"dart"` indica dano **por raio ou projétil**. `count` registra
a quantidade e sua progressão, sem multiplicar o dano de um ataque individual.
Isso evita transformar Eldritch Blast em um único ataque com todos os raios,
ou permitir crítico em Magic Missile. Alvos, ataques adicionais e a aplicação
de cada instância continuam exigindo decisão do jogador ou mestre.

`manual: true` e `applicationManual: true` identificam efeitos que não podem
ser aplicados como uma cura genérica. Aid, por exemplo, também modifica o
máximo de PV. `scalingManual: true` informa que uma progressão contextual não
foi convertida. Efeitos secundários, curas proporcionais ao dano, condições,
invocações, alterações do terreno e componentes consumidos não são deduzidos
de uma simples fórmula de dados.

Magias com vários tipos de dano, como Ice Storm e Meteor Swarm, também mantêm
aplicação manual: a resistência precisa ser resolvida por parcela de dano.
Prismatic Spray e Prismatic Wall exigem a escolha ou resolução da cor e de seus
efeitos próprios. O total numérico não substitui essas decisões.

Os controles de aplicar dano, cura ou PV temporários atuam somente na ficha
aberta. Eles não identificam nem alteram automaticamente o alvo de um ataque.

Conjuração normal gasta o espaço selecionado uma vez; rolar seu dano não gasta
outro espaço. Magia de Pacto usa sempre o nível real de sua reserva. Ritual
não gasta espaço nem permite aumentar o nível da magia. `castMode: "innate"`
usa uma concessão com `data.uses`, consumindo um uso no nível base. Conjuração
gratuita autorizada pela mesa é distinta dessa concessão e não presume qual
recurso deve gastar. Preparação, componentes, custos materiais, mãos livres,
conjuração longa e Preparar uma magia ainda exigem validação da mesa.

`damage` e `healingFormula` permanecem para compatibilidade e edição manual.
Um item antigo sem perfil não recebe uma progressão presumida. Ao substituir
a fórmula de um item importado manualmente, o editor deve desativar seu perfil
automático para que a alteração seja a fonte efetiva da rolagem.

## Vida, descansos e recursos

As barras nativas continuam sendo a fonte de PV atuais, máximos e temporários.
`hpBaseMax`, quando presente, guarda o máximo sem redução por exaustão; não
deve ser preenchido com um valor padrão que substitua uma barra já existente.
Ele também exclui a contribuição separada `hpTraitBonus`, derivada de
`mechanicalTraits.hpPerLevel` e `hpFlat`. Essa separação evita somar novamente
Robustez Anã a cada atualização, e permite retirar o benefício sem apagar o
máximo base ou ajustes manuais.
`death` registra `success`, `fail`, `stable`, `dead` e `unconscious`.
`deathSavesEnabled` diferencia a política padrão de personagens e monstros.

Dados de Vida usam `hitDice: {value, max, die}` ou, para diferentes classes,
`hitDicePools: [{id, value, max, die}]`. O texto legado `hitdice` é preservado.
Reservas devem ser configuradas antes de gastar dados ou recuperar quantidades.
Avanços de classe compatíveis configuram essas reservas; o editor permite
complementar ou corrigir uma ficha manual.
Um descanso longo de 2014 recupera até metade do total de dados, arredondando
para baixo e com mínimo de um; o de 2024 recupera todos. Ambos encerram os PV
temporários, salvo uma regra específica que determine outro comportamento.

Descansos representam a confirmação de um descanso concluído. Duração real,
interrupções, alimentação, restrições de frequência e exceções de características
continuam sujeitos à decisão da mesa. Não há relógio de exploração que prove
essas condições. Espaços normais e de Magia de Pacto têm reservas separadas:
`slots.l1` a `slots.l9` e `pactSlots: {value, max, level}`. As quantidades máximas
vêm de uma progressão declarada ou de configuração manual; não se deduzem de
um nome de classe escrito livremente.

Recursos incorporados conservam `data.uses: {value, max}` e `data.recharge`.
Máximos reconhecidos usam `data.usesProfile`, uma árvore declarativa limitada
de constantes, modificadores de atributo, proficiência, nível de classe,
escalas e operações aritméticas. Não há `eval`, macros nem caminhos executáveis.
Mudanças de máximo preservam `usesSpent`. Uma expressão ou contexto não
reconhecido mantém a orientação `usesGuidance` e exige configuração manual.
Características
com recuperação explícita usam `data.recovery`, separando os dois descansos:

```json
{"short": {"mode": "amount", "amount": 1}, "long": {"mode": "all"}}
```

Esse exemplo é a recuperação de Second Wind de 2024. Em 2014, a característica
recupera todos os usos no descanso curto ou longo. Recuperações com fórmulas
contextuais permanecem manuais, identificadas por `recoveryManual`; não é seguro
recuperar todos os recursos pelo nome de uma classe. Metadados explícitos de
recuperação têm prioridade sobre o campo legado `recharge`.

`data.actionType` conserva o tempo de conjuração como `action`, `bonus`,
`reaction` ou `long`. Isso permite distinguir a regra de magia como ação bônus
de 2014 da regra de gasto de espaços por turno de 2024. Magias antigas sem esse
metadado usam ação como padrão e permitem correção manual no fluxo de conjuração.

A economia de conjuração usa a cena, `combat.state().encounterId`, a rodada e o
combatente atual. Reiniciar um combate cria outra identidade; reordenar a lista
não reinicia a economia do turno. Fichas abertas pelo diretório consultam a cena
atual pelos mapas; fichas de token usam sua cena explícita. Fora do combate, ou
em um host antigo sem identificação do encontro, a restrição por turno exige
controle manual.

## Armadura, condições e concentração

Personagens usam `acMode: "equipment"` por padrão: a CA resulta da armadura
equipada, da Destreza permitida por ela e de um escudo. A primeira armadura ou
escudo arrastado ocupa seu espaço livre; itens adicionais ficam no inventário.
Equipar outra armadura ou escudo substitui o item equipado no mesmo espaço.
Monstros mantêm CA manual por padrão. Selecionar o modo manual nas configurações
registra `acModeExplicit: true`, preservando essa escolha. Fichas antigas com o
antigo padrão manual e armadura equipada passam ao cálculo automático, sem
apagar o valor manual guardado em `ac`.

`armorTraining` usa `light`, `medium`, `heavy` e
`shield`; um item pode ter `trained` explícito. A ausência de metadados de treino
preserva o comportamento legado, sem impor uma penalidade nova silenciosamente.
CA manual altera apenas a fórmula de CA: não remove a falta de treino, a
desvantagem em Furtividade ou a redução de deslocamento da armadura equipada.
Uma concessão explícita `ignoreHeavyArmorSpeedPenalty` remove somente essa
redução de deslocamento, como no anão de 2014.

Armas com `weaponGroup`/`baseWeapon` podem usar as proficiências concedidas pela
classe, com `weaponProficiencyMode: "class"`. Um ajuste manual no item usa
`data.proficiencyMode: "manual"`. Armas antigas sem esses metadados conservam
seu bônus registrado. Pesada dá desvantagem por tamanho Pequeno/Minúsculo em
2014; em 2024 verifica Força 13 para arma corpo a corpo ou Destreza 13 para arma
à distância. Acuidade escolhe o melhor atributo elegível. A segunda arma não
soma um modificador positivo de atributo ao dano sem autorização explícita.

`data.requiresAttunement` e `owned.attuned` controlam a sintonia. Um item
equipado sem a sintonia necessária mantém seu uso mundano, mas perde seu
`magicBonus` e passivos mágicos. Guardar o item desativa seus passivos.
Características desativadas também deixam de contribuir. A ausência dos
metadados preserva itens legados e não inventa requisitos pelo texto.

`effectTemplates` conserva alterações reconhecidas e partes ainda manuais.
Atributos derivados usam `abilities.*.effectiveScore`; o valor base em `score`
permanece editável e intacto. Isso permite retirar Manoplas de Força do Ogro
sem transformar permanentemente o atributo base em 19. Deslocamentos e
sentidos derivados usam `effectiveMovement` e `effectiveSenses`. Fórmulas de
PV e limites de atributo explícitos são avaliados sem executar código externo.
Requisitos declarados `unarmored` e `noShield` permitem aplicar itens como
Braçadeiras de Defesa; requisitos desconhecidos continuam manuais.

`mechanicalTraits.unarmoredDefense` declara as fórmulas de Bárbaro ou Monge.
Sem armadura, Bárbaro usa `10 + DES + CON` e pode usar escudo; Monge usa
`10 + DES + SAB` e não pode usar escudo. Entre fórmulas disponíveis, a CA usa
a maior opção legal, sem somá-las; CA manual explícita conserva seu valor.
A aquisição por multiclasse é distinta do cálculo: a proibição de ganhar
Defesa sem Armadura novamente em 2014 é respeitada nas concessões de uma classe
adicional. Desativar a característica não permite adquiri-la novamente.

O bônus declarado de Arquearia usa `weapon.attack.ranged`: soma uma única vez
ao ataque de armas da categoria à distância. Não altera dano, ataques de magia
nem armas corpo a corpo arremessadas. Outros estilos com requisitos de mãos,
armadura ou gatilhos de combate precisam de metadados compatíveis ou resolução
manual; Arquearia não habilita esses estilos por aproximação.

`conditions` guarda identificadores canônicos, como `poisoned` e `prone`.
Imunidades declaradas suprimem a penalidade da condição sem apagar o estado
armazenado. Petrificação resiste a todo dano em ambas as edições; imunidade a
dano de veneno pertence à regra de 2014. Em 2024 a imunidade é à condição
Envenenado, e o dano de veneno continua sujeito à resistência.
`concentration: {active, sourceId, pendingDC}` distingue uma concentração ativa
da propriedade informativa `item.data.concentration`. `pendingChecks` conserva
uma fila de `{dc, damage}` para resolver separadamente cada instância. A CD por dano é pelo
menos 10, ou metade do dano sofrido arredondada para baixo; em 2024 o máximo é
30. Dano absorvido por PV temporários ainda conta como dano sofrido. A automação
deve usar o dano após reduções, antes de subtrair PV temporários.

Em efeitos 5e, uma duração sem metadados de expiração permanece informativa.
Para uma duração em rodadas automática, `data.duration.expires` deve ser
`start` ou `end`. `sourceActorId` e `sourceTokenId`, dentro de `data.duration`,
identificam o turno de origem; o token tem precedência. `manual` não inicia
contagem. Editar a duração/origem ou reativar o efeito deve remover `remaining`
para reiniciar a contagem. Sem fonte explícita, a contagem acompanha o próprio
token para uma ficha independente, ou o ator para uma ficha vinculada. O mestre
continua controlando aplicação e ativação.

Os detalhes de contexto da rolagem permitem informar condições do alvo,
distância em pés e visibilidade para combinar vantagem e desvantagem. A ficha
não deduz esses dados da geometria do mapa. A salvaguarda de concentração usa
sempre Constituição, sem permitir trocá-la por um teste de atributo. Fechar a
modal aguarda a rolagem pendente e o salvamento do resultado.

`mechanicalTraits.saveAdvantages` exige um contexto `saveAgainst` compatível,
como `charmed`, `poisoned` ou `frightened`. Ancestralidade Feérica não concede
vantagem em todas as salvaguardas. `magicalSleepImmunity` distingue imunidade
a sono mágico de vantagem e não remove inconsciência causada por dano.
Vantagem em concentração também é específica desse teste. Visão, audição,
origem de medo, identidade do agarrador/encantador, cobertura e outras condições
dependentes de um alvo continuam exigindo contexto ou decisão manual.

O círculo de proficiência em cada atributo marca a **salvaguarda**. Ao marcar,
o cartão exibe o bônus da salvaguarda e abre esse tipo de rolagem por padrão.
O seletor permite escolher um teste comum, que continua usando somente o
modificador do atributo. Perícias e ataques não recebem proficiência de
salvaguarda.

O resultado é a mensagem nativa do chat; não há uma segunda modal de resultado.
Os controles de Inspiração Heroica e aplicação ficam nessa mensagem enquanto
a ficha de origem está aberta. Uma nova rolagem por Inspiração Heroica gera
outra mensagem e identifica a anterior como substituída. Para morte e
concentração, a resolução aguarda manter ou rerrolar o resultado; fechar a
ficha ou iniciar outra rolagem confirma o resultado pendente uma única vez.
Inspiração Heroica permite rerrolar imediatamente o último dado: uma nova
rolagem desabilita esse controle nas mensagens anteriores. Não é possível
consumir a mesma inspiração duas vezes nem voltar a uma rolagem já aplicada.
Após fechar a ficha, os
controles ficam desabilitados e a mensagem permanece no histórico.

## Fontes e testes

- [SRD 5.1](https://media.dndbeyond.com/compendium-images/srd/5.1/SRD_CC_v5.1.pdf):
  descanso p.87, PV temporários pp.98–99, concentração p.102, Fire Bolt p.144.
- [SRD 5.2.1](https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf):
  PV temporários p.18, multiclasse pp.24–26, Cure Wounds p.121,
  Fire Bolt/Flame Blade p.132, concentração p.179, descansos pp.185/187.
- [SRD 5.1](https://media.dndbeyond.com/compendium-images/srd/5.1/SRD_CC_v5.1.pdf):
  anão/Robustez Anã pp.3–4; propriedades de armas pp.64–65.
- [SRD 5.2.1](https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf):
  espécies pp.84–85; propriedades/treino de equipamento pp.89–93;
  Petrificado p.186; outras condições e rituais no glossário.

`tests/test_compendium_formulas.py` verifica a conversão offline, com os arquivos
originais fixados no cache e as descrições oficiais. Os testes do runtime em
`tests/rules.test.mjs`, `tests/rules-automation.test.mjs` e
`tests/automation.test.mjs` verificam os cálculos e resultados nativos.
`tests/e2e/dnd_automation.py`, na raiz do VTT, exercita os controles em uma mesa
descartável, incluindo salvamento ao fechar uma rolagem pendente, ambas as
edições, Dados de Vida de multiclasse e acesso somente leitura em janela móvel.
Os IDs e a procedência dos itens
permanecem estáveis ao reconstruir os compêndios.

Os controles usam a API oficial do Translator e possuem catálogos completos de
interface em português brasileiro, inglês e espanhol. O build confere paridade
de chaves e parâmetros; os testes de tradução verificam o adaptador real do host.
Conteúdo de documentos e nomes dos usuários permanecem no idioma original.
