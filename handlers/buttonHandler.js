const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const { GameError } = require('../utils/error-handler');
const logger = require('../utils/logger');
const WerewolfGame = require('../game/WerewolfGame');
const { createRoleToggleButtons, createGameSetupButtons, updateReadyButton } = require('../utils/buttonCreator');
const { createRoleInfoEmbed, createGameWelcomeEmbed } = require('../utils/embedCreator');
const ROLES = require('../constants/roles');
const GameStateManager = require('../utils/gameStateManager');

async function handleJoinGame(interaction, game) {
    try {
        const isAlreadyInGame = game.players.has(interaction.user.id);
        
        if (isAlreadyInGame) {
            // Remove player from game
            game.players.delete(interaction.user.id);
        } else {
            // Add player to game
            await game.addPlayer(interaction.user);
        }

        // Create updated embed with current player list showing ready status
        const setupEmbed = {
            ...createGameWelcomeEmbed(),
            fields: [
                ...createGameWelcomeEmbed().fields,
                ...createStatusFields(game)
            ]
        };

        // Get buttons from buttonCreator - it already includes the ready button
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

        // Send ephemeral confirmation to the player
        await interaction.reply({
            content: `You have ${isAlreadyInGame ? 'left' : 'joined'} the game.`,
            ephemeral: true
        });

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

        // Toggle ready status
        player.isReady = !player.isReady;

        // Update the embed to show new ready status
        const setupEmbed = {
            ...createGameWelcomeEmbed(),
            fields: [
                ...createGameWelcomeEmbed().fields,
                ...createStatusFields(game)
            ]
        };

        // Get buttons - but don't modify the ready button's appearance
        const buttons = createGameSetupButtons(game.selectedRoles);

        // Check if everyone is ready
        const allReady = Array.from(game.players.values()).every(p => p.isReady);
        if (allReady) {
            setupEmbed.fields.push({
                name: '🎮 Game Ready!',
                value: 'All players are ready. Game creator can start when ready.',
                inline: false
            });

            if (game.players.size < 4) {
                setupEmbed.fields.push({
                    name: '⚠️ Need More Players',
                    value: `${4 - game.players.size} more players needed to start.`,
                    inline: false
                });
            }
        } else {
            // Show who we're waiting for
            const unreadyPlayers = Array.from(game.players.values())
                .filter(p => !p.isReady)
                .map(p => p.username);
            
            setupEmbed.fields.push({
                name: '⏳ Waiting For',
                value: unreadyPlayers.join('\n'),
                inline: false
            });
        }

        // Add role distribution preview
        if (game.players.size >= 4) {
            const rolePreview = calculateRoleDistribution(game.players.size, game.selectedRoles);
            setupEmbed.fields.push({
                name: '🎭 Role Distribution',
                value: Object.entries(rolePreview)
                    .map(([role, count]) => `${role}: ${count}`)
                    .join('\n'),
                inline: false
            });
        }

        // Update the message
        await interaction.update({
            embeds: [setupEmbed],
            components: buttons
        });

        await game.saveGameState();

        // Send ephemeral confirmation to the player
        await interaction.followUp({
            content: `You are now ${player.isReady ? 'ready' : 'not ready'}.`,
            ephemeral: true
        });

        logger.info('Player ready status changed', {
            playerId: player.id,
            username: player.username,
            isReady: player.isReady
        });

    } catch (error) {
        logger.error('Error handling ready toggle', { error });
        throw error;
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
    return Array.from(players.values())
        .map(p => {
            const readyStatus = p.isReady ? '✅' : '⏳';
            return `**${p.username}** ${readyStatus}`;  // Bold names for visibility
        })
        .join('\n');
}

// Helper function to create status fields
function createStatusFields(game) {
    const fields = [];
    
    // Player list with clear ready status
    fields.push({
        name: `👥 Current Players (${game.players.size})`,
        value: game.players.size > 0 ?
            formatPlayerList(game.players) :
            '*No players yet...*',
        inline: false
    });

    // Game status section
    const allReady = Array.from(game.players.values()).every(p => p.isReady);
    if (allReady) {
        fields.push({
            name: '🎮 Ready to Start!',
            value: game.players.size >= 4 ?
                '```diff\n+ All players are ready! Game creator can start the game.\n```' :
                '```fix\nNeed ' + (4 - game.players.size) + ' more players to start.\n```',
            inline: false
        });
    } else {
        const unreadyPlayers = Array.from(game.players.values())
            .filter(p => !p.isReady)
            .map(p => `**${p.username}**`)
            .join('\n');
        
        fields.push({
            name: '⏳ Waiting For',
            value: '```fix\nThe following players need to ready up:\n```' + unreadyPlayers,
            inline: false
        });
    }

    return fields;
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
    handleReadyToggle
};
