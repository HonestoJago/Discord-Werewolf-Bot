const { GameError } = require('../utils/error-handler');
const logger = require('../utils/logger');
const ROLES = require('../constants/roles');
const PHASES = require('../constants/phases');
const { createVoteResultsEmbed } = require('../utils/embedCreator');

class VoteProcessor {
    constructor(game) {
        this.game = game;
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
        this.game.votes.forEach((vote, voterId) => {
            const player = this.game.players.get(voterId);
            if (player) {
                voteCounts[vote ? 'guilty' : 'innocent']++;
                playerVotes[player.username] = vote;
            }
        });
    
        const target = this.game.players.get(this.game.nominatedPlayer);
        const eliminated = voteCounts.guilty > voteCounts.innocent;
    
        // Create and send results embed
        const resultsEmbed = createVoteResultsEmbed(
            target,
            voteCounts,
            eliminated,
            playerVotes
        );
    
        const channel = await this.game.client.channels.fetch(this.game.gameChannelId);
        await channel.send({ embeds: [resultsEmbed] });
    
        if (eliminated) {
            // Only handle Hunter's revenge if Hunter role is in the game
            const hunterExists = Array.from(this.game.players.values())
                .some(p => p.role === ROLES.HUNTER);

            // Handle Hunter's revenge BEFORE marking as dead
            if (hunterExists && target.role === ROLES.HUNTER) {
                logger.info('Hunter was voted out', {
                    hunterId: target.id,
                    hunterName: target.username
                });

                // Set up Hunter's revenge state
                this.game.pendingHunterRevenge = target.id;
                
                // Send DM to Hunter
                await target.sendDM('You have been eliminated! Use `/action choose_target` to choose someone to take with you.');
                
                // Set timeout for Hunter's revenge
                const hunterTimeout = setTimeout(async () => {
                    if (this.game.pendingHunterRevenge) {
                        // If Hunter didn't act, just process their death
                        target.isAlive = false;
                        await this.game.moveToDeadChannel(target);
                        await this.game.handleLoversDeath(target);
                        this.game.pendingHunterRevenge = null;
                        
                        // Check win conditions before advancing to night
                        if (!this.game.checkWinConditions()) {
                            await this.game.advanceToNight();
                        }
                    }
                }, 300000); // 5 minutes

                // Clear voting state but stay in day phase
                this.game.clearVotingState();
                return;
            }
    
            // For non-Hunter players or if Hunter isn't in game, proceed normally
            target.isAlive = false;
            await this.game.moveToDeadChannel(target);
            await this.game.handleLoversDeath(target);
        }
    
        // Reset voting state
        this.game.clearVotingState();
    
        // If no win condition met, advance to night phase
        if (!this.game.checkWinConditions()) {
            await this.game.advanceToNight();
        }
    
        return {
            eliminated: eliminated ? target.id : null,
            votesFor: voteCounts.guilty,
            votesAgainst: voteCounts.innocent
        };
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
        await this.game.broadcastMessage(`**${hunter.username}** uses their dying action to take **${target.username}** with them!`);
        
        // Move both to dead channel
        await this.game.moveToDeadChannel(hunter);
        await this.game.moveToDeadChannel(target);
        
        // Handle any lover deaths
        await this.game.handleLoversDeath(target);
        
        // Clear the pending state
        this.game.pendingHunterRevenge = null;

        // Check win conditions before advancing to night
        if (!this.game.checkWinConditions()) {
            await this.game.advanceToNight();
        }
    }
}

module.exports = VoteProcessor; 