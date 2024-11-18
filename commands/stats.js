const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const PlayerStats = require('../models/Player');
const logger = require('../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription('View player statistics')
        .addStringOption(option => 
            option.setName('player')
                .setDescription('Player to view stats for (leave empty for your own stats)')
                .setRequired(false)
                .setAutocomplete(true)),

    async autocomplete(interaction) {
        try {
            const focusedValue = interaction.options.getFocused().toLowerCase();
            
            // Get all players from database
            const players = await PlayerStats.findAll({
                where: {},
                limit: 25
            });

            logger.info('Fetched players for autocomplete', { 
                playerCount: players.length,
                searchTerm: focusedValue
            });

            // Filter and format players for autocomplete
            const choices = players
                .filter(player => 
                    player.username.toLowerCase().includes(focusedValue))
                .map(player => ({
                    name: player.username,
                    value: player.discordId
                }));

            await interaction.respond(choices);
        } catch (error) {
            logger.error('Error in stats autocomplete', { error });
            await interaction.respond([]);
        }
    },

    async execute(interaction) {
        try {
            const targetId = interaction.options.getString('player');
            const targetUser = targetId ? await interaction.client.users.fetch(targetId) : interaction.user;
            
            logger.info('Attempting to fetch stats', { 
                targetId: targetUser.id,
                targetUsername: targetUser.username,
                interactionUser: interaction.user.id,
                interactionUsername: interaction.user.username
            });

            let stats = await PlayerStats.findByPk(targetUser.id.toString());
            
            if (!stats) {
                logger.info('Creating new player record', {
                    discordId: targetUser.id,
                    username: targetUser.username
                });
                
                stats = await PlayerStats.create({
                    discordId: targetUser.id.toString(),
                    username: targetUser.username,
                    gamesPlayed: 0,
                    gamesWon: 0
                });
            }

            const winRate = stats.gamesPlayed > 0 
                ? ((stats.gamesWon / stats.gamesPlayed) * 100).toFixed(1) 
                : 0;

            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle(`🎮 Player Stats: ${targetUser.username}`)
                .addFields(
                    { name: '📊 Overall', value: 
                        `Games Played: ${stats.gamesPlayed}\n` +
                        `Games Won: ${stats.gamesWon}\n` +
                        `Win Rate: ${winRate}%\n` +
                        `Times Eliminated: ${stats.timesEliminated || 0}`
                    },
                    { name: '🎭 Roles Played', value:
                        `Werewolf: ${stats.timesWerewolf || 0}\n` +
                        `Seer: ${stats.timesSeer || 0}\n` +
                        `Bodyguard: ${stats.timesBodyguard || 0}\n` +
                        `Cupid: ${stats.timesCupid || 0}\n` +
                        `Hunter: ${stats.timesHunter || 0}\n` +
                        `Villager: ${stats.timesVillager || 0}\n` +
                        `Minion: ${stats.timesMinion || 0}\n` +
                        `Sorcerer: ${stats.timesSorcerer || 0}`
                    },
                    { name: '🎯 Achievements', value:
                        `Correct Votes: ${stats.correctVotes || 0}\n` +
                        `Successful Investigations: ${stats.successfulInvestigations || 0}\n` +
                        `Successful Protections: ${stats.successfulProtections || 0}`
                    }
                )
                .setTimestamp();

            await interaction.reply({ embeds: [embed], ephemeral: true });
            
        } catch (error) {
            logger.error('Error displaying stats', { error });
            await interaction.reply({ 
                content: 'Failed to retrieve player statistics.', 
                ephemeral: true 
            });
        }
    }
}; 