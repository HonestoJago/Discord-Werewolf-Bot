const { SlashCommandBuilder } = require('discord.js');
const logger = require('../utils/logger');
const { handleCommandError, GameError } = require('../utils/error-handler');
const { createPlayerListEmbed } = require('../utils/embedCreator');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('create')
        .setDescription('Creates a new Werewolf game lobby in this channel.'),
    async execute(interaction, currentGame) {
        try {
            const { client, guild, channel, user } = interaction;

            if (!guild) {
                throw new GameError('Not in server', 'This command can only be used in a server channel.');
            }

            if (currentGame) {
                throw new GameError('Game in progress', 'A game is already in progress or a lobby exists.');
            }

            const newGame = client.createGame(guild.id, channel.id, user.id);
            await newGame.addPlayer(user);

            const embed = createPlayerListEmbed(newGame.players, newGame.phase);
            
            await interaction.reply({ content: 'Game lobby created! You have been added as the first player. Others can join using `/join`. Once you have enough players, use `/start` to begin the game.', embeds: [embed], ephemeral: false });
            logger.info({ userId: user.id, guildId: guild.id, channelId: channel.id }, 'Game lobby created');
        } catch (error) {
            await handleCommandError(interaction, error);
        }
    },
};
