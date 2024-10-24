const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const ROLES = require('../constants/roles');

function createRoleButtons() {
    const addButtons = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('add_werewolf')
                .setLabel('➕ Werewolf')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('add_seer')
                .setLabel('➕ Seer')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('add_doctor')
                .setLabel('➕ Doctor')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('add_cupid')
                .setLabel('➕ Cupid')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('add_villager')
                .setLabel('➕ Villager')
                .setStyle(ButtonStyle.Secondary)
        );

    const removeButtons = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('remove_werewolf')
                .setLabel('➖ Werewolf')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('remove_seer')
                .setLabel('➖ Seer')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('remove_doctor')
                .setLabel('➖ Doctor')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('remove_cupid')
                .setLabel('➖ Cupid')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('remove_villager')
                .setLabel('➖ Villager')
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
