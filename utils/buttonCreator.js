const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const ROLES = require('../constants/roles');

// Create all buttons in one place to ensure consistency
const createJoinButton = () => new ButtonBuilder()
    .setCustomId('join')
    .setLabel('🎮 Join the Hunt')
    .setStyle(ButtonStyle.Success);

const createRoleButton = (role) => {
    const roleIcons = {
        [ROLES.BODYGUARD]: '🛡️',
        [ROLES.CUPID]: '💘',
        [ROLES.HUNTER]: '🏹'
    };
    
    return new ButtonBuilder()
        .setCustomId(`toggle_${role}`)
        .setLabel(`${roleIcons[role]} ${role}`)
        .setStyle(ButtonStyle.Secondary);
};

const createViewButton = () => new ButtonBuilder()
    .setCustomId('view')
    .setLabel('📜 View Setup')
    .setStyle(ButtonStyle.Secondary);

const createResetButton = () => new ButtonBuilder()
    .setCustomId('reset')
    .setLabel('🔄 Reset Roles')
    .setStyle(ButtonStyle.Secondary);

const createStartButton = () => new ButtonBuilder()
    .setCustomId('start')
    .setLabel('🌕 Begin the Hunt')
    .setStyle(ButtonStyle.Danger);

function createGameSetupButtons() {
    // Create all rows
    const joinRow = new ActionRowBuilder()
        .addComponents(createJoinButton());

    const roleRow = new ActionRowBuilder()
        .addComponents(
            createRoleButton(ROLES.BODYGUARD),
            createRoleButton(ROLES.CUPID),
            createRoleButton(ROLES.HUNTER)
        );

    const controlRow = new ActionRowBuilder()
        .addComponents(
            createViewButton(),
            createResetButton(),
            createStartButton()
        );

    return [joinRow, roleRow, controlRow];
}

module.exports = {
    createGameSetupButtons,
    // Export individual creators in case they're needed elsewhere
    createJoinButton,
    createRoleButton,
    createViewButton,
    createResetButton,
    createStartButton
};
