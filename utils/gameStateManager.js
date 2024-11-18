const logger = require('./logger');
const Game = require('../models/Game');
const Player = require('../game/Player');
const { GameError } = require('./error-handler');
const { DiscordAPIError } = require('discord.js');
const PHASES = require('../constants/phases');
const ROLES = require('../constants/roles');
const { createDayPhaseEmbed } = require('../utils/embedCreator');
const dayPhaseHandler = require('../handlers/dayPhaseHandler');
const { ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');

class GameStateManager {
    /**
     * Saves complete game state to database
     * @param {WerewolfGame} game - Game instance to serialize
     */
    static async saveGameState(game) {
        try {
            // Serialize all players
            const serializedPlayers = {};
            for (const [playerId, player] of game.players) {
                serializedPlayers[playerId] = player.toJSON();
            }

            // Create complete state object
            const gameState = {
                guildId: game.guildId,
                channelId: game.gameChannelId,
                werewolfChannelId: game.werewolfChannel?.id,
                deadChannelId: game.deadChannel?.id,
                categoryId: process.env.WEREWOLF_CATEGORY_ID,
                creatorId: game.gameCreatorId,
                phase: game.phase,
                round: game.round,
                
                activeMessageIds: {
                    dayPhaseMessage: game.currentDayPhaseMessageId,
                    votingMessage: game.currentVotingMessageId,
                    lastAnnouncement: game.lastAnnouncementId,
                    activePrompts: Object.fromEntries(game.activePrompts || new Map())
                },
                
                players: serializedPlayers,
                
                votingState: {
                    nominatedPlayer: game.nominatedPlayer,
                    nominator: game.nominator,
                    seconder: game.seconder,
                    votingOpen: game.votingOpen,
                    votes: Object.fromEntries(game.votes),
                    nominationStartTime: game.nominationStartTime,
                    votingMessageId: game.currentVotingMessageId
                },
                
                nightState: {
                    expectedActions: Array.from(game.expectedNightActions),
                    completedActions: Array.from(game.completedNightActions),
                    pendingActions: game.nightActions,
                    lastProtectedPlayer: game.lastProtectedPlayer
                },
                
                specialRoles: {
                    lovers: Object.fromEntries(game.lovers),
                    pendingHunterRevenge: game.pendingHunterRevenge,
                    selectedRoles: Object.fromEntries(game.selectedRoles)
                },
                
                gameStartTime: game.gameStartTime,
                lastUpdated: new Date(),
                roleHistory: {
                    seer: {
                        investigations: [
                            // Add Night Zero vision
                            ...(game.nightActionProcessor?.initialVision ? [{
                                seerId: game.nightActionProcessor.initialVision.seerId,
                                targetId: game.nightActionProcessor.initialVision.targetId,
                                isWerewolf: game.nightActionProcessor.initialVision.isWerewolf,
                                round: 0,
                                isInitialVision: true
                            }] : []),
                            // Add regular investigations
                            ...(game.seerInvestigations || [])
                        ]
                    },
                    bodyguard: {
                        protections: game.nightActions?.bodyguardProtections || []
                    }
                },
                actionLog: game.actionLog || {}
            };

            await Game.upsert(gameState);
            
            logger.info('Game state saved successfully', {
                guildId: game.guildId,
                phase: game.phase
            });
        } catch (error) {
            logger.error('Failed to save game state', { error });
            throw error;
        }
    }

    /**
     * Restores game state from database
     * @param {Client} client - Discord client
     * @param {string} guildId - Guild ID to restore
     */
    static async restoreGameState(client, guildId) {
        try {
            const savedState = await Game.findByPk(guildId);
            if (!savedState) {
                throw new GameError('No saved game found', 'No saved game state found for this server.');
            }

            logger.info('Found saved game state', {
                guildId,
                phase: savedState.phase,
                playerCount: Object.keys(savedState.players || {}).length
            });

            // Verify guild exists
            const guild = await client.guilds.fetch(guildId).catch(error => {
                logger.error('Failed to fetch guild', { error, guildId });
                throw new GameError('Guild not found', 'Could not access the Discord server.');
            });

            // First verify/recreate channels
            const channels = await this.restoreChannels(client, savedState).catch(error => {
                logger.error('Failed to restore channels', { error });
                throw new GameError('Channel restoration failed', 'Could not restore game channels.');
            });

            // Create new game instance
            const game = new (require('../game/WerewolfGame'))(
                client,
                guildId,
                savedState.channelId,
                savedState.creatorId
            );

            try {
                // Restore basic properties
                game.phase = savedState.phase;
                game.round = savedState.round;
                game.gameStartTime = savedState.gameStartTime;

                // Restore channels
                game.werewolfChannel = channels.werewolfChannel;
                game.deadChannel = channels.deadChannel;

                // Verify all players still exist in guild
                for (const playerData of Object.values(savedState.players || {})) {
                    try {
                        await guild.members.fetch(playerData.discordId);
                    } catch (error) {
                        logger.warn('Player no longer in guild', {
                            playerId: playerData.discordId,
                            username: playerData.username
                        });
                        // Continue with restoration, but mark this player as disconnected
                        playerData.disconnected = true;
                    }
                }

                // Restore players
                for (const playerData of Object.values(savedState.players || {})) {
                    const player = Player.fromJSON(playerData, client);
                    game.players.set(player.id, player);
                }

                // Restore voting state
                if (savedState.votingState) {
                    Object.assign(game, savedState.votingState);
                    game.votes = new Map(Object.entries(savedState.votingState.votes || {}));
                }

                // Restore night state
                if (savedState.nightState) {
                    game.expectedNightActions = new Set(savedState.nightState.expectedActions || []);
                    game.completedNightActions = new Set(savedState.nightState.completedActions || []);
                    game.nightActions = savedState.nightState.pendingActions || {};
                    game.lastProtectedPlayer = savedState.nightState.lastProtectedPlayer;
                }

                // Restore special roles
                if (savedState.specialRoles) {
                    game.lovers = new Map(Object.entries(savedState.specialRoles.lovers || {}));
                    game.pendingHunterRevenge = savedState.specialRoles.pendingHunterRevenge;
                    game.selectedRoles = new Map(Object.entries(savedState.specialRoles.selectedRoles || {}));
                }

                // Restore UI state
                await this.restoreUIState(game, savedState.activeMessageIds, savedState.messageHistory)
                    .catch(error => {
                        logger.error('Failed to restore UI', { error });
                        // Continue with game restoration even if UI fails
                    });

                // Restore role history
                if (savedState.roleHistory?.seer?.investigations) {
                    game.seerInvestigations = savedState.roleHistory.seer.investigations;
                    logger.info('Restored Seer investigations', {
                        investigationCount: savedState.roleHistory.seer.investigations.length
                    });
                }
                if (savedState.roleHistory?.bodyguard?.protections) {
                    game.bodyguardProtections = savedState.roleHistory.bodyguard.protections;
                }

                logger.info('Game state restored successfully', {
                    guildId,
                    phase: game.phase,
                    playerCount: game.players.size
                });

                return game;
            } catch (error) {
                logger.error('Error during game state restoration', {
                    error,
                    phase: savedState.phase,
                    guildId
                });
                throw error;
            }
        } catch (error) {
            if (error instanceof DiscordAPIError) {
                logger.error('Discord API error during restoration', {
                    error: {
                        message: error.message,
                        code: error.code,
                        method: error.method,
                        path: error.path,
                        httpStatus: error.httpStatus
                    },
                    guildId
                });
            } else {
                logger.error('Failed to restore game state', {
                    error: {
                        message: error.message,
                        name: error.name,
                        stack: error.stack
                    },
                    guildId
                });
            }
            throw error;
        }
    }

    /**
     * Restores game channels and their permissions
     */
    static async restoreChannels(client, savedState) {
        try {
            const guild = await client.guilds.fetch(savedState.guildId);
            let category;
            try {
                category = await guild.channels.fetch(savedState.categoryId);
            } catch {
                logger.warn('Category not found, creating new one', { guildId: savedState.guildId });
                category = await guild.channels.create({
                    name: 'Werewolf Game',
                    type: 4, // CategoryChannel
                    position: 0
                });
            }
            let werewolfChannel = null;
            let deadChannel = null;

            // Restore/recreate werewolf channel
            if (savedState.werewolfChannelId) {
                try {
                    werewolfChannel = await guild.channels.fetch(savedState.werewolfChannelId);
                } catch {
                    // Channel doesn't exist, create new one
                    werewolfChannel = await guild.channels.create({
                        name: 'werewolf-channel',
                        type: 0,
                        parent: category,
                        permissionOverwrites: [
                            {
                                id: guild.id,
                                deny: ['ViewChannel']
                            }
                        ]
                    });
                }
            }

            // Restore/recreate dead channel
            if (savedState.deadChannelId) {
                try {
                    deadChannel = await guild.channels.fetch(savedState.deadChannelId);
                } catch {
                    // Channel doesn't exist, create new one
                    deadChannel = await guild.channels.create({
                        name: 'dead-players',
                        type: 0,
                        parent: category,
                        permissionOverwrites: [
                            {
                                id: guild.id,
                                deny: ['ViewChannel']
                            }
                        ]
                    });
                }
            }

            // Restore channel permissions
            if (werewolfChannel && savedState.channelPermissions?.werewolfChannel) {
                for (const [userId, permissions] of Object.entries(savedState.channelPermissions.werewolfChannel)) {
                    await werewolfChannel.permissionOverwrites.create(userId, {
                        ViewChannel: true,
                        SendMessages: true
                    });
                }
            }

            if (deadChannel && savedState.channelPermissions?.deadChannel) {
                for (const [userId, permissions] of Object.entries(savedState.channelPermissions.deadChannel)) {
                    await deadChannel.permissionOverwrites.create(userId, {
                        ViewChannel: true,
                        SendMessages: true
                    });
                }
            }

            return { werewolfChannel, deadChannel };
        } catch (error) {
            logger.error('Error restoring channels', { error });
            throw error;
        }
    }

    /**
     * Restores game UI state
     */
    static async restoreUIState(game, messageIds, messageHistory) {
        try {
            const channel = await game.client.channels.fetch(game.gameChannelId);

            // For Day phase, always create fresh UI
            if (game.phase === PHASES.DAY) {
                try {
                    const channel = await game.client.channels.fetch(game.gameChannelId);

                    // First send the day phase status
                    await channel.send({
                        embeds: [createDayPhaseEmbed(game.players)]
                    });

                    // Always create fresh nomination UI
                    await dayPhaseHandler.createDayPhaseUI(channel, game.players);
                    logger.info('Recreated nomination UI');

                    // If there's an active vote, just log it
                    if (game.votingOpen && game.nominatedPlayer && game.nominator && game.seconder) {
                        logger.info('Active vote in progress', {
                            target: game.players.get(game.nominatedPlayer).username,
                            nominator: game.players.get(game.nominator).username,
                            seconder: game.players.get(game.seconder).username,
                            currentVotes: Array.from(game.votes.entries())
                        });
                    }
                } catch (error) {
                    logger.error('Failed to recreate day phase UI', { error });
                }
            } else if (game.phase === PHASES.NIGHT) {
                // For night phase, use NightActionProcessor to recreate prompts
                await game.nightActionProcessor.handleNightActions();
                logger.info('Recreated night action prompts');
            }

            // Notify players with complete state
            for (const player of game.players.values()) {
                try {
                    const roleSpecificInfo = await this.getRoleSpecificInfo(game, player);
                    await player.sendDM({
                        embeds: [{
                            color: 0x0099ff,
                            title: '🔄 Game Restored',
                            description: 
                                'The game has been restored after a brief interruption.\n\n' +
                                `Current phase: ${game.phase}\n` +
                                `Your role: ${player.role}\n` +
                                (player.isAlive ? 'You are alive' : 'You are dead') +
                                (roleSpecificInfo ? `\n\n${roleSpecificInfo}` : '') +
                                (game.phase === PHASES.NIGHT && game.expectedNightActions.has(player.id) ?
                                    '\n\nYou have a pending night action to complete.' : '') +
                                (game.votingOpen && player.isAlive ? 
                                    '\n\nThere is an active vote in progress.' : '')
                        }]
                    });
                } catch (error) {
                    logger.error('Failed to send restore notification to player', {
                        error,
                        playerId: player.id,
                        username: player.username
                    });
                }
            }

            // Send restoration confirmation to channel
            await channel.send({
                embeds: [{
                    color: 0x0099ff,
                    title: '🔄 Game State Restored',
                    description: 
                        'The game has been restored to its previous state.\n\n' +
                        `**Phase:** ${game.phase}\n` +
                        `**Round:** ${game.round}\n` +
                        `**Players Alive:** ${game.getAlivePlayers().length}/${game.players.size}`
                }]
            });

        } catch (error) {
            logger.error('Error restoring UI state', { error });
            throw error;
        }
    }

    static async getRoleSpecificInfo(game, player) {
        if (!player.isAlive) return null;

        let info = [];

        // Check if player is someone's lover (regardless of role)
        for (const [playerId, loverId] of game.lovers.entries()) {
            if (loverId === player.id) {
                const lover = game.players.get(playerId);
                info.push(`You are the lover of **${lover.username}**`);
                break;
            }
        }

        // Add role-specific info
        switch(player.role) {
            case ROLES.CUPID:
                const cupidLoverId = game.lovers.get(player.id);
                if (cupidLoverId) {
                    const lover = game.players.get(cupidLoverId);
                    info.push(`Your lover is: **${lover.username}**`);
                }
                break;
            case ROLES.WEREWOLF:
                const werewolves = Array.from(game.players.values())
                    .filter(p => p.role === ROLES.WEREWOLF && p.isAlive)
                    .map(p => p.username)
                    .filter(name => name !== player.username);
                if (werewolves.length > 0) {
                    info.push(`Your fellow werewolves are: **${werewolves.join(', ')}**`);
                } else {
                    info.push('You are the lone werewolf');
                }
                break;
            case ROLES.SEER:
                if (game.seerInvestigations) {
                    const investigations = game.seerInvestigations
                        .filter(inv => inv.seerId === player.id)
                        .map(inv => {
                            const target = game.players.get(inv.targetId);
                            if (!target) return null;
                            return inv.isInitialVision ?
                                `Initial Vision: **${target.username}** is ${inv.isWerewolf ? 'a Werewolf!' : 'Not a Werewolf.'}` :
                                `Investigation: **${target.username}** is ${inv.isWerewolf ? 'a Werewolf!' : 'Not a Werewolf.'}`;
                        })
                        .filter(Boolean);  // Remove any null entries

                    if (investigations.length > 0) {
                        info.push('Your investigations have revealed:\n' + investigations.join('\n'));
                    }
                }
                break;
        }

        return info.length > 0 ? info.join('\n') : null;
    }

    // Add this method to handle channel deletion
    static async cleanupChannels(game) {
        try {
            const guild = await game.client.guilds.fetch(game.guildId);
            const botMember = await guild.members.fetch(game.client.user.id);
            
            // Check for required permissions
            if (!botMember.permissions.has('ManageChannels')) {
                throw new GameError('Missing Permissions', 'Bot needs Manage Channels permission to cleanup game channels.');
            }

            // Delete werewolf channel
            if (game.werewolfChannel) {
                try {
                    await game.werewolfChannel.delete()
                        .catch(error => {
                            if (error.code === 50001) { // Missing Access
                                return game.werewolfChannel.delete({ force: true });
                            }
                            throw error;
                        });
                } catch (error) {
                    logger.error('Error deleting werewolf channel', { error });
                }
            }

            // Delete dead channel
            if (game.deadChannel) {
                try {
                    await game.deadChannel.delete()
                        .catch(error => {
                            if (error.code === 50001) { // Missing Access
                                return game.deadChannel.delete({ force: true });
                            }
                            throw error;
                        });
                } catch (error) {
                    logger.error('Error deleting dead channel', { error });
                }
            }
        } catch (error) {
            logger.error('Error cleaning up channels', { error });
            throw error;
        }
    }
}

module.exports = GameStateManager; 