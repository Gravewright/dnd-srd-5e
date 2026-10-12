# Content Policy

This repository exists to provide a Gravewright ruleset framework for
5e/SRD-compatible play.

The package should remain safe to distribute as an unofficial compatibility
package.

## Allowed content

The repository may include:

- original Gravewright package code and configuration;
- schemas, layouts, mappings, rules, and formulas;
- original sheet/controller code;
- original CSS and UI styling;
- original sample/model actors and items;
- SRD-derived content when properly attributed under CC BY 4.0;
- terminology needed for compatibility when used in a lawful and non-misleading
  way.

## Disallowed content

Do not include:

- official rulebook text outside SRD-permitted material;
- official PDFs or book scans;
- official artwork;
- official trade dress;
- copied compendium data from proprietary tools;
- proprietary settings, adventures, subclasses, monsters, spells, magic items,
  or names outside material the package is allowed to use;
- logos or branding that imply official endorsement;
- content copied from third-party products without permission.

## Contributions

Every contribution that adds content must identify whether it is:

```text
original
SRD-derived
used with permission
```

When in doubt, do not include the content.

## Preferred approach

Prefer structured implementation and original prose. Licensed SRD descriptions
may be included with attribution and traceable sources; text outside that
permission must not be copied:

```text
Good:
  schema fields
  formulas
  roll automation
  item categories
  short labels
  original examples

Avoid:
  rules paragraphs without a confirmed reusable license
  monster text outside permitted SRD material
  spell descriptions outside permitted SRD material
  copied book tables outside permitted material
```

## Maintainer review

Maintainers should reject contributions that introduce licensing uncertainty.

The bundled compendium pipeline pins its public source revision, requires an
explicit CC-BY-4.0 content marker, and checks names against the corresponding
official SRD. An upstream marker alone is insufficient: for example, Arcane
Vigor is omitted because it is not present in SRD 5.2.1. Missing markers and
unconfirmed variants are omitted rather than assumed reusable. Each accepted
record retains source paths and digests. No upstream artwork, executable
automation, premium content or proprietary translations is bundled.
