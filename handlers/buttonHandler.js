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

module.exports = {
    handleAddRole,
    handleRemoveRole,
    handleViewRoles
};
