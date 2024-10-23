// commands/configure_roles.js

const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const ROLES = require('../constants/roles');
const { GameError } = require('../utils/error-handler');
const logger = require('../utils/logger');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('configure_roles')
        .setDescription('Configure roles for the Werewolf game. Only the game creator can use this command.'),
    async execute(interaction, gameInstance) {
        try {
            // Check if the user is the game creator
            if (interaction.user.id !== gameInstance.gameCreatorId) {
                throw new GameError('Not authorized', 'Only the game creator can configure roles.');
            }

            // Create buttons for adding and removing roles
            const addButtons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('add_werewolf')
                        .setLabel('Add Werewolf')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('remove_werewolf')
                        .setLabel('Remove Werewolf')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId('add_seer')
                        .setLabel('Add Seer')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('remove_seer')
                        .setLabel('Remove Seer')
                        .setStyle(ButtonStyle.Danger),
                );

            const addDoctorCupidButtons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('add_doctor')
                        .setLabel('Add Doctor')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('remove_doctor')
                        .setLabel('Remove Doctor')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId('add_cupid')
                        .setLabel('Add Cupid')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('remove_cupid')
                        .setLabel('Remove Cupid')
                        .setStyle(ButtonStyle.Danger),
                );

            const viewRolesButton = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('view_roles')
                        .setLabel('View Selected Roles')
                        .setStyle(ButtonStyle.Secondary),
                );

            // Send initial message with buttons
            await interaction.reply({
                content: 'Configure the game roles using the buttons below:',
                components: [addButtons, addDoctorCupidButtons, viewRolesButton],
                ephemeral: true,
            });

            // Create a collector to handle button interactions
            const filter = i => i.user.id === interaction.user.id;
            const collector = interaction.channel.createMessageComponentCollector({ filter, time: 600000 }); // 10 minutes

            collector.on('collect', async i => {
                if (!gameInstance.selectedRoles) gameInstance.selectedRoles = new Map();

                try {
                    let role, action;
                    switch (i.customId) {
                        case 'add_werewolf':
                            role = ROLES.WEREWOLF;
                            action = 'add';
                            break;
                        case 'remove_werewolf':
                            role = ROLES.WEREWOLF;
                            action = 'remove';
                            break;
                        case 'add_seer':
                            role = ROLES.SEER;
                            action = 'add';
                            break;
                        case 'remove_seer':
                            role = ROLES.SEER;
                            action = 'remove';
                            break;
                        case 'add_doctor':
                            role = ROLES.DOCTOR;
                            action = 'add';
                            break;
                        case 'remove_doctor':
                            role = ROLES.DOCTOR;
                            action = 'remove';
                            break;
                        case 'add_cupid':
                            role = ROLES.CUPID;
                            action = 'add';
                            break;
                        case 'remove_cupid':
                            role = ROLES.CUPID;
                            action = 'remove';
                            break;
                        case 'view_roles':
                            // Display current role configuration
                            const selectedRoles = gameInstance.selectedRoles;
                            if (selectedRoles.size === 0) {
                                await i.reply({ content: 'No roles have been selected yet.', ephemeral: true });
                            } else {
                                const rolesDescription = Array.from(selectedRoles.entries())
                                    .map(([roleName, count]) => `${roleName}: ${count}`)
                                    .join('\n');
                                const embed = new EmbedBuilder()
                                    .setColor('#00FF00')
                                    .setTitle('Current Role Configuration')
                                    .setDescription(rolesDescription)
                                    .setTimestamp();
                                await i.reply({ embeds: [embed], ephemeral: true });
                            }
                            return;
                        default:
                            await i.reply({ content: 'Unknown action.', ephemeral: true });
                            return;
                    }

                    if (action === 'add') {
                        gameInstance.addRole(role);
                        await i.reply({ content: `Role **${role}** has been added.`, ephemeral: true });
                    } else if (action === 'remove') {
                        gameInstance.removeRole(role);
                        await i.reply({ content: `Role **${role}** has been removed.`, ephemeral: true });
                    }
                } catch (err) {
                    if (err instanceof GameError) {
                        await i.reply({ content: err.userMessage, ephemeral: true });
                    } else {
                        logger.error('Error handling configure_roles button interaction', { 
                            error: err.message,
                            stack: err.stack
                        });
                        await i.reply({ content: 'An unexpected error occurred.', ephemeral: true });
                    }
                }
            });

            collector.on('end', collected => {
                logger.info('configure_roles collector ended');
            });
        } catch (err) {
            if (err instanceof GameError) {
                await interaction.reply({ content: err.userMessage, ephemeral: true });
            } else {
                logger.error('Error executing configure_roles command', { 
                    error: err.message,
                    stack: err.stack
                });
                await interaction.reply({ content: 'An unexpected error occurred.', ephemeral: true });
            }
        }
    },
};
