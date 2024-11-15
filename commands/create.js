const { SlashCommandBuilder } = require('discord.js');
const { createGame, cleanupGame } = require('../utils/gameManager');
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
            // First cleanup any existing game
            await cleanupGame(interaction.client, interaction.guildId);

            // Create new game instance
            const game = await createGame(
                interaction.client,
                interaction.guildId,
                interaction.channelId,
                interaction.user.id
            );

            // Store game instance
            interaction.client.games.set(interaction.guildId, game);

            // Send welcome message with setup UI
            await interaction.reply({
                embeds: [createGameWelcomeEmbed()],
                components: createGameSetupButtons(),
                ephemeral: false
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
