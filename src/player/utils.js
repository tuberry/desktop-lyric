// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Player utility functions for formatting and parsing player information
 */

/**
 * Format player name for display
 * @param {string} name - Full D-Bus name (e.g., org.mpris.MediaPlayer2.chromium.instance123)
 * @returns {string} - Formatted name (e.g., chromium)
 */
export function formatPlayerName(name) {
    const match = name.match(/org\.mpris\.MediaPlayer2\.([^.]+)/);
    return match ? match[1] : name;
}

/**
 * Format player display with type badge and current title
 * @param {string} name - Player D-Bus name
 * @param {Object} info - Player info object
 * @param {boolean} info.isVideo - Whether player is video type
 * @param {string|null} info.currentTitle - Current playing title
 * @returns {string} - Formatted display string
 */
export function formatPlayerDisplay(name, info) {
    const TYPE_BADGE = {video: '🎬', audio: '🎵'};
    
    const playerName = formatPlayerName(name);
    const typeBadge = info.isVideo ? TYPE_BADGE.video : TYPE_BADGE.audio;
    
    if (!info.currentTitle) {
        return `${typeBadge} ${playerName}`;
    }
    
    // Show full title - ellipsis handled by Pango
    return `${typeBadge} ${playerName} - ${info.currentTitle}`;
}

/**
 * Check if the app categories indicate a video player
 * @param {string[]|null} categories - App categories
 * @param {string} playerName - Player name (e.g., 'chromium', 'firefox')
 * @returns {boolean} - True if it's a video player (contains Video category or is a browser)
 */
export function isVideoPlayer(categories, playerName = '') {
    // Whitelist: known music players that should never be treated as video players
    const musicPlayers = ['splayer', 'yesplaymusic'];
    const lowerName = playerName.toLowerCase();
    if (musicPlayers.some(music => lowerName.includes(music))) {
        return false;
    }
    
    if (!categories) {
        // Browsers can play videos, treat them as video players
        const browsers = ['chromium', 'chrome', 'firefox', 'edge', 'brave', 'opera', 'vivaldi', 'epiphany'];
        return browsers.some(browser => lowerName.includes(browser));
    }
    
    // Check for Video category
    if (categories.includes('Video')) {
        return true;
    }
    
    // Browsers with WebBrowser category are treated as video players
    if (categories.includes('WebBrowser')) {
        return true;
    }
    
    return false;
}

/**
 * Parse playback status priority for auto-selection
 * @param {string} status - Playback status (Playing, Paused, Stopped)
 * @returns {number} - Priority value (higher is better)
 */
export function getPlaybackPriority(status) {
    const priorities = {
        'Playing': 3,
        'Paused': 2,
        'Stopped': 1,
    };
    return priorities[status] || 0;
}
