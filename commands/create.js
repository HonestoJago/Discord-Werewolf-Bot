const { SlashCommandBuilder } = require('discord.js');
const WerewolfGame = require('../game/WerewolfGame');
const { createGameSetupButtons } = require('../utils/buttonCreator');
const { createGameWelcomeEmbed } = require('../utils/embedCreator');
const { handleCommandError } = require('../utils/error-handler');
const logger = require('../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('create')
        .setDescription('Create a new Werewolf game'),

    async execute(interaction) {
        try {
            // Get existing game if any
            const existingGame = interaction.client.games.get(interaction.guildId);
            if (existingGame) {
                await existingGame.shutdownGame();
            }

            // Create new game instance
            const game = await WerewolfGame.create(
                interaction.client,
                interaction.guildId,
                interaction.channelId,
                interaction.user.id
            );

            // Send initial setup message
            await game.createInitialMessage(interaction.channel);

            // Send ephemeral confirmation to command user
            await interaction.reply({
                content: 'Game created successfully!',
                ephemeral: true
            });

            logger.info('New game created via command', {
                guildId: interaction.guildId,
                creatorId: interaction.user.id
            });

        } catch (error) {
            await handleCommandError(interaction, error);
        }
    }
};
