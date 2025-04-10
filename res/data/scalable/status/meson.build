# SPDX-FileCopyrightText: tuberry
# SPDX-License-Identifier: GPL-3.0-or-later

icon = 'lyric-symbolic.svg'

tray = custom_target(
  output: icon,
  build_by_default: true,
  build_always_stale: true,
  command: [
    find_program('gjs'),
    '-m',
    '@SOURCE_ROOT@' / 'cli/gen-icon.js',
    '@OUTDIR@',
    icon,
  ],
)
