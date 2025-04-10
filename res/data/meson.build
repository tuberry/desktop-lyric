# SPDX-FileCopyrightText: tuberry
# SPDX-License-Identifier: GPL-3.0-or-later

configure_file(
  input: 'metadata.json.in',
  output: 'metadata.json',
  configuration: metadata,
  install_dir: target_dir,
)

mpris = configure_file(
  input: 'mpris.xml',
  output: '@0@.MprisPlayer.xml'.format(metadata['dbus']),
  copy: true,
)

subdir('scalable/status') # HACK: for https://github.com/mesonbuild/meson/issues/2320

foreach name: ['extension']
  gres = configure_file(
    input: f'@name@.gresource.xml.in',
    output: f'@name@.gresource.xml',
    configuration: {'icon': icon, 'mpris': fs.name(mpris.full_path())},
  )
  gnome.compile_resources(
    name, gres,
    source_dir: '@OUTDIR@',
    dependencies: [mpris, tray],
    gresource_bundle: true,
    install: true,
    install_dir: target_dir / 'resource',
  )
endforeach
