"""Serve a disposable DnD table on the unchanged released VTT 0.2.3."""
from __future__ import annotations

import argparse
from copy import deepcopy
import json
import os
from pathlib import Path
import secrets
import socket
import sys
import tomllib

MODULE=Path(__file__).resolve().parents[2]


def default_archive():
    version=json.loads((MODULE/'manifest.json').read_text(encoding='utf-8'))['version']
    return MODULE/'dist'/f'gravewright-5e-srd-{version}.zip'


def host_root(value=None):
    configured=value or os.environ.get('GRAVEWRIGHT_TEST_HOST_ROOT')
    candidates=([Path(configured)] if configured else [])+[Path.cwd(),*MODULE.parents]
    for candidate in candidates:
        root=candidate.resolve()
        if (root/'manage.py').is_file() and (root/'gravewright/modules').is_dir():
            version=tomllib.loads((root/'pyproject.toml').read_text(encoding='utf-8'))['project']['version']
            if version!='0.2.3':
                raise RuntimeError('Use the released Gravewright VTT 0.2.3 checkout for this compatibility fixture.')
            return root
    raise RuntimeError('Pass --host-root or set GRAVEWRIGHT_TEST_HOST_ROOT to the released VTT 0.2.3.')


def available_port(preferred):
    with socket.socket() as connection:
        try:connection.bind(('127.0.0.1',preferred))
        except OSError:connection.bind(('127.0.0.1',0))
        return connection.getsockname()[1]


def configure_environment(root,fixture,port):
    os.environ.update({
        'PYTHON_DOTENV_DISABLED':'1','PYTHONUTF8':'1','DEFAULT_LOCALE':'en',
        'DJANGO_SETTINGS_MODULE':'config.settings','DJANGO_DEBUG':'true',
        'DJANGO_SECRET_KEY':secrets.token_urlsafe(64),
        'DJANGO_ALLOWED_HOSTS':'127.0.0.1,localhost,testserver','DJANGO_SECURE_COOKIES':'false',
        'GRAVEWRIGHT_HOST':'127.0.0.1','GRAVEWRIGHT_PORT':str(port),'GRAVEWRIGHT_PUBLIC_ORIGIN':'',
        'GRAVEWRIGHT_DATABASE':str(fixture/'review.sqlite3'),'GRAVEWRIGHT_MEDIA_ROOT':str(fixture/'media'),
        'GRAVEWRIGHT_MODULES_ROOT':str(fixture/'modules'),'GRAVEWRIGHT_CONTENT_ROOT':str(fixture/'content'),
        'GRAVEWRIGHT_SERVER_APPS':'','GRAVEWRIGHT_SERVER_APP_PATHS':'',
        'GRAVEWRIGHT_DJANGO_REGISTRY':str(fixture/'modules/server-apps.json'),
        'GRAVEWRIGHT_API_MODULES_ROOT':'','GRAVEWRIGHT_DJANGO_MODULES_ROOT':'',
        'GRAVEWRIGHT_REDIS_URL':'','GRAVEWRIGHT_MARKETPLACE_URL':'','GRAVEWRIGHT_MARKETPLACE_KEYS_FILE':'',
        'GRAVEWRIGHT_RELEASES_REPOSITORY':'','TRUSTED_PROXIES':'',
    })
    sys.path.insert(0,str(root))


def create_fixture(root,fixture,archive):
    from zipfile import ZipFile
    from jsonschema.validators import validator_for
    schema=json.loads((root/'gravewright/modules/contracts/schemas/manifest.json').read_text(encoding='utf-8'))
    with ZipFile(archive) as package:
        manifest=json.loads(package.read('manifest.json'))
        if 'django' in manifest or any(name.endswith(('.py','.pyc','.pyd')) for name in package.namelist()):
            raise RuntimeError('The current DnD ZIP must contain only browser runtime and authorized content.')
    validator_for(schema)(schema).validate(manifest)
    import django
    django.setup()
    from django.conf import settings
    from django.core.management import call_command
    from django.test import Client
    from django.utils import timezone
    from gravewright.accounts.models import User
    from gravewright.actors.models import Actor
    from gravewright.campaigns.models import Campaign,Membership,Onboarding
    from gravewright.maps.models import Broadcast,Scene
    from gravewright.maps.services import DEFAULTS
    from gravewright.modules.models import ModuleSet
    from gravewright.modules.packages import host
    from gravewright.tokens.models import Token
    settings.PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher']
    call_command('migrate',verbosity=0,interactive=False)
    package=host().install_local(archive.read_bytes(),expected_type='system')
    users={name:User.objects.create_user(f'dnd-{name}@example.test',secrets.token_urlsafe(20),
            name=name.title(),role='owner' if name=='gm' else 'participant') for name in ('gm','player','reader')}
    campaign=Campaign.objects.create(owner=users['gm'],name='DnD isolated review',system=package['id'])
    for name,user in users.items():
        membership=Membership.objects.create(campaign=campaign,user=user,role='gm' if name=='gm' else 'player')
        Onboarding.objects.create(membership=membership,dismissed=True,player_shown_at=timezone.now())
    ModuleSet.objects.create(campaign=campaign,modules={package['id']:package['version']})
    data={'rulesEdition':'2014','level':1,'bars':{'bar_1':{'value':20,'max':20},'bar_2':{'value':0,'max':0}},
          'abilities':{'dex':{'score':16}},'conditions':[],'effects':[],'inventory':[]}
    grants={str(users['player'].pk):'owner',str(users['reader'].pk):'read'}
    actor=Actor.objects.create(campaign=campaign,name='Hero',type='character',data=data,permissions=grants)
    monster=Actor.objects.create(campaign=campaign,name='Monster',type='monster',data={**deepcopy(data),'ac':13})
    scene=Scene.objects.create(campaign=campaign,name='Native scene',width=1024,height=768,settings=deepcopy(DEFAULTS))
    Broadcast.objects.create(campaign=campaign,scene=scene)
    linked=Token.objects.create(scene=scene,actor=actor,grid_x=2,grid_y=2)
    snapshot=Token.objects.create(scene=scene,actor=actor,linked=False,grid_x=5,grid_y=2,
        snapshot={**deepcopy(data),'token':{'name':'Independent Hero'}})
    enemy=Token.objects.create(scene=scene,actor=monster,grid_x=7,grid_y=4)
    sessions={}
    for name,user in users.items():
        client=Client();client.force_login(user)
        sessions[name]={'name':settings.SESSION_COOKIE_NAME,'value':client.cookies[settings.SESSION_COOKIE_NAME].value}
    sessions['editor']=sessions['player']
    return {'kind':'dnd-isolated-review','fixture':str(fixture),'host':str(root),'module':str(MODULE),
            'package':{'id':package['id'],'version':package['version']},'campaign':str(campaign.pk),'table':str(campaign.pk),
            'actor':str(actor.pk),'monster':str(monster.pk),'scene':str(scene.pk),
            'linkedToken':str(linked.pk),'snapshotToken':str(snapshot.pk),'monsterToken':str(enemy.pk),
            'users':{name:str(user.pk) for name,user in users.items()},'sessions':sessions}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host-root')
    parser.add_argument('--archive',type=Path,default=default_archive())
    parser.add_argument('--fixture',type=Path)
    parser.add_argument('--seed',type=Path)
    parser.add_argument('--port',type=int,default=30029)
    args=parser.parse_args()
    root=host_root(args.host_root)
    fixture=(args.fixture or root/'data/dnd-review'/secrets.token_hex(8)).resolve()
    if fixture.exists() and any(fixture.iterdir()):raise RuntimeError('Use a new empty isolated fixture directory.')
    fixture.mkdir(parents=True,exist_ok=True)
    archive=args.archive.resolve()
    if not archive.is_file():raise RuntimeError(f'Build the DnD archive first: {archive}')
    port=available_port(args.port)
    configure_environment(root,fixture,port)
    seed=create_fixture(root,fixture,archive)
    seed['base']=f'http://127.0.0.1:{port}'
    seed_file=(args.seed or fixture/'seed.json').resolve()
    seed_file.parent.mkdir(parents=True,exist_ok=True)
    seed_file.write_text(json.dumps(seed,ensure_ascii=False,indent=2),encoding='utf-8',newline='\n')
    print(json.dumps({'base':seed['base'],'seed':str(seed_file),'campaign':seed['campaign']}),flush=True)
    from django.core.management import call_command
    call_command('runserver',f'127.0.0.1:{port}',use_reloader=False,verbosity=0)


if __name__=='__main__':main()
