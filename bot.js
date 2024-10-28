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

// Create a new Discord client with necessary intents
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
    ],
    partials: ['CHANNEL'], // Needed to receive DMs
});

// Initialize collections
client.commands = new Collection();
client.games = new Map();  // Add this line to initialize games Map

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

// When the client is ready, run this code once (only triggered once)
client.once('ready', () => {
    logger.info(`Logged in as ${client.user.tag}! Bot is online and ready.`, { timestamp: new Date().toISOString() });
});

// Listen for interactions
client.on('interactionCreate', async interaction => {
    try {
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

            // Get game from the Map using guildId
            const game = interaction.guild ? client.games.get(interaction.guildId) : null;
            
            logger.info('Command execution', {
                command: interaction.commandName,
                guildId: interaction.guild?.id,
                hasGame: !!game,
                gamePhase: game?.phase,
                isDM: isDM
            });

            await command.execute(interaction, game);
        } 
        else if (interaction.isButton()) {
            const [handlerId] = interaction.customId.split('_');
            
            // Map handlers
            const handlers = {
                'day': dayPhaseHandler,
                'add': require('./handlers/buttonHandler').handleAddRole,
                'remove': require('./handlers/buttonHandler').handleRemoveRole,
                'view': require('./handlers/buttonHandler').handleViewRoles,
                'start': require('./handlers/buttonHandler').handleStartGame,
                'reset': require('./handlers/buttonHandler').handleResetRoles
            };

            const handler = handlers[handlerId];
            if (!handler) {
                logger.warn('No button handler found', { handlerId });
                return;
            }

            try {
                // Get the game instance for this guild
                const game = interaction.client.games.get(interaction.guildId);
                if (!game) {
                    await interaction.reply({ 
                        content: 'No active game found.', 
                        ephemeral: true 
                    });
                    return;
                }

                await handler(interaction, game);
            } catch (error) {
                logger.error('Error handling button', { 
                    error,
                    buttonId: interaction.customId 
                });
                await handleCommandError(interaction, error);
            }
        }
        else if (interaction.isStringSelectMenu()) {
            const [handlerId] = interaction.customId.split('_');
            
            const handlers = {
                'day': dayPhaseHandler,
                // Add other handlers here as needed
            };

            const handler = handlers[handlerId];
            if (!handler?.handleSelect) {
                logger.warn('No select menu handler found', { handlerId });
                return;
            }

            try {
                const game = interaction.guild ? client.games.get(interaction.guildId) : null;
                await handler.handleSelect(interaction, game);
            } catch (error) {
                logger.error('Error handling select menu', { 
                    error,
                    menuId: interaction.customId 
                });
                await handleCommandError(interaction, error);
            }
        }
    } catch (error) {
        logger.error('Error handling interaction', { error });
        await handleCommandError(interaction, error);
    }
});

// Function to create a new game
client.createGame = (guildId, channelId, creatorId, testMode = false) => {
    // Check if game exists in the Map
    if (client.games.has(guildId)) {
        throw new Error('A game is already in progress in this server.');
    }
    const game = new WerewolfGame(client, guildId, channelId, creatorId, testMode);
    client.games.set(guildId, game);
    logger.info('New game instance created', { guildId, creatorId });
    return game;
};

// Function to end the current game
client.endGame = (guildId) => {
    const game = client.games.get(guildId);
    if (game) {
        game.shutdownGame();  // If you have cleanup logic
        client.games.delete(guildId);
        logger.info('Game instance has been reset.', { guildId });
    }
};

// Log in to Discord with your bot token
client.login(process.env.BOT_TOKEN);

// Global error handlers
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at Promise', { reason, promise, timestamp: new Date().toISOString() });
});

process.on('uncaughtException', (error) => {
    logger.fatal('Uncaught Exception thrown', { error, timestamp: new Date().toISOString() });
    process.exit(1);
});
