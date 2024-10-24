const logger = require('../utils/logger');
const { GameError } = require('../utils/error-handler');
const ROLES = require('../constants/roles');

async function handleAddRole(interaction, game) {
    // Check authorization
    if (interaction.user.id !== game.gameCreatorId) {
        await interaction.reply({
            content: 'You are not authorized to modify roles.',
            ephemeral: true
        });
        return;
    }

    // Extract role from customId (format: 'add_rolename')
    const role = interaction.customId.split('_')[1];
    if (!Object.values(ROLES).includes(role)) {
        await interaction.reply({
            content: 'Invalid role selected.',
            ephemeral: true
        });
        return;
    }

    try {
        game.addRole(role);
        await interaction.deferUpdate();
    } catch (error) {
        await interaction.reply({
            content: error instanceof GameError ? error.userMessage : 'Failed to add role.',
            ephemeral: true
        });
    }
}

async function handleRemoveRole(interaction, game) {
    if (interaction.user.id !== game.gameCreatorId) {
        await interaction.reply({
            content: 'You are not authorized to modify roles.',
            ephemeral: true
        });
        return;
    }

    const role = interaction.customId.split('_')[1];
    try {
        game.removeRole(role);
        await interaction.deferUpdate();
    } catch (error) {
        await interaction.reply({
            content: error instanceof GameError ? error.userMessage : 'Failed to remove role.',
            ephemeral: true
        });
    }
}

async function handleViewRoles(interaction, game) {
    const roles = Array.from(game.selectedRoles.entries())
        .map(([role, count]) => `${role}: ${count}`)
        .join('\n');

    await interaction.reply({
        content: roles.length > 0 ? 
            `Current Roles:\n${roles}` : 
            'No roles configured yet.',
        ephemeral: true
    });
}

async function handleStartGame(interaction, game) {
    if (interaction.user.id !== game.gameCreatorId) {
        await interaction.reply({
            content: 'Only the game creator can start the game.',
            ephemeral: true
        });
        return;
    }

    try {
        await game.startGame();
        await interaction.reply('Game has started! Check your DMs for your role information.');
    } catch (error) {
        await interaction.reply({
            content: error instanceof GameError ? error.userMessage : 'Failed to start game.',
            ephemeral: true
        });
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
    handleAddRole,
    handleRemoveRole,
    handleViewRoles,
    handleStartGame,
    handleResetRoles
};
