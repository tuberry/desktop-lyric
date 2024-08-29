# desktop-lyric

Show the lyric of playing songs on the desktop.
>很多歌消失了。 —— *汪曾祺 《徙》*\
[![license]](/LICENSE.md)

![bee](https://user-images.githubusercontent.com/17917040/107332354-08111f80-6aef-11eb-9c7a-f8799c834501.png)

## Installation

### Manual

The latest and supported version should only work on the most current stable version of GNOME Shell.

```bash
git clone https://github.com/tuberry/desktop-lyric.git && cd desktop-lyric
meson setup build && meson install -C build
# meson setup build -Dtarget=system && meson install -C build # system-wide, default --prefix=/usr/local
```

For older versions, it's recommended to install via:

### E.G.O

[<img src="https://raw.githubusercontent.com/andyholmes/gnome-shell-extensions-badge/master/get-it-on-ego.svg?sanitize=true" alt="Get it on GNOME Extensions" height="100" align="middle">][EGO]

## Features

![dlpref](https://github.com/user-attachments/assets/ec12edb5-d4a0-4e9e-aec6-db37baecb3c6)

## Notes

* High CPU usage;
* Prefer lyrics from `xseam:asText` in [Mpris metadata];
* The lyrics ([LRC] format) filename format is `Title-Artist1,Artist2-Album.lrc`;
* Draw at an even pace so that exact synchronization with the song is not guaranteed;

## Contributions

Any contribution is welcome.

### Ideas

For any question or idea, feel free to open an issue or PR in the repo.

### Translations

To update the po file from sources:

```bash
bash ./cli/update-po.sh [your_lang_code] # like zh_CN, default to $LANG
```

### Developments

To install GJS TypeScript type [definitions](https://www.npmjs.com/package/@girs/gnome-shell):

```bash
npm install @girs/gnome-shell --save-dev
```

## Acknowledgements

* [lyrics-finder]: online lyrics
* [osdlyrics]: some names

[license]:https://img.shields.io/badge/license-GPLv3+-green.svg
[LRC]:https://en.wikipedia.org/wiki/LRC_(file_format)
[lyrics-finder]:https://github.com/TheWeirdDev/lyrics-finder-gnome-ext
[osdlyrics]:https://github.com/osdlyrics/osdlyrics
[EGO]:https://extensions.gnome.org/extension/4006/desktop-lyric/
[Mpris metadata]:https://www.freedesktop.org/wiki/Specifications/mpris-spec/metadata/#xesam:astext
