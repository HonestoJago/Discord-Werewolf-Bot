const GameStateManager = require('../utils/gameStateManager');
const logger = require('../utils/logger');
const { GameError } = require('../utils/error-handler');
const ROLES = require('../constants/roles');
const { createLoverDeathEmbed } = require('../utils/embedCreator');

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

            // Single save point after all changes
            await GameStateManager.saveGameState(this.game);

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

                            // Add lover death to pending changes
                            if (lover.role === ROLES.HUNTER && !options.skipHunterRevenge) {
                                // Set up Hunter's revenge before marking them dead
                                this.game.pendingHunterRevenge = lover.id;
                                await this.game.handleHunterRevenge(lover);
                                return;
                            }

                            pendingStateChanges.push({
                                playerId: loverId,
                                changes: { isAlive: false },
                                options: { 
                                    reason: 'Lover died',
                                    skipLoverDeath: true,
                                    skipHunterRevenge: lover.role === ROLES.HUNTER
                                }
                            });
                        }
                    }
                }

                // Handle special role death effects
                if (player.role === ROLES.HUNTER && !options.skipHunterRevenge) {
                    this.game.pendingHunterRevenge = player.id;
                    await this.game.handleHunterRevenge(player);
                    return;
                }

                // Move to dead channel
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

                // Save final state
                await this.game.saveGameState();

                // Only check win conditions after all state changes are complete
                if (!this.game.pendingHunterRevenge) {
                    await this.game.checkWinConditions();
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
}

module.exports = PlayerStateManager; 