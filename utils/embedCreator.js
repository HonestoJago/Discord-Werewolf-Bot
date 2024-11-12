const { EmbedBuilder } = require('discord.js');

function createPlayerListEmbed(players, phase) {
    const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('Werewolf Game Players')
        .setDescription(`Current game phase: ${phase}`)
        .addFields(
            { name: 'Player Count', value: players.size.toString(), inline: true },
            { name: 'Players', value: Array.from(players.values()).map(p => p.username).join('\n') || 'No players yet' }
        )
        .setTimestamp();

    return embed;
}

function createNominationEmbed(nominatorName, targetName) {
    return {
        color: 0xff0000,
        title: '⚖️ Player Nominated',
        description: `**${nominatorName}** has nominated **${targetName}** for elimination.\n\nThis nomination needs a second within 60 seconds to proceed to voting.`,
        footer: {
            text: 'Click the button below to second this nomination'
        }
    };
}

function createVotingEmbed(target, seconder, game) {
    const eligibleVoters = Array.from(game.players.values())
        .filter(p => p.isAlive && p.id !== target.id);
    const votesReceived = game.votes.size;
    const remainingVotes = eligibleVoters.length - votesReceived;

    const embed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('⚖️ Time to Vote!')
        .setDescription(
            `${target.username} has been nominated and seconded by ${seconder.username}.\n\n` +
            `**${target.username}** cannot vote in their own nomination.\n` +
            `All other living players must vote.`
        )
        .addFields(
            { 
                name: 'Instructions', 
                value: 'Click Lynch to eliminate the player, or Let Live to spare them.' 
            },
            {
                name: 'Voting Status',
                value: remainingVotes > 0 ? 
                    `Waiting for ${remainingVotes} more vote${remainingVotes === 1 ? '' : 's'}...` :
                    'All votes are in!'
            }
        )
        .setTimestamp();

    return embed;
}

function createVoteResultsEmbed(target, voteCounts, eliminated, playerVotes) {
    const embed = new EmbedBuilder()
        .setColor(eliminated ? '#FF0000' : '#00FF00')
        .setTitle('Vote Results')
        .setDescription(eliminated ? 
            `${target.username} has been eliminated.` :
            `${target.username} has survived the vote.`
        )
        .addFields(
            { name: 'Votes to Lynch', value: voteCounts.guilty.toString(), inline: true },
            { name: 'Votes to Spare', value: voteCounts.innocent.toString(), inline: true },
            { 
                name: 'Individual Votes', 
                value: Object.entries(playerVotes)
                    .map(([username, vote]) => `${username}: ${vote ? 'Lynch' : 'Spare'}`)
                    .join('\n') || 'No votes cast'
            },
            {
                name: 'Note',
                value: `${target.username} could not vote in their own nomination.`
            }
        )
        .setTimestamp();

    return embed;
}

function createDayPhaseEmbed(players, nominationActive = false) {
    const embed = new EmbedBuilder()
        .setColor('#FFA500')  // Orange for day phase
        .setTitle('Day Phase')
        .setDescription(nominationActive ? 
            'A nomination is in progress...' : 
            'Use the Nominate button to start a vote against a player.'
        )
        .addFields(
            { 
                name: 'Alive Players', 
                value: Array.from(players.values())
                    .filter(p => p.isAlive)
                    .map(p => p.username)
                    .join('\n') || 'No players alive'
            }
        )
        .setTimestamp();

    return embed;
}

function createNominationSelectEmbed(players) {
    return new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('Select Player to Nominate')
        .setDescription('Choose a player to nominate for elimination:')
        .addFields(
            { 
                name: 'Available Players', 
                value: Array.from(players.values())
                    .filter(p => p.isAlive)
                    .map(p => p.username)
                    .join('\n')
            }
        );
}

module.exports = { 
    createPlayerListEmbed,
    createNominationEmbed,
    createVotingEmbed,
    createVoteResultsEmbed,
    createDayPhaseEmbed,
    createNominationSelectEmbed
};
