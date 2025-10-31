// SPDX-FileCopyrightText: tuberry
// SPDX-License-Identifier: GPL-3.0-or-later

import {getPlaybackPriority} from './player-utils.js';

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
     * Priority: Playing > Paused > Stopped
     * @param {Map<string, Object>} availablePlayers - Map of player name to info
     * @returns {string|null} Selected player name
     */
    autoSelectPlayer(availablePlayers) {
        const players = Array.from(availablePlayers.entries());
        
        // Find the player with highest priority status
        let bestPlayer = null;
        let bestPriority = 0;
        
        for (const [name, info] of players) {
            const priority = getPlaybackPriority(info.playbackStatus);
            if (priority > bestPriority) {
                bestPriority = priority;
                bestPlayer = name;
            }
        }
        
        // If no player with priority found, return first available
        return bestPlayer || players[0]?.[0] || null;
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
     * @returns {boolean} True if should activate immediately
     */
    shouldActivateNewPlayer(newPlayerName, newPlayerInfo, currentPlayer, preferredPlayer, hasActivePlayer) {
        // No active player, activate this one
        if (!hasActivePlayer) {
            return true;
        }
        
        // This is the preferred player, activate it
        if (preferredPlayer && newPlayerName === preferredPlayer) {
            return true;
        }
        
        // Auto mode: new player is playing, switch to it (newest playing wins)
        if (!preferredPlayer && newPlayerInfo?.playbackStatus === 'Playing') {
            return true;
        }
        
        return false;
    }
}
