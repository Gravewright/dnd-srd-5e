# Compêndios SRD — cobertura e procedência

Conteúdo selecionado para o DnD 5e SRD 0.1.0. São coleções parciais,
separadas por edição, com textos e nomes em inglês. A tradução da interface
não traduz essas entradas. Variantes, subclasses e características podem ter
nomes repetidos; cada registro mantém identidade e procedência próprias.

| Tipo | 2014 / SRD 5.1 | 2024 / SRD 5.2.1 |
|---|---:|---:|
| Armas | 173 | 86 |
| Armaduras e escudos | 65 | 24 |
| Equipamentos e ferramentas | 243 | 332 |
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

Não inclui monstros, efeitos prontos ou todo o conteúdo do SRD. O editor aceita
os 11 tipos do sistema; estas coleções usam dez deles. Origens, classes,
talentos e características fornecem avanços declarativos para aplicar os
benefícios reconhecidos, com escolhas obrigatórias e registro de procedência.
Isso não executa todas as regras de cada descrição: maestrias, ativações,
contextos e efeitos sem representação continuam dependentes da mesa.

## Fontes e licenças

- Conteúdo de regras: [SRD 5.1 e SRD 5.2.1 publicados pela Wizards](https://www.dndbeyond.com/srd), sob [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/legalcode). As atribuições exigidas estão em [NOTICE.md](../NOTICE.md).
- Dados estruturados: [repositório público Foundry D&D5e, revisão fixada](https://github.com/foundryvtt/dnd5e/tree/87e94dbd9f930135e0694cd7e7d49f210603cd2c/packs/_source), com o aviso MIT preservado em [FOUNDRY-DATA-LICENSE.txt](FOUNDRY-DATA-LICENSE.txt). Foram consultados apenas os YAML públicos dos packs indicados no script.
- Descrições de magias: extraídas diretamente dos PDFs ingleses oficiais, em ordem de leitura por coluna. Outras descrições: convertidas dos registros licenciados para texto simples. Links de compêndio tornam-se nomes; macros e notas de automação do Foundry são removidas.

Nenhuma arte, ícone, tradução, código de automação, livro, PDF ou pacote premium
do Foundry/Wizards acompanha o ZIP. O código original do adaptador é MIT; essa
licença não substitui a licença CC BY 4.0 do conteúdo das regras.

Cada entrada guarda em `data.provenance` a edição, caminho e ID da fonte, commit,
SHA Git do arquivo, SHA-256 e o PDF oficial correspondente. Magias incluem a
página de origem. [PROVENANCE.json](PROVENANCE.json) registra contagens, hashes,
transformações e exclusões. Os IDs são estáveis entre reconstruções da mesma
edição e caminho de origem.

## Filtros e limitações

O adaptador exige o marcador explícito `CC-BY-4.0` no registro e compara o nome
com o SRD da edição correspondente. Variantes só entram por regras restritas de
nome; casos incertos ficam fora. O marcador upstream sozinho não basta:
**Arcane Vigor** foi excluída por não constar no SRD 5.2.1. **Ice Knife** consta
no SRD, mas foi omitida porque o registro estruturado não possui esse marcador.
Os documentos auxiliares vazios **Book of Shadows** e **Unarmed Strike** também foram omitidos. O relatório
lista as demais exclusões; a seleção não deve ser anunciada como SRD completo.

Valores de alcance, tempo e duração das magias usam seus cabeçalhos no PDF,
evitando fórmulas que dependem do runtime do Foundry. Perfis estruturados
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
passivos automáticos só porque a fonte upstream marca transferência.

Veja [automações e limites](../AUTOMATION.md) para as regras de combate,
descanso, concentração, fórmulas, compatibilidade e decisões ainda manuais.

A representação é uma adaptação experimental. A fonte oficial permanece a
referência para decisões de regras; diferenças de contexto não são resolvidas
automaticamente pelo catálogo.

## Reconstruir e validar

Na raiz do checkout de [DnD 5e SRD](https://github.com/Gravewright/dnd-srd-5e),
instale as dependências somente para ferramentas:

```sh
python -m pip install --target data/srd-compendium-tools PyYAML==6.0.3 PyMuPDF==1.27.2.2
python scripts/fetch_srd.py
python scripts/build_compendiums.py
node --test tests/compendiums.test.mjs
node --test tests/advancement.test.mjs
python tests/test_compendium_advancement.py
python tests/test_compendium_formulas.py
python scripts/build.py
```

Os JSONs prontos estão versionados; não é necessário executar downloads ou
instalar PyYAML/PyMuPDF para testar a interface ou criar os pacotes normais.
As suítes Python de conversão exigem o cache das fontes. Para reutilizar um cache
externo, defina `GRAVEWRIGHT_SRD_CACHE`; para as dependências de ferramentas em
outro diretório, defina `GRAVEWRIGHT_SRD_TOOLS`. Sem overrides, os arquivos de
desenvolvimento usam a pasta `data/` do checkout, fora dos ZIPs.

O download fixa o commit e verifica cada blob Git; os PDFs oficiais também têm
SHA-256 fixado. Fontes, PDFs e dependências ficam em `data/`, fora do ZIP.
O build final inclui os JSON e estes avisos; não inclui ferramentas ou testes.

O manifesto declara apenas `compendiums/2014.json` e `compendiums/2024.json`.
A base valida caminhos, limites, tipos registrados, integridade e versão ativa.
Os compêndios começam privados do mestre. Jogadores precisam de concessão de
leitura; importar documentos é reservado ao mestre. Veja o
[contrato da base VTT 0.2.1](https://github.com/Gravewright/gravewright/blob/v0.2.1/docs/pt-BR/modules.md).
