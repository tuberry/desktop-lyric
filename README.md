<!--
SPDX-FileCopyrightText: tuberry
SPDX-License-Identifier: CC-BY-SA-4.0
-->

# desktop-lyric

GNOME Shell extension to show the singing lyric on the desktop.

> 很多歌消失了。 —— _汪曾祺 《徙》_\
> [![license]](/LICENSE.md)

![bee](https://user-images.githubusercontent.com/17917040/107332354-08111f80-6aef-11eb-9c7a-f8799c834501.png)

## Installation

### Manual

The latest and supported version should only work on the [current stable version](https://release.gnome.org/calendar/#branches) of GNOME Shell.

```bash
git clone https://github.com/tuberry/desktop-lyric.git && cd desktop-lyric
just install || (meson setup build && meson compile -C build && meson install -C build)
# meson setup build -Dtarget=system && meson compile -C build && meson install -C build # system-wide
```

For older versions, it's recommended to install via:

```bash
gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell \
          --method org.gnome.Shell.Extensions.InstallRemoteExtension 'desktop-lyric@tuberry'
```

It's quite the same as installing from:

### E.G.O

[<img src="https://raw.githubusercontent.com/andyholmes/gnome-shell-extensions-badge/master/get-it-on-ego.svg?sanitize=true" alt="Get it on GNOME Extensions" height="100" align="middle">][EGO]

## Notes

- [Word-level lyrics] (😬) are not yet supported.

## Contributions

Feel free to open issues/discussions in the repo for any questions or ideas, **particularly before making significant changes or introducing new features**.

Also, _just_ so you know:

```bash
just --list

```

## Acknowledgements

- [lyrics-finder]: online lyrics
- [osdlyrics]: some names

[license]: https://img.shields.io/badge/license-GPLv3+-green.svg
[lyrics-finder]: https://github.com/TheWeirdDev/lyrics-finder-gnome-ext
[osdlyrics]: https://github.com/osdlyrics/osdlyrics
[EGO]: https://extensions.gnome.org/extension/4006/desktop-lyric/
[Word-level lyrics]: https://github.com/marz1877/LRCv2#other-synced-lyric-formats
