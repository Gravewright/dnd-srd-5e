# Compêndios SRD — cobertura e procedência

Conteúdo selecionado para o DnD 5e SRD 0.1.0. São coleções parciais,
separadas por edição, com textos e nomes em inglês. A tradução da interface
não traduz essas entradas. Variantes, subclasses e características podem ter
nomes repetidos; cada registro mantém identidade e procedência próprias.

| Tipo | 2014 / SRD 5.1 | 2024 / SRD 5.2.1 |
|---|---:|---:|
| Armas | 173 | 86 |
| Armaduras e escudos | 65 | 23 |
| Equipamentos e ferramentas | 243 | 333 |
| Consumíveis | 164 | 146 |
| Magias | 319 | 338 |
| Talentos | 1 | 17 |
| Características e subclasses | 272 | 303 |
| Raças e espécies | 9 | 14 |
| Antecedentes | 1 | 4 |
| Classes | 12 | 12 |
| **Total de entradas** | **1.259** | **1.276** |

São **2.535 entradas**: 2.524 registros adaptados e 11 características originais
derivadas do texto licenciado de seus pais no SRD 5.1 — dez ancestralidades de
Sopro de Dragão e Robustez Anã. Essas definições têm IDs estáveis e registram o
pai, a verificação textual e a transformação em sua procedência.

Inclui também `monsters-2014.json` (317 monstros) e `monsters-2024.json` (330 monstros). Não inclui efeitos prontos ou todo o conteúdo do SRD. O editor aceita
os 11 tipos do sistema; estas coleções usam dez deles. Origens, classes,
talentos e características fornecem avanços declarativos para aplicar os
benefícios reconhecidos, com escolhas obrigatórias e registro de procedência.
Isso não executa todas as regras de cada descrição: maestrias, ativações,
contextos e efeitos sem representação continuam dependentes da mesa.

## Fontes e licenças

- Conteúdo de regras: [SRD 5.1 e SRD 5.2.1 publicados pela Wizards](https://www.dndbeyond.com/srd), sob [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/legalcode). As atribuições exigidas estão em [NOTICE.md](../NOTICE.md).
- Representações estruturadas: dados YAML públicos, copyright 2021 Andrew Clayton, revisão `87e94dbd9f930135e0694cd7e7d49f210603cd2c`, sob MIT. O [aviso original](THIRD-PARTY-DATA-LICENSE.txt) acompanha o pacote; essa licença é separada da licença do texto das regras.
- Descrições de magias: extraídas diretamente dos PDFs ingleses oficiais, em ordem de leitura por coluna. Outras descrições: convertidas para texto simples. Links de compêndio tornam-se nomes; macros e notas de automação de outros aplicativos são removidas.

Nenhuma arte, ícone, tradução, código de automação, livro, PDF ou pacote premium
de terceiros acompanha o ZIP. O código original do adaptador é MIT; essa
licença não substitui a licença CC BY 4.0 do conteúdo das regras.

Cada entrada guarda em `data.provenance` a licença do conteúdo, o PDF oficial
correspondente e seu SHA-256. Magias e monstros incluem a página de origem.
Registros adaptados também preservam a revisão, o caminho, o identificador e os
hashes do dado estruturado de origem.
[PROVENANCE.json](PROVENANCE.json) registra contagens, hashes dos PDFs,
transformações e exclusões. Os IDs das entradas são estáveis.

## Filtros e limitações

A seleção exige conteúdo explicitamente licenciado em CC BY 4.0 e compara o
nome com o SRD da edição correspondente. Variantes só entram por regras restritas
de nome; casos incertos ficam fora. A licença sozinha não basta:
**Arcane Vigor** foi excluída por não constar no SRD 5.2.1. **Ice Knife** consta
no SRD, mas foi omitida porque o registro estruturado não declara essa licença.
Os documentos auxiliares vazios **Book of Shadows** e **Unarmed Strike** também foram omitidos. O relatório
lista as demais exclusões; a seleção não deve ser anunciada como SRD completo.

Valores de alcance, tempo e duração das magias usam seus cabeçalhos no PDF,
sem fórmulas que dependam de outro aplicativo. Perfis estruturados
distinguem dano, cura e PV temporários, preservam o modificador de conjuração
quando explicitamente previsto e escalam por nível do personagem ou do espaço.
Fórmulas por raio/projétil não somam todas as instâncias em um único ataque.
Escolhas alternativas, dano de vários tipos, modificadores condicionais e
efeitos posteriores continuam manuais quando não representados. Armas usam os campos
de atributo/proficiência próprios do Gravewright e bônus mágicos separados;
armaduras incluem o bônus mágico em `base_ac`, com `magicBonus` separado para
respeitar a sintonia. Armas mágicas que permitem
escolher a arma base precisam dessa configuração na cópia antes de rolar.
Magias somente de cura não recebem uma ação de dano. Recursos com expressões
numéricas reconhecidas recebem uma árvore declarativa limitada; ao mudar seu
máximo, preservam os usos gastos. Expressões não reconhecidas ficam manuais.

## Avanços, escolhas e passivos

`data.advancement` representa aumentos de atributos, proficiências, idiomas,
tamanho, concessões, escolhas, escalas, Dados de Vida, PV e subclasses. A
aplicação pede as escolhas antes de concluir. `advancementLedger` registra as
contribuições para reaplicar, subir de nível, substituir ou remover a origem
sem duplicar concessões compartilhadas nem apagar cegamente edições manuais.
As duas edições mantêm seus próprios atributos de origem e regras de classe.

Classes distinguem os treinos iniciais dos de multiclasse, oferecem os talentos
elegíveis quando o avanço permite substituir um aumento de atributo e calculam
PV, Dados de Vida e espaços normais/de Pacto pelos metadados. Pré-requisitos
declarados de nível, classe e característica restringem as opções; requisitos
não declarados e escolhas completas de magias de classe continuam manuais.

O equipamento inicial conserva grupos **AND** (conjunto), **OR** (alternativa),
referências de itens, quantidades, categorias elegíveis e moedas. O plano pede
as alternativas e concede cópias independentes, ou a riqueza de valor fixo
declarado. Classe adicional não concede novamente seu pacote inicial. Itens
consumidos e moedas gastas não reaparecem ao recalcular a progressão. Fórmulas
de riqueza sem valor declarado e referências incompletas geram avisos.

Passivos reconhecidos usam `effectTemplates`, `mechanicalTraits`, modificadores
e traços tipados. Equipamento deve estar equipado e, quando exigido,
sintonizado. Atributos, sentidos e deslocamentos efetivos são derivados sem
alterar suas bases. Requisitos conhecidos, como ausência de armadura e escudo,
são avaliados; condições desconhecidas permanecem manuais. Magias não recebem
passivos automáticos.

Veja [automações e limites](../AUTOMATION.md) para as regras de combate,
descanso, concentração, fórmulas, compatibilidade e decisões ainda manuais.

A representação é uma adaptação experimental. A fonte oficial permanece a
referência para decisões de regras; diferenças de contexto não são resolvidas
automaticamente pelo catálogo.

## Validar

Os JSONs prontos estão versionados. As correções de regras conferidas com os
PDFs oficiais ficam registradas em `data.contentCorrections` de cada entrada e
em [PROVENANCE.json](PROVENANCE.json). Para validar:

```sh
node --test tests/compendiums.test.mjs tests/rules-audit.test.mjs
python scripts/build.py
python scripts/validate_package.py
```

O build final inclui os JSON e estes avisos; não inclui ferramentas ou testes.

O manifesto declara os dois catálogos de itens e os dois catálogos de monstros.
A base valida caminhos, limites, tipos registrados, integridade e versão ativa.
Os compêndios começam privados do mestre. Jogadores precisam de concessão de
leitura; importar documentos é reservado ao mestre. Veja o
[contrato da base VTT 0.2.1](https://github.com/Gravewright/gravewright/blob/v0.2.1/docs/pt-BR/modules.md).

## Monstros

Os blocos oficiais foram extraídos dos PDFs em ordem de leitura, com hashes
conferidos. A CA vem do PDF, incluindo armadura e escudo. A iniciativa
preserva o bônus explícito de 2024. Ataques simples recebem rolagens sem duplicar
atributo ou proficiência; dano de múltiplos tipos e efeitos contextuais permanecem
no texto de referência. Centopeia Gigante e Vespa Gigante de 2024 são transcritas
diretamente do PDF.

`MONSTER-PROVENANCE.json` registra a cobertura e as exclusões.
Variantes de invocação e objetos mágicos não são anunciados como novos monstros.
Atores importados são cópias independentes; o pacote não altera atores existentes.
