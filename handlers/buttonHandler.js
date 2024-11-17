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
        if (interaction.user.id !== game.gameCreatorId) {
            await interaction.reply({
                content: 'Only the game creator can modify roles.',
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
        // Check authorization
        if (interaction.user.id !== game.gameCreatorId) {
            await interaction.reply({
                content: 'Only the game creator can start the game.',
                ephemeral: true
            });
            return;
        }

        // Defer the reply immediately to prevent timeout
        await interaction.deferReply({ ephemeral: true });
        
        try {
            // Start the game
            await game.startGame();
            
            // Edit the deferred reply
            await interaction.editReply('Game started successfully!');
        } catch (error) {
            // If there's an error, edit the deferred reply with the error message
            if (error instanceof GameError) {
                await interaction.editReply(error.userMessage);
            } else {
                logger.error('Error starting game', { error });
                await interaction.editReply('Failed to start game.');
            }
        }
    } catch (error) {
        // Only try to reply if we haven't already
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: error instanceof GameError ? error.userMessage : 'Failed to start game.',
                ephemeral: true
            });
        }
        logger.error('Error in handleStartGame', { error });
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

module.exports = {
    handleJoinGame,
    handleToggleRole,
    handleViewRoles,
    handleStartGame,
    handleResetRoles
};
