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

// Define the ID(s) of the allowed channel(s) from environment variables
const allowedChannelIds = process.env.ALLOWED_CHANNEL_IDS ? process.env.ALLOWED_CHANNEL_IDS.split(',') : [];

// Initialize the commands collection
client.commands = new Collection();
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

// Store the game instance
let currentGame = null;

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

            if (!command) {
                logger.warn(`No command found for ${interaction.commandName}`, { timestamp: new Date().toISOString() });
                return;
            }

            // Pass the currentGame to the command execution
            await command.execute(interaction, currentGame);
        } 
        else if (interaction.isButton()) {
            const [handlerId] = interaction.customId.split('_');
            
            // Map handlers
            const handlers = {
                'day': dayPhaseHandler,
                // Add other handlers here as needed
            };

            const handler = handlers[handlerId];
            if (!handler?.handleButton) {
                logger.warn('No button handler found', { handlerId });
                return;
            }

            try {
                await handler.handleButton(interaction, currentGame);
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
                await handler.handleSelect(interaction, currentGame);
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
    if (currentGame) {
        throw new Error('A game is already in progress.');
    }
    currentGame = new WerewolfGame(client, guildId, channelId, creatorId, testMode);
    logger.info('New game instance created', { guildId, creatorId, timestamp: new Date().toISOString() });
    return currentGame;
};

// Function to end the current game
client.endGame = () => {
    currentGame = null;
    logger.info('Game instance has been reset.', { timestamp: new Date().toISOString() });
};

// Function to get the current game
client.getCurrentGame = () => currentGame;

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
