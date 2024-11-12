const logger = require('../utils/logger');
const { GameError } = require('../utils/error-handler');
const ROLES = require('../constants/roles');
const { EmbedBuilder, ButtonStyle } = require('discord.js');

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
    // Get current role counts
    const roleSetup = Array.from(game.selectedRoles.entries())
        .map(([role, count]) => `${role}: ${count}`)
        .join('\n');

    // Get current player list
    const playerList = Array.from(game.players.values())
        .map(player => player.username)
        .join('\n');

    // Calculate automatic roles
    const playerCount = game.players.size;
    
    // Only show role calculations if there are players
    let roleBreakdown;
    if (playerCount === 0) {
        roleBreakdown = 'Waiting for players to join...';
    } else {
        const werewolfCount = Math.floor(playerCount / 4);
        const villagerCount = Math.max(0, playerCount - werewolfCount - 1  // -1 for Seer
            - (game.selectedRoles.get(ROLES.DOCTOR) || 0)
            - (game.selectedRoles.get(ROLES.CUPID) || 0)
            - (game.selectedRoles.get(ROLES.HUNTER) || 0));  // Subtract Hunter from villager count

        roleBreakdown = `Seer: 1\nWerewolves: ${werewolfCount}\nVillagers: ${villagerCount}`;
    }

    const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('Game Setup')
        .addFields(
            { 
                name: 'Current Players', 
                value: playerList || 'No players yet', 
                inline: false 
            },
            { 
                name: 'Player Count', 
                value: `${playerCount} players`, 
                inline: true 
            },
            {
                name: 'Automatic Roles',
                value: roleBreakdown,
                inline: true
            },
            { 
                name: 'Optional Roles', 
                value: roleSetup || 'No optional roles selected', 
                inline: true 
            }
        )
        .setTimestamp();

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

module.exports = {
    handleJoinGame,
    handleToggleRole,
    handleViewRoles,
    handleStartGame,
    handleResetRoles
};
