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
            // Handle Hunter's revenge BEFORE marking as dead
            if (target.role === ROLES.HUNTER) {
                this.game.expectedNightActions.add(target.id);
                this.game.pendingHunterRevenge = target.id;
                await target.sendDM('You have been eliminated! Use `/action hunter_revenge` to choose someone to take with you.');
                target.isAlive = false;
                this.game.clearVotingState();
                return;
            }
    
            // For non-Hunter players, proceed normally
            target.isAlive = false;
            await this.game.moveToDeadChannel(target);
            await this.game.handleLoversDeath(target);
        }
    
        // Reset voting state
        this.game.clearVotingState();
    
        // If no win condition met, advance to night phase
        // This happens whether someone was eliminated or not (including ties)
        if (!this.game.checkWinConditions()) {
            await this.game.advanceToNight();
        }
    
        return {
            eliminated: eliminated ? target.id : null,
            votesFor: voteCounts.guilty,
            votesAgainst: voteCounts.innocent
        };
    }
}

module.exports = VoteProcessor; 