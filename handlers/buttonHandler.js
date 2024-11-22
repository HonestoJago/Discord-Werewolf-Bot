const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const { GameError } = require('../utils/error-handler');
const logger = require('../utils/logger');
const WerewolfGame = require('../game/WerewolfGame');
const { createRoleToggleButtons, createGameSetupButtons, updateReadyButton } = require('../utils/buttonCreator');
const { createRoleInfoEmbed, createGameWelcomeEmbed, createVotingEmbed } = require('../utils/embedCreator');
const ROLES = require('../constants/roles');
const GameStateManager = require('../utils/gameStateManager');
const Game = require('../models/Game');

async function handleJoinGame(interaction, game) {
    try {
        const isAlreadyInGame = game.players.has(interaction.user.id);
        
        if (isAlreadyInGame) {
            game.players.delete(interaction.user.id);
        } else {
            await game.addPlayer(interaction.user);
        }

        // Update the embed with current player list
        const setupEmbed = {
            ...createGameWelcomeEmbed(),
            fields: [
                ...createGameWelcomeEmbed().fields,
                ...createStatusFields(game)
            ]
        };

        const setupButtons = createGameSetupButtons(game.selectedRoles);

        // Update setup message
        let setupMessage = game.setupMessageId ? 
            await interaction.channel.messages.fetch(game.setupMessageId)
                .catch(error => {
                    logger.error('Failed to fetch setup message', { error });
                    return null;
                }) 
            : null;

        if (setupMessage) {
            await setupMessage.edit({
                embeds: [setupEmbed],
                components: setupButtons
            });
        }

        // Just acknowledge the interaction
        await interaction.deferUpdate();
        await game.saveGameState();

    } catch (error) {
        logger.error('Error in handleJoinGame', { error });
        throw error;
    }
}

async function handleToggleRole(interaction, game) {
    try {
        if (!game.isGameCreatorOrAuthorized(interaction.user.id)) {
            throw new GameError('Unauthorized', 'Only the game creator can modify roles.');
        }

        const role = interaction.customId.split('_')[1];
        const isAdding = interaction.customId.startsWith('add');

        try {
            if (isAdding) {
                game.addRole(role);
            } else {
                if (game.selectedRoles.has(role)) {
                    game.removeRole(role);
                }
            }
        } catch (error) {
            logger.warn('Error toggling role', { 
                error: error.message, 
                role,
                isAdding
            });
        }

        // Update with full game setup buttons, maintaining all buttons
        await interaction.update({
            components: createGameSetupButtons(game.selectedRoles)
        });
        await game.saveGameState();

    } catch (error) {
        throw error;
    }
}

async function handleViewRoles(interaction, game) {
    try {
        const roleInfoEmbed = {
            color: 0x0099ff,
            title: 'Role Information',
            fields: [
                {
                    name: '🐺 Werewolf',
                    value: 'Vote each night to eliminate a player. Win when werewolves equal or outnumber villagers.',
                    inline: false
                },
                {
                    name: '👁️ Seer',
                    value: 'Investigate one player each night to learn if they are a werewolf.',
                    inline: false
                },
                {
                    name: '🛡️ Bodyguard',
                    value: 'Protect one player each night from werewolf attacks.',
                    inline: false
                },
                {
                    name: '💘 Cupid',
                    value: 'Choose two players to be lovers at the start. If one dies, both die.',
                    inline: false
                },
                {
                    name: '🏹 Hunter',
                    value: 'When killed, take one other player with you.',
                    inline: false
                },
                {
                    name: '🦹 Minion',
                    value: 'Know the werewolves but unknown to them. Win with werewolves.',
                    inline: false
                },
                {
                    name: '🧙 Sorcerer',
                    value: 'Each night, investigate one player to learn if they are the Seer. Win with werewolves.',
                    inline: false
                },
                {
                    name: '👥 Villager',
                    value: 'Vote during the day to eliminate suspicious players.',
                    inline: false
                }
            ]
        };

        await interaction.reply({
            embeds: [roleInfoEmbed],
            ephemeral: true
        });
    } catch (error) {
        throw error;
    }
}

async function handleViewSetup(interaction, game) {
    try {
        // Format selected roles with emojis
        const roleEmojis = {
            'bodyguard': '🛡️',
            'cupid': '💘',
            'hunter': '🏹',
            'minion': '🦹',
            'sorcerer': '🧙'
        };

        const selectedRolesFormatted = Array.from(game.selectedRoles.keys())
            .map(role => `${roleEmojis[role.toLowerCase()] || ''} ${role}`)
            .join('\n');

        const setupEmbed = {
            color: 0x0099ff,
            title: '🎮 Current Game Setup',
            fields: [
                {
                    name: '👥 Players',
                    value: game.players.size > 0 
                        ? Array.from(game.players.values())
                            .map(p => `• ${p.username}`)
                            .join('\n')
                        : 'No players yet',
                    inline: true
                },
                {
                    name: '🎭 Optional Roles',
                    value: selectedRolesFormatted || 'None selected',
                    inline: true
                }
            ],
            footer: {
                text: 'Toggle roles using the buttons below'
            }
        };

        await interaction.reply({
            embeds: [setupEmbed],
            ephemeral: true
        });
    } catch (error) {
        throw error;
    }
}

async function handleResetRoles(interaction, game) {
    try {
        if (!game.isGameCreatorOrAuthorized(interaction.user.id)) {
            throw new GameError('Unauthorized', 'Only the game creator can reset roles.');
        }

        game.selectedRoles.clear();
        await interaction.update({
            components: createGameSetupButtons()
        });
        await game.saveGameState();
    } catch (error) {
        throw error;
    }
}

async function handleStartGame(interaction, game) {
    try {
        if (!game.isGameCreatorOrAuthorized(interaction.user.id)) {
            throw new GameError('Unauthorized', 'Only the game creator can start the game.');
        }

        // Check minimum player count
        if (game.players.size < 4) {
            throw new GameError('Not enough players', 'At least 4 players are needed to start.');
        }

        // Check if all players are ready
        const unreadyPlayers = Array.from(game.players.values())
            .filter(p => !p.isReady)
            .map(p => p.username);

        if (unreadyPlayers.length > 0) {
            throw new GameError(
                'Players not ready',
                `Waiting for players to ready up:\n${unreadyPlayers.join('\n')}`
            );
        }

        await interaction.deferUpdate();
        await game.startGame();

        // Try to update the original message, but don't throw if it fails
        try {
            await interaction.editReply({
                components: [] // Remove all buttons after game starts
            });
        } catch (error) {
            // Just log interaction failures - game has already started successfully
            logger.debug('Could not update start game interaction', {
                error: error.code,
                message: error.message
            });
        }

    } catch (error) {
        // Only throw if it's a game error, not an interaction error
        if (error instanceof GameError) {
            throw error;
        }
        logger.error('Error in handleStartGame', { error });
    }
}

async function handleRestoreGame(interaction, guildId) {
    try {
        const savedGame = await Game.findByPk(guildId);
        if (!savedGame) {
            await interaction.reply({
                content: 'This game is no longer available.',
                ephemeral: true
            });
            return;
        }

        // Check against the actual creatorId stored in the database record
        if (interaction.user.id !== savedGame.creatorId) {
            await interaction.reply({
                content: 'Only the game creator can make this decision.',
                ephemeral: true
            });
            return;
        }

        await interaction.deferUpdate();

        try {
            const restoredGame = await GameStateManager.restoreGameState(interaction.client, guildId);
            if (restoredGame) {
                interaction.client.games.set(guildId, restoredGame);
                await interaction.message.edit({
                    embeds: [{
                        color: 0x00ff00,
                        title: '✅ Game Restored',
                        description: 'The game has been successfully restored.'
                    }],
                    components: []
                });
            }
        } catch (error) {
            logger.error('Error restoring game', { error, guildId });
            await interaction.message.edit({
                embeds: [{
                    color: 0xff0000,
                    title: '❌ Restoration Failed',
                    description: 'Failed to restore the game. Starting a new game might be necessary.'
                }],
                components: []
            });
        }
    } catch (error) {
        logger.error('Error handling restore button', { error });
        throw error;
    }
}

async function handleDeleteGame(interaction, guildId) {
    try {
        const savedGame = await Game.findByPk(guildId);
        if (!savedGame) {
            await interaction.reply({
                content: 'This game is no longer available.',
                ephemeral: true
            });
            return;
        }

        if (interaction.user.id !== savedGame.creatorId) {
            await interaction.reply({
                content: 'Only the game creator can make this decision.',
                ephemeral: true
            });
            return;
        }

        await interaction.deferUpdate();

        try {
            // Create minimal temp game just for channel cleanup
            const tempGame = {
                client: interaction.client,
                guildId,
                werewolfChannel: { id: savedGame.werewolfChannelId },
                deadChannel: { id: savedGame.deadChannelId }
            };

            // Clean up channels
            await GameStateManager.cleanupChannels(tempGame);

            // Delete from database
            await Game.destroy({ where: { guildId } });
            
            await interaction.message.edit({
                embeds: [{
                    color: 0xff0000,
                    title: '🗑️ Game Deleted',
                    description: 'The unfinished game and its channels have been deleted.'
                }],
                components: []
            });

        } catch (error) {
            logger.error('Error handling game deletion', { error, guildId });
            await interaction.message.edit({
                embeds: [{
                    color: 0xff0000,
                    title: '❌ Error',
                    description: 'Failed to delete the game. Please try again.'
                }],
                components: []
            });
        }
    } catch (error) {
        logger.error('Error handling delete button', { error });
        throw error;
    }
}

// Add new handler for ready button
async function handleReadyToggle(interaction, game) {
    try {
        const player = game.players.get(interaction.user.id);
        if (!player) {
            await interaction.reply({
                content: 'You must join the game first!',
                ephemeral: true
            });
            return;
        }

        await game.handleReadyCheck(interaction.user.id);
        
        // Just acknowledge the interaction
        await interaction.deferUpdate();

    } catch (error) {
        if (error instanceof GameError) {
            await interaction.reply({
                content: error.userMessage,
                ephemeral: true
            });
        } else {
            logger.error('Error handling ready toggle', { error });
            await handleCommandError(interaction, error);
        }
    }
}

// Helper function to preview role distribution
function calculateRoleDistribution(playerCount, selectedRoles) {
    const distribution = {
        'Werewolves': Math.max(1, Math.floor(playerCount / 4)),
        'Seer': 1,
        'Villagers': playerCount - 2 - selectedRoles.size // Subtract mandatory roles and optional roles
    };

    // Add selected optional roles
    for (const [role] of selectedRoles) {
        distribution[role] = 1;
    }

    return distribution;
}

// Helper function to format player list with better visual hierarchy
function formatPlayerList(players) {
    // Separate players by ready status
    const readyPlayers = [];
    const unreadyPlayers = [];
    
    players.forEach(p => {
        if (p.isReady) {
            readyPlayers.push(p.username);
        } else {
            unreadyPlayers.push(p.username);
        }
    });

    // Build sections
    const sections = [];
    
    if (readyPlayers.length > 0) {
        sections.push('```diff\n' + readyPlayers.map(name => `+ ${name}`).join('\n') + '\n```');
    }

    return sections.join('\n');
}

// Helper function to create status fields
function createStatusFields(game) {
    const fields = [];
    
    // Separate players by ready status
    const readyPlayers = [];
    const unreadyPlayers = [];
    
    game.players.forEach(p => {
        if (p.isReady) {
            readyPlayers.push(p.username);
        } else {
            unreadyPlayers.push(p.username);
        }
    });

    // Player list showing only ready players
    if (game.players.size > 0) {
        if (readyPlayers.length > 0) {
            fields.push({
                name: `✅ Confirmed Ready to Play (${readyPlayers.length})`,
                value: '```diff\n' + readyPlayers.map(name => `+ ${name}`).join('\n') + '\n```',
                inline: false
            });
        }

        // Show unready players in "Joined but not ready" section
        if (unreadyPlayers.length > 0) {
            fields.push({
                name: '⌛ Joined but Not Ready',
                value: '```ini\n' + unreadyPlayers.map(name => `[${name}]`).join('\n') + '\n```',
                inline: false
            });
        }
    } else {
        fields.push({
            name: `👥 Players`,
            value: '*No players yet...*',
            inline: false
        });
    }

    // Game status section
    const allReady = unreadyPlayers.length === 0;
    if (allReady && game.players.size > 0) {
        fields.push({
            name: '🎮 Ready to Start!',
            value: game.players.size >= 4 ?
                '```diff\n+ All players are ready! Game creator can start the game.\n```' :
                '```fix\nNeed ' + (4 - game.players.size) + ' more players to start.\n```',
            inline: false
        });
    }

    return fields;
}

// Add these new handlers
async function handleSecondButton(interaction, currentGame) {
    try {
        const targetId = interaction.customId.split('_')[1];
        
        // Try to delete the nomination message first in case the second fails
        const originalMessage = interaction.message;

        try {
            await currentGame.voteProcessor.second(interaction.user.id);
            
            await interaction.reply({ 
                content: 'You have seconded the nomination.', 
                ephemeral: true 
            });

            // Only try to delete the original message if the second was successful
            try {
                await originalMessage.delete();
            } catch (deleteError) {
                logger.warn('Could not delete nomination message', { deleteError });
            }

        } catch (error) {
            logger.error('Error processing second', { 
                error: {
                    name: error.name,
                    message: error.message,
                    stack: error.stack
                },
                userId: interaction.user.id,
                targetId: targetId
            });

            if (!interaction.replied) {
                await interaction.reply({
                    content: error instanceof GameError ? error.userMessage : 'Failed to process your action.',
                    ephemeral: true
                });
            }
        }
    } catch (error) {
        logger.error('Error in handleSecondButton', { 
            error: {
                name: error.name,
                message: error.message,
                stack: error.stack
            }
        });
        
        if (!interaction.replied) {
            await interaction.reply({
                content: 'An error occurred while processing your action.',
                ephemeral: true
            });
        }
    }
}

async function handleVoteButton(interaction, currentGame) {
    const [, targetId, vote] = interaction.customId.split('_');
    
    if (interaction.user.id === currentGame.nominatedPlayer) {
        await interaction.reply({
            content: 'You cannot vote in your own nomination.',
            ephemeral: true
        });
        return;
    }

    const voter = currentGame.players.get(interaction.user.id);
    if (!voter?.isAlive) {
        await interaction.reply({
            content: 'Only living players can vote.',
            ephemeral: true
        });
        return;
    }

    try {
        await currentGame.voteProcessor.submitVote(interaction.user.id, vote === 'guilty');
        await interaction.reply({
            content: `Your vote to ${vote === 'guilty' ? 'lynch' : 'spare'} has been recorded.`,
            ephemeral: true
        });
    } catch (error) {
        if (error.code !== 10062) {
            logger.error('Error processing vote', { error });
        }
    }
}

// Add new handler for DM check toggle
async function handleDmCheckToggle(interaction, game) {
    const snapshot = game.createGameSnapshot();
    
    try {
        // Log the attempt
        logger.info('DM check toggle attempted', {
            userId: interaction.user.id,
            isCreator: interaction.user.id === game.gameCreatorId,
            currentSetting: game.requireDmCheck
        });

        // Defer the update immediately
        await interaction.deferUpdate();

        if (!game.isGameCreatorOrAuthorized(interaction.user.id)) {
            logger.warn('Unauthorized DM check toggle attempt', {
                userId: interaction.user.id,
                creatorId: game.gameCreatorId
            });
            
            await interaction.followUp({
                content: 'Only the game creator can toggle DM check requirement.',
                ephemeral: true
            });
            return;
        }

        // Toggle state atomically
        const oldSetting = game.requireDmCheck;
        await game.toggleDmCheck();
        
        // Log the successful toggle
        logger.info('DM check requirement changed', {
            from: oldSetting,
            to: game.requireDmCheck,
            readyPlayerCount: game.readyPlayers.size,
            totalPlayers: game.players.size
        });
        
        // Update UI components after state change
        const setupMessage = await interaction.channel.messages.fetch(game.setupMessageId);
        await setupMessage.edit({
            components: createGameSetupButtons(game.selectedRoles, game.requireDmCheck)
        });

    } catch (error) {
        await game.restoreFromSnapshot(snapshot);
        logger.error('Error handling DM check toggle', { 
            error,
            userId: interaction.user.id,
            currentSetting: game.requireDmCheck,
            playerCount: game.players.size,
            readyCount: game.readyPlayers.size
        });
        
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: 'An error occurred while toggling DM check requirement.',
                ephemeral: true
            });
        }
    }
}

module.exports = {
    handleJoinGame,
    handleToggleRole,
    handleViewRoles,
    handleViewSetup,
    handleResetRoles,
    handleStartGame,
    handleRestoreGame,
    handleDeleteGame,
    handleReadyToggle,
    handleSecondButton,
    handleVoteButton,
    handleDmCheckToggle
};
