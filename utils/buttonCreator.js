const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const ROLES = require('../constants/roles');

function createRoleButtons() {
    const addButtons = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('add_bodyguard')
                .setLabel('➕ Bodyguard')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('add_cupid')
                .setLabel('➕ Cupid')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('add_hunter')
                .setLabel('➕ Hunter')
                .setStyle(ButtonStyle.Secondary)
        );

    const removeButtons = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('remove_bodyguard')
                .setLabel('➖ Bodyguard')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('remove_cupid')
                .setLabel('➖ Cupid')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('remove_hunter')
                .setLabel('➖ Hunter')
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

    return [addButtons, removeButtons, utilityButtons];
}

module.exports = { createRoleButtons };
