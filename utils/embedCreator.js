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

function createNominationEmbed(nominator, target) {
    return new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('Player Nominated')
        .setDescription(`${nominator.username} has nominated ${target.username} for elimination.`)
        .addFields(
            { name: 'Status', value: 'Waiting for a second...' }
        )
        .setTimestamp();
}

function createVotingEmbed(target, seconder) {
    return new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('Voting Started')
        .setDescription(`${target.username} has been nominated for elimination.\nNomination seconded by ${seconder.username}.`)
        .addFields(
            { name: 'Instructions', value: 'Click the buttons below to vote.' }
        )
        .setTimestamp();
}

function createVoteResultsEmbed(target, voteCounts, eliminated) {
    return new EmbedBuilder()
        .setColor(eliminated ? '#FF0000' : '#00FF00')
        .setTitle('Vote Results')
        .setDescription(eliminated ? 
            `${target.username} has been eliminated.` :
            `${target.username} has survived the vote.`
        )
        .addFields(
            { name: 'Votes to Lynch', value: voteCounts.guilty.toString(), inline: true },
            { name: 'Votes to Spare', value: voteCounts.innocent.toString(), inline: true }
        )
        .setTimestamp();
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
