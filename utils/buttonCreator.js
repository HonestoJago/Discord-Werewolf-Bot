const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const ROLES = require('../constants/roles');

function createRoleButtons() {
    const roleButtons = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('toggle_bodyguard')
                .setLabel('🛡️ Bodyguard')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('toggle_cupid')
                .setLabel('💘 Cupid')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('toggle_hunter')
                .setLabel('🏹 Hunter')
                .setStyle(ButtonStyle.Secondary)
        );

    const utilityButtons = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('view_roles')
                .setLabel('📋 View Setup')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('reset_roles')
                .setLabel('🔄 Reset')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('start_game')
                .setLabel('▶️ Start Game')
                .setStyle(ButtonStyle.Success)
        );

    return [roleButtons, utilityButtons];
}

module.exports = { createRoleButtons };
