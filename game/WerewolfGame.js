// game/WerewolfGame.js

const Player = require('./Player');
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const { GameError } = require('../utils/error-handler');
const logger = require('../utils/logger');
const ROLES = require('../constants/roles');  // Direct import of frozen object
const PHASES = require('../constants/phases'); // Direct import of frozen object
const { createDayPhaseEmbed, createVoteResultsEmbed } = require('../utils/embedCreator');

// Define roles and their properties in a configuration object
const ROLE_CONFIG = {
    [ROLES.WEREWOLF]: { maxCount: (playerCount) => Math.floor(playerCount / 4) },
    [ROLES.SEER]: { maxCount: 1 },
    [ROLES.DOCTOR]: { maxCount: 1 },
    [ROLES.CUPID]: { maxCount: 1 },
    [ROLES.VILLAGER]: { maxCount: (playerCount) => playerCount }
};

const PHASE_TRANSITIONS = {
    [PHASES.LOBBY]: ['NIGHT_ZERO'],
    [PHASES.NIGHT_ZERO]: ['DAY'],
    [PHASES.DAY]: ['NIGHT', 'NOMINATION'],
    [PHASES.NOMINATION]: ['VOTING'],
    [PHASES.VOTING]: ['DAY', 'GAME_OVER'],
    [PHASES.NIGHT]: ['DAY', 'GAME_OVER'],
    [PHASES.GAME_OVER]: []
};

class WerewolfGame {
    constructor(client, guildId, gameChannelId, gameCreatorId, authorizedIds = []) {
        this.client = client;
        this.guildId = guildId;
        this.gameChannelId = gameChannelId;
        this.gameCreatorId = gameCreatorId;
        this.authorizedIds = authorizedIds; // Array of user IDs authorized to advance phases

        this.players = new Map(); // Map of playerId -> Player instance
        this.phase = PHASES.LOBBY;  // This should be set to LOBBY
        this.round = 0;
        this.votes = new Map(); // Map of playerId -> votedPlayerId
        this.nightActions = {}; // Store night actions like attacks, investigations, etc.
        this.werewolfChannel = null; // Private channel for werewolves
        this.deadChannel = null; // Channel for dead players
        this.gameOver = false;
        this.lastProtectedPlayer = null; // Track the last protected player
        this.lovers = new Map(); // Store lover pairs
        this.selectedRoles = new Map(); // Dynamic role selection

        // Voting state
        this.nominatedPlayer = null;
        this.nominator = null;
        this.seconder = null;
        this.votes = new Map();  // voterId -> boolean (true = guilty)
        this.votingOpen = false;
        this.nominationTimeout = null;
        this.NOMINATION_WAIT_TIME = 60000; // 1 minute
        
        logger.info('Game created with phase', { 
            phase: this.phase,
            isLobby: this.phase === PHASES.LOBBY,
            phaseValue: PHASES.LOBBY  // Add this to verify PHASES.LOBBY value
        });
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
            if (this.players.size < 6) {
                throw new GameError('Not enough players', 'Not enough players to start the game. Minimum 6 players required.');
            }
            if (this.selectedRoles.size === 0) {
                throw new GameError('Roles Not Configured', 'Please configure the game roles before starting.');
            }

            // Set phase before other operations
            this.phase = PHASES.NIGHT_ZERO;
            this.round = 0;

            await this.assignRoles();
            await this.createPrivateChannels();
            await this.broadcastMessage(`Game is starting with ${this.players.size} players, including ${this.getPlayersByRole(ROLES.WEREWOLF).length} werewolves.`);
            
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
            const playerArray = Array.from(this.players.values());
            const playerCount = playerArray.length;
    
            // Always include one Seer
            let rolePool = [ROLES.SEER];
    
            // Calculate number of werewolves
            const werewolfCount = Math.floor(playerCount / 4);
            rolePool.push(...Array(werewolfCount).fill(ROLES.WEREWOLF));
    
            // Add selected special roles
            for (const [role, count] of this.selectedRoles.entries()) {
                rolePool.push(...Array(count).fill(role));
            }
    
            // Fill remaining slots with villagers
            const remainingSlots = playerCount - rolePool.length;
            rolePool.push(...Array(remainingSlots).fill(ROLES.VILLAGER));
    
            // Shuffle the role pool
            rolePool = this.shuffleArray(rolePool);
    
            // Assign roles to players
            for (let i = 0; i < playerArray.length; i++) {
                const player = playerArray[i];
                const role = rolePool[i];
                player.assignRole(role);
            }
    
            logger.info('Roles assigned to all players');
        } catch (error) {
            logger.error('Error assigning roles to players', { error });
            throw new GameError('Role Assignment Failed', 'An error occurred while assigning roles.');
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

            // Create Werewolf channel
            this.werewolfChannel = await guild.channels.create({
                name: 'werewolf-channel',
                type: 0, // GUILD_TEXT
                permissionOverwrites: [
                    {
                        id: guild.roles.everyone.id,
                        deny: ['VIEW_CHANNEL'],
                    },
                    ...Array.from(this.getPlayersByRole(ROLES.WEREWOLF)).map(player => ({
                        id: player.id,
                        allow: ['VIEW_CHANNEL', 'SEND_MESSAGES', 'READ_MESSAGE_HISTORY'],
                    })),
                ],
            });
            logger.info('Werewolf channel created');

            // Create Dead channel
            this.deadChannel = await guild.channels.create({
                name: 'dead-players',
                type: 0, // GUILD_TEXT
                permissionOverwrites: [
                    {
                        id: guild.roles.everyone.id,
                        deny: ['SEND_MESSAGES'],
                        allow: ['VIEW_CHANNEL', 'READ_MESSAGE_HISTORY'],
                    },
                ],
            });
            logger.info('Dead players channel created');
        } catch (error) {
            logger.error('Error creating private channels', { error });
            throw new GameError('Channel Creation Failed', 'Failed to create necessary channels.');
        }
    }

    /**
     * Handles Night Zero phase where initial actions occur.
     */
    async nightZero() {
        try {
            // Don't change phase here since it's already set in startGame
            this.expectedNightActions = new Set();

            // Handle Seer's automatic revelation first
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

            // Setup Cupid's action if present
            const cupid = this.getPlayerByRole(ROLES.CUPID);
            if (cupid && cupid.isAlive) {
                await cupid.sendDM('Use `/action choose_lovers` to select two players to be lovers. You have 10 minutes.');
                this.expectedNightActions.add(cupid.id);

                // Set backup timeout only if we have a Cupid
                this.nightActionTimeout = setTimeout(() => {
                    this.processNightActions();
                }, 600000);
            } else {
                // If no Cupid, advance to Day phase immediately
                await this.advancePhase();
            }

            logger.info('Night Zero started');
        } catch (error) {
            logger.error('Error during Night Zero', { error });
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
            await this.broadcastMessage(`--- Night ${this.round} ---`);

            // Notify players with night actions
            const notifications = {};

            // Only add notifications if it's not Night Zero (except for Cupid)
            if (this.phase !== PHASES.NIGHT_ZERO) {
                notifications[ROLES.WEREWOLF] = 'Use `/action attack` to choose your victim. You have 10 minutes.';
                notifications[ROLES.SEER] = 'Use `/action investigate` to learn if a player is a werewolf. You have 10 minutes.';
                notifications[ROLES.DOCTOR] = 'Use `/action protect` to save someone from the werewolves. You have 10 minutes.';
            } else {
                // Night Zero notifications
                notifications[ROLES.CUPID] = 'Use `/action choose_lovers` to select two players to be lovers. You have 10 minutes.';
                // Remove Doctor notification for Night Zero
            }

            // Send DMs to players with night actions
            for (const [role, message] of Object.entries(notifications)) {
                if (message) {
                    const player = this.getPlayerByRole(role);
                    if (player?.isAlive) {
                        await player.sendDM(message);
                    }
                }
            }

            // Set timeout for night phase
            this.nightActionTimeout = setTimeout(() => {
                this.processNightActions();
            }, 600000); // 10 minutes

            logger.info(`Game advanced to Night ${this.round}`);
        } catch (error) {
            logger.error('Error advancing to Night phase', { error });
            throw error;
        }
    }

    /**
     * Handles all night actions such as Werewolf attacks, Seer investigations, Doctor protections.
     */
    async handleNightActions() {
        try {
            // Collect actions from roles that act during the night
            const actionPromises = [];

            // Werewolves attack
            const werewolves = this.getPlayersByRole(ROLES.WEREWOLF);
            if (werewolves.length > 0) {
                actionPromises.push(this.collectWerewolfAttack(werewolves));
            }

            // Seer investigates
            const seer = this.getPlayerByRole(ROLES.SEER);
            if (seer && seer.isAlive) {
                actionPromises.push(this.collectSeerInvestigation(seer));
            }

            // Doctor protects
            const doctor = this.getPlayerByRole(ROLES.DOCTOR);
            if (doctor && doctor.isAlive) {
                actionPromises.push(this.collectDoctorProtection(doctor));
            }

            // Cupid chooses lovers
            const cupid = this.getPlayerByRole(ROLES.CUPID);
            if (cupid && cupid.isAlive) {
                actionPromises.push(this.collectCupidLovers(cupid));
            }

            // Wait for all actions to be collected
            await Promise.all(actionPromises);

            // Process night actions
            await this.processNightActions();

            // Advance to Day phase
            await this.advanceToDay();
        } catch (error) {
            logger.error('Error handling night actions', { error });
            throw error;
        }
    }

    /**
     * Collects Werewolf attack target.
     * @param {Player[]} werewolves - Array of werewolf players.
     */
    async collectWerewolfAttack(werewolves) {
        try {
            // For simplicity, if multiple werewolves are present, have them agree on a target
            // Alternatively, handle voting among werewolves to choose a target
            const attackTargets = werewolves.map(wolf => wolf.promptDM('Choose a player to attack by typing their username:'));

            const responses = await Promise.all(attackTargets);
            const validResponses = responses.filter(response => response !== null);

            if (validResponses.length === 0) {
                logger.warn('No valid attack targets provided by werewolves');
                return;
            }

            // Majority vote or consensus
            const target = this.getMostFrequent(validResponses);

            const victim = this.getPlayerByUsername(target);
            if (!victim || victim.role === ROLES.WEREWOLF || !victim.isAlive) {
                logger.warn('Invalid attack target chosen by werewolves', { target });
                return;
            }

            this.nightActions.werewolfVictim = victim.id;
            logger.info('Werewolf attack recorded', { attackerIds: werewolves.map(w => w.id), targetId: victim.id });
        } catch (error) {
            logger.error('Error collecting Werewolf attack', { error });
            throw error;
        }
    }

    /**
     * Collects Seer investigation target.
     * @param {Player} seer - The Seer player.
     */
    async collectSeerInvestigation(seer) {
        try {
            const investigationTarget = await seer.promptDM('Choose a player to investigate by typing their username:');
            if (!investigationTarget) {
                logger.warn('Seer failed to provide an investigation target', { seerId: seer.id });
                return;
            }
            const target = this.getPlayerByUsername(investigationTarget);
            if (!target || !target.isAlive) {
                await seer.sendDM('Invalid target. Your investigation has failed.');
                logger.warn('Invalid Seer investigation target', { seerId: seer.id, targetUsername: investigationTarget });
                return;
            }
            this.nightActions.seerTarget = target.id;
            logger.info('Seer investigation recorded', { seerId: seer.id, targetId: target.id });
        } catch (error) {
            logger.error('Error collecting Seer investigation', { error });
            throw error;
        }
    }

    /**
     * Collects Doctor protection target.
     * @param {Player} doctor - The Doctor player.
     */
    async collectDoctorProtection(doctor) {
        try {
            const protectTarget = await doctor.promptDM('Choose a player to protect by typing their username:');
            if (!protectTarget) {
                logger.warn('Doctor failed to provide a protection target', { doctorId: doctor.id });
                return;
            }
            const target = this.getPlayerByUsername(protectTarget);
            if (!target || !target.isAlive) {
                await doctor.sendDM('Invalid target. Your protection has failed.');
                logger.warn('Invalid Doctor protection target', { doctorId: doctor.id, targetUsername: protectTarget });
                return;
            }
            if (target.id === this.lastProtectedPlayer) {
                await doctor.sendDM('You cannot protect the same player on consecutive nights.');
                logger.warn('Doctor attempted consecutive protection', { doctorId: doctor.id, targetId: target.id });
                return;
            }
            this.nightActions.doctorProtection = target.id;
            this.lastProtectedPlayer = target.id;
            logger.info('Doctor protection recorded', { doctorId: doctor.id, protectTargetId: target.id });
        } catch (error) {
            logger.error('Error collecting Doctor protection', { error });
            throw error;
        }
    }

    /**
     * Collects Cupid's lovers selection.
     * @param {Player} cupid - The Cupid player.
     */
    async collectCupidLovers(cupid) {
        try {
            const chooseLoversMessage = 'Choose two players to be lovers by typing their usernames separated by a comma (e.g., Alice, Bob):';
            const loversFilter = m => {
                const names = m.content.split(',').map(name => name.trim());
                if (names.length !== 2) return false;
                const p1 = this.getPlayerByUsername(names[0]);
                const p2 = this.getPlayerByUsername(names[1]);
                return p1 && p2 && p1.id !== p2.id && p1.isAlive && p2.isAlive;
            };
            const loversResponse = await cupid.promptDM(chooseLoversMessage, loversFilter);
            if (!loversResponse) {
                logger.warn('Cupid failed to choose lovers in time', { cupidId: cupid.id });
                return;
            }
            const [lover1Username, lover2Username] = loversResponse.split(',').map(name => name.trim());
            const lover1 = this.getPlayerByUsername(lover1Username);
            const lover2 = this.getPlayerByUsername(lover2Username);
            if (!lover1 || !lover2 || lover1.id === lover2.id) {
                await cupid.sendDM('Invalid lovers selection.');
                logger.warn('Invalid lovers selection by Cupid', { cupidId: cupid.id, lover1Username, lover2Username });
                return;
            }
            this.setLovers(lover1.id, lover2.id);
            await cupid.sendDM(`You have chosen **${lover1.username}** and **${lover2.username}** as lovers.`);
            logger.info('Cupid chose lovers', { cupidId: cupid.id, lover1Id: lover1.id, lover2Id: lover2.id });
        } catch (error) {
            logger.error('Error collecting Cupid lovers selection', { error });
            throw error;
        }
    }

    /**
     * Processes all collected night actions.
     */
    async processNightActions() {
        // Clear any remaining timeout
        if (this.nightActionTimeout) {
            clearTimeout(this.nightActionTimeout);
            this.nightActionTimeout = null;
        }

        // Reset advance check
        this.checkAdvanceNight = false;

        // Process actions in order:
        // 1. Information gathering (Seer)
        // 2. Protection (Doctor)
        // 3. Attacks (Werewolves) - but not during Night Zero
        
        const investigations = Object.entries(this.nightActions)
            .filter(([_, action]) => action.action === 'investigate');
        const protections = Object.entries(this.nightActions)
            .filter(([_, action]) => action.action === 'protect');
        const attacks = this.phase !== PHASES.NIGHT_ZERO ? 
            Object.entries(this.nightActions)
                .filter(([_, action]) => action.action === 'attack') :
            [];

        // Process in order
        for (const [playerId, action] of investigations) {
            const seer = this.players.get(playerId);
            const target = this.players.get(action.target);
            if (seer?.isAlive && target?.isAlive) {
                const isWerewolf = target.role === ROLES.WEREWOLF;
                await seer.sendDM(`Your investigation reveals that **${target.username}** is **${isWerewolf ? 'a Werewolf' : 'Not a Werewolf'}**.`);
            }
        }

        for (const [playerId, action] of protections) {
            const target = this.players.get(action.target);
            if (target) {
                target.isProtected = true;
            }
        }

        for (const [playerId, action] of attacks) {
            const target = this.players.get(action.target);
            if (target?.isAlive && !target.isProtected) {
                target.isAlive = false;
                await this.broadcastMessage(`**${target.username}** was killed during the night.`);
                await this.moveToDeadChannel(target);
                await this.handleLoversDeath(target);
            } else if (target?.isProtected) {
                await this.broadcastMessage(`**${target.username}** was attacked by the Werewolves, but was protected by the Doctor.`);
            }
        }

        // Reset protections
        for (const player of this.players.values()) {
            player.isProtected = false;
        }

        // Advance to day if game isn't over
        if (!this.checkWinConditions()) {
            await this.advanceToDay();
        }
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
            await this.deadChannel.send(`**${player.username}** has died.`);
            logger.info('Player moved to Dead channel', { playerId: player.id });
        } catch (error) {
            logger.error('Error moving player to Dead channel', { error, playerId: player.id });
        }
    }

    /**
     * Handles the death of lovers when one dies.
     * @param {Player} player - The player who died.
     */
    async handleLoversDeath(player) {
        try {
            const loverId = this.lovers.get(player.id);
            if (!loverId) return;
    
            const lover = this.players.get(loverId);
            if (!lover) return;
    
            // Set both players to dead status atomically
            const deaths = [];
            if (lover.isAlive) {
                lover.isAlive = false;
                deaths.push({
                    player: lover,
                    message: `**${lover.username}**, who was in love with **${player.username}**, has died of heartbreak.`
                });
            }
    
            // Process all deaths
            for (const death of deaths) {
                await this.broadcastMessage(death.message);
                await this.moveToDeadChannel(death.player);
            }
    
            // Clean up relationships once
            this.lovers.delete(player.id);
            this.lovers.delete(loverId);
    
            // Check win conditions once after all deaths
            if (deaths.length > 0) {
                await this.checkWinConditions();
                logger.info('Lovers died of heartbreak', { 
                    deadPlayerId: player.id,
                    loverId: lover.id 
                });
            }
        } catch (error) {
            logger.error('Error handling lovers\' death', { error, playerId: player.id });
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
            logger.info('Broadcast message sent to game channel', { message: typeof message === 'string' ? message : 'Embed object' });
        } catch (error) {
            logger.error('Error broadcasting message to game channel', { error });
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
        logger.info('Cleaning up channels');

        const cleanupChannel = async (channel, channelName) => {
            if (!channel) {
                logger.info(`${channelName} channel not found`);
                return;
            }

            try {
                // Check permissions
                const permissions = channel.permissionsFor(this.client.user);
                if (!permissions || !permissions.has('MANAGE_CHANNELS')) {
                    logger.warn(`Bot lacks permission to delete ${channelName} channel`);
                    return;
                }

                await channel.delete();
                logger.info(`${channelName} channel deleted successfully`);
            } catch (error) {
                if (error.code === 10003) { // Unknown Channel error
                    logger.info(`${channelName} channel no longer exists`);
                } else {
                    logger.error(`Error deleting ${channelName} channel`, { error });
                }
            }
        };

        // Execute channel deletions concurrently
        await Promise.all([
            cleanupChannel(this.werewolfChannel, 'Werewolf'),
            cleanupChannel(this.deadChannel, 'Dead')
        ]);

        // Reset channel properties
        this.werewolfChannel = null;
        this.deadChannel = null;
    }

    /**
     * Adds a role to the selected roles configuration
     * @param {string} role - The role to add
     */
    addRole(role) {
        if (!this.selectedRoles) {
            this.selectedRoles = new Map();
        }
        // Missing phase check!
        // Should have:
        if (this.phase !== PHASES.LOBBY) {
            throw new GameError('Cannot modify roles', 'Cannot modify roles after game has started');
        }
        
        const currentCount = this.selectedRoles.get(role) || 0;
        
        // Validate role count based on game rules
        if (role === ROLES.SEER && currentCount >= 1) {
            throw new GameError('Invalid Role Count', 'There can only be one Seer.');
        }
        if (role === ROLES.DOCTOR && currentCount >= 1) {
            throw new GameError('Invalid Role Count', 'There can only be one Doctor.');
        }
        if (role === ROLES.CUPID && currentCount >= 1) {
            throw new GameError('Invalid Role Count', 'There can only be one Cupid.');
        }
        if (role === ROLES.WEREWOLF && currentCount >= Math.floor(this.players.size / 4)) {
            throw new GameError('Invalid Role Count', 'Too many Werewolves for current player count.');
        }

        this.selectedRoles.set(role, currentCount + 1);
        logger.info('Role added to configuration', { role, count: currentCount + 1 });
    }

    /**
     * Removes a role from the selected roles configuration
     * @param {string} role - The role to remove
     */
    removeRole(role) {
        if (!this.selectedRoles) {
            this.selectedRoles = new Map();
            throw new GameError('No Roles', 'There are no roles to remove.');
        }

        const currentCount = this.selectedRoles.get(role);
        if (!currentCount || currentCount <= 0) {
            throw new GameError('Invalid Role', `There are no ${role} roles to remove.`);
        }

        if (currentCount === 1) {
            this.selectedRoles.delete(role);
        } else {
            this.selectedRoles.set(role, currentCount - 1);
        }
        logger.info('Role removed from configuration', { role, remainingCount: currentCount - 1 });
    }

    // New method in WerewolfGame.js
    async processNightAction(playerId, action, target) {
        // Get and validate player using Map's get method directly
        const player = this.players.get(playerId);
        if (!player) {
            throw new GameError(
                'You are not authorized to perform this action', 
                'You are not authorized to perform this action.'
            );
        }

        // Check player state
        if (!player.isAlive) {
            throw new GameError('Dead players cannot perform actions', 'Dead players cannot perform actions.');
        }

        // Check game phase
        if (this.phase !== PHASES.NIGHT && this.phase !== PHASES.NIGHT_ZERO) {
            throw new GameError('Wrong phase', 'Night actions can only be performed during night phases');
        }

        // Validate target exists and is alive
        const targetPlayer = this.players.get(target);
        if (!targetPlayer || !targetPlayer.isAlive) {
            throw new GameError('Invalid target', 'Target player not found or is dead');
        }

        // Validate action based on phase and role
        this.validateNightAction(player, action, target);

        // Process different action types
        switch (action) {
            case 'choose_lovers':
                if (this.phase !== PHASES.NIGHT_ZERO) {
                    throw new GameError(
                        'Cupid can only choose lovers during Night Zero', 
                        'Cupid can only choose lovers during Night Zero.'
                    );
                }
                await this.processLoverSelection(playerId, target);
                // Store the action after processing
                this.nightActions[playerId] = { action, target };
                break;
            case 'attack':
                await this.processWerewolfAttack(playerId, target);
                break;
            case 'investigate':
                await this.processSeerInvestigation(playerId, target);
                break;
            case 'protect':
                this.lastProtectedPlayer = target;
                this.nightActions[playerId] = { action, target };
                break;
            default:
                this.nightActions[playerId] = { action, target };
        }

        logger.info('Night action collected', { playerId, action, target });
    }
    async processWerewolfAttack(playerId, target) {
        const werewolves = Array.from(this.players.values())
            .filter(p => p.role === ROLES.WEREWOLF && p.isAlive);
        
        // Check for existing werewolf attacks
        const existingAttacks = Object.entries(this.nightActions)
            .filter(([pid, action]) => 
                action.action === 'attack' && pid !== playerId
            );

        if (existingAttacks.length > 0) {
            const existingTarget = existingAttacks[0][1].target;
            if (existingTarget !== target) {
                // Notify all werewolves of the conflict
                for (const wolf of werewolves) {
                    await wolf.sendDM('Werewolves must agree on a single target. Please coordinate in the werewolf channel.');
                }
                throw new GameError('Conflicting Attack', 
                    'Werewolves must agree on a single target. Please coordinate in the werewolf channel.');
            }
            // Don't store duplicate attack if target matches
            return;
        }

        // Store the attack only if no existing attack
        this.nightActions[playerId] = { action: 'attack', target };
    }

    async processSeerInvestigation(playerId, target) {
        const targetPlayer = this.players.get(target);
        if (!targetPlayer) {
            throw new GameError('Invalid target', 'Target player not found.');
        }

        const isWerewolf = targetPlayer.role === ROLES.WEREWOLF;
        const resultMessage = `Your investigation reveals that **${targetPlayer.username}** is **${isWerewolf ? 'a Werewolf' : 'Not a Werewolf'}**.`;
        
        const seer = this.players.get(playerId);
        await seer.sendDM(resultMessage);
        
        // Store the action
        this.nightActions[playerId] = { action: 'investigate', target };
        
        logger.info('Seer investigation completed', { 
            seerId: playerId, 
            targetId: target,
            isWerewolf 
        });
    }

    validateNightAction(player, action, target) {
        // Night Zero validations
        if (this.phase === PHASES.NIGHT_ZERO) {
            if (action === 'investigate' && player.role === ROLES.SEER) {
                throw new GameError('Invalid action', 'The Seer cannot investigate during Night Zero.');
            }
            if (action === 'attack' && player.role === ROLES.WEREWOLF) {
                throw new GameError('Werewolves cannot attack during Night Zero', 
                    'Werewolves cannot attack during Night Zero.');
            }
            if (action === 'protect' && player.role === ROLES.DOCTOR) {
                throw new GameError('Invalid action', 
                    'The Doctor cannot protect anyone during Night Zero.');
            }
        } else {
            // Non-Night Zero validations
            if (action === 'choose_lovers' && player.role === ROLES.CUPID) {
                throw new GameError(
                    'Cupid can only choose lovers during Night Zero', 
                    'Cupid can only choose lovers during Night Zero.'
                );
            }
        }

        // Role-specific validations
        switch(action) {
            case 'protect':
                if (player.role !== ROLES.DOCTOR) {
                    throw new GameError('Invalid role', 'Only the Doctor can protect players.');
                }
                if (target === this.lastProtectedPlayer) {
                    throw new GameError('Invalid target', 'You cannot protect the same player two nights in a row.');
                }
                break;
            case 'investigate':
                if (player.role !== ROLES.SEER) {
                    throw new GameError('Invalid role', 'Only the Seer can investigate players.');
                }
                if (target === player.id) {
                    throw new GameError('Invalid target', 'You cannot investigate yourself.');
                }
                break;
            case 'attack':
                if (player.role !== ROLES.WEREWOLF) {
                    throw new GameError('Invalid role', 'Only Werewolves can attack players.');
                }
                break;
            case 'choose_lovers':
                if (player.role !== ROLES.CUPID) {
                    throw new GameError('Invalid role', 'Only Cupid can choose lovers.');
                }
                break;
            default:
                throw new GameError('Invalid action', 'Unknown action type.');
        }

        // Target validation
        if (!target) {
            throw new GameError('Invalid target', 'You must specify a target for your action.');
        }
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

        // Clear any existing nomination timeout
        if (this.nominationTimeout) {
            clearTimeout(this.nominationTimeout);
        }

        // Set nomination state
        this.nominatedPlayer = targetId;
        this.nominator = nominatorId;
        this.phase = PHASES.NOMINATION;

        // Start nomination timeout
        this.nominationTimeout = setTimeout(async () => {
            if (this.phase === PHASES.NOMINATION) {
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
        if (this.phase !== PHASES.NOMINATION) {
            throw new GameError('Wrong phase', 'No active nomination to second.');
        }

        const seconder = this.players.get(seconderId);
        if (!seconder?.isAlive) {
            throw new GameError('Invalid seconder', 'Dead players cannot second nominations.');
        }
        if (seconderId === this.nominator) {
            throw new GameError('Invalid seconder', 'The nominator cannot second their own nomination.');
        }

        // Clear nomination timeout
        if (this.nominationTimeout) {
            clearTimeout(this.nominationTimeout);
            this.nominationTimeout = null;
        }

        this.seconder = seconderId;
        this.phase = PHASES.VOTING;
        this.votingOpen = true;
        this.votes.clear();

        const target = this.players.get(this.nominatedPlayer);
        await this.broadcastMessage({
            embeds: [{
                title: 'Voting Started',
                description: `The nomination of ${target.username} has been seconded by ${seconder.username}.\n` +
                           `Voting is now open. Use /vote guilty or /vote innocent in DMs to cast your vote.`
            }]
        });

        logger.info('Nomination seconded', {
            seconder: seconder.username,
            target: target.username
        });
    }

    async submitVote(voterId, guilty) {
        if (this.phase !== PHASES.VOTING || !this.votingOpen) {
            throw new GameError('Wrong phase', 'Voting is not currently open.');
        }

        const voter = this.players.get(voterId);
        if (!voter?.isAlive) {
            throw new GameError('Invalid voter', 'Dead players cannot vote.');
        }
        this.votes.set(voterId, guilty);
        logger.info('Vote submitted', { 
            voter: voter.username, 
            guilty 
        });
    }

    async advancePhase() {
        try {
            const validTransitions = PHASE_TRANSITIONS[this.phase];
            if (!validTransitions || validTransitions.length === 0) {
                throw new GameError('Invalid phase', 'Cannot advance from current game phase.');
            }

            // Determine the next phase based on game logic
            let nextPhase;
            if (this.phase === PHASES.DAY && this.nominatedPlayer) {
                nextPhase = PHASES.NOMINATION;
            } else if (this.phase === PHASES.NOMINATION && this.seconder) {
                nextPhase = PHASES.VOTING;
            } else {
                nextPhase = validTransitions[0]; // Default to the first valid transition
            }

            if (!validTransitions.includes(nextPhase)) {
                throw new GameError('Invalid transition', 'Cannot transition to the next phase.');
            }

            this.phase = nextPhase;
            logger.info(`Phase advanced to ${this.phase}`, { round: this.round });

            // Handle phase-specific logic here
            // ...

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
        if (this.phase !== PHASES.VOTING) {
            throw new GameError('Wrong phase', 'No votes to process.');
        }

        const voteCounts = {
            guilty: 0,
            innocent: 0
        };

        this.votes.forEach(vote => {
            vote ? voteCounts.guilty++ : voteCounts.innocent++;
        });

        const target = this.players.get(this.nominatedPlayer);
        const eliminated = voteCounts.guilty > voteCounts.innocent;

        if (eliminated) {
            target.isAlive = false;
            await this.handleLoversDeath(target); // Handle lovers if target was in love
            await this.checkWinConditions();      // Check if game is over
        }

        // Create results embed
        const resultsEmbed = createVoteResultsEmbed(
            target,
            voteCounts,
            eliminated
        );

        // Send results to channel
        const channel = await this.client.channels.fetch(this.gameChannelId);
        await channel.send({ embeds: [resultsEmbed] });

        // Reset voting state
        this.clearVotingState();

        // If game isn't over, continue to night phase
        if (!this.gameOver) {
            await this.advanceToNight();
        }

        return {
            eliminated: eliminated ? target.id : null,
            votesFor: voteCounts.guilty,
            votesAgainst: voteCounts.innocent
        };
    }

    async clearNomination(reason) {
        // Clear timeout if it exists
        if (this.nominationTimeout) {
            clearTimeout(this.nominationTimeout);
            this.nominationTimeout = null;
        }

        // Reset nomination state
        this.nominatedPlayer = null;
        this.nominator = null;
        this.phase = PHASES.DAY;

        // Announce nomination clear
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

    async advanceToDay() {
        try {
            this.phase = PHASES.DAY;
            this.round += 1;

            // Create and send day phase GUI
            const channel = await this.client.channels.fetch(this.gameChannelId);
            
            const embed = createDayPhaseEmbed(this.players);
            const nominateButton = new ButtonBuilder()
                .setCustomId('day_nominate')
                .setLabel('Nominate')
                .setStyle(ButtonStyle.Primary);

            const row = new ActionRowBuilder().addComponents(nominateButton);

            const message = await channel.send({
                embeds: [embed],
                components: [row]
            });

            // Store message ID for future updates
            this.dayPhaseMessageId = message.id;

            logger.info(`Game advanced to Day ${this.round}`);
        } catch (error) {
            logger.error('Error advancing to Day phase', { error });
            throw error;
        }
    }

    checkWinConditions() {
        // Get all living players
        const alivePlayers = this.getAlivePlayers();
        
        // Count living werewolves
        const livingWerewolves = alivePlayers.filter(p => p.role === ROLES.WEREWOLF).length;
        
        // Count living villager team (everyone who's not a werewolf)
        const livingVillagerTeam = alivePlayers.filter(p => p.role !== ROLES.WEREWOLF).length;

        // If all werewolves are dead, villagers win
        if (livingWerewolves === 0) {
            this.phase = PHASES.GAME_OVER;  // Set phase first
            this.gameOver = true;
            this.broadcastMessage('**Villagers win!** All werewolves have been eliminated.');
            return true;
        }

        // If werewolves reach parity with or outnumber villager team, werewolves win
        if (livingWerewolves >= livingVillagerTeam) {
            this.phase = PHASES.GAME_OVER;  // Set phase first
            this.gameOver = true;
            this.broadcastMessage('**Werewolves win!** They have reached parity with the villagers.');
            return true;
        }

        return false;
    }

    // Add to the class

    async processLoverSelection(cupidId, targetString) {
        const [target1Id, target2Id] = targetString.split(',').map(id => id.trim());
        
        // Validate targets
        const target1 = this.players.get(target1Id);
        const target2 = this.players.get(target2Id);

        if (!target1 || !target2) {
            throw new GameError('Invalid targets', 'One or both selected players were not found.');
        }

        if (!target1.isAlive || !target2.isAlive) {
            throw new GameError('Invalid targets', 'You can only choose living players as lovers.');
        }

        if (target1Id === target2Id) {
            throw new GameError('Invalid targets', 'You must choose two different players.');
        }

        // Set up bidirectional lover relationship
        this.lovers.set(target1Id, target2Id);
        this.lovers.set(target2Id, target1Id);

        // Notify the chosen lovers
        await target1.sendDM(`You have fallen in love with **${target2.username}**. If one of you dies, the other will die of heartbreak.`);
        await target2.sendDM(`You have fallen in love with **${target1.username}**. If one of you dies, the other will die of heartbreak.`);

        logger.info('Lovers chosen by Cupid', {
            cupidId,
            lover1: target1Id,
            lover2: target2Id
        });
    }
    // Start of Selection
    getPhase() {
        return this.phase;
    }

    isInLobby() {
        return this.phase === PHASES.LOBBY;
    }
}
module.exports = WerewolfGame;

