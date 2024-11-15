const logger = require('../utils/logger');
const { GameError } = require('../utils/error-handler');
const ROLES = require('../constants/roles');
const { EmbedBuilder, ButtonStyle } = require('discord.js');
const GameManager = require('../utils/gameManager');
const { createGameSetupButtons } = require('../utils/buttonCreator');
const { createGameWelcomeEmbed } = require('../utils/embedCreator');

async function handleJoinGame(interaction, game) {
    try {
        // Add the player to the game
        await game.addPlayer(interaction.user);
        await interaction.reply({
            content: 'You have joined the game!',
            ephemeral: true
        });
    } catch (error) {
        logger.error('Error joining game', { error });
        await interaction.reply({
            content: error instanceof GameError ? error.userMessage : 'Failed to join the game.',
            ephemeral: true
        });
    }
}

async function handleToggleRole(interaction, game) {
    try {
        // Check authorization
        if (!game.isGameCreatorOrAuthorized(interaction.user.id)) {
            await interaction.reply({
                content: 'You are not authorized to modify roles.',
                ephemeral: true
            });
            return;
        }

        // Extract role from customId (format: 'toggle_rolename')
        const role = interaction.customId.split('_')[1];
        if (!Object.values(ROLES).includes(role)) {
            await interaction.reply({
                content: 'Invalid role selected.',
                ephemeral: true
            });
            return;
        }

        const currentCount = game.selectedRoles.get(role) || 0;

        try {
            // Create new button components based on current message
            const newComponents = interaction.message.components.map(row => {
                const newRow = {
                    type: 1,
                    components: row.components.map(button => {
                        // Convert to plain object if it's not already
                        const buttonData = button.toJSON ? button.toJSON() : button;
                        
                        if (buttonData.custom_id === interaction.customId) {
                            if (currentCount === 0) {
                                game.addRole(role);
                                return {
                                    ...buttonData,
                                    style: ButtonStyle.Primary
                                };
                            } else {
                                game.removeRole(role);
                                return {
                                    ...buttonData,
                                    style: ButtonStyle.Secondary
                                };
                            }
                        }
                        return buttonData;
                    })
                };
                return newRow;
            });

            // Update the message with new components
            await interaction.update({ components: newComponents });

        } catch (error) {
            logger.error('Error updating button', { error });
            await interaction.reply({
                content: error instanceof GameError ? error.userMessage : 'Failed to toggle role.',
                ephemeral: true
            });
        }
    } catch (error) {
        logger.error('Error toggling role', { error });
        await interaction.reply({
            content: error instanceof GameError ? error.userMessage : 'Failed to toggle role.',
            ephemeral: true
        });
    }
}

async function handleViewRoles(interaction, game) {
    const playerCount = game.players.size;
    const werewolfCount = Math.floor(playerCount / 4);
    const villagerCount = Math.max(0, playerCount - werewolfCount - 1  // -1 for Seer
        - (game.selectedRoles.get(ROLES.BODYGUARD) || 0)
        - (game.selectedRoles.get(ROLES.CUPID) || 0)
        - (game.selectedRoles.get(ROLES.HUNTER) || 0));

    const embed = new EmbedBuilder()
        .setColor('#800000')
        .setTitle('📜 Village Registry')
        .setDescription('*The elder reviews the gathering...*')
        .addFields(
            { 
                name: '🎭 Villagers Present', 
                value: playerCount === 0 ? 
                    '*The village square stands empty...*' :
                    Array.from(game.players.values())
                        .map(player => `• ${player.username}`)
                        .join('\n'),
                inline: false 
            },
            { 
                name: '🌙 Basic Roles',
                value: playerCount === 0 ?
                    '*Waiting for villagers to gather...*' :
                    `🐺 Werewolves: ${werewolfCount}\n` +
                    `👁️ Seer: 1\n` +
                    `👥 Villagers: ${villagerCount}`,
                inline: true
            },
            { 
                name: '⚔️ Optional Roles', 
                value: Array.from(game.selectedRoles.entries())
                    .filter(([role]) => ![ROLES.WEREWOLF, ROLES.SEER].includes(role))
                    .map(([role, count]) => {
                        const roleIcons = {
                            [ROLES.BODYGUARD]: '🛡️',
                            [ROLES.CUPID]: '💘',
                            [ROLES.HUNTER]: '🏹'
                        };
                        return `${roleIcons[role]} ${role}: ${count}`;
                    })
                    .join('\n') || '*No optional roles selected*',
                inline: true 
            }
        )
        .setFooter({ text: 'May the fates be kind to the innocent...' });

    await interaction.reply({
        embeds: [embed],
        ephemeral: true
    });
}

async function handleStartGame(interaction, game) {
    try {
        // Defer the reply immediately to prevent timeout
        await interaction.deferReply({ ephemeral: true });
        
        // Start the game
        await game.startGame();
        
        // Edit the deferred reply
        await interaction.editReply('Game started successfully!');
    } catch (error) {
        logger.error('Error starting game', { error });
        if (interaction.deferred) {
            await interaction.editReply('Failed to start game.');
        } else {
            await interaction.reply({ content: 'Failed to start game.', ephemeral: true });
        }
    }
}

async function handleResetRoles(interaction, game) {
    if (interaction.user.id !== game.gameCreatorId) {
        await interaction.reply({
            content: 'Only the game creator can reset roles.',
            ephemeral: true
        });
        return;
    }

    try {
        game.selectedRoles = new Map();
        await interaction.reply({
            content: 'All roles have been reset.',
            ephemeral: true
        });
    } catch (error) {
        await interaction.reply({
            content: error instanceof GameError ? error.userMessage : 'Failed to reset roles.',
            ephemeral: true
        });
    }
}

async function handleNewGame(interaction, game) {
    try {
        // Cleanup existing game
        await GameManager.cleanupGame(interaction.client, interaction.guildId);
        
        // Create new game
        const newGame = await GameManager.createGame(
            interaction.client,
            interaction.guildId,
            interaction.channelId,
            interaction.user.id
        );
        
        // Store new game
        interaction.client.games.set(interaction.guildId, newGame);

        // Update UI
        await interaction.update({
            embeds: [createGameWelcomeEmbed()],
            components: createGameSetupButtons()
        });

        logger.info('New game created via button', {
            guildId: interaction.guildId,
            creatorId: interaction.user.id
        });
    } catch (error) {
        logger.error('Error creating new game', { error });
        await interaction.reply({
            content: 'Failed to create new game. Please try using `/create` instead.',
            ephemeral: true
        });
    }
}

async function handleEndGame(interaction, game) {
    try {
        const client = interaction.client;
        await client.endGame(interaction.guildId);
        
        // Update message to remove buttons
        await interaction.message.edit({
            components: []
        });
        
        await interaction.reply('Game ended and channels cleaned up.');
    } catch (error) {
        logger.error('Error ending game', { error });
        await interaction.reply({
            content: 'Failed to end game.',
            ephemeral: true
        });
    }
}

module.exports = {
    handleJoinGame,
    handleToggleRole,
    handleViewRoles,
    handleStartGame,
    handleResetRoles,
    handleNewGame,
    handleEndGame
};
