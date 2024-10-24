const { SlashCommandBuilder } = require('discord.js');
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
            // Create new game instance
            const game = new WerewolfGame(
                interaction.client,
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
                        value: '1. Configure roles using buttons below\n2. Players join with `/join`\n3. Start the game with `/start`',
                        inline: false
                    }
                ],
                footer: {
                    text: 'May the village survive the night...'
                }
            };

            // Create role configuration buttons
            const buttons = createRoleButtons();

            await interaction.reply({
                embeds: [welcomeEmbed],
                components: buttons,
                ephemeral: false
            });

            // Log successful game creation
            logger.info('New game instance created', {
                guildId: interaction.guildId,
                creatorId: interaction.user.id
            });

        } catch (error) {
            await handleCommandError(interaction, error);
        }
    }
};
