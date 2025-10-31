// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

export const URL = {
    NCM: 'https://music.163.com/',
    LRCLIB: 'https://lrclib.net/',
};

export const Key = {
    MINI: 'minimize',
    DRAG: 'draggable',
    FONT: 'font-name',
    SITE: 'lyric-place',
    AREA: 'systray-area',
    ONLN: 'online-lyrics',
    OPCT: 'lyric-opacity',
    PRGR: 'show-progress',
    PATH: 'lyric-location',
    FABK: 'online-fallback',
    PRVD: 'online-provider',
    SPAN: 'refresh-interval',
    ORNT: 'lyric-orientation',
    AVPL: 'allow-video-players',
    PMPL: 'preferred-mpris-player',
    PWID: 'panel-width',
    ACLR: 'active-color',
    ICLR: 'inactive-color',
};

// Color presets
export const ColorPreset = {
    SYSTEM: 0,      // System accent color
    WHITE: 1,       // White
    BLACK: 2,       // Black
    GREEN: 3,       // Green
    ORANGE: 4,      // Orange
    YELLOW: 5,      // Yellow
    BLUE: 6,        // Blue
    RED: 7,         // Red
    PURPLE: 8,      // Purple
};

// Predefined colors (RGBA values 0-1)
export const Colors = {
    [ColorPreset.WHITE]: [1.0, 1.0, 1.0],
    [ColorPreset.BLACK]: [0.0, 0.0, 0.0],
    [ColorPreset.GREEN]: [0.3, 0.8, 0.3],
    [ColorPreset.ORANGE]: [1.0, 0.6, 0.2],
    [ColorPreset.YELLOW]: [1.0, 0.9, 0.2],
    [ColorPreset.BLUE]: [0.3, 0.6, 1.0],
    [ColorPreset.RED]: [1.0, 0.3, 0.3],
    [ColorPreset.PURPLE]: [0.7, 0.3, 0.9],
};
