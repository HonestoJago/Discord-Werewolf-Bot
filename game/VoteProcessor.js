const dayPhaseHandler = require('../handlers/dayPhaseHandler');
const { GameError } = require('../utils/error-handler');
const logger = require('../utils/logger');
const ROLES = require('../constants/roles');
const PHASES = require('../constants/phases');
const { createVoteResultsEmbed, createHunterRevengeEmbed, createHunterTensionEmbed } = require('../utils/embedCreator');
const { StringSelectMenuBuilder, ActionRowBuilder } = require('discord.js');

class VoteProcessor {
    constructor(game) {
        this.game = game;
    }

    async nominate(nominatorId, targetId) {
        if (this.game.nominatedPlayer) {
            throw new GameError('Nomination Active', 'A nomination is already in progress. Please wait for it to conclude.');
        }

        if (this.game.votingOpen) {
            throw new GameError('Invalid state', 'Cannot nominate while voting is in progress');
        }

        if (this.game.phase !== PHASES.DAY) {
            throw new GameError('Wrong phase', 'Nominations can only be made during the day.');
        }

        const nominator = this.game.players.get(nominatorId);
        const target = this.game.players.get(targetId);

        if (!nominator?.isAlive) {
            throw new GameError('Invalid nominator', 'Dead players cannot make nominations.');
        }
        if (!target?.isAlive) {
            throw new GameError('Invalid target', 'Dead players cannot be nominated.');
        }
        if (nominatorId === targetId) {
            throw new GameError('Invalid nomination', 'You cannot nominate yourself.');
        }

        this.game.nominatedPlayer = targetId;
        this.game.nominator = nominatorId;
        this.game.votingOpen = false;

        if (this.game.nominationTimeout) {
            clearTimeout(this.game.nominationTimeout);
        }

        this.game.nominationTimeout = setTimeout(async () => {
            if (this.game.nominatedPlayer && !this.game.votingOpen) {
                await this.clearNomination('No second received within one minute. Nomination failed.');
                await this.initiateNewNomination();
            }
        }, this.game.NOMINATION_WAIT_TIME);

        await this.game.broadcastMessage({
            embeds: [{
                title: '⚖️ Accusation Made',
                description: `${nominator.username} has nominated ${target.username} for elimination.\n` +
                           `Please second this nomination within one minute to proceed to voting.`,
                footer: { text: 'The next 60 seconds could determine a villager\'s fate...' }
            }]
        });

        logger.info('Player nominated', { 
            nominator: nominator.username, 
            target: target.username 
        });
    }

    async second(seconderId) {
        if (!this.game.nominatedPlayer || this.game.votingOpen) {
            throw new GameError('Invalid state', 'No active nomination to second.');
        }

        const seconder = this.game.players.get(seconderId);
        if (!seconder?.isAlive) {
            throw new GameError('Invalid seconder', 'Dead players cannot second nominations.');
        }
        if (seconderId === this.game.nominator) {
            throw new GameError('Invalid seconder', 'The nominator cannot second their own nomination.');
        }

        if (this.game.seconder) {
            throw new GameError('Already seconded', 'This nomination has already been seconded.');
        }

        if (this.game.nominationTimeout) {
            clearTimeout(this.game.nominationTimeout);
            this.game.nominationTimeout = null;
        }

        this.game.seconder = seconderId;
        this.game.votingOpen = true;
        this.game.votes.clear();

        logger.info('Nomination seconded', {
            seconder: seconder.username,
            target: this.game.players.get(this.game.nominatedPlayer).username
        });

        await this.game.broadcastMessage({
            embeds: [{
                title: 'Nomination Seconded',
                description: `${seconder.username} has seconded the nomination of ${this.game.players.get(this.game.nominatedPlayer).username}.\n` +
                           `Proceeding to voting phase.`
            }]
        });
    }

    async submitVote(voterId, isGuilty) {
        if (!this.game.votingOpen) {
            throw new GameError('Invalid state', 'Voting is not currently open.');
        }
        const voter = this.game.players.get(voterId);
        if (!voter?.isAlive) {
            throw new GameError('Invalid voter', 'Dead players cannot vote.');
        }

        if (voterId === this.game.nominatedPlayer) {
            throw new GameError('Invalid voter', 'You cannot vote in your own nomination.');
        }

        // Record the vote
        this.game.votes.set(voterId, isGuilty);

        // Check if all votes are in
        const eligibleVoters = Array.from(this.game.players.values())
            .filter(p => p.isAlive && p.id !== this.game.nominatedPlayer)
            .length;

        if (this.game.votes.size >= eligibleVoters) {
            // Process voting results
            const results = await this.processVotes();
            return results;
        }

        return null;
    }

    clearVotingState() {
        this.game.nominatedPlayer = null;
        this.game.nominator = null;
        this.game.seconder = null;
        this.game.votingOpen = false;
        this.game.votes.clear();
        if (this.game.nominationTimeout) {
            clearTimeout(this.game.nominationTimeout);
            this.game.nominationTimeout = null;
        }
    }

    async processVotes() {
        if (!this.game.votingOpen) {
            throw new GameError('Invalid state', 'No votes to process.');
        }
    
        const voteCounts = {
            guilty: 0,
            innocent: 0
        };
    
        const playerVotes = {};
        const target = this.game.players.get(this.game.nominatedPlayer);
        
        // Count votes only from living players who aren't the target
        const eligibleVoters = Array.from(this.game.players.values())
            .filter(p => p.isAlive && p.id !== this.game.nominatedPlayer)
            .length;
    
        try {
            // Calculate votes
            for (const [voterId, vote] of this.game.votes.entries()) {
                const voter = this.game.players.get(voterId);
                if (voter && voter.isAlive && voterId !== this.game.nominatedPlayer) {
                    voteCounts[vote ? 'guilty' : 'innocent']++;
                    playerVotes[voter.username] = vote;
                }
            }
    
            // Check if we have all eligible votes
            const totalVotes = voteCounts.guilty + voteCounts.innocent;
            const expectedVotes = eligibleVoters;
            
            // If we don't have all votes yet, don't process the result
            if (totalVotes < expectedVotes) {
                return null;
            }
    
            if (voteCounts.guilty === voteCounts.innocent || voteCounts.innocent > voteCounts.guilty) {
                // Create and send results embed
                const resultsEmbed = createVoteResultsEmbed(
                    target,
                    voteCounts,
                    false, // not eliminated
                    playerVotes
                );

                const channel = await this.game.client.channels.fetch(this.game.gameChannelId);
                await channel.send({ embeds: [resultsEmbed] });

                // Broadcast that no one was eliminated and stay in day phase
                await this.game.broadcastMessage('No player was eliminated. The voting continues...');
                
                // Clear voting state
                this.clearVotingState();

                // Refresh the day phase UI for new nominations
                const dayChannel = await this.game.client.channels.fetch(this.game.gameChannelId);
                await dayPhaseHandler.createDayPhaseUI(dayChannel, this.game.players);

                return {
                    eliminated: null,
                    votesFor: voteCounts.guilty,
                    votesAgainst: voteCounts.innocent,
                    stayInDay: true
                };
            }

            // If we get here, it means guilty votes won
            const eliminated = true;

            // Create and send results embed
            const resultsEmbed = createVoteResultsEmbed(
                target,
                voteCounts,
                eliminated,
                playerVotes
            );

            const channel = await this.game.client.channels.fetch(this.game.gameChannelId);
            await channel.send({ embeds: [resultsEmbed] });

            // Handle elimination and phase transition
            if (eliminated) {
                // Announce whether the eliminated player was a werewolf
                const isWerewolf = target.role === ROLES.WEREWOLF;
                    await this.game.broadcastMessage({
                        embeds: [{
                        color: isWerewolf ? 0x008000 : 0x800000,
                        title: isWerewolf ? '🐺 A Wolf Among Us!' : '❌ An Innocent Soul',
                        description: isWerewolf ?
                            `*The village's suspicions were correct! **${target.username}** was indeed a Werewolf!*` :
                            `*Alas, **${target.username}** was not a Werewolf. The real beasts still lurk among you...*`,
                        footer: { text: isWerewolf ? 'But are there more?' : 'Choose more carefully next time...' }
                    }]
                });

                // Handle Hunter's revenge BEFORE marking as dead
                if (target.role === ROLES.HUNTER) {
                    logger.info('Hunter was voted out', {
                        hunterId: target.id,
                        hunterName: target.username
                    });

                    // Set up Hunter's revenge state
                    this.game.pendingHunterRevenge = target.id;
                    
                    // Create dropdown for Hunter's revenge
                    const validTargets = Array.from(this.game.players.values())
                        .filter(p => p.isAlive && p.id !== target.id)
                        .map(p => ({
                            label: p.username,
                            value: p.id,
                            description: `Take ${p.username} with you`
                        }));

                    const selectMenu = new StringSelectMenuBuilder()
                        .setCustomId('hunter_revenge')
                        .setPlaceholder('Choose your target')
                        .addOptions(validTargets);

                    const row = new ActionRowBuilder().addComponents(selectMenu);

                    // Send DM to Hunter with dropdown
                    await target.sendDM({
                        embeds: [createHunterRevengeEmbed()],
                        components: [row]
                    });
                    
                    // Send mysterious message to village
                    await this.game.broadcastMessage({
                        embeds: [createHunterTensionEmbed(true)]
                    });

                    // Reset voting state WITHOUT broadcasting a "nomination failed" message
                    this.game.nominatedPlayer = null;
                    this.game.nominator = null;
                    this.game.seconder = null;
                    this.game.votingOpen = false;
                    this.game.votes.clear();
                    if (this.game.nominationTimeout) {
                        clearTimeout(this.game.nominationTimeout);
                        this.game.nominationTimeout = null;
                    }

                    return;
                }

                // For non-Hunter players, mark as dead first, then handle effects
                target.isAlive = false;
                await this.game.broadcastMessage(`**${target.username}** has been eliminated!`);
                await this.game.moveToDeadChannel(target);
                await this.game.nightActionProcessor.handleLoversDeath(target);

                    // Reset voting state WITHOUT broadcasting a "nomination failed" message
                    this.game.nominatedPlayer = null;
                    this.game.nominator = null;
                    this.game.seconder = null;
                    this.game.votingOpen = false;
                    this.game.votes.clear();
                    if (this.game.nominationTimeout) {
                        clearTimeout(this.game.nominationTimeout);
                        this.game.nominationTimeout = null;
                    }

                // Only advance to night if someone was actually eliminated
                const gameOver = await this.game.checkWinConditions();
                if (!gameOver) {
                    await this.game.advanceToNight();
                }
            }

            // Reset voting state
            this.clearVotingState();

            return {
                eliminated: eliminated ? target.id : null,
                votesFor: voteCounts.guilty,
                votesAgainst: voteCounts.innocent,
                stayInDay: !eliminated
            };
        } catch (error) {
            logger.error('Error processing votes', { error });
            throw error;
        }
    }

    // Add method to handle Hunter's revenge during day
    async processHunterRevenge(hunterId, targetId) {
        const hunter = this.game.players.get(hunterId);
        const target = this.game.players.get(targetId);

        if (!this.game.pendingHunterRevenge || hunterId !== this.game.pendingHunterRevenge) {
            throw new GameError('Invalid action', 'You can only use this action when prompted after being eliminated as the Hunter.');
        }

        if (!target?.isAlive) {
            throw new GameError('Invalid target', 'You must choose a living player.');
        }

        // Mark both players as dead
        hunter.isAlive = false;
                target.isAlive = false;

        // Broadcast the revenge
                    await this.game.broadcastMessage({
                        embeds: [{
                color: 0x800000,
                title: '🏹 The Hunter\'s Final Shot',
                            description: 
                    `*With their dying breath, **${hunter.username}** raises their bow...*\n\n` +
                    `In a final act of vengeance, they take **${target.username}** with them to the grave!`,
                footer: { text: 'Even in death, the Hunter\'s aim remains true...' }
                        }]
                    });

        // Move both to dead channel
        await this.game.moveToDeadChannel(hunter);
                await this.game.moveToDeadChannel(target);

        // Handle any lover deaths
        await this.game.nightActionProcessor.handleLoversDeath(target);
        
        // Clear the pending state
        this.game.pendingHunterRevenge = null;

        // Check win conditions before advancing to night
        if (!this.game.checkWinConditions()) {
            await this.game.advanceToNight();
        }
    }

    async clearNomination(reason, broadcast = true) {
        if (this.game.nominatedPlayer || this.game.nominator || this.game.seconder || this.game.votingOpen) {
            // Clear all nomination-related state
                    this.game.nominatedPlayer = null;
                    this.game.nominator = null;
                    this.game.seconder = null;
                    this.game.votingOpen = false;
                    this.game.votes.clear();

            // Clear any existing timeout
                    if (this.game.nominationTimeout) {
                        clearTimeout(this.game.nominationTimeout);
                        this.game.nominationTimeout = null;
                    }

            // Only broadcast if explicitly requested
            if (broadcast) {
                    await this.game.broadcastMessage({
                        embeds: [{
                        title: 'Nomination Failed',
                        description: reason
                        }]
                    });
            }

            logger.info('Nomination cleared', { reason, broadcast });
        }
    }

    /**
     * Initiates a new nomination process after a nomination failure.
     */
    async initiateNewNomination() {
        // Reset nomination state
                    this.game.nominatedPlayer = null;
                    this.game.nominator = null;
                    this.game.seconder = null;
                    this.game.votingOpen = false;
                    this.game.votes.clear();

        // Notify players to nominate again
                    await this.game.broadcastMessage({
                        embeds: [{
                title: 'Nomination Reset',
                description: 'The previous nomination failed due to a lack of a second. Please nominate a new player for elimination.'
                        }]
                    });

        // Re-initiate Day phase UI to prompt for new nomination
        const channel = await this.game.client.channels.fetch(this.game.gameChannelId);
        await dayPhaseHandler.createDayPhaseUI(channel, this.game.players);

        logger.info('Nomination has been reset', { reason: 'Previous nomination failed due to no seconder.' });
    }
}

module.exports = VoteProcessor; 