const logger = require('../utils/logger');
const { GameError } = require('../utils/error-handler');
const ROLES = require('../constants/roles');
const { EmbedBuilder } = require('discord.js');

async function handleAddRole(interaction, game) {
    try {
        // Add debug logging
        logger.info('Adding role', { 
            currentPhase: game.getPhase(),
            isLobby: game.isInLobby()
        });

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

        game.addRole(role);
        await interaction.deferUpdate();
        
        // Log after role addition
        logger.info('Role added successfully', { 
            role,
            currentPhase: game.getPhase(),
            isLobby: game.isInLobby()
        });
    } catch (error) {
        logger.error('Error adding role', {
            error,
            currentPhase: game.getPhase(),
            isLobby: game.isInLobby()
        });
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
