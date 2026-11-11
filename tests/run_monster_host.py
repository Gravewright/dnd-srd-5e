"""Validate the built monster packs on a host with disposable data only."""
import json
import os
from pathlib import Path
import sys
import tempfile
import uuid

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from dev_paths import host_root
HOST=host_root(required=True)
sys.path.insert(0,str(HOST))
VERSION=json.loads((ROOT/'manifest.json').read_text())['version']
ARCHIVE=ROOT/'dist'/f'gravewright-5e-srd-{VERSION}.zip'


def main():
    local=ROOT/'data';local.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='monster-host-',dir=local) as directory:
        isolated=Path(directory).resolve()
        os.environ.update(PYTHON_DOTENV_DISABLED='1',DJANGO_SETTINGS_MODULE='config.settings',
            GRAVEWRIGHT_DATABASE=':memory:',GRAVEWRIGHT_MEDIA_ROOT=str(isolated/'media'),
            GRAVEWRIGHT_MODULES_ROOT=str(isolated/'modules'),GRAVEWRIGHT_CONTENT_ROOT=str(isolated/'content'),
            GRAVEWRIGHT_DJANGO_REGISTRY=str(isolated/'modules/server-apps.json'),GRAVEWRIGHT_SERVER_APPS='',
            GRAVEWRIGHT_SERVER_APP_PATHS='',GRAVEWRIGHT_REDIS_URL='',GRAVEWRIGHT_MARKETPLACE_URL='',
            GRAVEWRIGHT_MARKETPLACE_KEYS_FILE='',GRAVEWRIGHT_RELEASES_REPOSITORY='')
        import django
        django.setup()
        from django.conf import settings
        from django.test import TestCase,override_settings
        from django.test.runner import DiscoverRunner
        from gravewright.accounts.models import User
        from gravewright.actors.models import Actor
        from gravewright.campaigns.models import Campaign,Membership
        from gravewright.modules.packages import host
        from gravewright.table import domain
        from gravewright.table.domain import MapError
        settings.DATABASES['default']['TEST']['NAME']=':memory:'
        assert settings.DATABASES['default']['NAME']==':memory:'
        assert Path(settings.MEDIA_ROOT).is_relative_to(isolated)

        @override_settings(PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],CHANNEL_LAYERS={'default':{'BACKEND':'channels.layers.InMemoryChannelLayer'}})
        class MonsterImportTests(TestCase):
            def test_native_install_read_import_and_player_permissions(self):
                engine=host();manifest=engine.install_local(ARCHIVE.read_bytes(),expected_type='system')
                gm=User.objects.create_user(email='monster-gm@example.test',password='synthetic-test',name='GM',role='owner')
                player=User.objects.create_user(email='monster-player@example.test',password='synthetic-test',name='Player')
                campaign=Campaign.objects.create(owner=gm,name='Disposable monsters',system=manifest['id'])
                for user,role in ((gm,'gm'),(player,'player')):Membership.objects.create(campaign=campaign,user=user,role=role)
                engine.configure(campaign.pk,{manifest['id']:VERSION},{},'0')
                def command(user,action,payload):return domain.command(campaign.pk,user.pk,'compendiums',action,payload,uuid.uuid4())
                all_packs=domain.state(campaign.pk,gm.pk,'compendiums')['packs']
                monsters=[p for p in all_packs if p['entries'] and p['entries'][0]['kind']=='actor']
                self.assertEqual(len(monsters),2)
                self.assertEqual(sum(len(p['entries']) for p in monsters),647)
                self.assertFalse(any(p['id'] in {x['id'] for x in monsters} for p in domain.state(campaign.pk,player.pk,'compendiums')['packs']))
                for pack in monsters:
                    entry=next(e for e in pack['entries'] if e['name']=='Aboleth')
                    payload={'packId':pack['id'],'id':entry['id']}
                    with self.assertRaises(MapError):command(player,'read',payload)
                    raw=command(gm,'read',payload)
                    result=command(gm,'import',payload)
                    self.assertEqual(result['kind'],'actor')
                    actor=Actor.objects.get(pk=result['id'])
                    self.assertEqual(actor.type,'monster')
                    for field in ('abilities','hp','ac','actions_text','attacks','provenance'):
                        self.assertEqual(actor.data[field],raw['data'][field])
                    command(gm,'permissions',{'packId':pack['id'],'level':'read'})
                    self.assertEqual(command(player,'read',payload),raw)
                    with self.assertRaises(MapError):command(player,'import',payload)
                self.assertEqual(Actor.objects.filter(campaign=campaign).count(),2)
        import types
        module=types.ModuleType('monster_native_checks')
        module.MonsterImportTests=MonsterImportTests
        sys.modules[module.__name__]=module
        return DiscoverRunner(verbosity=1).run_tests(['monster_native_checks'])

if __name__=='__main__':raise SystemExit(main())
