# SPDX-FileCopyrightText: tuberry
# SPDX-License-Identifier: GPL-3.0-or-later

configure_file(
  input: 'metadata.json.in',
  output: 'metadata.json',
  configuration: me,
  install_dir: target_dir,
)

_icon = 'lyric-symbolic.svg'
_mpris = '@0@.MprisPlayer.xml'.format(me['dbus'])
_gres = {'icon': _icon, 'mpris': _mpris}

_deps = [] + custom_target(
  output: _icon,
  build_by_default: true,
  build_always_stale: true,
  build_subdir: 'scalable/status',
  command: [
    find_program('gjs'),
    '-m',
    '@SOURCE_ROOT@' / 'cli/gen-icon.js',
    '@OUTDIR@',
    _icon,
  ],
) + configure_file(
  input: 'mpris.xml',
  output: _mpris,
  copy: true,
)

foreach x: ['extension']
  gnome.compile_resources(
    x, configure_file(
      input: f'@x@.gresource.xml.in',
      output: f'@x@.gresource.xml',
      configuration: _gres,
    ),
    source_dir: '@OUTDIR@',
    dependencies: _deps,
    gresource_bundle: true,
    install: true,
    install_dir: target_dir / 'resource',
  )
endforeach
