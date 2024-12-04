const Player = require('../game/Player');
console.log('Player class:', Player);
const Game = require('../models/Game');
const { GameError } = require('./error-handler');
const { DiscordAPIError, ButtonBuilder, ActionRowBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const logger = require('./logger');
const PHASES = require('../constants/phases');
const ROLES = require('../constants/roles');
const { createDayPhaseEmbed, createHunterRevengeEmbed, createHunterTensionEmbed } = require('./embedCreator');

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
                actionLog: game.actionLog || {},
                setupMessageId: game.setupMessageId,
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
            
            console.log('Saved state:', savedState);

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

                // Restore players
                for (const [playerId, playerData] of Object.entries(savedState.players)) {
                    const player = new Player(
                        playerData.discordId,
                        playerData.username,
                        client,
                        playerData.discriminator
                    );
                    
                    player.role = playerData.role;
                    player.isAlive = playerData.isAlive;
                    player.isProtected = playerData.isProtected;
                    player.lastAction = playerData.lastAction;
                    player.actionTarget = playerData.actionTarget;

                    game.players.set(playerId, player);
                }

                // Restore night state
                if (savedState.phase === PHASES.NIGHT) {
                    // Restore completed and expected actions
                    game.completedNightActions = new Set(savedState.nightState.completedActions || []);
                    game.expectedNightActions = new Set(savedState.nightState.expectedActions || []);
                    game.nightActions = savedState.nightState.pendingActions || {};
                    game.lastProtectedPlayer = savedState.nightState.lastProtectedPlayer;
                }

                // Only send night action prompts once, and only to players who haven't acted
                if (savedState.phase === PHASES.NIGHT) {
                    const pendingPlayers = Array.from(savedState.nightState.expectedActions || [])
                        .filter(id => !game.completedNightActions.has(id));
                    
                    if (pendingPlayers.length > 0) {
                        logger.info('Restored night action prompts', {
                            pendingPlayers
                        });
                        // Don't call handleNightActions here - we'll do it after UI restoration
                    }
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

                // Restore role-specific history
                if (savedState.roleHistory?.seer?.investigations) {
                    game.seerInvestigations = savedState.roleHistory.seer.investigations;
                    logger.info('Restored Seer investigations', {
                        investigationCount: savedState.roleHistory.seer.investigations.length
                    });
                }

                if (savedState.roleHistory?.sorcerer?.investigations) {
                    game.sorcererInvestigations = savedState.roleHistory.sorcerer.investigations;
                    logger.info('Restored Sorcerer investigations', {
                        investigationCount: savedState.roleHistory.sorcerer.investigations.length
                    });
                }

                if (savedState.roleHistory?.bodyguard?.protections) {
                    game.bodyguardProtections = savedState.roleHistory.bodyguard.protections;
                }

                if (savedState.roleHistory?.minion?.revealedWerewolves) {
                    game.minionRevealedWerewolves = savedState.roleHistory.minion.revealedWerewolves;
                    logger.info('Restored Minion information', {
                        revealCount: savedState.roleHistory.minion.revealedWerewolves.length
                    });
                }

                logger.info('Game state restored successfully', {
                    guildId,
                    phase: game.phase,
                    playerCount: game.players.size
                });

                // After restoring all basic state, check for pending Hunter revenge
                if (game.pendingHunterRevenge) {
                    const hunter = game.players.get(game.pendingHunterRevenge);
                    if (hunter) {
                        // Re-create and send the Hunter's revenge UI
                        const validTargets = Array.from(game.players.values())
                            .filter(p => p.isAlive && p.id !== hunter.id)
                            .map(p => ({
                                label: p.username,
                                value: p.id,
                                description: `Take ${p.username} with you`
                            }));

                        const selectMenu = new StringSelectMenuBuilder()
                            .setCustomId('hunter_revenge')
                            .setPlaceholder('Choose your target')
                            .addOptions(validTargets);

                        const row = new ActionRowBuilder().addComponents(selectMenu);

                        // Send DM to Hunter with dropdown
                        await hunter.sendDM({
                            embeds: [createHunterRevengeEmbed()],
                            components: [row]
                        });

                        // Send mysterious message to village
                        await game.broadcastMessage({
                            embeds: [createHunterTensionEmbed(true)]
                        });

                        logger.info('Restored Hunter revenge UI', {
                            hunterId: hunter.id,
                            hunterName: hunter.username
                        });
                    }
                }

                // Only now handle night actions if needed
                if (savedState.phase === PHASES.NIGHT) {
                    const pendingPlayers = Array.from(game.expectedNightActions)
                        .filter(id => !game.completedNightActions.has(id));
                    
                    if (pendingPlayers.length > 0) {
                        await game.nightActionProcessor.handleNightActions();
                    }
                }

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
            // Improve error logging with full details
            logger.error('Error restoring game state', {
                error: {
                    name: error.name,
                    message: error.message,
                    stack: error.stack,
                    code: error.code
                },
                guildId,
                phase: savedState?.phase,
                lastUpdated: savedState?.lastUpdated
            });

            // Clean up failed game
            try {
                await Game.destroy({ where: { guildId } });
                logger.info('Cleaned up failed game state', { guildId });
            } catch (cleanupError) {
                logger.error('Error cleaning up failed game', {
                    error: {
                        name: cleanupError.name,
                        message: cleanupError.message,
                        stack: cleanupError.stack
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

            // For Day phase, restore nomination state first
            if (game.phase === PHASES.DAY) {
                await game.restoreNominationState();

                // Then create fresh UI components
                try {
                    await channel.send({
                        embeds: [createDayPhaseEmbed(game.players)]
                    });

                    // Create nomination UI only if no active nomination
                    if (!game.nominatedPlayer) {
                        await game.voteProcessor.createDayPhaseUI(channel, game.players);
                    }
                    
                    logger.info('Recreated day phase UI');
                } catch (error) {
                    logger.error('Failed to recreate day phase UI', { error });
                }
            }

            // Send a single restoration message to the game channel
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

            // Send a single notification to each player
            for (const player of game.players.values()) {
                try {
                    const roleSpecificInfo = await this.getRoleSpecificInfo(game, player);
                    const hasPendingAction = game.phase === PHASES.NIGHT && 
                        game.expectedNightActions.has(player.id) && 
                        !game.completedNightActions.has(player.id);

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
                                (hasPendingAction ? '\n\nYou have a pending night action to complete.' : '') +
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
            case ROLES.MINION:
                const knownWerewolves = Array.from(game.players.values())
                    .filter(p => p.role === ROLES.WEREWOLF)
                    .map(p => p.username);
                if (knownWerewolves.length > 0) {
                    info.push(`The werewolves are: **${knownWerewolves.join(', ')}**`);
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
            case ROLES.SORCERER:
                if (game.sorcererInvestigations) {
                    const investigations = game.sorcererInvestigations
                        .filter(inv => inv.sorcererId === player.id)
                        .map(inv => {
                            const target = game.players.get(inv.targetId);
                            if (!target) return null;
                            return `Investigation: **${target.username}** is ${inv.isSeer ? 'the Seer!' : 'Not the Seer.'}`;
                        })
                        .filter(Boolean);

                    if (investigations.length > 0) {
                        info.push('Your dark visions have revealed:\n' + investigations.join('\n'));
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
            let channelsDeleted = 0;
            
            // Only delete the specific werewolf channel for this game
            if (game.werewolfChannel?.id) {
                try {
                    const channel = await guild.channels.fetch(game.werewolfChannel.id)
                        .catch(error => {
                            if (error.code === 10003) { // Unknown Channel
                                logger.info('Werewolf channel already deleted', { 
                                    channelId: game.werewolfChannel.id 
                                });
                                return null;
                            }
                            throw error;
                        });
                    
                    if (channel) {
                        await channel.delete();
                        channelsDeleted++;
                        logger.info('Deleted werewolf channel', { 
                            channelId: game.werewolfChannel.id 
                        });
                    }
                } catch (error) {
                    if (error.code !== 10003) { // Only log if not "Unknown Channel"
                        logger.error('Failed to delete werewolf channel', { 
                            error,
                            channelId: game.werewolfChannel.id
                        });
                    }
                }
            }

            // Similar handling for dead channel
            if (game.deadChannel?.id) {
                try {
                    const channel = await guild.channels.fetch(game.deadChannel.id)
                        .catch(error => {
                            if (error.code === 10003) {
                                logger.info('Dead channel already deleted', { 
                                    channelId: game.deadChannel.id 
                                });
                                return null;
                            }
                            throw error;
                        });

                    if (channel) {
                        await channel.delete();
                        channelsDeleted++;
                        logger.info('Deleted dead channel', { 
                            channelId: game.deadChannel.id 
                        });
                    }
                } catch (error) {
                    if (error.code !== 10003) {
                        logger.error('Failed to delete dead channel', { 
                            error,
                            channelId: game.deadChannel.id
                        });
                    }
                }
            }

            logger.info('Game channels cleanup completed', {
                guildId: game.guildId,
                werewolfChannelId: game.werewolfChannel?.id,
                deadChannelId: game.deadChannel?.id,
                channelsDeleted
            });

        } catch (error) {
            logger.error('Error in channel cleanup', { error });
            throw error;
        }
    }
}

module.exports = GameStateManager; 