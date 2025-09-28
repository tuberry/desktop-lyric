// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import * as T from '../src/util.js';

const L = 16; // length (side)
const M = 1 / 16; // margin
const W = 1 - 2 * M; // width (content)
const C = '#28282B'; // color
const XFM = `fill="${C}" transform="translate(${M} ${M}) scale(${W} ${W})"`;
const SVG = `viewBox="0 0 1 1" width="${L}" height="${L}" xmlns="http://www.w3.org/2000/svg"`;
const save = (text, name) => T.fwrite(T.fopen(ARGV.concat(name).join('/')), text);

let a = 1 / 2, // c == e ==> a == 1 / 2
    b = (1 - Math.cos(Math.PI / 6)) * a,
    c = (1 - a) / 2,
    d = a + b,
    e = a / 2,
    play = [[a, 1 / 2], [b, 1 / 2 + a / 2], [b, c]];

await save(`<svg ${SVG}>
  <g ${XFM}>
    <rect x="${b}" y="0" rx="${c / 2}" width="${1 - b}" height="${c}" opacity="0.6"/>
    <rect x="${b}" y="${1 - c}" width="${1 - b}" height="${c}" rx="${c / 2}" opacity="0.85"/>
    <rect x="${d}" y="${1 / 2 - e / 2}" width="${1 - d}" height="${e}" rx="${e / 2}"/>
    <path d="M${play.at(-1).join(' ')} ${play.map(([x, y]) => `A${a} ${a} 0 0 1 ${x} ${y}`).join(' ')}Z"/>
  </g>
</svg>`);
