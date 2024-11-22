const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const ROLES = require('../constants/roles');

function createGameSetupButtons(selectedRoles = new Map(), requireDmCheck = true) {
    const rows = [];

    // First row: Join, Ready, and DM Check Toggle buttons
    const joinRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('join')
            .setLabel('Join the Hunt')
            .setStyle(ButtonStyle.Success)
            .setEmoji('🐺'),
        new ButtonBuilder()
            .setCustomId('ready')
            .setLabel('Ready')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('✅'),
        new ButtonBuilder()
            .setCustomId('toggle_dm')
            .setLabel(`DM Check: ${requireDmCheck ? 'ON' : 'OFF'}`)
            .setStyle(requireDmCheck ? ButtonStyle.Secondary : ButtonStyle.Success)
            .setEmoji('📨')
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

// Update ready button style based on player's ready status
function updateReadyButton(isReady) {
    return new ButtonBuilder()
        .setCustomId('ready')
        .setLabel(isReady ? 'Ready!' : 'Ready')
        .setStyle(isReady ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setEmoji('✅');
}

function createSecondButton(targetId) {
    const secondButton = new ButtonBuilder()
        .setCustomId(`second_${targetId}`)
        .setLabel('Second This Nomination')
        .setStyle(ButtonStyle.Primary);

    return new ActionRowBuilder().addComponents(secondButton);
}

function createVotingButtons(targetId) {
    const lynchButton = new ButtonBuilder()
        .setCustomId(`vote_${targetId}_guilty`)
        .setLabel('Lynch')
        .setStyle(ButtonStyle.Danger);

    const spareButton = new ButtonBuilder()
        .setCustomId(`vote_${targetId}_innocent`)
        .setLabel('Let Live')
        .setStyle(ButtonStyle.Success);

    return new ActionRowBuilder().addComponents(lynchButton, spareButton);
}

module.exports = {
    createGameSetupButtons,
    updateReadyButton,
    createSecondButton,
    createVotingButtons
};
