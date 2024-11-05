const { SlashCommandBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const WerewolfGame = require('../game/WerewolfGame');
const { createRoleConfigEmbed } = require('../utils/embedCreator');
const { createRoleButtons } = require('../utils/buttonCreator');
const { GameError, handleCommandError } = require('../utils/error-handler');
const logger = require('../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('create')
        .setDescription('Create a new Werewolf game'),

    async execute(interaction) {
        try {
            // Create new game instance using client's createGame method
            const game = interaction.client.createGame(
                interaction.guildId,
                interaction.channelId,
                interaction.user.id
            );

            // Store game instance
            interaction.client.games.set(interaction.guildId, game);

            // Create thematic welcome message and configuration instructions
            const welcomeEmbed = {
                color: 0x800000, // Dark red for werewolf theme
                title: '🐺 Welcome to Werewolf 🌕',
                description: 
                    '*As darkness falls upon the village, rumors of werewolves spread through the streets...*\n\n' +
                    'You have been chosen to organize this gathering. Choose your roles wisely:\n\n' +
                    '**Role Guidelines:**\n' +
                    '• Werewolves: Max 1/4 of total players (rounded down)\n' +  // Fixed ratio
                    '• Special Roles (Seer, Doctor, Cupid): Max 1 each\n' +
                    '• Villagers: As many as needed\n\n' +
                    '*Remember: A balanced game makes for the most thrilling hunt.*',
                fields: [
                    {
                        name: 'Current Setup',
                        value: 'No roles configured yet. Use the buttons below to add roles.',
                        inline: false
                    },
                    {
                        name: 'Next Steps',
                        value: '1. Click Join button or use `/join` to join\n2. Configure roles using buttons below\n3. Start the game when ready',
                        inline: false
                    }
                ],
                footer: {
                    text: 'May the village survive the night...'
                }
            };

            // Create join button
            const joinButton = new ButtonBuilder()
                .setCustomId('join_game')
                .setLabel('🎮 Join Game')
                .setStyle(ButtonStyle.Success);

            // Create role configuration buttons
            const roleButtons = createRoleButtons();

            // Add join button to first row
            const allButtons = [
                { type: 1, components: [joinButton] },  // New row with join button
                ...roleButtons  // Existing role buttons
            ];

            await interaction.reply({
                embeds: [welcomeEmbed],
                components: allButtons,
                ephemeral: false
            });

            logger.info('New game instance created', {
                guildId: interaction.guildId,
                creatorId: interaction.user.id
            });

        } catch (error) {
            await handleCommandError(interaction, error);
        }
    }
};
