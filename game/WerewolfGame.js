// game/WerewolfGame.js

const Player = require('./Player');
const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const { GameError } = require('../utils/error-handler');
const logger = require('../utils/logger');
const ROLES = require('../constants/roles');
const PHASES = require('../constants/phases');
const { createDayPhaseEmbed, createVoteResultsEmbed } = require('../utils/embedCreator');

class WerewolfGame {
    constructor(client, guildId, gameChannelId, gameCreatorId, authorizedIds = []) {
        this.client = client;
        this.guildId = guildId;
        this.gameChannelId = gameChannelId;
        this.gameCreatorId = gameCreatorId;
        this.authorizedIds = authorizedIds; // Array of user IDs authorized to advance phases

        this.players = new Map(); // Map of playerId -> Player instance
        this.phase = PHASES.LOBBY; // Initial phase
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
    }

    /**
     * Adds a player to the game.
     * @param {User} user - Discord user object.
     * @returns {Player} - The added player.
     */
    addPlayer(user) {
        try {
            if (this.phase !== PHASES.LOBBY) {
                throw new GameError('Cannot join a game in progress.', 'The game has already started. You cannot join at this time.');
            }
            if (this.players.has(user.id)) {
                throw new GameError('Player already in game.', 'You are already in the game.');
            }
            const player = new Player(user.id, user.username, this.client);
            this.players.set(user.id, player);
            logger.info('Player added to the game', { playerId: user.id, username: user.username });
            return player;
        } catch (error) {
            logger.error('Error adding player to game', { error, userId: user.id });
            throw error; // Re-throw the error to be handled by the command handler
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

            this.phase = PHASES.NIGHT_ZERO;
            this.round = 0;
            await this.assignRoles();
            await this.broadcastMessage(`Game is starting with ${this.players.size} players, including ${this.getPlayersByRole(ROLES.WEREWOLF).length} werewolves.`);
            await this.createPrivateChannels();
            await this.nightZero();
            await this.broadcastMessage(`Night Zero has ended. Day 1 will begin soon.`);
            logger.info('Game started successfully');
        } catch (error) {
            logger.error('Error starting game', { error });
            throw error;
        }
    }

    /**
     * Assigns roles to all players based on selectedRoles configuration.
     */
    async assignRoles() {
        try {
            // Create a pool of roles based on selectedRoles
            let rolePool = [];
            for (let [role, count] of this.selectedRoles.entries()) {
                for (let i = 0; i < count; i++) {
                    rolePool.push(role);
                }
            }

            // Shuffle the role pool
            rolePool = this.shuffleArray(rolePool);

            // Assign roles to players
            const playerArray = Array.from(this.players.values());
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
            // Implement any initial night zero actions if necessary
            // For example, assigning lovers by Cupid
            const cupid = this.getPlayerByRole(ROLES.CUPID);
            if (cupid && cupid.isAlive) {
                await cupid.sendDM('Please choose two players to be lovers by typing their usernames separated by a comma (e.g., Alice, Bob):');
                const response = await cupid.promptDM(
                    'Choose two players to be lovers by typing their usernames separated by a comma (e.g., Alice, Bob):',
                    m => {
                        const names = m.content.split(',').map(name => name.trim());
                        if (names.length !== 2) return false;
                        const p1 = this.getPlayerByUsername(names[0]);
                        const p2 = this.getPlayerByUsername(names[1]);
                        return p1 && p2 && p1.id !== p2.id && p1.isAlive && p2.isAlive;
                    }
                );

                if (response) {
                    const [lover1Username, lover2Username] = response.split(',').map(name => name.trim());
                    const lover1 = this.getPlayerByUsername(lover1Username);
                    const lover2 = this.getPlayerByUsername(lover2Username);
                    this.setLovers(lover1.id, lover2.id);
                    await cupid.sendDM(`You have chosen **${lover1.username}** and **${lover2.username}** as lovers.`);
                    logger.info('Cupid chose lovers', { cupidId: cupid.id, lover1Id: lover1.id, lover2Id: lover2.id });
                } else {
                    await cupid.sendDM('Failed to choose lovers in time.');
                    logger.warn('Cupid failed to choose lovers in time', { cupidId: cupid.id });
                }
            }

            // Proceed to first night
            await this.advanceToNight();
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
            logger.info(`Game advanced to Night ${this.round}`);
            await this.handleNightActions();
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
        try {
            // Process Werewolf attack
            if (this.nightActions.werewolfVictim) {
                const victim = this.players.get(this.nightActions.werewolfVictim);
                if (!victim) {
                    logger.warn('Werewolf victim not found', { victimId: this.nightActions.werewolfVictim });
                } else if (victim.isProtected) {
                    await this.broadcastMessage(`**${victim.username}** was attacked by the Werewolves, but was protected by the Doctor.`);
                    logger.info('Werewolf attack was protected', { victimId: victim.id });
                } else {
                    victim.isAlive = false;
                    await this.broadcastMessage(`**${victim.username}** was killed during the night.`);
                    await this.moveToDeadChannel(victim);
                    logger.info('Player was killed by Werewolves', { victimId: victim.id });

                    // Handle lovers' death
                    await this.handleLoversDeath(victim);
                }
            }

            // Process Seer investigation
            if (this.nightActions.seerTarget) {
                const target = this.players.get(this.nightActions.seerTarget);
                if (target) {
                    const role = target.role;
                    const seer = this.getPlayerByRole(ROLES.SEER);
                    if (seer && seer.isAlive) {
                        await seer.sendDM(`**${target.username}** is a **${role}**.`);
                        logger.info('Seer investigation result sent', { seerId: seer.id, targetId: target.id, role });
                    }
                }
            }

            // Reset night actions
            this.nightActions = {};
        } catch (error) {
            logger.error('Error processing night actions', { error });
            throw error;
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
            if (loverId) {
                const lover = this.players.get(loverId);
                if (lover && lover.isAlive) {
                    lover.isAlive = false;
                    await this.broadcastMessage(`**${lover.username}**, who was in love with **${player.username}**, has died of heartbreak.`);
                    await this.moveToDeadChannel(lover);
                    logger.info('Lover died of heartbreak', { loverId: lover.id });
                }
                // Remove lover relationship
                this.lovers.delete(player.id);
                this.lovers.delete(loverId);
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
     * Collects an action from a player during the night.
     * @param {string} playerId - ID of the player.
     * @param {string} action - The action to collect.
     * @param {string|null} targetUsername - Username of the target player.
     */
    async collectNightAction(playerId, action, targetUsername) {
        const player = this.players.get(playerId);
        if (!player || !player.isAlive) {
            throw new GameError(
                'Invalid player',
                'You are not a participant or are no longer alive in the game.'
            );
        }

        switch (action) {
            case 'attack':
                // Werewolves choose a target via DM
                const attackMessage = 'Choose a player to attack by typing their username:';
                const attackFilter = m => this.getPlayerByUsername(m.content) !== null;
                const attackResponse = await player.promptDM(attackMessage, attackFilter);
                if (!attackResponse) {
                    logger.warn('Werewolf did not respond to attack prompt', { playerId });
                    return;
                }
                const attackTarget = this.getPlayerByUsername(attackResponse);
                if (!attackTarget || attackTarget.role === ROLES.WEREWOLF || !attackTarget.isAlive) {
                    await player.sendDM('Invalid target. Your attack has failed.');
                    logger.warn('Invalid attack target', { playerId, attackTargetUsername: attackResponse });
                    return;
                }
                this.nightActions.werewolfVictim = attackTarget.id;
                logger.info('Werewolf attack recorded', { attackerId: playerId, targetId: attackTarget.id });
                break;

            case 'investigate':
                // Seer chooses a target via DM
                const investigateMessage = 'Choose a player to investigate by typing their username:';
                const investigateFilter = m => this.getPlayerByUsername(m.content) !== null;
                const investigateResponse = await player.promptDM(investigateMessage, investigateFilter);
                if (!investigateResponse) {
                    logger.warn('Seer did not respond to investigate prompt', { playerId });
                    return;
                }
                const investigateTarget = this.getPlayerByUsername(investigateResponse);
                if (!investigateTarget || !investigateTarget.isAlive) {
                    await player.sendDM('Invalid target. Your investigation has failed.');
                    logger.warn('Invalid Seer investigation target', { playerId, investigateTargetUsername: investigateResponse });
                    return;
                }
                this.nightActions.seerTarget = investigateTarget.id;
                logger.info('Seer investigation recorded', { seerId: playerId, targetId: investigateTarget.id });
                break;

            case 'protect':
                // Doctor chooses a target via DM
                const protectMessage = 'Choose a player to protect by typing their username:';
                const protectFilter = m => this.getPlayerByUsername(m.content) !== null;
                const protectResponse = await player.promptDM(protectMessage, protectFilter);
                if (!protectResponse) {
                    logger.warn('Doctor did not respond to protect prompt', { playerId });
                    return;
                }
                const protectTarget = this.getPlayerByUsername(protectResponse);
                if (!protectTarget || !protectTarget.isAlive) {
                    await player.sendDM('Invalid target. Your protection has failed.');
                    logger.warn('Invalid Doctor protection target', { playerId, protectTargetUsername: protectResponse });
                    return;
                }
                if (protectTarget.id === this.lastProtectedPlayer) {
                    await player.sendDM('You cannot protect the same player on consecutive nights.');
                    logger.warn('Doctor attempted consecutive protection', { playerId, protectTargetId: protectTarget.id });
                    return;
                }
                this.nightActions.doctorProtection = protectTarget.id;
                this.lastProtectedPlayer = protectTarget.id;
                logger.info('Doctor protection recorded', { doctorId: playerId, protectTargetId: protectTarget.id });
                break;

            case 'choose_lovers':
                // Cupid chooses two lovers via DM
                const chooseLoversMessage = 'Choose two players to be lovers by typing their usernames separated by a comma (e.g., Alice, Bob):';
                const loversFilter = m => {
                    const names = m.content.split(',').map(name => name.trim());
                    if (names.length !== 2) return false;
                    const p1 = this.getPlayerByUsername(names[0]);
                    const p2 = this.getPlayerByUsername(names[1]);
                    return p1 && p2 && p1.id !== p2.id && p1.isAlive && p2.isAlive;
                };
                const loversResponse = await player.promptDM(chooseLoversMessage, loversFilter);
                if (!loversResponse) {
                    logger.warn('Cupid did not respond to choose lovers prompt', { playerId });
                    return;
                }
                const [lover1Username, lover2Username] = loversResponse.split(',').map(name => name.trim());
                const lover1 = this.getPlayerByUsername(lover1Username);
                const lover2 = this.getPlayerByUsername(lover2Username);
                if (!lover1 || !lover2 || lover1.id === lover2.id) {
                    await player.sendDM('Invalid lovers selection.');
                    logger.warn('Invalid lovers selection by Cupid', { playerId, lover1Username, lover2Username });
                    return;
                }
                this.setLovers(lover1.id, lover2.id);
                await player.sendDM(`You have chosen **${lover1.username}** and **${lover2.username}** as lovers.`);
                logger.info('Cupid chose lovers', { cupidId: playerId, lover1Id: lover1.id, lover2Id: lover2.id });
                break;

            default:
                throw new GameError(
                    'No night action',
                    'Your role does not have a night action.'
                );
        }
    }

    /**
     * Eliminates a player from the game.
     * @param {string} playerId - ID of the player to eliminate.
     * @param {string} reason - Reason for elimination.
     */
    async eliminatePlayer(playerId, reason) {
        try {
            const player = this.players.get(playerId);
            if (!player || !player.isAlive) return;

            player.isAlive = false;
            await this.broadcastMessage(`**${player.username}** has been eliminated (${reason}).`);
            await this.moveToDeadChannel(player);
            logger.info('Player eliminated', { playerId, reason });

            // Handle lovers' death
            await this.handleLoversDeath(player);

            await this.checkWinConditions();
        } catch (error) {
            logger.error('Error eliminating player', { error, playerId, reason });
            throw new GameError('Player Elimination Failed', 'An error occurred while eliminating a player. The game state may be inconsistent.');
        }
    }

    /**
     * Checks if any win conditions are met.
     */
    async checkWinConditions() {
        try {
            const werewolvesAlive = this.getPlayersByRole(ROLES.WEREWOLF).length;
            const villagersAlive = this.getAlivePlayers().length - werewolvesAlive;

            if (werewolvesAlive === 0) {
                await this.broadcastMessage('All Werewolves have been eliminated. **Villagers** win!');
                logger.info('Villagers have won the game');
                await this.shutdownGame();
                return;
            } else if (werewolvesAlive >= villagersAlive) {
                await this.broadcastMessage('Werewolves have reached parity with Villagers. **Werewolves** win!');
                logger.info('Werewolves have won the game');
                await this.shutdownGame();
                return;
            }

            // Continue the game
            await this.advanceToNight();
        } catch (error) {
            logger.error('Error checking win conditions', { error });
            throw error;
        }
    }

    /**
     * Advances the game to the Day phase.
     */
    async advanceToDay() {
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
    }

    /**
     * Handles voting during the Day phase.
     */
    async handleDayVoting() {
        try {
            // Prompt all alive players to vote
            const alivePlayers = this.getAlivePlayers();
            const votePromises = alivePlayers.map(player => this.collectPlayerVote(player));

            const votes = await Promise.all(votePromises);
            votes.forEach(vote => {
                if (vote) {
                    this.votes.set(vote.voterId, vote.targetId);
                }
            });

            // Tally votes
            const voteTally = {};
            this.votes.forEach(targetId => {
                if (voteTally[targetId]) {
                    voteTally[targetId] += 1;
                } else {
                    voteTally[targetId] = 1;
                }
            });

            // Determine who has the most votes
            let maxVotes = 0;
            let eliminatedPlayerId = null;
            for (const [targetId, count] of Object.entries(voteTally)) {
                if (count > maxVotes) {
                    maxVotes = count;
                    eliminatedPlayerId = targetId;
                }
            }

            if (eliminatedPlayerId) {
                const eliminatedPlayer = this.players.get(eliminatedPlayerId);
                if (eliminatedPlayer) {
                    await this.eliminatePlayer(eliminatedPlayerId, 'voting');
                    logger.info('Player eliminated by voting', { playerId: eliminatedPlayerId });
                }
            } else {
                await this.broadcastMessage('No votes were cast. No one is eliminated today.');
                logger.info('No votes cast during Day phase');
            }

            // Reset votes
            this.votes.clear();

            // Check win conditions after elimination
            await this.checkWinConditions();
        } catch (error) {
            logger.error('Error handling Day voting', { error });
            throw error;
        }
    }

    /**
     * Collects a vote from a player.
     * @param {Player} player - The player to collect vote from.
     * @returns {Object|null} - An object containing voterId and targetId or null if timed out.
     */
    async collectPlayerVote(player) {
        try {
            const voteMessage = 'Please vote to eliminate a player by typing their username:';
            const voteFilter = m => {
                const target = this.getPlayerByUsername(m.content);
                return target && target.isAlive && target.id !== player.id;
            };
            const response = await player.promptDM(voteMessage, voteFilter);
            if (!response) {
                logger.warn('Player did not provide a valid vote', { playerId: player.id });
                return null;
            }
            const target = this.getPlayerByUsername(response);
            if (target) {
                logger.info('Player cast a vote', { voterId: player.id, targetId: target.id });
                return { voterId: player.id, targetId: target.id };
            } else {
                logger.warn('Invalid vote target', { playerId: player.id, voteContent: response });
                return null;
            }
        } catch (error) {
            logger.error('Error collecting vote from player', { error, playerId: player.id });
            return null;
        }
    }

    /**
     * Sets lovers between two players.
     * @param {string} player1Id - ID of the first player.
     * @param {string} player2Id - ID of the second player.
     */
    setLovers(player1Id, player2Id) {
        const player1 = this.players.get(player1Id);
        const player2 = this.players.get(player2Id);
        if (player1 && player2) {
            player1.loverId = player2Id;
            player2.loverId = player1Id;
            this.lovers.set(player1Id, player2Id);
            this.lovers.set(player2Id, player1Id);
            logger.info('Lovers set', { player1Id, player2Id });
        } else {
            logger.warn('Failed to set lovers due to missing players', { player1Id, player2Id });
        }
    }

    /**
     * Determines the winner based on the current game state.
     * @returns {string} - The name of the winning team.
     */
    determineWinner() {
        const werewolvesAlive = this.getPlayersByRole(ROLES.WEREWOLF).length;
        const villagersAlive = this.getAlivePlayers().length - werewolvesAlive;

        if (werewolvesAlive === 0) {
            return 'Villagers';
        } else if (werewolvesAlive >= villagersAlive) {
            return 'Werewolves';
        } else {
            return 'Undetermined'; // This should not happen if the game ended correctly
        }
    }

    /**
     * Collects the most frequent element in an array.
     * @param {Array} arr - The array to process.
     * @returns {string} - The most frequent element.
     */
    getMostFrequent(arr) {
        const frequency = {};
        let max = 0;
        let mostFrequent = null;
        arr.forEach(item => {
            frequency[item] = (frequency[item] || 0) + 1;
            if (frequency[item] > max) {
                max = frequency[item];
                mostFrequent = item;
            }
        });
        return mostFrequent;
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
        if (role === ROLES.WEREWOLF && currentCount >= Math.floor(this.players.size / 3)) {
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
            throw new GameError('Not authorized', 'You are not authorized to perform this action.');
        }

        // Check player state
        if (!player.isAlive) {
            throw new GameError('Dead player', 'Dead players cannot perform actions.');
        }

        // Check game phase
        if (this.phase === PHASES.DAY) {
            throw new GameError('Wrong phase', 'Actions can only be performed during the night phase.');
        }

        // Validate action based on phase and role
        this.validateNightAction(player, action, target);

        // Set lastProtectedPlayer immediately when protection is processed
        if (action === 'protect') {
            this.lastProtectedPlayer = target;
        }

        // Store the action
        this.nightActions[playerId] = { action, target };
        logger.info('Night action collected', { playerId, action, target });
    }

    validateNightAction(player, action, target) {
        // Night Zero validations
        if (this.phase === PHASES.NIGHT_ZERO) {
            if (action === 'investigate' && player.role === ROLES.SEER) {
                throw new GameError('Invalid action', 'The Seer cannot investigate during Night Zero.');
            }
            if (action === 'attack' && player.role === ROLES.WEREWOLF) {
                throw new GameError('Invalid action', 'Werewolves cannot attack during Night Zero.');
            }
        } else {
            // Non-Night Zero validations
            if (action === 'choose_lovers' && player.role === ROLES.CUPID) {
                throw new GameError('Invalid action', 'Cupid can only choose lovers during Night Zero.');
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
        console.log('Current phase:', this.phase);
        switch(this.phase) {
            case PHASES.NIGHT:
                await this.processNightActions();
                console.log('Win conditions check:', this.checkWinConditions());
                if (!this.checkWinConditions()) {
                    await this.advanceToDay();
                }
                console.log('New phase:', this.phase);
                break;

            case PHASES.NIGHT_ZERO:
                await this.processNightZeroActions();
                if (!this.checkWinConditions()) {
                    await this.advanceToDay();
                }
                break;

            case PHASES.DAY:
            case PHASES.NOMINATION:
            case PHASES.VOTING:
                // Clean up any existing voting state
                this.clearVotingState();
                await this.advanceToNight();
                break;

            default:
                throw new GameError('Invalid phase', 'Cannot advance from current game phase.');
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
}

module.exports = WerewolfGame;
