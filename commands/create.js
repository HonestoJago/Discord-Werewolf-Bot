const { SlashCommandBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const WerewolfGame = require('../game/WerewolfGame');
const { createRoleConfigEmbed } = require('../utils/embedCreator');
const { createGameSetupButtons } = require('../utils/buttonCreator');
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

            // Create thematic welcome message
            const welcomeEmbed = {
                color: 0x800000, // Dark red for werewolf theme
                title: '🌕 A New Hunt Begins 🐺',
                description: 
                    '*The village elder has called for a gathering. Dark rumors spread of wolves among the sheep...*\n\n' +
                    '**Game Setup**\n' +
                    'This game will be played with video and voice chat:\n' +
                    '• During the day, all players will have cameras and mics ON\n' +
                    '• During the night, all players will turn cameras and mics OFF\n\n' +
                    '**Basic Roles (Automatic)**\n' +
                    '• Werewolves (1 per 4 players)\n' +
                    '• Seer (1)\n' +
                    '• Villagers (remaining players)\n\n' +
                    '**Optional Roles**\n' +
                    'The following roles can be added to enhance the game:\n' +
                    '• 🛡️ Bodyguard: Protects one player each night\n' +
                    '• 💘 Cupid: Chooses one player to be their lover (both die if either dies)\n' +
                    '• 🏹 Hunter: Takes someone with them when they die',
                fields: [
                    {
                        name: '📜 How to Join',
                        value: 'Click the Join button below or use `/join` to enter the game.',
                        inline: false
                    },
                    {
                        name: '⚔️ Optional Roles',
                        value: 'Game creator can toggle optional roles using the buttons below.\nThese roles will be randomly assigned when the game starts.',
                        inline: false
                    }
                ],
                footer: {
                    text: 'The hunt begins when the creator clicks Start Game...'
                }
            };

            const buttons = createGameSetupButtons();

            await interaction.reply({
                embeds: [welcomeEmbed],
                components: buttons,
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
