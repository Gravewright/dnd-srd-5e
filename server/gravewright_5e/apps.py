"""Opt-in system integration; discovery does not execute marketplace code."""
from django.apps import AppConfig


class Gravewright5eConfig(AppConfig):
    name = 'gravewright_5e'
    label = 'gravewright_5e'
    verbose_name = 'DnD 5e SRD'

    def ready(self):
        from api.combat import register_provider
        from .combat import prepare_initiative, advance_effects
        register_provider('gravewright.5e-srd', prepare_initiative=prepare_initiative,
                          advance_effects=advance_effects)
