const { SlashCommandBuilder } = require('discord.js');
const { createRoleCard } = require('../utils/embedCreator');
const ROLES = require('../constants/roles');
const logger = require('../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('role-info')
        .setDescription('Learn about different roles')
        .addStringOption(option =>
            option.setName('role')
                .setDescription('The role to learn about')
                .setRequired(true)
                .addChoices(
                    { name: '🐺 Werewolf', value: ROLES.WEREWOLF },
                    { name: '👁️ Seer', value: ROLES.SEER },
                    { name: '🛡️ Bodyguard', value: ROLES.BODYGUARD },
                    { name: '💘 Cupid', value: ROLES.CUPID },
                    { name: '🏹 Hunter', value: ROLES.HUNTER },
                    { name: '👥 Villager', value: ROLES.VILLAGER },
                    { name: '🦹 Minion', value: ROLES.MINION },
                    { name: '🧙 Sorcerer', value: ROLES.SORCERER }
                )),

    async execute(interaction) {
        try {
            const role = interaction.options.getString('role');
            const roleCard = createRoleCard(role);
            
            await interaction.reply({ 
                embeds: [roleCard], 
                ephemeral: true 
            });

            logger.info('Role info displayed', { 
                userId: interaction.user.id,
                role: role
            });
        } catch (error) {
            logger.error('Error displaying role info', { error });
            await interaction.reply({ 
                content: 'Failed to display role information.', 
                ephemeral: true 
            });
        }
    }
}; 