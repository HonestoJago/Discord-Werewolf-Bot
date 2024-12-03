const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const GameStateManager = require('../utils/gameStateManager');
const { GameError } = require('../utils/error-handler');
const { handleCommandError } = require('../utils/error-handler');
const logger = require('../utils/logger');
const ROLES = require('../constants/roles');
const PHASES = require('../constants/phases');
const { 
    createVoteResultsEmbed, 
    createHunterRevengeEmbed, 
    createHunterTensionEmbed, 
    createDeathAnnouncementEmbed,
    createDayPhaseEmbed,
    createNominationEmbed,
    createVotingEmbed
} = require('../utils/embedCreator');
const buttonCreator = require('../utils/buttonCreator');

class VoteProcessor {
    constructor(game) {
        this.game = game;
    }

    /**
     * Creates a snapshot of the current voting state
     * @returns {Object} Snapshot of current state
     */
    createVoteSnapshot() {
        return {
            nominatedPlayer: this.game.nominatedPlayer,
            nominator: this.game.nominator,
            seconder: this.game.seconder,
            votingOpen: this.game.votingOpen,
            votes: new Map(this.game.votes),
            nominationTimeout: this.game.nominationTimeout
        };
    }

    /**
     * Restores voting state from a snapshot
     * @param {Object} snapshot - State snapshot to restore
     */
    restoreFromSnapshot(snapshot) {
        this.game.nominatedPlayer = snapshot.nominatedPlayer;
        this.game.nominator = snapshot.nominator;
        this.game.seconder = snapshot.seconder;
        this.game.votingOpen = snapshot.votingOpen;
        this.game.votes = new Map(snapshot.votes);
        
        if (this.game.nominationTimeout) {
            clearTimeout(this.game.nominationTimeout);
        }
        this.game.nominationTimeout = snapshot.nominationTimeout;
    }

    /**
     * Atomically processes a nomination
     * @param {string} nominatorId - ID of the nominating player
     * @param {string} targetId - ID of the nominated player
     */
    async nominate(nominatorId, targetId) {
        const snapshot = this.createVoteSnapshot();
        
        try {
            // Validate nomination
            if (this.game.nominatedPlayer) {
                throw new GameError('Nomination Active', 'A nomination is already in progress.');
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

            // Update state atomically
            this.game.nominatedPlayer = targetId;
            this.game.nominator = nominatorId;
            this.game.votingOpen = false;

            // Clear any existing timeout
            if (this.game.nominationTimeout) {
                clearTimeout(this.game.nominationTimeout);
            }

            // Set new timeout
            this.game.nominationTimeout = setTimeout(async () => {
                if (this.game.nominatedPlayer && !this.game.votingOpen) {
                    await this.clearNomination('No second received within one minute. Nomination failed.');
                    await this.initiateNewNomination();
                }
            }, this.game.NOMINATION_WAIT_TIME);

            // Save state before broadcasting
            await this.game.saveGameState();

            // Broadcast nomination
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

        } catch (error) {
            // Restore previous state on error
            this.restoreFromSnapshot(snapshot);
            throw error;
        }
    }

    /**
     * Atomically processes a second
     * @param {string} seconderId - ID of the player seconding the nomination
     */
    async second(seconderId) {
        const snapshot = this.createVoteSnapshot();

        try {
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

            // Update state atomically
            if (this.game.nominationTimeout) {
                clearTimeout(this.game.nominationTimeout);
                this.game.nominationTimeout = null;
            }

            this.game.seconder = seconderId;
            this.game.votingOpen = true;
            this.game.votes.clear();

            // Save state before broadcasting
            await this.game.saveGameState();

            // Create and send voting UI
            const channel = await this.game.client.channels.fetch(this.game.gameChannelId);
            const target = this.game.players.get(this.game.nominatedPlayer);
            
            await channel.send({
                embeds: [createVotingEmbed(
                    target,
                    seconder,
                    this.game
                )],
                components: [buttonCreator.createVotingButtons(this.game.nominatedPlayer)]
            });

            logger.info('Nomination seconded', {
                seconder: seconder.username,
                target: target.username
            });

        } catch (error) {
            // Restore previous state on error
            this.restoreFromSnapshot(snapshot);
            throw error;
        }
    }

    /**
     * Atomically processes a vote submission
     * @param {string} voterId - ID of the voting player
     * @param {boolean} isGuilty - Whether the vote is guilty or innocent
     */
    async submitVote(voterId, isGuilty) {
        const snapshot = this.createVoteSnapshot();
        
        try {
            // Check if game is over first
            if (this.game.gameOver || this.game.phase === PHASES.GAME_OVER) {
                logger.info('Vote attempted after game end', { 
                    voterId,
                    gamePhase: this.game.phase,
                    gameOver: this.game.gameOver
                });
                return null;  // Silently ignore votes after game end
            }

            // Validate vote
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

            // Record the vote atomically
            this.game.votes.set(voterId, isGuilty);

            // Save state after vote is recorded
            await this.game.saveGameState();

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
        } catch (error) {
            // Only restore and throw if game isn't over
            if (!this.game.gameOver && this.game.phase !== PHASES.GAME_OVER) {
                await this.restoreFromSnapshot(snapshot);
                throw error;
            }
            // Log but don't throw for post-game errors
            logger.info('Vote processing skipped - game ended', {
                voterId,
                gamePhase: this.game.phase,
                gameOver: this.game.gameOver
            });
            return null;
        }
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

    /**
     * Atomically processes the voting results
     * @returns {Object} Results of the vote
     */
    async processVotes() {
        const snapshot = this.createVoteSnapshot();
        let target = null;  // Define target outside try block
        let voteCounts = { guilty: 0, innocent: 0 };  // Define voteCounts outside try block
        let playerVotes = {};  // Define playerVotes outside try block
        
        try {
            if (!this.game.votingOpen) {
                throw new GameError('Invalid state', 'No votes to process.');
            }
        
            target = this.game.players.get(this.game.nominatedPlayer);
            
            // Count votes only from living players who aren't the target
            const eligibleVoters = Array.from(this.game.players.values())
                .filter(p => p.isAlive && p.id !== this.game.nominatedPlayer)
                .length;
        
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
            if (totalVotes < eligibleVoters) {
                logger.info('Vote processing incomplete - waiting for more votes', {
                    target: target.username,
                    currentVotes: totalVotes,
                    requiredVotes: eligibleVoters,
                    guiltyVotes: voteCounts.guilty,
                    innocentVotes: voteCounts.innocent
                });
                return null;
            }

            logger.info('Processing vote results', {
                target: target.username,
                guiltyVotes: voteCounts.guilty,
                innocentVotes: voteCounts.innocent,
                eligibleVoters,
                playerVotes
            });
        
            // Process vote outcome atomically
            if (voteCounts.guilty === voteCounts.innocent || voteCounts.innocent > voteCounts.guilty) {
                // Create and send results embed
                const resultsEmbed = createVoteResultsEmbed(
                    target,
                    voteCounts,
                    false,
                    playerVotes
                );

                const channel = await this.game.client.channels.fetch(this.game.gameChannelId);
                await channel.send({ embeds: [resultsEmbed] });

                // Clear voting state
                this.clearVotingState();
                await this.game.saveGameState();

                // Refresh the day phase UI
                const dayChannel = await this.game.client.channels.fetch(this.game.gameChannelId);
                await this.createDayPhaseUI(dayChannel, this.game.players);

                logger.info('Vote failed - target spared', {
                    target: target.username,
                    guiltyVotes: voteCounts.guilty,
                    innocentVotes: voteCounts.innocent,
                    reason: voteCounts.guilty === voteCounts.innocent ? 'tie' : 'majority innocent'
                });

                return {
                    eliminated: null,
                    votesFor: voteCounts.guilty,
                    votesAgainst: voteCounts.innocent,
                    stayInDay: true
                };
            }

            // Handle guilty verdict atomically
            if (voteCounts.guilty > voteCounts.innocent) {
                const eliminated = true;
                const resultsEmbed = createVoteResultsEmbed(
                    target,
                    voteCounts,
                    eliminated,
                    playerVotes
                );

                const channel = await this.game.client.channels.fetch(this.game.gameChannelId);
                await channel.send({ embeds: [resultsEmbed] });

                logger.info('Vote passed - target eliminated', {
                    target: target.username,
                    targetRole: target.role,
                    guiltyVotes: voteCounts.guilty,
                    innocentVotes: voteCounts.innocent
                });

                // Handle elimination through PlayerStateManager
                await this.game.playerStateManager.changePlayerState(target.id, 
                    { isAlive: false },
                    { reason: 'Eliminated by vote' }
                );

                // Clear voting state
                this.clearVotingState();
                await this.game.saveGameState();

                // Check win conditions and advance phase if needed
                if (!this.game.pendingHunterRevenge) {
                    const gameOver = await this.game.playerStateManager.checkWinConditionsAfterDeath(target.id);
                    if (!gameOver) {
                        await this.game.advanceToNight();
                    }
                }

                return {
                    eliminated: target.id,
                    votesFor: voteCounts.guilty,
                    votesAgainst: voteCounts.innocent,
                    stayInDay: false
                };
            }

            // If we get here, something went wrong with the vote processing
            logger.error('Vote processing reached invalid state', {
                guiltyVotes: voteCounts.guilty,
                innocentVotes: voteCounts.innocent,
                target: target.username,
                playerVotes
            });
            
            // Return a safe default that keeps us in day phase
            return {
                eliminated: null,
                votesFor: voteCounts.guilty,
                votesAgainst: voteCounts.innocent,
                stayInDay: true
            };

        } catch (error) {
            // Restore previous state on error
            this.restoreFromSnapshot(snapshot);
            logger.error('Error processing votes', { 
                error: {
                    name: error.name,
                    message: error.message,
                    stack: error.stack
                },
                target: target?.username,
                nominatedPlayer: this.game.nominatedPlayer,
                voteCounts,
                playerVotes,
                phase: this.game.phase,
                round: this.game.round
            });
            throw error;
        }
    }

    /**
     * Helper method to handle Hunter's revenge setup
     * @param {Player} hunter - The Hunter player
     */
    async handleHunterRevenge(hunter) {
        await this.game.handleHunterRevenge(hunter);
    }

      /**
     * Atomically clears the current nomination
     * @param {string} reason - Reason for clearing the nomination
     * @param {boolean} broadcast - Whether to broadcast the clearing
     */
    async clearNomination(reason, broadcast = true) {
        const snapshot = this.createVoteSnapshot();
        
        try {
            if (this.game.nominatedPlayer || this.game.nominator || this.game.seconder || this.game.votingOpen) {
                // Update state atomically
                this.game.nominatedPlayer = null;
                this.game.nominator = null;
                this.game.seconder = null;
                this.game.votingOpen = false;
                this.game.votes.clear();

                if (this.game.nominationTimeout) {
                    clearTimeout(this.game.nominationTimeout);
                    this.game.nominationTimeout = null;
                }

                // Save state before broadcasting
                await this.game.saveGameState();

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
        } catch (error) {
            // Restore previous state on error
            this.restoreFromSnapshot(snapshot);
            logger.error('Error clearing nomination', { error });
            throw error;
        }
    }

    /**
     * Atomically initiates a new nomination process
     */
    async initiateNewNomination() {
        const snapshot = this.createVoteSnapshot();
        
        try {
            // Update state atomically
            this.game.nominatedPlayer = null;
            this.game.nominator = null;
            this.game.seconder = null;
            this.game.votingOpen = false;
            this.game.votes.clear();

            // Save state before broadcasting
            await this.game.saveGameState();

            // Notify players to nominate again
            await this.game.broadcastMessage({
                embeds: [{
                    title: 'Nomination Reset',
                    description: 'The previous nomination failed due to a lack of a second. Please nominate a new player for elimination.'
                }]
            });

            // Re-initiate Day phase UI
            const channel = await this.game.client.channels.fetch(this.game.gameChannelId);
            await this.createDayPhaseUI(channel, this.game.players);

            logger.info('Nomination has been reset', { 
                reason: 'Previous nomination failed due to no seconder.' 
            });
        } catch (error) {
            // Restore previous state on error
            this.restoreFromSnapshot(snapshot);
            logger.error('Error initiating new nomination', { error });
            throw error;
        }
    }

    async createDayPhaseUI(channel, players) {
        try {
            // Create the day phase UI with player status
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('day_select_target')
                .setPlaceholder('Select a player to nominate')
                .addOptions(
                    Array.from(players.values())
                        .filter(p => p.isAlive)
                        .map(p => ({
                            label: p.username,
                            value: p.id,
                            description: `Nominate ${p.username} for elimination`
                        }))
                );

            const row = new ActionRowBuilder().addComponents(selectMenu);
            const embed = createDayPhaseEmbed(players);

            await channel.send({
                embeds: [embed],
                components: [row]
            });
        } catch (error) {
            logger.error('Error creating day phase UI', { error });
            throw error;
        }
    }

    async handleNominationSelect(interaction) {
        try {
            // Check for active nomination first
            if (this.game.nominatedPlayer) {
                await interaction.reply({
                    content: 'A nomination is already in progress. Please wait for it to conclude.',
                    ephemeral: true
                });
                return;
            }

            const targetId = interaction.values[0];
            const target = this.game.players.get(targetId);
            
            // Handle the nomination
            await this.nominate(interaction.user.id, targetId);
            await this.game.saveGameState();

            // Send nomination announcement with second button
            await interaction.reply({
                embeds: [createNominationEmbed(interaction.user.username, target.username)],
                components: [buttonCreator.createSecondButton(targetId)]
            });
        } catch (error) {
            await handleCommandError(interaction, error);
        }
    }
}

module.exports = VoteProcessor; 