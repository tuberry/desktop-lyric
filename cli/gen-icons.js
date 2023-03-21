// vim:fdm=syntax
// by tuberry
'use strict';

const { Gio } = imports.gi;

const sp = x => Math.sin(Math.PI * x);
const cp = x => Math.cos(Math.PI * x);

const L = 16;
const n = 1 / 16;
const m = n * L;
const W = L - 2 * m;
const fill = 'fill="#444"';

let g = W / 8,
    w = W - g,
    H = (W - g * 2) * 4 / 9,
    h = H * 9 / 16,
    r = H * 5 / 8, // H / Math.sqrt(3),
    pt = (x, y) => [r / 2 + g + x * cp(y), L / 2 + x * sp(y)],
    T = Array.from({ length: 3 }, (_x, i) => pt(r, i * 2 / 3));

Gio.File.new_for_path(ARGV.join('/')).replace_contents(`<svg xmlns="http://www.w3.org/2000/svg" width="${L}" height="${L}" version="1.1">
 <path d="M ${T.at(-1).join(' ')}
\t${T.map(([x, y]) => `A ${H} ${H} 0 0 1 ${x} ${y}`).join('\n\t')}"
 ${fill}/>
 <rect width="${w}" height="${h}" x="${m + g}" y="${m}" rx="${h / 2}" ${fill}/>
 <rect width="${W * 9 / 16}" height="${H}" x="${m + W * 7 / 16}" y="${(L - H) / 2}" rx="${H / 2}" ${fill}/>
 <rect width="${w}" height="${h}" x="${m + g}" y="${L - m - h}" rx="${h / 2}" ${fill}/>
</svg>`, null, false, Gio.FileCreateFlags.NONE, null);
