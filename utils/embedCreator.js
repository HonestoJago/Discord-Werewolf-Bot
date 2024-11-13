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
        color: 0x800000,
        title: '⚖️ Accusation Made',
        description: 
            `*In a moment of courage or folly, **${nominatorName}** points an accusing finger at **${targetName}**.*\n\n` +
            'Will anyone support this accusation? A second is needed to bring this to trial.',
        footer: {
            text: 'The next 60 seconds could determine a villager\'s fate...'
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
        .setColor(eliminated ? '#800000' : '#006400')
        .setTitle(eliminated ? '⚰️ The Village Has Spoken' : '🕊️ Mercy Prevails')
        .setDescription(eliminated ? 
            `*With heavy hearts, the village condemns **${target.username}** to death.*` :
            `*The village shows mercy, and **${target.username}** lives to see another day.*`
        )
        .addFields(
            { name: '🔨 Votes for Death', value: voteCounts.guilty.toString(), inline: true },
            { name: '💐 Votes for Mercy', value: voteCounts.innocent.toString(), inline: true },
            { 
                name: '📜 The Verdict',
                value: Object.entries(playerVotes)
                    .map(([username, vote]) => `${username}: ${vote ? '🔨' : '💐'}`)
                    .join('\n') || '*No votes were cast*'
            }
        )
        .setTimestamp();

    return embed;
}

function createDayPhaseEmbed(players, nominationActive = false) {
    const embed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('☀️ Village Council')
        .setDescription(nominationActive ? 
            '*Tensions rise as accusations fly...*' : 
            '*The village gathers to root out evil. Who among you acts suspicious?*'
        )
        .addFields(
            { 
                name: '🎭 Living Villagers', 
                value: Array.from(players.values())
                    .filter(p => p.isAlive)
                    .map(p => `• ${p.username}`)
                    .join('\n') || '*The village lies empty...*'
            }
        )
        .setFooter({ text: 'Choose wisely, for the fate of the village hangs in the balance...' });

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
