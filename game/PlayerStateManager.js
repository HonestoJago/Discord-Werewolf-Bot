const GameStateManager = require('../utils/gameStateManager');
const logger = require('../utils/logger');
const { GameError } = require('../utils/error-handler');
const ROLES = require('../constants/roles');
const PHASES = require('../constants/phases');
const { 
    createLoverDeathEmbed, 
    createGameEndEmbed, 
    createHunterRevengeEmbed, 
    createHunterTensionEmbed,
    createDeathAnnouncementEmbed,
    createHunterRevengePromptEmbed,
    createHunterRevengeFallbackEmbed
} = require('../utils/embedCreator');
const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');

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
        const snapshot = this.createGameSnapshot();
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

            // Log state change before returning
            logger.info('Player state changed', {
                playerId,
                changes,
                reason: options.reason || 'No reason provided',
                finalState: this.createPlayerSnapshot(playerId)
            });

            // Check win conditions if requested and not skipped
            if (options.checkWinConditions && !options.skipWinCheck) {
                return await this.checkGameEndingConditions();
            }
            return false;  // Game continues if no win check requested

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
                const pendingStateChanges = [];
                const deathChain = new Set();
                deathChain.add(player.id);

                // Special handling for Hunter - they get revenge no matter how they die
                if (player.role === ROLES.HUNTER && !options.skipHunterRevenge) {
                    // Set up revenge while Hunter is still alive
                    this.game.pendingHunterRevenge = player.id;
                    await this.handleHunterDeath(player, options.reason);
                    
                    // Process any other pending deaths
                    for (const change of pendingStateChanges) {
                        await this.changePlayerState(
                            change.playerId,
                            change.changes,
                            { ...change.options, skipWinCheck: true }
                        );
                    }
                    return;  // Hunter's actual death will be processed after revenge
                }

                // Handle normal death
                player.isAlive = false;

                // Send death announcement if it's a werewolf kill
                if (options.reason === 'Killed by werewolves') {
                    await this.game.broadcastMessage({
                        embeds: [createDeathAnnouncementEmbed(player)]
                    });
                }

                // Handle lover death if applicable
                if (!options.skipLoverDeath) {
                    const loverId = this.game.lovers.get(player.id);
                    if (loverId) {
                        const lover = this.game.players.get(loverId);
                        if (lover?.isAlive) {
                            await this.game.broadcastMessage({
                                embeds: [createLoverDeathEmbed(lover, player)]
                            });

                            deathChain.add(loverId);

                            // Queue lover's death - if they're Hunter, they'll get revenge when their death is processed
                            pendingStateChanges.push({
                                playerId: loverId,
                                changes: { isAlive: false },
                                options: { 
                                    reason: 'Lover died',
                                    skipLoverDeath: true,  // Prevent infinite chain
                                    skipHunterRevenge: false // Let Hunter get revenge if they're the lover
                                }
                            });
                        }
                    }
                }

                // Process all deaths
                for (const change of pendingStateChanges) {
                    await this.changePlayerState(
                        change.playerId,
                        change.changes,
                        change.options
                    );
                }

                // Move to dead channel if needed
                if (!options.skipChannelMove) {
                    await this.game.moveToDeadChannel(player);
                }

                // Check win conditions if not skipped
                if (!options.skipWinCheck) {
                    await this.checkGameEndingConditions();
                }
            }
        } catch (error) {
            logger.error('Error in handleAliveStateChange', { error });
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
        // Log initial state
        logger.info('Checking game ending conditions', {
            phase: this.game.phase,
            gameOver: this.game.gameOver,
            pendingHunterRevenge: this.game.pendingHunterRevenge,
            round: this.game.round
        });

        // Skip checks during setup phases
        if (this.game.phase === PHASES.LOBBY || this.game.phase === PHASES.NIGHT_ZERO) {
            logger.info('Skipping win check - setup phase', { phase: this.game.phase });
            return false;
        }

        // Skip if game is already over
        if (this.game.gameOver) {
            logger.info('Game is already over', { phase: this.game.phase });
            return true;
        }

        // Skip if Hunter revenge is pending
        if (this.game.pendingHunterRevenge) {
            logger.info('Skipping win check - Hunter revenge pending', {
                hunterId: this.game.pendingHunterRevenge
            });
            return false;
        }

        // Get alive players after all deaths are processed
        const alivePlayers = this.game.getAlivePlayers();
        
        // Log current player state
        logger.info('Current player state', {
            totalPlayers: this.game.players.size,
            alivePlayers: alivePlayers.length,
            playerDetails: Array.from(this.game.players.values()).map(p => ({
                username: p.username,
                role: p.role,
                isAlive: p.isAlive,
                isProtected: p.isProtected,
                hasLover: this.game.lovers.has(p.id)
            }))
        });
        
        // Check if all players are dead (draw)
        if (alivePlayers.length === 0) {
            logger.info('All players are dead - ending in draw', {
                finalState: Array.from(this.game.players.values()).map(p => ({
                    username: p.username,
                    role: p.role,
                    isAlive: p.isAlive,
                    deathReason: p.deathReason
                }))
            });
            await this.endGameInDraw();
            return true;
        }

        // Count living werewolves and villager team members
        const livingWerewolves = alivePlayers.filter(p => p.role === ROLES.WEREWOLF).length;
        const livingVillagerTeam = alivePlayers.filter(p => !this.isWerewolfTeam(p)).length;

        // Log team counts
        logger.info('Team counts', {
            livingWerewolves,
            livingVillagerTeam,
            werewolfTeamPlayers: alivePlayers.filter(p => this.isWerewolfTeam(p))
                .map(p => ({ username: p.username, role: p.role })),
            villageTeamPlayers: alivePlayers.filter(p => !this.isWerewolfTeam(p))
                .map(p => ({ username: p.username, role: p.role }))
        });

        // If no players remain alive on either team, it's a draw
        if (livingWerewolves === 0 && livingVillagerTeam === 0) {
            logger.info('No players remain alive on either team - ending in draw', {
                finalState: Array.from(this.game.players.values()).map(p => ({
                    username: p.username,
                    role: p.role,
                    isAlive: p.isAlive,
                    deathReason: p.deathReason
                }))
            });
            await this.endGameInDraw();
            return true;
        }

        // Only check team wins if there are still players alive
        if (alivePlayers.length > 0) {
            if (livingWerewolves === 0) {
                logger.info('Village team wins - all werewolves eliminated', {
                    remainingVillagers: alivePlayers.filter(p => !this.isWerewolfTeam(p))
                        .map(p => ({ username: p.username, role: p.role }))
                });
                const winners = alivePlayers.filter(p => !this.isWerewolfTeam(p));
                await this.endGame(winners);
                return true;
            }
            else if (livingWerewolves >= livingVillagerTeam) {
                logger.info('Werewolf team wins - achieved parity', {
                    livingWerewolves,
                    livingVillagerTeam,
                    remainingPlayers: alivePlayers.map(p => ({ 
                        username: p.username, 
                        role: p.role,
                        team: this.isWerewolfTeam(p) ? 'werewolf' : 'village'
                    }))
                });
                const winners = alivePlayers.filter(p => this.isWerewolfTeam(p));
                await this.endGame(winners);
                return true;
            }
        }

        logger.info('No win condition met - game continues', {
            livingWerewolves,
            livingVillagerTeam,
            totalAlive: alivePlayers.length
        });
        return false;
    }

    // Add helper method to check if a player is on the werewolf team
    isWerewolfTeam(player) {
        return player.role === ROLES.WEREWOLF || 
               player.role === ROLES.MINION || 
               player.role === ROLES.SORCERER;
    }

    // Add helper method to check if a player is on the village team
    isVillageTeam(player) {
        return !this.isWerewolfTeam(player);
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

    async processHunterRevenge(hunterId, targetId) {
        const snapshot = this.createGameSnapshot();
        
        try {
            const hunter = this.game.players.get(hunterId);
            const target = this.game.players.get(targetId);
    
            if (!target || !target.isAlive) {
                throw new GameError('Invalid target', 'Target player not found or is already dead');
            }
    
            // Send revenge announcement
            await this.game.broadcastMessage({
                embeds: [createHunterRevengeEmbed(hunter, target)]
            });
    
            // Kill the target
            await this.changePlayerState(target.id, 
                { isAlive: false },
                { 
                    reason: 'Hunter revenge target',
                    skipHunterRevenge: true,  // Prevent infinite revenge chain
                    skipLoverDeath: true,     // Skip lover deaths for target
                }
            );
    
            // Clear pending revenge state
            this.game.pendingHunterRevenge = null;
    
            // Save state
            await this.game.saveGameState();
    
            // Check win conditions after all state changes
            return await this.checkGameEndingConditions();
    
        } catch (error) {
            await this.restoreFromSnapshot(snapshot);
            logger.error('Error processing Hunter revenge', { error });
            throw error;
        }
    }

    /**
     * Creates a snapshot of the current game state for this manager
     * @returns {Object} Snapshot of current state
     */
    createGameSnapshot() {
        return {
            phase: this.game.phase,
            players: new Map(Array.from(this.game.players.entries()).map(([id, player]) => [
                id,
                {
                    id: player.id,
                    isAlive: player.isAlive,
                    isProtected: player.isProtected,
                    role: player.role
                }
            ])),
            round: this.game.round,
            lastProtectedPlayer: this.game.lastProtectedPlayer,
            pendingHunterRevenge: this.game.pendingHunterRevenge,
            lovers: new Map(this.game.lovers)
        };
    }

    /**
     * Restores game state from a snapshot
     * @param {Object} snapshot - The snapshot to restore from
     */
    async restoreFromSnapshot(snapshot) {
        this.game.phase = snapshot.phase;
        this.game.players = new Map(Array.from(snapshot.players.entries()).map(([id, playerData]) => [
            id,
            Object.assign(this.game.players.get(id), playerData)
        ]));
        this.game.round = snapshot.round;
        this.game.lastProtectedPlayer = snapshot.lastProtectedPlayer;
        this.game.pendingHunterRevenge = snapshot.pendingHunterRevenge;
        this.game.lovers = new Map(snapshot.lovers);
        await this.game.saveGameState();
    }

    async handleHunterDeath(hunter, reason) {
        // Set up revenge while Hunter is still alive
        this.game.pendingHunterRevenge = hunter.id;

        // Create dropdown for Hunter's revenge
        const validTargets = Array.from(this.game.players.values())
            .filter(p => p.isAlive && p.id !== hunter.id)
            .map(p => ({
                label: p.username,
                value: p.id,
                description: `Take ${p.username} with you`
            }));

        // Send tension message to village first
        await this.game.broadcastMessage({
            embeds: [createHunterTensionEmbed(hunter)]
        });

        // Send revenge UI to Hunter
        try {
            await hunter.sendDM({
                embeds: [createHunterRevengePromptEmbed()],
                components: [new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('hunter_revenge')
                        .setPlaceholder('Choose your target')
                        .addOptions(validTargets)
                )]
            });

            logger.info('Hunter revenge DM sent', {
                hunterId: hunter.id,
                hunterName: hunter.username,
                validTargetCount: validTargets.length
            });
        } catch (error) {
            logger.error('Failed to send Hunter revenge DM', { error });
            // Send fallback message to game channel
            await this.game.broadcastMessage({
                embeds: [createHunterRevengeFallbackEmbed(hunter.username)]
            });
        }

        // Queue Hunter's death for after revenge
        return {
            playerId: hunter.id,
            changes: { isAlive: false },
            options: { 
                reason: reason,
                skipLoverDeath: true,  // Prevent death chain loops
                skipHunterRevenge: true // Already handled revenge
            }
        };
    }
}

module.exports = PlayerStateManager; 