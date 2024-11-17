const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { GameError } = require('../utils/error-handler');
const logger = require('../utils/logger');
const ROLES = require('../constants/roles');
const PHASES = require('../constants/phases');
const { 
    createNightActionEmbed, 
    createSeerRevealEmbed, 
    createProtectionEmbed,
    createNightTransitionEmbed 
} = require('../utils/embedCreator');

class NightActionProcessor {
    constructor(game) {
        this.game = game;
        this.protectionMessageSent = false;
    }

    async processNightAction(playerId, action, targetId) {
        try {
            // Add validation for required night actions
            if (!this.game.expectedNightActions.has(playerId)) {
                logger.warn('Unexpected night action', {
                    playerId,
                    action,
                    expectedActions: Array.from(this.game.expectedNightActions)
                });
                throw new GameError('Invalid Action', 'You are not expected to take an action at this time.');
            }

            const player = this.game.players.get(playerId);
            if (!player) {
                throw new GameError(
                    'You are not authorized to perform this action', 
                    'You are not authorized to perform this action.'
                );
            }

            // Handle Hunter's revenge
            if (action === 'choose_target' || action === 'hunter_revenge') {
                if (!this.game.pendingHunterRevenge || player.id !== this.game.pendingHunterRevenge) {
                    throw new GameError('Invalid action', 'You can only use this action when prompted after being eliminated as the Hunter.');
                }
                return await this.processHunterRevenge(player, targetId);
            }

            // Regular night action validation
            if (!player.isAlive) {
                throw new GameError('Dead players cannot perform actions', 'Dead players cannot perform actions.');
            }

            if (this.game.phase !== PHASES.NIGHT && this.game.phase !== PHASES.NIGHT_ZERO) {
                throw new GameError('Wrong phase', 'Night actions can only be performed during night phases');
            }

            // Validate target exists and is alive
            const targetPlayer = this.game.players.get(targetId);
            if (!targetPlayer || !targetPlayer.isAlive) {
                throw new GameError('Invalid target', 'Target player not found or is dead');
            }

            // Validate action based on phase and role
            this.validateNightAction(player, action, targetId);

            // Check if action was already submitted
            if (this.game.completedNightActions.has(playerId)) {
                throw new GameError('Action already submitted', 'You have already submitted your action for this night.');
            }

            // Handle Seer investigation immediately
            if (action === 'investigate') {
                const seer = this.game.players.get(playerId);
                const target = this.game.players.get(targetId);

                if (!target) {
                    throw new GameError('Invalid target', 'Target player not found.');
                }

                const isWerewolf = target.role === ROLES.WEREWOLF;
                const aliveStatus = target.isAlive ? '' : ' (deceased)';
                
                // Send the result immediately
                await seer.sendDM({
                    embeds: [{
                        color: 0x4B0082,
                        title: '🔮 Vision Revealed',
                        description: 
                            `*Your mystical powers reveal the truth about **${target.username}**${aliveStatus}...*\n\n` +
                            `Your vision shows that they are **${isWerewolf ? 'a Werewolf!' : 'Not a Werewolf.'}**`,
                        footer: { text: 'Use this knowledge wisely...' }
                    }]
                });

                logger.info('Seer investigation completed', {
                    seerId: seer.id,
                    targetId: target.id,
                    targetAlive: target.isAlive,
                    result: isWerewolf ? 'werewolf' : 'not werewolf'
                });
            }

            // Store the action for other roles
            this.game.nightActions[playerId] = { action, target: targetId };
            this.game.completedNightActions.add(playerId);

            // Only send generic confirmation for non-Seer actions
            if (action !== 'investigate') {
                await player.sendDM('Your action has been recorded. Wait for the night phase to end to see the results.');
            }

            logger.info('Night action collected', { playerId, action, targetId });

            // Check if all actions are complete
            const allActionsComplete = Array.from(this.game.expectedNightActions).every(
                id => this.game.completedNightActions.has(id)
            );

            if (allActionsComplete) {
                logger.info('All night actions received, processing night phase', {
                    expectedActions: Array.from(this.game.expectedNightActions),
                    completedActions: Array.from(this.game.completedNightActions)
                });

                // Process all night actions and advance to day
                await this.processNightActions();
            }

        } catch (error) {
            logger.error('Error processing night action', { error });
            throw error;
        }
    }

    async processNightActions() {
        try {
            // Process Cupid's action first if it's Night Zero
            if (this.game.phase === PHASES.NIGHT_ZERO) {
                for (const [playerId, action] of Object.entries(this.game.nightActions)) {
                    if (action.action === 'choose_lovers') {
                        const cupid = this.game.players.get(playerId);
                        const lover = this.game.players.get(action.target);
                        
                        if (!cupid || !lover) {
                            logger.error('Invalid Cupid or lover selection', { 
                                cupidId: playerId, 
                                loverId: action.target 
                            });
                            continue;
                        }

                        if (!lover.isAlive) {
                            logger.error('Cannot select dead player as lover', { 
                                loverId: action.target 
                            });
                            continue;
                        }

                        if (cupid.id === lover.id) {
                            logger.error('Cupid cannot select self as lover', { 
                                cupidId: cupid.id 
                            });
                            continue;
                        }

                        // Set up bidirectional lover relationship
                        this.game.lovers.set(cupid.id, lover.id);
                        this.game.lovers.set(lover.id, cupid.id);
                        
                        // Notify both players
                        await lover.sendDM({
                            embeds: [{
                                color: 0xff69b4,
                                title: '💘 You Have Been Chosen!',
                                description: `**${cupid.username}** has chosen you as their lover. If either of you dies, the other will die of heartbreak.`
                            }]
                        });
                        
                        await cupid.sendDM({
                            embeds: [{
                                color: 0xff69b4,
                                title: '💘 Love Blossoms',
                                description: `You have chosen **${lover.username}** as your lover. If either of you dies, the other will die of heartbreak.`
                            }]
                        });

                        logger.info('Lovers set', {
                            cupidId: cupid.id,
                            cupidName: cupid.username,
                            loverId: lover.id,
                            loverName: lover.username,
                            loversMap: Array.from(this.game.lovers.entries())
                        });

                        // After processing Cupid's action, finish Night Zero
                        await this.game.finishNightZero();
                    }
                }
            }

            // Process other night actions...
            await this.processBodyguardProtection();
            await this.processWerewolfAttacks();

            // Clean up night state
            this.game.nightActions = {};
            this.game.completedNightActions.clear();
            this.game.expectedNightActions.clear();

            // Add logging before phase transition
            logger.info('Night actions processed, attempting phase transition', {
                currentPhase: this.game.phase,
                round: this.game.round
            });

            // Check win conditions and advance phase
            if (!this.game.checkWinConditions()) {
                // Direct call to advance phase, exactly like advance.js does
                await this.game.advanceToDay();
                
                logger.info('Advanced to day after night actions', {
                    currentPhase: this.game.phase,
                    round: this.game.round
                });
            }
        } catch (error) {
            logger.error('Error processing night actions', { error });
            // Even if there's an error, try to advance the phase
            if (!this.game.checkWinConditions()) {
                await this.game.advanceToDay();
            }
        }
    }

    async processBodyguardProtection() {
        for (const [playerId, action] of Object.entries(this.game.nightActions)) {
            if (action.action === 'protect') {
                const target = this.game.players.get(action.target);
                if (target) {
                    target.isProtected = true;
                    this.game.lastProtectedPlayer = target.id;
                    logger.info('Bodyguard protected player', { targetId: target.id });
                }
            }
        }
    }

    async processHunterRevenge(player, target) {
        if (player.id !== this.game.pendingHunterRevenge) {
            throw new GameError('Invalid action', 'You can only use this action when eliminated as the Hunter.');
        }
        
        const targetPlayer = this.game.players.get(target);
        if (!targetPlayer?.isAlive) {
            throw new GameError('Invalid target', 'You must choose a living player.');
        }

        // Mark both players as dead
        player.isAlive = false;
        targetPlayer.isAlive = false;

        // Broadcast the revenge
        await this.game.broadcastMessage(`**${player.username}** uses their dying action to take **${targetPlayer.username}** with them!`);
        
        // Move both to dead channel
        await this.game.moveToDeadChannel(player);
        await this.game.moveToDeadChannel(targetPlayer);
        
        // Handle any lover deaths
        await this.game.handleLoversDeath(targetPlayer);
        
        // Clear the pending state
        this.game.pendingHunterRevenge = null;
        this.game.expectedNightActions.delete(player.id);
        
        // Finish the night phase
        await this.finishNightPhase();
    }

    async finishNightPhase() {
        // Process any pending Hunter revenge if they didn't act
        if (this.game.pendingHunterRevenge) {
            const hunter = this.game.players.get(this.game.pendingHunterRevenge);
            if (hunter) {
                hunter.isAlive = false;
                await this.game.moveToDeadChannel(hunter);
                await this.game.handleLoversDeath(hunter);
            }
            this.game.pendingHunterRevenge = null;
        }

        // Reset protections
        for (const player of this.game.players.values()) {
            player.isProtected = false;
        }

        // Track phase advance for timing test
        if (this.executionOrder) {
            this.executionOrder.push('phase_advance');
        }

        // Check win conditions before advancing
        if (!this.game.checkWinConditions()) {
            await this.game.advanceToDay();
        }
    }

    validateNightAction(player, action, targetId) {
        // Special case for Hunter's revenge - skip other validations
        if ((action === 'choose_target' || action === 'hunter_revenge') && 
            player.id === this.game.pendingHunterRevenge) {
            return;
        }

        // Role-specific validations should come before checking expected actions
        switch(action) {
            case 'choose_lovers':
                if (player.role !== ROLES.CUPID) {
                    throw new GameError('Invalid role', 'Only Cupid can choose a lover.');
                }
                if (this.game.phase !== PHASES.NIGHT_ZERO) {
                    throw new GameError('Invalid phase', 'Cupid can only choose lovers during Night Zero.');
                }
                break;
            case 'protect':
                if (player.role !== ROLES.BODYGUARD) {
                    throw new GameError('Invalid role', 'Only the Bodyguard can protect players.');
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
            case 'choose_target':
            case 'hunter_revenge':
                if (player.role !== ROLES.HUNTER || !this.game.pendingHunterRevenge) {
                    throw new GameError('Invalid action', 'Only the Hunter can choose a target after being eliminated.');
                }
                break;
            default:
                throw new GameError('Invalid action', 'Unknown action type.');
        }

        // Check if player has already acted
        if (this.game.completedNightActions.has(player.id)) {
            throw new GameError(
                'Action already performed',
                'You have already performed your night action.'
            );
        }

        // Check if player is expected to act
        if (!this.game.expectedNightActions.has(player.id)) {
            throw new GameError(
                'Unexpected action',
                'You are not expected to perform any action at this time.'
            );
        }

        // Additional target validations
        if (action === 'protect') {
            if (targetId === player.id) {
                throw new GameError('Invalid target', 'You cannot protect yourself.');
            }
            if (this.game.lastProtectedPlayer && targetId === this.game.lastProtectedPlayer) {
                throw new GameError('Invalid target', 'You cannot protect the same player two nights in a row.');
            }
        }

        if (action === 'investigate') {
            if (targetId === player.id) {
                throw new GameError('Invalid target', 'You cannot investigate yourself.');
            }
        }

        if (action === 'attack') {
            if (targetId === player.id) {
                throw new GameError('Invalid target', 'You cannot attack yourself.');
            }
        }

        if (action === 'choose_lovers') {
            if (targetId === player.id) {
                throw new GameError('Invalid target', 'You cannot choose yourself as a lover.');
            }
        }
    }

    /**
     * Handles all night actions including Night Zero actions.
     */
    async handleNightActions() {
        try {
            logger.info('Handling night actions', { phase: this.game.phase });

            // Send night transition embed FIRST
            const channel = await this.game.client.channels.fetch(this.game.gameChannelId);
            await channel.send({
                embeds: [createNightTransitionEmbed(this.game.players)]
            });

            // Identify all players with night actions
            const nightRoles = [ROLES.WEREWOLF, ROLES.SEER, ROLES.BODYGUARD];
            const nightPlayers = Array.from(this.game.players.values()).filter(player => 
                nightRoles.includes(player.role) && player.isAlive
            );

            logger.info('Identified night action players', { players: nightPlayers.map(p => p.username) });

            // Add night players to expectedNightActions
            nightPlayers.forEach(player => {
                this.game.expectedNightActions.add(player.id);
            });

            // Send DM prompts with dropdown menus to night action players
            for (const player of nightPlayers) {
                const validTargets = this.getValidTargetsForRole(player);
                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId(`night_action_${player.role.toLowerCase()}`)
                    .setPlaceholder('Select your target')
                    .addOptions(
                        validTargets.map(target => ({
                            label: target.username,
                            value: target.id,
                            description: `Target ${target.username}`
                        }))
                    );

                const row = new ActionRowBuilder().addComponents(selectMenu);
                const embed = createNightActionEmbed(player.role);

                await player.sendDM({ 
                    embeds: [embed], 
                    components: [row] 
                });

                logger.info(`Sent ${player.role} action prompt`, { 
                    username: player.username 
                });
            }

            logger.info('Night action prompts sent, waiting for actions', {
                expectedActions: Array.from(this.game.expectedNightActions)
            });

        } catch (error) {
            logger.error('Error handling night actions', { error });
            throw error;
        }
    }

    getValidTargetsForRole(player) {
        const allPlayers = Array.from(this.game.players.values())
            .filter(p => p.isAlive && p.id !== player.id);

        switch(player.role) {
            case ROLES.WEREWOLF:
                return allPlayers.filter(p => p.role !== ROLES.WEREWOLF);
            case ROLES.BODYGUARD:
                return allPlayers.filter(p => 
                    p.id !== this.game.lastProtectedPlayer
                );
            case ROLES.SEER:
                return allPlayers;
            default:
                return [];
        }
    }

    /**
     * Waits for Cupid to complete their action during Night Zero.
     */
    async waitForCupidAction() {
        return new Promise((resolve, reject) => {
            // Listen for Cupid's action completion
            const interval = setInterval(() => {
                if (!this.game.expectedNightActions.has(this.game.cupidId)) {
                    clearInterval(interval);
                    resolve();
                }
            }, 1000);

            // Set a maximum wait time to prevent indefinite waiting
            setTimeout(() => {
                clearInterval(interval);
                logger.warn('Cupid did not complete their action in time.');
                resolve(); // Proceed to Day phase regardless
            }, 60000); // 1 minute
        });
    }

    /**
     * Collects Werewolf attack target.
     * @param {Player[]} werewolves - Array of werewolf players.
     */
    async collectWerewolfAttack(werewolves) {
        try {
            const attackTargets = werewolves.map(wolf => 
                wolf.promptDM('Choose a player to attack by typing their username:')
            );

            const responses = await Promise.all(attackTargets);
            const validResponses = responses.filter(response => response !== null);

            if (validResponses.length === 0) {
                logger.warn('No valid attack targets provided by werewolves');
                return;
            }

            // Use the local getMostFrequent method instead of game's
            const target = this.getMostFrequent(validResponses);
            const victim = this.game.getPlayerByUsername(target);

            if (!victim || victim.role === ROLES.WEREWOLF || !victim.isAlive) {
                logger.warn('Invalid attack target chosen by werewolves', { target });
                return;
            }

            this.game.nightActions.werewolfVictim = victim.id;
            logger.info('Werewolf attack recorded', { 
                attackerIds: werewolves.map(w => w.id), 
                targetId: victim.id 
            });
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

            const target = this.game.getPlayerByUsername(investigationTarget);
            if (!target || !target.isAlive) {
                await seer.sendDM('Invalid target. Your investigation has failed.');
                logger.warn('Invalid Seer investigation target', { seerId: seer.id, targetUsername: investigationTarget });
                return;
            }

            this.game.nightActions.seerTarget = target.id;
            logger.info('Seer investigation recorded', { seerId: seer.id, targetId: target.id });
        } catch (error) {
            logger.error('Error collecting Seer investigation', { error });
            throw error;
        }
    }

    /**
     * Collects Cupid's lover selection.
     * @param {Player} cupid - The Cupid player.
     */
    async collectCupidLover(cupid) {
        try {
            const chooseLoverMessage = 'Choose a player to be your lover by typing their username. Choose wisely - if either of you dies, the other will die of heartbreak.';
            const loverResponse = await cupid.promptDM(chooseLoverMessage);
            
            if (!loverResponse) {
                logger.warn('Cupid failed to choose a lover', { cupidId: cupid.id });
                return;
            }

            const lover = this.game.getPlayerByUsername(loverResponse);
            if (!lover || !lover.isAlive || lover.id === cupid.id) {
                await cupid.sendDM('Invalid lover selection.');
                logger.warn('Invalid lover selection by Cupid', { 
                    cupidId: cupid.id, 
                    targetUsername: loverResponse 
                });
                return;
            }

            this.game.nightActions[cupid.id] = {
                action: 'choose_lovers',
                target: lover.id
            };

            logger.info('Cupid chose lover', { 
                cupidId: cupid.id, 
                loverId: lover.id 
            });
        } catch (error) {
            logger.error('Error collecting Cupid lover selection', { error });
            throw error;
        }
    }

    /**
     * Processes Cupid's action during Night Zero.
     */
    async processCupidAction() {
        try {
            for (const [playerId, action] of Object.entries(this.game.nightActions)) {
                if (action.action === 'choose_lovers') {
                    const cupid = this.game.players.get(playerId);
                    const lover = this.game.players.get(action.target);
                    
                    if (!cupid || !lover) {
                        logger.error('Invalid Cupid or lover selection', { 
                            cupidId: playerId, 
                            loverId: action.target 
                        });
                        continue;
                    }

                    if (!lover.isAlive) {
                        logger.error('Cannot select dead player as lover', { 
                            loverId: action.target 
                        });
                        continue;
                    }

                    if (cupid.id === lover.id) {
                        logger.error('Cupid cannot select self as lover', { 
                            cupidId: cupid.id 
                        });
                        continue;
                    }

                    // Set up bidirectional lover relationship
                    this.game.lovers.set(cupid.id, lover.id);
                    this.game.lovers.set(lover.id, cupid.id);
                    
                    // Notify both players
                    await lover.sendDM({
                        embeds: [{
                            color: 0xff69b4,
                            title: '💘 You Have Been Chosen!',
                            description: `**${cupid.username}** has chosen you as their lover. If either of you dies, the other will die of heartbreak.`
                        }]
                    });
                    
                    await cupid.sendDM({
                        embeds: [{
                            color: 0xff69b4,
                            title: '💘 Love Blossoms',
                            description: `You have chosen **${lover.username}** as your lover. If either of you dies, the other will die of heartbreak.`
                        }]
                    });

                    logger.info('Lovers set', {
                        cupidId: cupid.id,
                        cupidName: cupid.username,
                        loverId: lover.id,
                        loverName: lover.username,
                        loversMap: Array.from(this.game.lovers.entries())
                    });

                    // After processing Cupid's action, finish Night Zero
                    await this.game.finishNightZero();
                }
            }
        } catch (error) {
            logger.error('Error processing Cupid action', { error });
            // Even if there's an error, try to advance the phase
            await this.game.finishNightZero();
        }
    }

    getMostFrequent(arr) {
        const counts = {};
        let maxCount = 0;
        let maxValue;

        for (const value of arr) {
            counts[value] = (counts[value] || 0) + 1;
            if (counts[value] > maxCount) {
                maxCount = counts[value];
                maxValue = value;
            }
        }

        return maxValue;
    }

    async processWerewolfAttacks() {
        try {
            for (const [playerId, action] of Object.entries(this.game.nightActions)) {
                if (action.action === 'attack') {
                    const target = this.game.players.get(action.target);
                    
                    logger.info('Processing werewolf attack', {
                        targetId: action.target,
                        targetRole: target?.role,
                        targetIsAlive: target?.isAlive,
                        targetIsProtected: target?.isProtected,
                        hasLovers: !!this.game.lovers.get(action.target)
                    });

                    if (!target?.isAlive) {
                        continue;
                    }

                    if (target.isProtected) {
                        if (!this.protectionMessageSent) {
                            await this.game.broadcastMessage({
                                embeds: [createProtectionEmbed(true)]
                            });
                            this.protectionMessageSent = true;
                        }
                        continue;
                    }

                    // Handle Hunter case
                    if (target.role === ROLES.HUNTER) {
                        this.game.pendingHunterRevenge = target.id;
                        await target.sendDM('You have been eliminated! Use `/action choose_target` to choose someone to take with you.');
                    }

                    // Mark target as dead and move to dead channel
                    target.isAlive = false;
                    await this.game.broadcastMessage({
                        embeds: [{
                            color: 0x800000,
                            title: '🐺 A Grim Discovery',
                            description: 
                                `*As dawn breaks, the village finds **${target.username}** dead, their body savagely mauled...*\n\n` +
                                `The werewolves have claimed another victim.`,
                            footer: { text: 'The hunt continues...' }
                        }]
                    });
                    
                    await this.game.moveToDeadChannel(target);

                    // Handle lover death after target is fully processed
                    const loverId = this.game.lovers.get(target.id);
                    if (loverId) {
                        const lover = this.game.players.get(loverId);
                        if (lover?.isAlive) {
                            lover.isAlive = false;
                            await this.game.broadcastMessage({
                                embeds: [{
                                    color: 0xff69b4,
                                    title: '💔 A Heart Breaks',
                                    description: `**${lover.username}** has died of heartbreak!`,
                                    footer: { text: 'Love and death are forever intertwined...' }
                                }]
                            });
                            await this.game.moveToDeadChannel(lover);
                        }
                    }
                }
            }

            // Check win conditions and advance phase
            const gameOver = await this.game.checkWinConditions();
            if (!gameOver) {
                await this.game.advanceToDay();
            }

        } catch (error) {
            logger.error('Error processing werewolf attacks', { 
                error: error.message,
                stack: error.stack 
            });
            if (!this.game.checkWinConditions()) {
                await this.game.advanceToDay();
            }
        } finally {
            this.protectionMessageSent = false;
        }
    }

    async handleNightZero() {
        try {
            logger.info('Starting Night Zero phase');

            // Get werewolves and send them their team info first
            const werewolves = this.game.getPlayersByRole(ROLES.WEREWOLF);
            const werewolfNames = werewolves.map(w => w.username).join(', ');
            
            for (const werewolf of werewolves) {
                await werewolf.sendDM({
                    embeds: [{
                        color: 0x800000,
                        title: '🐺 Your Pack',
                        description: werewolves.length > 1 ?
                            `*Your fellow werewolves are: **${werewolfNames}***` :
                            '*You are the lone werewolf. Hunt carefully...*',
                        footer: { text: 'Coordinate with your pack during the night phase...' }
                    }]
                });
            }

            // Handle Seer's initial revelation
            const seer = this.game.getPlayerByRole(ROLES.SEER);
            logger.info('Found Seer for Night Zero', {
                seerFound: !!seer,
                seerAlive: seer?.isAlive,
                seerUsername: seer?.username
            });

            if (seer && seer.isAlive) {
                try {
                    const validTargets = Array.from(this.game.players.values()).filter(
                        p => p.id !== seer.id && p.isAlive && p.role !== ROLES.WEREWOLF
                    );
                    
                    if (validTargets.length > 0) {
                        const randomPlayer = validTargets[Math.floor(Math.random() * validTargets.length)];
                        const isWerewolf = randomPlayer.role === ROLES.WEREWOLF;
                        
                        await seer.sendDM({
                            embeds: [createSeerRevealEmbed(randomPlayer, isWerewolf)]
                        });
                        
                        logger.info('Seer received initial vision', {
                            seerId: seer.id,
                            targetId: randomPlayer.id,
                            isWerewolf: isWerewolf,
                            targetRole: randomPlayer.role
                        });
                    }
                } catch (error) {
                    logger.error('Error sending Seer vision', { 
                        error: error.message,
                        stack: error.stack,
                        seerId: seer.id
                    });
                }
            }

            // Handle Cupid's action if present
            const cupid = this.game.getPlayerByRole(ROLES.CUPID);
            logger.info('Found Cupid for Night Zero', {
                cupidFound: !!cupid,
                cupidAlive: cupid?.isAlive,
                cupidUsername: cupid?.username
            });

            if (cupid?.isAlive) {
                try {
                    // Add Cupid to expected actions
                    this.game.expectedNightActions.add(cupid.id);

                    // Create dropdown for Cupid's lover selection
                    const validTargets = Array.from(this.game.players.values())
                        .filter(p => p.isAlive && p.id !== cupid.id);

                    const selectMenu = new StringSelectMenuBuilder()
                        .setCustomId('night_action_cupid')
                        .setPlaceholder('Select your lover')
                        .addOptions(
                            validTargets.map(target => ({
                                label: target.username,
                                value: target.id,
                                description: `Choose ${target.username} as your lover`
                            }))
                        );

                    const row = new ActionRowBuilder().addComponents(selectMenu);
                    const embed = createNightActionEmbed(ROLES.CUPID);

                    await cupid.sendDM({ 
                        embeds: [embed], 
                        components: [row] 
                    });

                    logger.info('Sent Cupid action prompt with dropdown', { 
                        username: cupid.username,
                        validTargetCount: validTargets.length,
                        hasComponents: true
                    });
                } catch (error) {
                    logger.error('Error sending Cupid prompt', { error });
                }
            } else {
                // If no Cupid or Cupid is not alive, proceed to Day phase
                logger.info('No Cupid present or Cupid not alive, proceeding to Day phase');
                await this.game.finishNightZero();
            }

            logger.info('Game started successfully');
        } catch (error) {
            logger.error('Error during Night Zero', { error });
            // Even if there's an error, try to advance to Day phase
            await this.game.finishNightZero();
        }
    }

    areAllNightActionsComplete() {
        return Array.from(this.game.expectedNightActions).every(
            playerId => this.game.completedNightActions.has(playerId)
        );
    }

    async handleLoversDeath(deadPlayer) {
        try {
            logger.info('Handling lover death', {
                deadPlayerId: deadPlayer.id,
                deadPlayerName: deadPlayer.username,
                loversMap: Array.from(this.game.lovers.entries())
            });

            // Check if dead player has a lover
            const loverId = this.game.lovers.get(deadPlayer.id);
            if (!loverId) {
                logger.info('No lover found for dead player', {
                    playerId: deadPlayer.id,
                    playerName: deadPlayer.username
                });
                return;
            }

            const lover = this.game.players.get(loverId);
            if (!lover || !lover.isAlive) {
                return;
            }

            // Mark lover as dead
            lover.isAlive = false;

            // Send heartbreak message
            await this.game.broadcastMessage({
                embeds: [{
                    color: 0xff69b4,
                    title: '💔 A Heart Breaks',
                    description: `**${lover.username}** has died of heartbreak!`,
                    footer: { text: 'Love and death are forever intertwined...' }
                }]
            });

            // Move lover to dead channel
            await this.game.moveToDeadChannel(lover);

            logger.info('Lover died of heartbreak', {
                originalDeadPlayer: deadPlayer.username,
                loverName: lover.username
            });

        } catch (error) {
            logger.error('Error handling lover death', { 
                error: error.message,
                stack: error.stack,
                deadPlayerId: deadPlayer.id
            });
        }
    }
}

module.exports = NightActionProcessor; 