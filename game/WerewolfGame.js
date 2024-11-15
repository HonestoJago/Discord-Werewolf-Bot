// game/WerewolfGame.js

const Player = require('./Player');
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const { GameError } = require('../utils/error-handler');
const logger = require('../utils/logger');
const ROLES = require('../constants/roles');  // Direct import of frozen object
const PHASES = require('../constants/phases'); // Direct import of frozen object
const { createDayPhaseEmbed, createVoteResultsEmbed, createGameEndEmbed } = require('../utils/embedCreator');
const NightActionProcessor = require('./NightActionProcessor');
const VoteProcessor = require('./VoteProcessor');
const dayPhaseHandler = require('../handlers/dayPhaseHandler');
const PlayerStats = require('../models/Player');
const Game = require('../models/Game');
const { createGameEndButtons } = require('../utils/buttonCreator');

// Define roles and their properties in a configuration object
const ROLE_CONFIG = {
    [ROLES.WEREWOLF]: { maxCount: (playerCount) => Math.max(1, Math.floor(playerCount / 4)) },
    [ROLES.SEER]: { maxCount: 1 },
    [ROLES.BODYGUARD]: { maxCount: 1 },
    [ROLES.CUPID]: { maxCount: 1 },
    [ROLES.HUNTER]: { maxCount: 1 },
    [ROLES.VILLAGER]: { maxCount: (playerCount) => playerCount }
};

const PHASE_TRANSITIONS = {
    [PHASES.LOBBY]: ['NIGHT_ZERO'],
    [PHASES.NIGHT_ZERO]: ['DAY'],
    [PHASES.DAY]: ['NIGHT', 'GAME_OVER'],
    [PHASES.NIGHT]: ['DAY', 'GAME_OVER'],
    [PHASES.GAME_OVER]: []
};

class WerewolfGame {
    constructor(client, guildId, gameChannelId, gameCreatorId, authorizedIds = []) {
        if (!client) {
            throw new Error('Discord client is required');
        }
        if (!guildId) {
            throw new Error('Guild ID is required');
        }
        if (!gameChannelId) {
            throw new Error('Game channel ID is required');
        }
        if (!gameCreatorId) {
            throw new Error('Game creator ID is required');
        }

        this.client = client;
        this.guildId = guildId;
        this.gameChannelId = gameChannelId;
        this.gameCreatorId = gameCreatorId;
        this.authorizedIds = authorizedIds; // Array of user IDs authorized to advance phases

        this.players = new Map(); // Map of playerId -> Player instance
        this.phase = PHASES.LOBBY;  // This should be set to LOBBY
        this.round = 0;
        this.nightActions = {}; // Store night actions like attacks, investigations, etc.
        this.werewolfChannel = null; // Private channel for werewolves
        this.deadChannel = null; // Channel for dead players
        this.gameOver = false;
        this.lastProtectedPlayer = null; // Track the last protected player
        this.lovers = new Map(); // Store lover pairs
        this.selectedRoles = new Map(); // Dynamic role selection
        this.pendingHunterRevenge = null;  // Track if Hunter needs to take revenge

        // Voting state
        this.nominatedPlayer = null;
        this.nominator = null;
        this.seconder = null;
        this.votes = new Map();   // Map of voterId -> boolean (true = guilty, false = innocent))
        this.votingOpen = false;
        this.nominationTimeout = null;
        this.NOMINATION_WAIT_TIME = 60000; // 1 minute
        
        // Add tracking for completed night actions
        this.completedNightActions = new Set(); // Track which players have completed their actions
        this.expectedNightActions = new Set(); // Track which players are expected to act
        
        logger.info('Game created with phase', { 
            phase: this.phase,
            isLobby: this.phase === PHASES.LOBBY,
            phaseValue: PHASES.LOBBY  // Add this to verify PHASES.LOBBY value
        });

        // Add the processors
        this.nightActionProcessor = new NightActionProcessor(this);
        this.voteProcessor = new VoteProcessor(this);
    
        // Set up periodic state saving
        this.stateSaveInterval = setInterval(async () => {
            try {
                await this.saveGameState();
            } catch (error) {
                logger.error('Error in periodic state save', { error });
            }
        }, 5 * 60 * 1000); // Save every 5 minutes
    }

    /**
     * Adds a player to the game.
     * @param {User} user - Discord user object.
     * @returns {Player} - The added player.
     */
    addPlayer(user) {
        logger.info('Adding player', { 
            phase: this.phase,
            isLobby: this.phase === PHASES.LOBBY 
        });
        
        if (this.phase !== PHASES.LOBBY) {
            throw new GameError('Cannot join', 'The game has already started. You cannot join at this time.');
        }

        try {
            // Add debug logging
            logger.info('Attempting to add player', { 
                userId: user.id, 
                currentPhase: this.phase,
                isLobby: this.phase === PHASES.LOBBY 
            });

            // Check phase first
            if (this.phase !== PHASES.LOBBY) {
                throw new GameError('Cannot join', 'The game has already started. You cannot join at this time.');
            }

            // Then check for duplicate players
            if (this.players.has(user.id)) {
                throw new GameError('Player already in game', 'You are already in the game.');
            }

            const player = new Player(user.id, user.username, this.client);
            this.players.set(user.id, player);
            // Save game state after adding player
            this.saveGameState().catch(error => {
                logger.error('Error saving game state after adding player', { error });
            });
            logger.info('Player added to the game', { 
                playerId: user.id, 
                username: user.username,
                currentPhase: this.phase 
            });
            return player;
        } catch (error) {
            logger.error('Error adding player to game', { 
                error, 
                userId: user.id,
                currentPhase: this.phase 
            });
            throw error;
        }
    }

    /**
     * Starts the game after validating configurations.
     */
    async startGame() {
        try {
            if (this.phase !== PHASES.LOBBY) {
                throw new GameError('Game already started', 'The game has already started.');
            }
            if (this.players.size < 4) {
                throw new GameError('Not enough players', 'Not enough players to start the game. Minimum 4 players required.');
            }

            // Initialize selectedRoles if not exists
            if (!this.selectedRoles) {
                this.selectedRoles = new Map();
            }

            // Automatically add basic roles (no need for manual configuration)
            const playerCount = this.players.size;
            const werewolfCount = Math.max(1, Math.floor(playerCount / 4));
            
            // Always include 1 Seer and calculated number of Werewolves
            this.selectedRoles.set(ROLES.WEREWOLF, werewolfCount);
            this.selectedRoles.set(ROLES.SEER, 1);

            // Set phase before other operations
            this.phase = PHASES.NIGHT_ZERO;
            this.round = 0;

            await this.assignRoles();
            await this.createPrivateChannels();
            await this.broadcastMessage({
                embeds: [{
                    color: 0x800000,
                    title: '🌕 Night Falls on the Village 🐺',
                    description: 
                        '*As darkness descends, fear grips the hearts of the villagers...*\n\n' +
                        '**All players:** Please turn off your cameras and microphones now.\n' +
                        'The first night begins, and with it, ancient powers awaken...',
                    footer: { text: 'Stay silent until dawn breaks...' }
                }]
            });
            
            // Initialize night zero
            await this.nightZero();
            
            logger.info('Game started successfully');
        } catch (error) {
            // Reset phase if anything fails
            this.phase = PHASES.LOBBY;
            logger.error('Error starting game', { error });
            throw error;
        }
    }

    /**
     * Assigns roles to all players based on selectedRoles configuration.
     */
    async assignRoles() {
        try {
            // Get all players as an array
            const players = Array.from(this.players.values());
            const playerCount = players.length;
            
            // Create array of roles based on selectedRoles
            let roles = [];
            
            // Add werewolves
            const werewolfCount = Math.max(1, Math.floor(playerCount / 4));
            roles.push(...Array(werewolfCount).fill(ROLES.WEREWOLF));
            
            // Add one seer
            roles.push(ROLES.SEER);

            // Add optional roles if they were selected during setup
            if (this.selectedRoles.has(ROLES.BODYGUARD)) {
                roles.push(ROLES.BODYGUARD);
            }
            if (this.selectedRoles.has(ROLES.CUPID)) {
                roles.push(ROLES.CUPID);
            }
            if (this.selectedRoles.has(ROLES.HUNTER)) {
                roles.push(ROLES.HUNTER);
            }
            
            // Fill remaining slots with villagers
            const villagerCount = playerCount - roles.length;
            roles.push(...Array(villagerCount).fill(ROLES.VILLAGER));
            
            // Shuffle roles
            for (let i = roles.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [roles[i], roles[j]] = [roles[j], roles[i]];
            }
            
            // Assign roles to players
            for (let i = 0; i < players.length; i++) {
                const player = players[i];
                const role = roles[i];
                
                // Log before assignment
                logger.info('Assigning role', { 
                    playerId: player.id, 
                    playerName: player.username, 
                    role: role 
                });
                
                await player.assignRole(role);
                
                // If werewolf, add to werewolf channel
                if (role === ROLES.WEREWOLF && this.werewolfChannel) {
                    await this.werewolfChannel.permissionOverwrites.create(player.id, {
                        ViewChannel: true,
                        SendMessages: true
                    });
                }
            }
            
            logger.info('Roles assigned successfully', {
                playerCount,
                werewolfCount,
                roles: roles.reduce((acc, role) => {
                    acc[role] = (acc[role] || 0) + 1;
                    return acc;
                }, {})
            });
            
        } catch (error) {
            logger.error('Error in assignRoles', { error });
            throw error;
        }
    }

    /**
     * Shuffles an array using the Fisher-Yates algorithm.
     * @param {Array} array - The array to shuffle.
     * @returns {Array} - Shuffled array.
     */
    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    /**
     * Creates private channels for werewolves and dead players.
     */
    async createPrivateChannels() {
        try {
            const guild = await this.client.guilds.fetch(this.guildId);
            const gameChannel = await guild.channels.fetch(this.gameChannelId);
            
            // Get category ID from environment variables
            const categoryId = process.env.WEREWOLF_CATEGORY_ID;
            if (!categoryId) {
                throw new GameError('Config Error', 'WEREWOLF_CATEGORY_ID not set in environment variables');
            }

            // Fetch the category
            const category = await guild.channels.fetch(categoryId);
            if (!category) {
                throw new GameError('Config Error', 'Could not find the specified category');
            }

            // Create Dead channel with default permissions denying view access
            this.deadChannel = await guild.channels.create({
                name: 'dead-players',
                type: 0,  // 0 is text channel
                parent: categoryId,
                permissionOverwrites: [
                    {
                        id: guild.id,
                        deny: ['ViewChannel', 'SendMessages']  // Everyone can't see or send by default
                    },
                    {
                        id: this.client.user.id,
                        allow: ['ViewChannel', 'SendMessages', 'ManageChannels']
                    }
                ]
            });

            // Create Werewolf channel
            this.werewolfChannel = await guild.channels.create({
                name: 'werewolf-channel',
                type: 0,  // 0 is text channel
                parent: categoryId,
                permissionOverwrites: [
                    {
                        id: guild.id,
                        deny: ['ViewChannel']
                    },
                    {
                        id: this.client.user.id,
                        allow: ['ViewChannel', 'SendMessages', 'ManageChannels']
                    }
                ]
            });

            // Add werewolves to the channel after creation
            const werewolves = this.getPlayersByRole(ROLES.WEREWOLF);
            for (const werewolf of werewolves) {
                await this.werewolfChannel.permissionOverwrites.create(werewolf.id, {
                    ViewChannel: true,
                    SendMessages: true
                });
            }

            logger.info('Private channels created successfully', {
                categoryId,
                werewolfChannelId: this.werewolfChannel.id,
                deadChannelId: this.deadChannel.id
            });
        } catch (error) {
            logger.error('Error creating private channels', { error });
            throw new GameError('Channel Creation Failed', 'Failed to create necessary channels. Make sure the bot has proper permissions and the category ID is correct.');
        }
    }

    /**
     * Handles Night Zero phase where initial actions occur.
     */
    async nightZero() {
        try {
            // Get werewolves and send them their team info
            const werewolves = this.getPlayersByRole(ROLES.WEREWOLF);
            const werewolfNames = werewolves.map(w => w.username).join(', ');
            for (const werewolf of werewolves) {
                await werewolf.sendDM(`Your fellow werewolves are: ${werewolfNames}`);
            }

            // Handle Seer's initial revelation
            const seer = this.getPlayerByRole(ROLES.SEER);
            if (seer && seer.isAlive) {
                const validTargets = Array.from(this.players.values()).filter(
                    p => p.role !== ROLES.WEREWOLF && 
                         p.id !== seer.id && 
                         p.isAlive
                );
                
                if (validTargets.length > 0) {
                    const randomPlayer = validTargets[Math.floor(Math.random() * validTargets.length)];
                    await seer.sendDM(`You have been shown that **${randomPlayer.username}** is **Not a Werewolf**.`);
                }
            }

            // If no Cupid, advance to Day phase immediately
            const cupid = this.getPlayerByRole(ROLES.CUPID);
            if (!cupid || !cupid.isAlive) {
                // Set a short timeout to ensure all messages are sent before advancing
                setTimeout(async () => {
                    try {
                        logger.info('Advancing to Day phase after Night Zero (no Cupid)');
                        this.phase = PHASES.DAY;
                        this.round = 1; // Start first day
                        const channel = await this.client.channels.fetch(this.gameChannelId);
                        await dayPhaseHandler.createDayPhaseUI(channel, this.players);
                        await this.broadcastMessage('The sun rises on the first day. Discuss and find the werewolves!');
                    } catch (error) {
                        logger.error('Error advancing to day after Night Zero', { error: error.stack });
                        throw error;
                    }
                }, 2000);
            } else {
                // Handle Cupid's action
                await cupid.sendDM('Use `/action choose_lovers` to select your lover. You have 10 minutes.');
                this.expectedNightActions.add(cupid.id);
                
                // Set timeout for Cupid's action
                this.nightActionTimeout = setTimeout(async () => {
                    try {
                        logger.info('Advancing to Day phase after Cupid timeout');
                        this.phase = PHASES.DAY;
                        this.round = 1;
                        const channel = await this.client.channels.fetch(this.gameChannelId);
                        await dayPhaseHandler.createDayPhaseUI(channel, this.players);
                        await this.broadcastMessage('The sun rises on the first day. Discuss and find the werewolves!');
                    } catch (error) {
                        logger.error('Error advancing after Cupid timeout', { error: error.stack });
                        throw error;
                    }
                }, 600000); // 10 minutes
            }

            logger.info('Night Zero started');
        } catch (error) {
            logger.error('Error during Night Zero', { error: error.stack });
            throw error;
        }
    }

    /**
     * Advances the game to the Night phase.
     */
    async advanceToNight() {
        try {
            this.phase = PHASES.NIGHT;
            this.round += 1;
            
            await this.broadcastMessage({
                embeds: [{
                    color: 0x2C3E50,
                    title: '🌙 Night Falls Once More',
                    description: 
                        '*As darkness envelops the village, danger lurks in the shadows...*\n\n' +
                        '**All players:** Please turn off your cameras and microphones now.\n' +
                        'The night phase begins, and with it, dark deeds will be done...',
                    footer: { text: 'Remain silent until morning comes...' }
                }]
            });

            // Reset night action tracking
            this.completedNightActions.clear();
            this.expectedNightActions.clear();
            this.nightActions = {};

            // Delegate all night action handling to NightActionProcessor
            await this.nightActionProcessor.handleNightActions();

            logger.info(`Game advanced to Night ${this.round}`, {
                expectedActions: Array.from(this.expectedNightActions)
            });

            await this.saveGameState();
        } catch (error) {
            logger.error('Error advancing to Night phase', { error });
            throw error;
        }
    }

    /**
     * Processes all collected night actions.
     */
    async processNightActions() {
        return await this.nightActionProcessor.processNightActions();
    }

    /**
     * Moves a player to the Dead channel.
     * @param {Player} player - The player to move.
     */
    async moveToDeadChannel(player) {
        try {
            if (!this.deadChannel) {
                logger.warn('Dead channel is not set');
                return;
            }

            // Update dead channel permissions for the dead player
            await this.deadChannel.permissionOverwrites.create(player.id, {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true
            });

            await this.deadChannel.send(`**${player.username}** has joined the dead chat.`);
            await player.sendDM('You have died! You can now speak with other dead players in the #dead-players channel.');
            
            logger.info('Player moved to Dead channel', { playerId: player.id });
        } catch (error) {
            logger.error('Error moving player to Dead channel', { error, playerId: player.id });
        }
    }

    /**
 * Handles the death of lovers when one dies.
 * @param {Player} player - The player who died.
 */
    async handleLoversDeath(deadPlayer) {
        try {
            logger.info('Handling lover death', {
                deadPlayerId: deadPlayer.id,
                deadPlayerName: deadPlayer.username,
                loversMap: Array.from(this.lovers.entries())
            });

            // Check both directions for lover relationship
            const loverId = this.lovers.get(deadPlayer.id);
            const reverseCheck = Array.from(this.lovers.entries())
                .find(([id, targetId]) => targetId === deadPlayer.id)?.[0];
            
            const actualLoverId = loverId || reverseCheck;

            if (!actualLoverId) {
                logger.info('No lover found for dead player', {
                    playerId: deadPlayer.id,
                    playerName: deadPlayer.username
                });
                return;
            }

            const lover = this.players.get(actualLoverId);
            if (!lover || !lover.isAlive) {
                return;
            }

            // Remove relationships before processing death
            this.lovers.delete(deadPlayer.id);
            this.lovers.delete(actualLoverId);

            // Mark as dead before sending messages
            lover.isAlive = false;

            // Send heartbreak message
            await this.broadcastMessage({
                embeds: [{
                    color: 0xff69b4,
                    title: '💔 A Heart Breaks',
                    description: `**${lover.username}** has died of heartbreak!`,
                    footer: { text: 'Love and death are forever intertwined...' }
                }]
            });
            
            // Move to dead channel after death message
            await this.moveToDeadChannel(lover);

            // Check win conditions after all deaths are processed
            this.checkWinConditions();
        } catch (error) {
            logger.error('Error handling lover death', { error });
        }
    }
    /**
     * Broadcasts a message to the game channel.
     * @param {string|object} message - The message or embed to send.
     */
    async broadcastMessage(message) {
        try {
            const channel = await this.client.channels.fetch(this.gameChannelId);
            if (!channel) {
                logger.error('Game channel not found', { gameChannelId: this.gameChannelId });
                throw new GameError('Channel Not Found', 'The game channel does not exist.');
            }
            await channel.send(message);
            logger.info('Broadcast message sent', { message: typeof message === 'string' ? message : 'Embed object' });
        } catch (error) {
            logger.error('Error broadcasting message', { error });
            // Throw wrapped error to allow proper handling
            throw new GameError('Broadcast Failed', 'Failed to send message to game channel.');
        }
    }

    /**
     * Retrieves a single player by role.
     * @param {string} role - The role to search for.
     * @returns {Player|null} - The player with the specified role or null.
     */
    getPlayerByRole(role) {
        const player = Array.from(this.players.values()).find(
            (p) => p.role === role && p.isAlive
        );
        if (!player && role !== ROLES.CUPID) {
            logger.warn('No player found with role', { role });
            logger.info('Current players and their roles:', {
                players: Array.from(this.players.values()).map(p => `${p.username}: ${p.role}`)
            });
        }
        return player || null;
    }

    /**
     * Retrieves all players with a specific role.
     * @param {string} role - The role to search for.
     * @returns {Player[]} - Array of players with the specified role.
     */
    getPlayersByRole(role) {
        return Array.from(this.players.values()).filter(
            (player) => player.role === role && player.isAlive
        );
    }

    /**
     * Retrieves a player by their username.
     * @param {string} username - The username to search for.
     * @returns {Player|null} - The player with the specified username or null.
     */
    getPlayerByUsername(username) {
        return Array.from(this.players.values()).find(
            (player) => player.username.toLowerCase() === username.toLowerCase()
        ) || null;
    }

    /**
     * Retrieves all alive players.
     * @returns {Player[]} - Array of alive players.
     */
    getAlivePlayers() {
        return Array.from(this.players.values()).filter((player) => player.isAlive);
    }
    
    async advanceToDay() {
        try {
            // Guard against multiple transitions
            if (this.phase === PHASES.DAY) {
                logger.warn('Already in Day phase, skipping transition');
                return;
            }
    
            this.phase = PHASES.DAY;
            
            // Clear any night state
            this.completedNightActions.clear();
            this.expectedNightActions.clear();
            this.nightActions = {};
            
            await this.broadcastMessage({
                embeds: [{
                    color: 0xFFA500,
                    title: '☀️ Dawn Breaks Over the Village',
                    description: 
                        '*The morning sun reveals the events of the night...*\n\n' +
                        '**All players:** Please turn your cameras and microphones ON.\n' +
                        'The time for discussion begins. Who among you seems suspicious?',
                    footer: { text: 'Debate wisely, for a wrong accusation could doom the village.' }
                }]
            });
    
            const channel = await this.client.channels.fetch(this.gameChannelId);
            await dayPhaseHandler.createDayPhaseUI(channel, this.players);
    
            logger.info(`Advanced to Day ${this.round}`);
        } catch (error) {
            logger.error('Error advancing to Day phase', { error });
            throw error;
        }
    }
    /**
     * Shuts down the game, cleaning up channels and resetting state.
     */
    async shutdownGame() {
        try {
            await this.cleanupChannels();
            this.players.forEach(player => player.reset());
            this.phase = PHASES.LOBBY;
            this.round = 0;
            this.votes.clear();
            this.nightActions = {};
            this.lovers.clear();
            this.selectedRoles.clear();
            this.gameOver = false;
            this.lastProtectedPlayer = null;
            logger.info('Game has been shut down and reset');
        } catch (error) {
            logger.error('Error shutting down the game', { error });
            throw error;
        }
    }

    /**
     * Cleans up private channels after the game ends.
     */
    async cleanupChannels() {
        try {
            if (this.werewolfChannel) {
                try {
                    await this.werewolfChannel.delete();
                    logger.info('Werewolf channel deleted successfully');
                } catch (error) {
                    logger.error('Error deleting werewolf channel', { error });
                }
            }

            if (this.deadChannel) {
                try {
                    await this.deadChannel.delete();
                    logger.info('Dead channel deleted successfully');
                } catch (error) {
                    logger.error('Error deleting dead channel', { error });
                }
            }

            // Clear the references
            this.werewolfChannel = null;
            this.deadChannel = null;
        } catch (error) {
            logger.error('Error in cleanupChannels', { error });
            throw error;
        }
    }

    /**
     * Adds a role to the selected roles configuration
     * @param {string} role - The role to add
     */
    addRole(role) {
        if (!ROLE_CONFIG[role]) {
            throw new GameError('Invalid role', `${role} is not a valid optional role.`);
        }

        const currentCount = this.selectedRoles.get(role) || 0;
        const maxCount = typeof ROLE_CONFIG[role].maxCount === 'function' 
            ? ROLE_CONFIG[role].maxCount(this.players.size)
            : ROLE_CONFIG[role].maxCount;

        if (currentCount >= maxCount) {
            throw new GameError('Role limit reached', `Cannot add more ${role} roles.`);
        }

        this.selectedRoles.set(role, currentCount + 1);
        logger.info(`Added ${role} role`, { currentCount: currentCount + 1 });
    }

    /**
     * Removes a role from the selected roles configuration
     * @param {string} role - The role to remove
     */
    removeRole(role) {
        const currentCount = this.selectedRoles.get(role) || 0;
        if (currentCount <= 0) {
            throw new GameError('No role to remove', `There are no ${role} roles to remove.`);
        }

        this.selectedRoles.set(role, currentCount - 1);
        if (this.selectedRoles.get(role) === 0) {
            this.selectedRoles.delete(role);
        }
        logger.info(`Removed ${role} role`, { currentCount: currentCount - 1 });
    }

    // New method in WerewolfGame.js
    async processNightAction(playerId, action, target) {
        await this.nightActionProcessor.processNightAction(playerId, action, target);
        
        // After processing the action, check if all actions are complete
        await this.checkAndProcessNightActions();
    }

    // Nomination methods
    async nominate(nominatorId, targetId) {
        if (this.phase !== PHASES.DAY) {
            throw new GameError('Wrong phase', 'Nominations can only be made during the day.');
        }

        const nominator = this.players.get(nominatorId);
        const target = this.players.get(targetId);

        if (!nominator?.isAlive) {
            throw new GameError('Invalid nominator', 'Dead players cannot make nominations.');
        }
        if (!target?.isAlive) {
            throw new GameError('Invalid target', 'Dead players cannot be nominated.');
        }
        if (nominatorId === targetId) {
            throw new GameError('Invalid target', 'You cannot nominate yourself.');
        }

        // Don't change phase, just set nomination state
        this.nominatedPlayer = targetId;
        this.nominator = nominatorId;
        this.votingOpen = false;

        // Start nomination timeout
        this.nominationTimeout = setTimeout(async () => {
            if (this.nominatedPlayer && !this.votingOpen) {
                await this.clearNomination('No second received within one minute. Nomination failed.');
            }
        }, this.NOMINATION_WAIT_TIME);

        await this.broadcastMessage({
            embeds: [{
                title: 'Player Nominated',
                description: `${nominator.username} has nominated ${target.username} for elimination.\n` +
                           `A second is required within one minute to proceed to voting.`
            }]
        });

        logger.info('Player nominated', { 
            nominator: nominator.username, 
            target: target.username 
        });
    }

    async second(seconderId) {
        if (!this.nominatedPlayer || this.votingOpen) {
            throw new GameError('Invalid state', 'No active nomination to second.');
        }

        const seconder = this.players.get(seconderId);
        if (!seconder?.isAlive) {
            throw new GameError('Invalid seconder', 'Dead players cannot second nominations.');
        }
        if (seconderId === this.nominator) {
            throw new GameError('Invalid seconder', 'The nominator cannot second their own nomination.');
        }

        this.seconder = seconderId;
        this.votingOpen = true;
        this.votes.clear();

        logger.info('Nomination seconded', {
            seconder: seconder.username,
            target: this.players.get(this.nominatedPlayer).username
        });
    }

    async submitVote(voterId, isGuilty) {
        if (!this.votingOpen) {
            throw new GameError('Invalid state', 'Voting is not currently open.');
        }
        const voter = this.players.get(voterId);
        if (!voter?.isAlive) {
            throw new GameError('Invalid voter', 'Dead players cannot vote.');
        }

        if (voterId === this.nominatedPlayer) {
            throw new GameError('Invalid voter', 'You cannot vote in your own nomination.');
        }

        // Record the vote
        this.votes.set(voterId, isGuilty);

        // Check if all votes are in
        const eligibleVoters = Array.from(this.players.values())
            .filter(p => p.isAlive && p.id !== this.nominatedPlayer)
            .length;

        if (this.votes.size >= eligibleVoters) {
            // Process voting results
            const results = await this.voteProcessor.processVotes();
            
            // Note: We don't need to handle phase transition here anymore
            // as it's handled in the VoteProcessor based on the elimination result
            
            return results;
        }

        return null;
    }

    async advancePhase() {
        try {
            const validTransitions = PHASE_TRANSITIONS[this.phase];
            if (!validTransitions || validTransitions.length === 0) {
                throw new GameError('Invalid phase', 'Cannot advance from current game phase.');
            }
    
            const nextPhase = validTransitions[0];
            const phaseMessages = {
                [PHASES.DAY]: {
                    title: '☀️ Dawn Breaks',
                    description: '*The morning sun rises over the village...*\n\n' +
                        '**All players:** Please turn your cameras and microphones ON.\n' +
                        `Round ${this.round}: The village gathers to discuss the night's events.`
                },
                [PHASES.NIGHT]: {
                    title: '🌙 Night Falls',
                    description: '*Darkness descends upon the village...*\n\n' +
                        '**All players:** Please turn your cameras and microphones OFF.\n' +
                        'Check your DMs for your night actions.'
                }
            };
    
            this.phase = nextPhase;
            
            // Send thematic transition message
            if (phaseMessages[nextPhase]) {
                await this.broadcastMessage({
                    embeds: [{
                        color: nextPhase === PHASES.DAY ? 0xFFA500 : 0x000066,
                        title: phaseMessages[nextPhase].title,
                        description: phaseMessages[nextPhase].description,
                        footer: { text: `Day ${this.round}` }
                    }]
                });
            }
    
            logger.info(`Phase advanced to ${this.phase}`, { round: this.round });
        } catch (error) {
            logger.error('Error advancing phase', { error });
            throw error;
        }
    }

    clearVotingState() {
        this.nominatedPlayer = null;
        this.nominator = null;
        this.seconder = null;
        this.votes.clear();
        this.votingOpen = false;
        if (this.nominationTimeout) {
            clearTimeout(this.nominationTimeout);
            this.nominationTimeout = null;
        }
    }

    // Add to WerewolfGame class

    async processVotes() {
        return await this.voteProcessor.processVotes();
    }

    async clearNomination(reason) {
        if (this.nominationTimeout) {
            clearTimeout(this.nominationTimeout);
            this.nominationTimeout = null;
        }

        // Reset nomination state but stay in DAY phase
        this.nominatedPlayer = null;
        this.nominator = null;
        this.seconder = null;
        this.votingOpen = false;
        this.votes.clear();

        await this.broadcastMessage({
            embeds: [{
                title: 'Nomination Failed',
                description: reason
            }]
        });

        logger.info('Nomination cleared', { reason });
    }

    cleanup() {
        if (this.nightActionTimeout) {
            clearTimeout(this.nightActionTimeout);
            this.nightActionTimeout = null;
        }
        // Add any other cleanup needed
    }

    checkWinConditions() {
        // Don't check win conditions during setup phases
        if (this.phase === PHASES.LOBBY || this.phase === PHASES.NIGHT_ZERO) {
            return false;
        }

        // If game is already over, don't check again
        if (this.gameOver) {
            return true;
        }

        // Get all living players
        const alivePlayers = this.getAlivePlayers();
        
        // Count living werewolves
        const livingWerewolves = alivePlayers.filter(p => p.role === ROLES.WEREWOLF).length;
        
        // Count living villager team (everyone who's not a werewolf)
        const livingVillagerTeam = alivePlayers.filter(p => p.role !== ROLES.WEREWOLF).length;

        let winners = new Set();
        let gameOver = false;

        // Calculate game stats
        const gameStats = {
            rounds: this.round,
            totalPlayers: this.players.size,
            eliminations: this.players.size - alivePlayers.length,
            duration: this.getGameDuration()
        };

        // If all werewolves are dead, villagers win
        if (livingWerewolves === 0) {
            this.phase = PHASES.GAME_OVER;
            this.gameOver = true;
            // Add all non-werewolf players to winners
            this.players.forEach(player => {
                if (player.role !== ROLES.WEREWOLF) {
                    winners.add(player);
                }
            });
            gameOver = true;
        }

        // If werewolves reach parity with or outnumber villager team, werewolves win
        if (livingWerewolves >= livingVillagerTeam) {
            this.phase = PHASES.GAME_OVER;
            this.gameOver = true;
            // Add all werewolf players to winners
            this.players.forEach(player => {
                if (player.role === ROLES.WEREWOLF) {
                    winners.add(player);
                }
            });
            gameOver = true;
        }

        if (gameOver) {
            // Send game end message with buttons using centralized creators
            this.broadcastMessage({
                embeds: [createGameEndEmbed(Array.from(winners), gameStats)],
                components: [createGameEndButtons()]
            });

            // Update player stats
            this.updatePlayerStats(winners);
        }

        return gameOver;
    }

    // Add this helper method to calculate game duration
    getGameDuration() {
        const now = Date.now();
        const gameStart = this.gameStartTime || now; // Add gameStartTime property in constructor
        const duration = now - gameStart;
        
        const hours = Math.floor(duration / (1000 * 60 * 60));
        const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
        
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        return `${minutes}m`;
    }

    async updatePlayerStats(winners) {
        try {
            logger.info('Starting to update player stats', { 
                playerCount: this.players.size,
                winnerCount: winners.size 
            });
    
            for (const [playerId, player] of this.players) {
                try {
                    // Convert ID to string to match database format
                    const discordId = playerId.toString();
                    
                    let stats = await PlayerStats.findByPk(discordId);
                    if (!stats) {
                        logger.info('Creating new player stats record', { 
                            discordId, 
                            username: player.username 
                        });
                        stats = await PlayerStats.create({
                            discordId,
                            username: player.username
                        });
                    }
    
                    // Update stats
                    await stats.increment('gamesPlayed');
                    if (winners.has(playerId)) {
                        await stats.increment('gamesWon');
                    }
    
                    // Update role-specific count
                    const roleField = `times${player.role.charAt(0).toUpperCase() + player.role.slice(1)}`;
                    await stats.increment(roleField);
    
                    logger.info('Updated stats for player', { 
                        discordId,
                        username: player.username,
                        role: player.role,
                        won: winners.has(playerId)
                    });
                } catch (error) {
                    logger.error('Error updating individual player stats', {
                        playerId,
                        error: error.message
                    });
                }
            }
        } catch (error) {
            logger.error('Error in updatePlayerStats', { 
                error: error.message,
                stack: error.stack 
            });
        }
    }
    // Add to the class

    async processLoverSelection(cupidId, targetId) {
        try {
            const cupid = this.players.get(cupidId);
            const target = this.players.get(targetId);
        
            if (!cupid || !target) {
                throw new GameError('Invalid Selection', 'Selected player not found.');
            }
        
            if (!target.isAlive) {
                throw new GameError('Invalid Selection', 'Cannot select a dead player as lover.');
            }
        
            if (cupid.id === target.id) {
                throw new GameError('Invalid Selection', 'You cannot select yourself as a lover.');
            }
        
            // Set up bidirectional lover relationship
            this.lovers.set(cupid.id, target.id);
            this.lovers.set(target.id, cupid.id);  // Add this line to make it bidirectional
            
            logger.info('Cupid chose lover', {
                cupidId,
                cupidName: cupid.username,
                loverId: targetId,
                loverName: target.username,
                loversMap: Array.from(this.lovers.entries())
            });
        
            // Notify both players
            try {
                await target.sendDM({
                    embeds: [{
                        color: 0xff69b4,
                        title: '💘 You Have Been Struck By Cupid\'s Arrow!',
                        description: `You have fallen in love with **${cupid.username}**. If either of you dies, the other will die of heartbreak.`
                    }]
                });
                
                await cupid.sendDM({
                    embeds: [{
                        color: 0xff69b4,
                        title: '💘 Love Blossoms',
                        description: `You have chosen **${target.username}** as your lover. If either of you dies, the other will die of heartbreak.`
                    }]
                });
            } catch (error) {
                logger.error('Failed to notify lovers', { error });
                throw new GameError('Communication Error', 'Failed to notify players of their lover status.');
            }

            // Mark Cupid's action as completed
            this.completedNightActions.add(cupidId);
            
            return true;
        } catch (error) {
            if (!(error instanceof GameError)) {
                throw new GameError('Lover Selection Failed', 'An error occurred while processing lover selection.');
            }
            throw error;
        }
    }
    // Start of Selection
    getPhase() {
        return this.phase;
    }

    isInLobby() {
        return this.phase === PHASES.LOBBY;
    }

    // Add this method to the WerewolfGame class
    isGameCreatorOrAuthorized(userId) {
        return userId === this.gameCreatorId || this.authorizedIds.includes(userId);
    }

    async checkAndProcessNightActions() {
        // Check if all expected actions are completed
        const allActionsComplete = Array.from(this.expectedNightActions).every(
            playerId => this.completedNightActions.has(playerId)
        );

        if (allActionsComplete) {
            logger.info('All night actions completed, processing actions', {
                expectedActions: Array.from(this.expectedNightActions),
                completedActions: Array.from(this.completedNightActions)
            });
            await this.nightActionProcessor.processNightActions();
        }
        return allActionsComplete;
    }

    /**
     * Serializes the game state for database storage
     */
    serializeGame() {
        try {
            // First log the current state before serialization
            logger.info('Current game state before serialization', {
                phase: this.phase,
                round: this.round,
                playerCount: this.players.size,
                playersWithRoles: Array.from(this.players.values()).filter(p => p.role).length
            });
    
            const serializedState = {
                players: Array.from(this.players.values()).map(player => ({
                    id: player.id,
                    username: player.username,
                    role: player.role || null,  // Explicitly handle null case
                    isAlive: Boolean(player.isAlive),
                    isProtected: Boolean(player.isProtected)
                })),
                phase: this.phase,
                round: Number(this.round),
                votes: Array.from(this.votes.entries()),
                nightActions: this.nightActions || {},
                lastProtectedPlayer: this.lastProtectedPlayer,
                lovers: Array.from(this.lovers.entries()),
                selectedRoles: Array.from(this.selectedRoles.entries()),
                pendingHunterRevenge: this.pendingHunterRevenge,
                nominatedPlayer: this.nominatedPlayer,
                nominator: this.nominator,
                seconder: this.seconder,
                votingOpen: Boolean(this.votingOpen),
                completedNightActions: Array.from(this.completedNightActions),
                expectedNightActions: Array.from(this.expectedNightActions)
            };
    
            // Validate the serialized state
            if (!serializedState.phase || !PHASES[serializedState.phase]) {
                throw new Error(`Invalid phase in game state: ${serializedState.phase}`);
            }
    
            return serializedState;
        } catch (error) {
            logger.error('Error in serializeGame', { 
                error: error.message,
                stack: error.stack 
            });
            throw error;
        }
    }

    /**
     * Saves the current game state to the database
     */
    async saveGameState() {
        try {
            // First get the current state
            const currentState = this.serializeGame();
            
            // Log the state we're about to save
            logger.info('Saving game state', { 
                guildId: this.guildId,
                currentPhase: this.phase,
                statePhase: currentState.phase,
                round: this.round,
                playerCount: this.players.size
            });
    
            // Save to database with explicit phase from current game state
            await Game.upsert({
                guildId: this.guildId,
                channelId: this.gameChannelId,
                creatorId: this.gameCreatorId,
                phase: this.phase,  // Use the actual current phase
                round: this.round,
                gameState: currentState,
                lastUpdated: new Date()
            });
            
            // Verify the save was successful
            const savedGame = await Game.findByPk(this.guildId);
            if (savedGame.phase !== this.phase) {
                logger.error('Phase mismatch after save', {
                    expectedPhase: this.phase,
                    savedPhase: savedGame.phase
                });
                throw new Error('Game state save verification failed');
            }
    
            logger.info('Game state saved successfully', { 
                guildId: this.guildId,
                phase: savedGame.phase,
                round: savedGame.round
            });
        } catch (error) {
            logger.error('Failed to save game state', { 
                error,
                currentPhase: this.phase,
                guildId: this.guildId
            });
            throw error;
        }
    }

    /**
     * Restores a game from saved state
     */
    static async restoreGame(client, guildId) {
        try {
            const savedGame = await Game.findByPk(guildId);
            if (!savedGame) {
                logger.error('No saved game found during restoration', { guildId });
                return null;
            }
    
            // Validate required fields
            if (!savedGame.channelId || !savedGame.creatorId) {
                logger.error('Saved game missing required fields', { 
                    guildId,
                    channelId: savedGame.channelId,
                    creatorId: savedGame.creatorId 
                });
                return null;
            }
    
            // Validate gameState
            if (!savedGame.gameState || typeof savedGame.gameState !== 'object') {
                logger.error('Invalid game state in saved game', { 
                    guildId,
                    gameState: savedGame.gameState 
                });
                return null;
            }
    
            // Create new game instance with error handling
            let game;
            try {
                game = new WerewolfGame(
                    client,
                    savedGame.guildId,
                    savedGame.channelId,
                    savedGame.creatorId
                );
            } catch (error) {
                logger.error('Error creating new game instance', { 
                    error: error.message,
                    guildId 
                });
                throw error;
            }
    
            // Rest of restoreGame remains the same...
            game.phase = savedGame.phase;
            game.round = savedGame.round;
    
            // Then restore the detailed state
            const state = savedGame.gameState;
            if (!state) {
                logger.error('No game state found in saved game', { guildId });
                return null;
            }
    
            try {
                // Restore players with error handling
                if (state.players && Array.isArray(state.players)) {
                    for (const playerData of state.players) {
                        try {
                            const player = new Player(playerData.id, playerData.username, client);
                            player.role = playerData.role;
                            player.isAlive = playerData.isAlive;
                            player.isProtected = playerData.isProtected;
                            game.players.set(player.id, player);
                        } catch (error) {
                            logger.error('Error restoring player', { error, playerData });
                        }
                    }
                }
    
                // Restore other game state with type checking
                game.votes = new Map(Array.isArray(state.votes) ? state.votes : []);
                game.nightActions = state.nightActions || {};
                game.lastProtectedPlayer = state.lastProtectedPlayer;
                game.lovers = new Map(Array.isArray(state.lovers) ? state.lovers : []);
                game.selectedRoles = new Map(Array.isArray(state.selectedRoles) ? state.selectedRoles : []);
                game.pendingHunterRevenge = state.pendingHunterRevenge;
                game.nominatedPlayer = state.nominatedPlayer;
                game.nominator = state.nominator;
                game.seconder = state.seconder;
                game.votingOpen = Boolean(state.votingOpen);
                game.completedNightActions = new Set(Array.isArray(state.completedNightActions) ? state.completedNightActions : []);
                game.expectedNightActions = new Set(Array.isArray(state.expectedNightActions) ? state.expectedNightActions : []);
            } catch (error) {
                logger.error('Error restoring game state', { error });
                throw error;
            }

            // Restore special channels if they exist
            try {
                // First fetch the guild
                const guild = await client.guilds.fetch(guildId);
                if (!guild) {
                    logger.error('Could not fetch guild during restoration', { guildId });
                    return null;
                }

                // Then fetch the category
                const categoryId = process.env.WEREWOLF_CATEGORY_ID;
                if (!categoryId) {
                    logger.warn('WEREWOLF_CATEGORY_ID not set in environment variables', { guildId });
                } else {
                    try {
                        const category = await guild.channels.fetch(categoryId);
                        
                        if (category) {
                            // Find channels by their proper names
                            const channels = await guild.channels.fetch();
                            const werewolfChannel = channels.find(c => 
                                c.parentId === categoryId && c.name === 'werewolf-channel'
                            );
                            const deadChannel = channels.find(c => 
                                c.parentId === categoryId && c.name === 'dead-players'
                            );
                            
                            if (werewolfChannel) {
                                game.werewolfChannel = werewolfChannel;
                                logger.info('Restored werewolf channel', { channelId: werewolfChannel.id });
                            }
                            
                            if (deadChannel) {
                                game.deadChannel = deadChannel;
                                logger.info('Restored dead channel', { channelId: deadChannel.id });
                            }
                        }
                    } catch (error) {
                        logger.warn('Error fetching special channels', { 
                            error: error.message,
                            categoryId 
                        });
                        // Don't throw - we can continue without these channels
                    }
                }

                // Recreate phase-specific UI
                try {
                    const gameChannel = await guild.channels.fetch(savedGame.channelId);
                    if (gameChannel) {
                        switch (game.phase) {
                            case PHASES.DAY:
                                // If there's an active nomination and voting
                                if (game.nominatedPlayer && game.seconder) {
                                    const target = game.players.get(game.nominatedPlayer);
                                    const nominator = game.players.get(game.nominator);
                                    const seconder = game.players.get(game.seconder);
                                    
                                    if (target && nominator && seconder) {
                                        // Recreate voting UI
                                        const lynchButton = new ButtonBuilder()
                                            .setCustomId(`vote_${target.id}_guilty`)
                                            .setLabel('Lynch')
                                            .setStyle(ButtonStyle.Danger);

                                        const spareButton = new ButtonBuilder()
                                            .setCustomId(`vote_${target.id}_innocent`)
                                            .setLabel('Let Live')
                                            .setStyle(ButtonStyle.Success);

                                        const row = new ActionRowBuilder()
                                            .addComponents(lynchButton, spareButton);

                                        await gameChannel.send({
                                            embeds: [createVoteResultsEmbed(target, nominator, game)],
                                            components: [row]
                                        });
                                    }
                                } else {
                                    // Create regular day phase UI if no active vote
                                    await dayPhaseHandler.createDayPhaseUI(gameChannel, game.players);
                                }
                                break;

                            case PHASES.NIGHT:
                            case PHASES.NIGHT_ZERO:
                                // Recreate night phase UI and reminders
                                if (typeof game.sendNightActionReminders === 'function') {
                                    await game.sendNightActionReminders();
                                }
                                break;
                        }
                    } else {
                        logger.error('Could not fetch game channel during restoration', {
                            channelId: savedGame.channelId
                        });
                    }
                } catch (error) {
                    logger.error('Error recreating game UI', {
                        error: error.message,
                        phase: game.phase
                    });
                    // Don't throw - we can continue without recreating UI
                }
            } catch (error) {
                logger.error('Error restoring channels and UI', {
                    error: error.message,
                    guildId
                });
                // Don't throw - we can continue without channels
            }

            // Add DM notifications to all players
            for (const [playerId, player] of game.players) {
                try {
                    const dmChannel = await player.getDMChannel();
                    if (dmChannel) {
                        await dmChannel.send({
                            embeds: [{
                                color: 0x0099ff,
                                title: '🔄 Game Restored',
                                description: 
                                    'The game you were participating in has been restored.\n\n' +
                                    `**Your Role:** ${player.role}\n` +
                                    `**Current Phase:** ${game.phase}\n` +
                                    `**Status:** ${player.isAlive ? '🟢 Alive' : '💀 Dead'}\n\n` +
                                    (game.phase === PHASES.NIGHT && player.isAlive ? 
                                        'Check your action menu if you have any night actions to complete.' : 
                                        'Continue participating in the game channel.'),
                                footer: { text: 'Use /game-status for detailed game information' }
                            }]
                        });
                    }
                } catch (error) {
                    logger.warn('Failed to send DM to player during game restoration', {
                        playerId,
                        error
                    });
                }
            }

            // Notify players of game restoration
            const phaseInfo = {
                [PHASES.LOBBY]: "The game is in the lobby phase.",
                [PHASES.NIGHT_ZERO]: "It is currently the first night. Check your DMs for any actions.",
                [PHASES.NIGHT]: "It is currently night. Check your DMs for any actions you need to take.",
                [PHASES.DAY]: "It is currently day. Continue your discussion and voting.",
                [PHASES.GAME_OVER]: "The game has ended."
            };

            await game.broadcastMessage({
                embeds: [{
                    color: 0x0099ff,
                    title: '🔄 Game Restored',
                    description: 
                        'The game has been restored after a brief interruption.\n\n' +
                        `**Current Phase:** ${game.phase}\n` +
                        `**Round:** ${game.round}\n` +
                        `**Players Alive:** ${game.getAlivePlayers().length}/${game.players.size}\n\n` +
                        phaseInfo[game.phase],
                    footer: { text: 'Use /game-status for detailed game information' }
                }]
            });

            logger.info('Game restored successfully', {
                guildId,
                phase: game.phase,
                round: game.round,
                alivePlayers: game.getAlivePlayers().length
            });

            return game;
        } catch (error) {
            logger.error('Error restoring game', { 
                error: error.message,
                stack: error.stack,
                guildId 
            });
            throw error;
        }
    }
};

module.exports = WerewolfGame;

