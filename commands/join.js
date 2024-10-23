// commands/join.js

const { SlashCommandBuilder } = require('discord.js');
const { GameError } = require('../utils/error-handler');
const logger = require('../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('join')
        .setDescription('Join the Werewolf game.'),
    async execute(interaction, gameInstance) {
        try {
            // Prevent joining after the game has started
            if (!gameInstance || gameInstance.phase !== 'LOBBY') {
                throw new GameError('Cannot join', 'The game has already started. You cannot join at this time.');
            }

            // Add the player to the game
            gameInstance.addPlayer(interaction.user);

            await interaction.reply({ content: 'You have successfully joined the Werewolf game!', ephemeral: true });
            await gameInstance.broadcastMessage(`**${interaction.user.username}** has joined the game.`);
            logger.info('Player joined the game', { userId: interaction.user.id, username: interaction.user.username });
        } catch (error) {
            logger.error('Error executing /join command', { error, userId: interaction.user.id });
            await interaction.reply({ content: error.userMessage || 'An error occurred while joining the game.', ephemeral: true });
        }
    },
};
