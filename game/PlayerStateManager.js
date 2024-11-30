const GameStateManager = require('../utils/gameStateManager');
const logger = require('../utils/logger');
const { GameError } = require('../utils/error-handler');
const ROLES = require('../constants/roles');
const PHASES = require('../constants/phases');
const { createLoverDeathEmbed, createGameEndEmbed } = require('../utils/embedCreator');

class PlayerStateManager {
    constructor(game) {
        this.game = game;
    }

    createPlayerSnapshot(playerId) {
        const player = this.game.players.get(playerId);
        if (!player) return null;
        
        return {
            id: player.id,
            isAlive: player.isAlive,
            isProtected: player.isProtected,
            role: player.role,
            lovers: this.game.lovers.get(player.id),
            pendingActions: this.game.nightActions[player.id]
        };
    }

    async restoreFromSnapshot(playerId, snapshot) {
        if (!snapshot) return;
        
        const player = this.game.players.get(playerId);
        if (!player) return;

        player.isAlive = snapshot.isAlive;
        player.isProtected = snapshot.isProtected;
        player.role = snapshot.role;

        // Restore lover relationship if it existed
        if (snapshot.lovers) {
            this.game.lovers.set(playerId, snapshot.lovers);
        } else {
            this.game.lovers.delete(playerId);
        }

        // Restore pending actions
        if (snapshot.pendingActions) {
            this.game.nightActions[playerId] = snapshot.pendingActions;
        } else {
            delete this.game.nightActions[playerId];
        }
    }

    async changePlayerState(playerId, changes, options = {}) {
        const snapshot = this.createPlayerSnapshot(playerId);
        const relatedSnapshots = new Map();
        
        try {
            const player = this.game.players.get(playerId);
            if (!player) {
                throw new GameError('Invalid player', 'Player not found');
            }
            
            // Handle lover changes
            if ('lovers' in changes) {
                await this.handleLoverChange(playerId, changes.lovers, options);
            }

            // Collect related player snapshots
            if (this.game.lovers.has(playerId)) {
                const loverId = this.game.lovers.get(playerId);
                relatedSnapshots.set(loverId, this.createPlayerSnapshot(loverId));
            }

            // Apply changes atomically
            if ('isAlive' in changes) {
                await this.handleAliveStateChange(player, changes.isAlive, options);
            }
            
            if ('role' in changes) {
                await this.handleRoleChange(player, changes.role, options);
            }
            
            if ('isProtected' in changes) {
                await this.handleProtectionChange(player, changes.isProtected, options);
            }

            // Save state before checking win conditions
            await GameStateManager.saveGameState(this.game);

            // Check win conditions after state changes if not skipped
            if (!options.skipWinCheck && !this.game.pendingHunterRevenge) {
                await this.checkGameEndingConditions();
            }

            logger.info('Player state changed', {
                playerId,
                changes,
                reason: options.reason || 'No reason provided',
                finalState: this.createPlayerSnapshot(playerId)
            });
            
        } catch (error) {
            const errorDetails = {
                message: error.message || 'Unknown error',
                stack: error.stack,
                name: error.name || 'Error',
                code: error.code
            };
            
            logger.error('Error changing player state', { 
                error: errorDetails,
                playerId, 
                changes,
                options,
                currentState: this.createPlayerSnapshot(playerId)
            });
            
            // Restore states
            await this.restoreFromSnapshot(playerId, snapshot);
            for (const [relatedId, relatedSnapshot] of relatedSnapshots) {
                await this.restoreFromSnapshot(relatedId, relatedSnapshot);
            }
            
            throw error;
        }
    }

    async handleAliveStateChange(player, isAlive, options = {}) {
        try {
            if (!isAlive && player.isAlive) {
                // Create a list to track all pending state changes
                const pendingStateChanges = [];
                const deathChain = new Set(); // Track all deaths in this chain
                deathChain.add(player.id);
                
                // Handle death
                player.isAlive = false;

                // Handle lover death if not already being handled
                if (!options.skipLoverDeath) {
                    const loverId = this.game.lovers.get(player.id);
                    if (loverId) {
                        const lover = this.game.players.get(loverId);
                        if (lover?.isAlive) {
                            await this.game.broadcastMessage({
                                embeds: [createLoverDeathEmbed(lover, player)]
                            });

                            deathChain.add(loverId);

                            // Handle Hunter lover death specially
                            if (lover.role === ROLES.HUNTER && !options.skipHunterRevenge) {
                                this.game.pendingHunterRevenge = lover.id;
                                await this.game.handleHunterRevenge(lover);
                                return; // Exit early to let Hunter revenge handle the rest
                            }

                            // For any other lover death, queue it with skipHunterRevenge=true
                            pendingStateChanges.push({
                                playerId: loverId,
                                changes: { isAlive: false },
                                options: { 
                                    reason: 'Lover died',
                                    skipLoverDeath: true,  // Prevent infinite lover death chain
                                    skipHunterRevenge: true // Prevent Hunter revenge on lover death
                                }
                            });
                        }
                    }
                }

                // Move to dead channel if needed
                if (!options.skipChannelMove) {
                    await this.game.moveToDeadChannel(player);
                }

                // Process all pending state changes atomically
                for (const change of pendingStateChanges) {
                    await this.changePlayerState(
                        change.playerId,
                        change.changes,
                        change.options
                    );
                }

                // Save state
                await this.game.saveGameState();

                // Skip win condition check if Hunter revenge is pending
                if (this.game.pendingHunterRevenge) {
                    logger.info('Skipping win condition check - Hunter revenge pending', {
                        hunterId: this.game.pendingHunterRevenge
                    });
                    return;
                }

                // Check game ending conditions if not skipped
                if (!options.skipWinCheck) {
                    await this.checkGameEndingConditions();
                }
            }
        } catch (error) {
            logger.error('Error in handleAliveStateChange', {
                error: {
                    message: error.message,
                    stack: error.stack,
                    name: error.name
                },
                playerId: player.id,
                isAlive,
                options
            });
            throw error;
        }
    }

    async handleRoleChange(player, newRole, options = {}) {
        if (!ROLES[newRole]) {
            throw new GameError('Invalid role', `${newRole} is not a valid role`);
        }

        const oldRole = player.role;
        player.role = newRole;

        if (!options.skipNotification) {
            await player.assignRole(newRole);
        }

        logger.info('Player role changed', {
            playerId: player.id,
            oldRole,
            newRole,
            reason: options.reason || 'No reason provided'
        });
    }

    async handleProtectionChange(player, isProtected, options = {}) {
        if (isProtected) {
            player.isProtected = true;
            this.game.lastProtectedPlayer = player.id;
        } else {
            player.isProtected = false;
            if (this.game.lastProtectedPlayer === player.id) {
                this.game.lastProtectedPlayer = null;
            }
        }
    }

    async handleLoverChange(playerId, loverId, options = {}) {
        // Update lovers map atomically
        this.game.lovers.set(playerId, loverId);
        this.game.lovers.set(loverId, playerId);
        
        logger.info('Updated lover relationship', {
            player1: playerId,
            player2: loverId,
            reason: options.reason || 'No reason provided'
        });
    }

    async validateStateChange(playerId, changes) {
        const player = this.game.players.get(playerId);
        if (!player) {
            throw new GameError('Invalid player', 'Player not found');
        }

        if ('role' in changes && !ROLES[changes.role]) {
            throw new GameError('Invalid role', `${changes.role} is not a valid role`);
        }

        // Add any other validation rules
        return true;
    }

    // Add new method to centralize game ending logic
    async checkGameEndingConditions() {
        // Check if all players are dead (draw)
        const alivePlayers = this.game.getAlivePlayers();
        if (alivePlayers.length === 0) {
            logger.info('All players are dead - ending in draw');
            await this.endGameInDraw();
            return;
        }

        // Count living werewolves and villager team members
        const livingWerewolves = alivePlayers.filter(p => p.role === ROLES.WEREWOLF).length;
        const livingVillagerTeam = alivePlayers.filter(p => 
            p.role !== ROLES.WEREWOLF && 
            p.role !== ROLES.MINION && 
            p.role !== ROLES.SORCERER
        ).length;

        // Check win conditions
        if (livingWerewolves === 0) {
            // Village team wins
            await this.endGame(alivePlayers.filter(p => 
                p.role !== ROLES.WEREWOLF && 
                p.role !== ROLES.MINION && 
                p.role !== ROLES.SORCERER
            ));
        }
        else if (livingWerewolves >= livingVillagerTeam) {
            // Werewolf team wins
            await this.endGame(alivePlayers.filter(p => 
                p.role === ROLES.WEREWOLF || 
                p.role === ROLES.MINION || 
                p.role === ROLES.SORCERER
            ));
        }
    }

    async endGameInDraw() {
        this.game.phase = PHASES.GAME_OVER;
        this.game.gameOver = true;

        const gameStats = {
            rounds: this.game.round,
            totalPlayers: this.game.players.size,
            eliminations: this.game.players.size,
            duration: this.game.getGameDuration(),
            players: Array.from(this.game.players.values())
        };

        // Send draw announcement
        await this.game.broadcastMessage({
            embeds: [createGameEndEmbed([], gameStats, true)] // Added true for isDraw parameter
        });

        logger.info('Game ended in draw', {
            rounds: this.game.round,
            totalPlayers: this.game.players.size
        });

        await this.game.shutdownGame();
    }

    async endGame(winners) {
        this.game.phase = PHASES.GAME_OVER;
        this.game.gameOver = true;

        const gameStats = {
            rounds: this.game.round,
            totalPlayers: this.game.players.size,
            eliminations: this.game.players.size - winners.length,
            duration: this.game.getGameDuration(),
            players: Array.from(this.game.players.values())
        };

        await this.game.broadcastMessage({
            embeds: [createGameEndEmbed(Array.from(winners), gameStats)]
        });

        await this.game.shutdownGame();
    }
}

module.exports = PlayerStateManager; 