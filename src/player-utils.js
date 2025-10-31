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
 * @returns {boolean} - True if it's a video player (not AudioVideo AND is Video)
 */
export function isVideoPlayer(categories) {
    if (!categories) return false;
    
    // Check if it's NOT AudioVideo AND is Video
    return categories.reduce((result, category) => {
        result[0] &&= category !== 'AudioVideo'; // Not an audio/video hybrid
        result[1] ||= category === 'Video';       // Is a video player
        return result;
    }, [true, false]).some(x => x);
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
