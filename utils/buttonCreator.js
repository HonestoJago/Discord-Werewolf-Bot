const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const ROLES = require('../constants/roles');

function createGameSetupButtons(selectedRoles = new Map()) {
    const rows = [];

    // Join button row
    const joinRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('join')
            .setLabel('Join the Hunt')
            .setStyle(ButtonStyle.Success)
            .setEmoji('🐺')
    );
    rows.push(joinRow);

    // Optional role toggle buttons
    const roleButtons = [];
    for (const roleType of Object.values(ROLES)) {
        if (roleType === ROLES.WEREWOLF || roleType === ROLES.SEER || roleType === ROLES.VILLAGER) {
            continue; // Skip mandatory roles
        }

        const isSelected = selectedRoles.has(roleType);
        roleButtons.push(
            new ButtonBuilder()
                .setCustomId(`${isSelected ? 'remove' : 'add'}_${roleType}`)
                .setLabel(roleType)
                .setStyle(isSelected ? ButtonStyle.Success : ButtonStyle.Secondary)
        );
    }

    // Split role buttons into rows of 5
    for (let i = 0; i < roleButtons.length; i += 5) {
        rows.push(
            new ActionRowBuilder().addComponents(roleButtons.slice(i, i + 5))
        );
    }

    // Control buttons row
    const controlRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('view')
            .setLabel('View Setup')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('📜'),
        new ButtonBuilder()
            .setCustomId('view_info')
            .setLabel('View Role Info')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('ℹ️'),
        new ButtonBuilder()
            .setCustomId('reset')
            .setLabel('Reset Roles')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🔄'),
        new ButtonBuilder()
            .setCustomId('start')
            .setLabel('Begin the Hunt')
            .setStyle(ButtonStyle.Success)
            .setEmoji('🌕')
    );
    rows.push(controlRow);

    return rows;
}

function createRoleToggleButtons(selectedRoles = new Map()) {
    const rows = [];
    const roleButtons = [];

    for (const roleType of Object.values(ROLES)) {
        if (roleType === ROLES.WEREWOLF || roleType === ROLES.SEER || roleType === ROLES.VILLAGER) {
            continue; // Skip mandatory roles
        }

        const isSelected = selectedRoles.has(roleType);
        roleButtons.push(
            new ButtonBuilder()
                .setCustomId(`${isSelected ? 'remove' : 'add'}_${roleType}`)
                .setLabel(roleType)
                .setStyle(isSelected ? ButtonStyle.Success : ButtonStyle.Secondary)
        );
    }

    // Split role buttons into rows of 5
    for (let i = 0; i < roleButtons.length; i += 5) {
        rows.push(
            new ActionRowBuilder().addComponents(roleButtons.slice(i, i + 5))
        );
    }

    // Add control buttons
    const controlRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('view')
            .setLabel('View Role Info')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('reset')
            .setLabel('Reset Roles')
            .setStyle(ButtonStyle.Danger)
    );
    rows.push(controlRow);

    return rows;
}

module.exports = {
    createGameSetupButtons,
    createRoleToggleButtons
};
