// bot.js

// Import necessary modules
const { Client, GatewayIntentBits, Collection, REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { handleCommandError } = require('./utils/error-handler');
const logger = require('./utils/logger');
const WerewolfGame = require('./game/WerewolfGame');
const dayPhaseHandler = require('./handlers/dayPhaseHandler');
const buttonHandler = require('./handlers/buttonHandler');
const sequelize = require('./utils/database');
const PlayerStats = require('./models/Player');
const Game = require('./models/Game');
const ROLES = require('./constants/roles');
const PHASES = require('./constants/phases');
const ACTIONS = require('./constants/actions');
const GameStateManager = require('./utils/gameStateManager');

// Add this near the top of the file with other constants
const ACTION_MAP = {
    [ROLES.WEREWOLF]: 'attack',
    [ROLES.SEER]: 'investigate',
    [ROLES.BODYGUARD]: 'protect',
    [ROLES.SORCERER]: 'dark_investigate',
    [ROLES.HUNTER]: 'hunter_revenge',
    [ROLES.CUPID]: 'choose_lovers'
};

// Create a new Discord client with necessary intents
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
    ],
    partials: ['CHANNEL'], // Needed to receive DMs
    componentLifetime: 0 // Components will never expire
});

// Initialize collections
client.commands = new Collection();
client.games = new Collection();  // Add this line to initialize games Map

// Define the ID(s) of the allowed channel(s) from environment variables
const allowedChannelIds = process.env.ALLOWED_CHANNEL_IDS ? process.env.ALLOWED_CHANNEL_IDS.split(',') : [];

// Load command files
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

const commands = [];

// Load command files
for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
        commands.push(command.data.toJSON());
        logger.info(`Loaded command: ${command.data.name}`, { timestamp: new Date().toISOString() });
    } else {
        logger.warn(`The command at ${filePath} is missing a required "data" or "execute" property.`, { timestamp: new Date().toISOString() });
    }
}

// Register commands with Discord via REST API
const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);

(async () => {
    try {
        logger.info('Started refreshing application (/) commands.', { timestamp: new Date().toISOString() });

        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands },
        );

        logger.info('Successfully reloaded application (/) commands.', { timestamp: new Date().toISOString() });
    } catch (error) {
        logger.error('Error refreshing application commands', { error, timestamp: new Date().toISOString() });
    }
})();

const MAX_GAME_AGE_HOURS = 24; // Configure maximum age for abandoned games

// When the client is ready, run this code once (only triggered once)
client.once('ready', async () => {
    try {
        // Find all saved games
        const savedGames = await Game.findAll();
        
        logger.info('Found saved games during startup', { 
            count: savedGames.length,
            games: savedGames.map(g => ({
                guildId: g.guildId,
                phase: g.phase,
                lastUpdated: g.lastUpdated
            }))
        });
        
        for (const savedGame of savedGames) {
            // Check if game is too old
            const gameAge = new Date() - new Date(savedGame.lastUpdated);
            const gameAgeHours = gameAge / (1000 * 60 * 60);
            
            if (gameAgeHours > MAX_GAME_AGE_HOURS) {
                logger.info('Removing stale game', { 
                    guildId: savedGame.guildId, 
                    ageHours: gameAgeHours 
                });
                await Game.destroy({ where: { guildId: savedGame.guildId } });
                continue;
            }

            try {
                // Verify the game channel still exists
                const channel = await client.channels.fetch(savedGame.channelId)
                    .catch(() => null);
                
                if (!channel) {
                    logger.warn('Game channel no longer exists, cleaning up game', {
                        guildId: savedGame.guildId
                    });
                    await Game.destroy({ where: { guildId: savedGame.guildId } });
                    continue;
                }

                // Send prompt to channel asking if they want to restore the game
                await channel.send({
                    embeds: [{
                        color: 0x0099ff,
                        title: '🎮 Unfinished Game Found',
                        description: 
                            `A game was interrupted in this channel:\n\n` +
                            `**Phase:** ${savedGame.phase}\n` +
                            `**Round:** ${savedGame.round}\n` +
                            `**Last Updated:** ${new Date(savedGame.lastUpdated).toLocaleString()}\n\n` +
                            'Would you like to restore this game?'
                    }],
                    components: [{
                        type: 1,
                        components: [
                            {
                                type: 2,
                                style: 1,
                                label: 'Restore Game',
                                custom_id: `restore_${savedGame.guildId}`,
                            },
                            {
                                type: 2,
                                style: 4,
                                label: 'Delete Game',
                                custom_id: `delete_${savedGame.guildId}`,
                            }
                        ]
                    }]
                });

            } catch (error) {
                logger.error('Error handling saved game', {
                    error,
                    guildId: savedGame.guildId
                });
                // Clean up failed game
                await Game.destroy({ where: { guildId: savedGame.guildId } });
            }
        }
        
        logger.info(`Bot ready!`);
    } catch (error) {
        logger.error('Error in startup game restoration process', { error });
    }
});

// Listen for interactions
client.on('interactionCreate', async interaction => {
    try {
        if (interaction.isAutocomplete()) {
            const command = client.commands.get(interaction.commandName);
            if (!command || !command.autocomplete) return;

            // For DMs, search all games for this player
            let game = null;
            if (!interaction.guild) {
                for (const [, gameInstance] of client.games) {
                    if (gameInstance.players.has(interaction.user.id)) {
                        game = gameInstance;
                        break;
                    }
                }
            } else {
                game = client.games.get(interaction.guildId);
            }

            try {
                await command.autocomplete(interaction, game);
            } catch (error) {
                logger.error('Error in autocomplete', { error });
            }
            return;
        }

        if (interaction.isCommand()) {
            // Determine if the interaction is a DM
            const isDM = !interaction.guild;

            // Check if the interaction is from an allowed channel or is a DM
            if (!isDM && !allowedChannelIds.includes(interaction.channelId)) {
                await interaction.reply({ content: 'This command can only be used in specific channels or DMs.', ephemeral: true });
                return;
            }

            const command = client.commands.get(interaction.commandName);
            if (!command) return;

            // Get game instance - for DMs, find the game the player is in
            let game = null;
            if (isDM) {
                // Search all games for this player
                for (const [, gameInstance] of client.games) {
                    if (gameInstance.players.has(interaction.user.id)) {
                        game = gameInstance;
                        break;
                    }
                }
            } else {
                game = client.games.get(interaction.guildId);
            }
            
            logger.info('Command execution', {
                command: interaction.commandName,
                guildId: interaction.guild?.id,
                hasGame: !!game,
                gamePhase: game?.phase,
                isDM: isDM
            });

            // Special handling for stats command since it doesn't need a game instance
            if (interaction.commandName === 'stats') {
                const command = client.commands.get('stats');
                await command.execute(interaction);
                return;
            }

            // Regular command handling
            await command.execute(interaction, game);
        } 
        else if (interaction.isButton()) {
            // Check if this is a game restoration button
            if (interaction.customId.startsWith('restore_') || interaction.customId.startsWith('delete_')) {
                const [action, guildId] = interaction.customId.split('_');
                const savedGame = await Game.findByPk(guildId);
                
                if (!savedGame) {
                    await interaction.reply({
                        content: 'This game is no longer available.',
                        ephemeral: true
                    });
                    return;
                }

                // Check against the actual creatorId stored in the database record
                if (interaction.user.id !== savedGame.creatorId) {
                    await interaction.reply({
                        content: 'Only the game creator can make this decision.',
                        ephemeral: true
                    });
                    return;
                }

                await interaction.deferUpdate();

                if (action === 'restore') {
                    try {
                        const restoredGame = await GameStateManager.restoreGameState(client, guildId);
                        if (restoredGame) {
                            client.games.set(guildId, restoredGame);
                            await interaction.message.edit({
                                embeds: [{
                                    color: 0x00ff00,
                                    title: '✅ Game Restored',
                                    description: 'The game has been successfully restored.'
                                }],
                                components: []
                            });
                        }
                    } catch (error) {
                        logger.error('Error restoring game', { error, guildId });
                        await interaction.message.edit({
                            embeds: [{
                                color: 0xff0000,
                                title: '❌ Restoration Failed',
                                description: 'Failed to restore the game. Starting a new game might be necessary.'
                            }],
                            components: []
                        });
                    }
                } else if (action === 'delete') {
                    try {
                        const savedGame = await Game.findByPk(guildId);
                        if (savedGame) {
                            // Create minimal temp game just for channel cleanup
                            const tempGame = {
                                client,
                                guildId,
                                werewolfChannel: { id: savedGame.werewolfChannelId },
                                deadChannel: { id: savedGame.deadChannelId }
                            };

                            // Clean up channels
                            await GameStateManager.cleanupChannels(tempGame);

                            // Delete from database
                            await Game.destroy({ where: { guildId } });
                            
                            await interaction.message.edit({
                                embeds: [{
                                    color: 0xff0000,
                                    title: '🗑️ Game Deleted',
                                    description: 'The unfinished game and its channels have been deleted.'
                                }],
                                components: []
                            });
                        }
                    } catch (error) {
                        logger.error('Error handling game deletion', { error, guildId });
                        await interaction.message.edit({
                            embeds: [{
                                color: 0xff0000,
                                title: '❌ Error',
                                description: 'Failed to delete the game. Please try again.'
                            }],
                            components: []
                        });
                    }
                    return;
                }
            }

            // Handle regular game buttons
            const game = client.games.get(interaction.guildId);
            if (!game) {
                await interaction.reply({
                    content: 'No active game found.',
                    ephemeral: true
                });
                return;
            }

            // Extract action from customId
            const action = interaction.customId.includes('_') ? 
                interaction.customId.split('_')[0] : 
                interaction.customId;

            try {
                switch (action) {
                    case 'join':
                        await buttonHandler.handleJoinGame(interaction, game);
                        break;
                    case 'toggle':
                    case 'add':
                    case 'remove':
                        await buttonHandler.handleToggleRole(interaction, game);
                        break;
                    case 'view':
                        if (interaction.customId === 'view_info') {
                            await buttonHandler.handleViewRoles(interaction, game);
                        } else if (interaction.customId === 'view') {
                            await buttonHandler.handleViewSetup(interaction, game);
                        }
                        break;
                    case 'reset':
                        await buttonHandler.handleResetRoles(interaction, game);
                        break;
                    case 'start':
                        await buttonHandler.handleStartGame(interaction, game);
                        break;
                    case 'second':
                    case 'vote':
                        await dayPhaseHandler.handleButton(interaction, game);
                        break;
                    default:
                        logger.warn('Unhandled button interaction', { 
                            action, 
                            customId: interaction.customId 
                        });
                        break;
                }
            } catch (error) {
                await handleCommandError(interaction, error);
            }
        }
        else if (interaction.isStringSelectMenu()) {
            try {
                // Find the game for this player
                const game = interaction.guild ? 
                    client.games.get(interaction.guildId) : 
                    Array.from(client.games.values())
                        .find(g => g.players.has(interaction.user.id));

                if (!game) {
                    await interaction.reply({
                        content: 'No active game found.',
                        ephemeral: true
                    });
                    return;
                }

                const player = game.players.get(interaction.user.id);
                if (!player?.isAlive) {
                    await interaction.reply({
                        content: 'You cannot perform actions.',
                        ephemeral: true
                    });
                    return;
                }

                // Handle night actions
                if (interaction.customId.startsWith('night_action_')) {
                    // Defer the reply immediately
                    await interaction.deferReply({ ephemeral: true });
                    
                    const roleKey = interaction.customId.split('night_action_')[1].toUpperCase();
                    
                    try {
                        // Special handling for Night Zero actions
                        if (game.phase === PHASES.NIGHT_ZERO && roleKey === 'CUPID') {
                            await game.nightActionProcessor.processNightZeroAction(
                                player.id,
                                interaction.values[0]
                            );
                        } else if (game.phase === PHASES.NIGHT) {
                            const action = ACTION_MAP[ROLES[roleKey]];
                            await game.nightActionProcessor.processNightAction(
                                player.id,
                                action,
                                interaction.values[0]
                            );
                        }
                        
                        // Edit the deferred reply
                        await interaction.editReply({
                            content: 'Your action has been recorded.',
                            ephemeral: true
                        });
                    } catch (error) {
                        // If there's an error, edit the deferred reply with the error message
                        await interaction.editReply({
                            content: 'There was an error processing your action. Please try again.',
                            ephemeral: true
                        });
                        logger.error('Error handling night action', { error });
                    }
                }
                // Handle other select menus
                else if (interaction.customId.startsWith('day_')) {
                    await dayPhaseHandler.handleSelect(interaction, game);
                }
                else if (interaction.customId === 'hunter_revenge') {
                    await interaction.deferReply({ ephemeral: true });

                    const hunterId = interaction.user.id;
                    const targetId = interaction.values[0];

                    try {
                        // Process Hunter's Revenge
                        await game.voteProcessor.processHunterRevenge(hunterId, targetId);

                        // Inform the user
                        await interaction.editReply({
                            content: 'Your revenge has been executed. Both you and your target have been eliminated.',
                            ephemeral: true
                        });
                    } catch (error) {
                        // Handle errors
                        await interaction.editReply({
                            content: `There was an error processing your revenge: ${error.message}`,
                            ephemeral: true
                        });
                        logger.error('Error processing Hunter\'s Revenge', { error });
                    }
                }
            } catch (error) {
                logger.error('Error handling select menu interaction', { error });
                await handleCommandError(interaction, error);
            }
        }
    } catch (error) {
        logger.error('Error handling interaction', { error });
        await handleCommandError(interaction, error);
    }
});

// Add this before client.login
const { initializeDatabase } = require('./utils/database');

(async () => {
    try {
        // Initialize database first
        await initializeDatabase();
        
        // Then start the bot
        await client.login(process.env.BOT_TOKEN);
    } catch (error) {
        logger.error('Failed to initialize:', error);
        process.exit(1);
    }
})();

// Global error handlers
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at Promise', { reason, promise, timestamp: new Date().toISOString() });
});

process.on('uncaughtException', (error) => {
    logger.fatal('Uncaught Exception thrown', { error, timestamp: new Date().toISOString() });
    process.exit(1);
});

// Add disconnect handler
client.on('shardDisconnect', () => {
    logger.warn('Bot disconnected from Discord');
});

// Add reconnect handler
client.on('shardReconnecting', () => {
    logger.info('Attempting to reconnect to Discord');
});

// Add resume handler
client.on('shardResume', () => {
    logger.info('Connection to Discord restored');
});