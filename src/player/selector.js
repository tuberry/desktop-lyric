// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import {getPlaybackPriority} from './utils.js';

/**
 * PlayerSelector - Responsible for player selection strategy
 */
export class PlayerSelector {
    /**
     * Select the best player from available players
     * @param {Map<string, Object>} availablePlayers - Map of player name to info
     * @param {string} preferredPlayer - User's preferred player setting
     * @param {string|null} currentPlayer - Currently active player
     * @returns {string|null} Selected player name or null
     */
    selectPlayer(availablePlayers, preferredPlayer, currentPlayer = null) {
        const hasPlayers = availablePlayers.size > 0;
        
        // If user explicitly selected a player
        if (preferredPlayer && preferredPlayer !== 'none' && availablePlayers.has(preferredPlayer)) {
            return preferredPlayer;
        }
        
        // If user selected "None"
        if (preferredPlayer === 'none') {
            return null;
        }
        
        // Auto mode: smart selection based on playback status
        if (!preferredPlayer && hasPlayers) {
            return this.autoSelectPlayer(availablePlayers);
        }
        
        return null;
    }

    /**
     * Auto-select best player based on playback status
     * Priority: Music Playing > Video Playing > Music Paused > Video Paused > Music Stopped > Video Stopped
     * @param {Map<string, Object>} availablePlayers - Map of player name to info
     * @returns {string|null} Selected player name
     */
    autoSelectPlayer(availablePlayers) {
        const players = Array.from(availablePlayers.entries());
        
        // Separate music and video players
        const musicPlayers = players.filter(([_, info]) => !info.isVideo);
        const videoPlayers = players.filter(([_, info]) => info.isVideo);
        
        // Find best of each type
        const bestMusic = this._findBestPlayer(musicPlayers);
        const bestVideo = this._findBestPlayer(videoPlayers);
        
        // No players at all
        if (!bestMusic && !bestVideo) return null;
        
        // Only one type available
        if (!bestMusic) return bestVideo;
        if (!bestVideo) return bestMusic;
        
        // Both available: compare priorities with music boost
        // Music boost: 0.5 ensures Music Playing > Video Playing > Music Paused
        const musicInfo = availablePlayers.get(bestMusic);
        const videoInfo = availablePlayers.get(bestVideo);
        const musicPriority = getPlaybackPriority(musicInfo.playbackStatus) + 0.5;
        const videoPriority = getPlaybackPriority(videoInfo.playbackStatus);
        
        return musicPriority >= videoPriority ? bestMusic : bestVideo;
    }

    /**
     * Find best player from a list based on playback status
     * @param {Array} players - Array of [name, info] tuples
     * @returns {string|null} Best player name
     */
    _findBestPlayer(players) {
        if (players.length === 0) return null;
        
        let bestPlayer = null;
        let bestPriority = 0;
        
        for (const [name, info] of players) {
            const priority = getPlaybackPriority(info.playbackStatus);
            if (priority > bestPriority) {
                bestPriority = priority;
                bestPlayer = name;
            }
        }
        
        // If no player with priority > 0, return first player
        return bestPlayer || players[0][0];
    }

    /**
     * Check if we should auto-switch away from current player
     * @param {string} currentPlayer - Current player name
     * @param {Map<string, Object>} availablePlayers - Map of player name to info
     * @returns {boolean} True if should switch
     */
    shouldAutoSwitch(currentPlayer, availablePlayers) {
        const currentInfo = availablePlayers.get(currentPlayer);
        
        // If current player is playing, don't switch
        if (currentInfo?.playbackStatus === 'Playing') {
            return false;
        }
        
        // Check if any other player is playing
        return Array.from(availablePlayers.entries())
            .some(([name, info]) => name !== currentPlayer && info.playbackStatus === 'Playing');
    }

    /**
     * Determine if a new player should be activated immediately
     * @param {string} newPlayerName - New player that appeared
     * @param {Object} newPlayerInfo - New player info
     * @param {string|null} currentPlayer - Currently active player
     * @param {string} preferredPlayer - User's preferred player
     * @param {boolean} hasActivePlayer - Whether there's an active player
     * @param {Map<string, Object>} availablePlayers - All available players
     * @returns {boolean} True if should activate immediately
     */
    shouldActivateNewPlayer(newPlayerName, newPlayerInfo, currentPlayer, preferredPlayer, hasActivePlayer, availablePlayers) {
        // No active player, activate this one
        if (!hasActivePlayer) {
            return true;
        }
        
        // This is the preferred player, activate it
        if (preferredPlayer && newPlayerName === preferredPlayer) {
            return true;
        }
        
        // Auto mode: activate if new player is better than current
        if (!preferredPlayer && newPlayerInfo?.playbackStatus === 'Playing') {
            // If new player is music, always activate (music > video)
            if (!newPlayerInfo.isVideo) {
                return true;
            }
            
            // If new player is video, only activate if current is not music
            if (currentPlayer) {
                const currentInfo = availablePlayers?.get(currentPlayer);
                // Don't switch to video if current is music
                if (currentInfo && !currentInfo.isVideo) {
                    return false;
                }
            }
            
            return true;
        }
        
        return false;
    }
}
