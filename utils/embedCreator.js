const { EmbedBuilder } = require('discord.js');

// First, we'd need to add these role-specific constants
const ROLE_ABILITIES = {
    'werewolf': 'Vote each night to eliminate a player',
    'seer': 'Investigate one player each night to learn if they are a werewolf',
    'bodyguard': 'Protect one player each night from werewolf attacks',
    'cupid': 'Choose one player to be your lover at the start of the game. If either lover dies, both die of heartbreak.',
    'hunter': 'Take one player with you when you die',
    'villager': 'Vote during the day to eliminate suspicious players'
};

const ROLE_WIN_CONDITIONS = {
    'werewolf': 'Win when werewolves equal or outnumber villagers',
    'seer': 'Win when all werewolves are eliminated',
    'bodyguard': 'Win when all werewolves are eliminated',
    'cupid': 'Win when all werewolves are eliminated',
    'hunter': 'Win when all werewolves are eliminated',
    'villager': 'Win when all werewolves are eliminated'
};

const ROLE_TIPS = {
    'werewolf': 'Try to appear helpful during day discussions. Coordinate with other werewolves at night.',
    'seer': 'Share information carefully - revealing too much too early makes you a target',
    'bodyguard': 'Pay attention to discussions to identify likely werewolf targets',
    'cupid': 'Choose your lover wisely - your fates are linked! Consider picking someone you trust.',
    'hunter': 'Your revenge shot is powerful - use it wisely when eliminated',
    'villager': 'Pay attention to voting patterns and player behavior'
};

const ROLE_EMOJIS = {
    'werewolf': '🐺',
    'seer': '👁️',
    'bodyguard': '🛡️',
    'cupid': '💘',
    'hunter': '🏹',
    'villager': '👥'
};

function getRoleEmoji(role) {
    return ROLE_EMOJIS[role] || '❓';
}

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

function createTimedEmbed(title, description, endTime) {
    const timeRemaining = Math.max(0, endTime - Date.now());
    const minutes = Math.floor(timeRemaining / 60000);
    const seconds = Math.floor((timeRemaining % 60000) / 1000);

    return new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle(title)
        .setDescription(description)
        .addFields({
            name: '⏳ Time Remaining',
            value: `${minutes}:${seconds.toString().padStart(2, '0')}`
        })
        .setTimestamp(endTime);
}

function createVotingEmbed(target, seconder, game, endTime) {
    const embed = createTimedEmbed(
        '⚖️ Time to Vote!',
        `${target.username} has been nominated...`,
        endTime
    );
    const eligibleVoters = Array.from(game.players.values())
        .filter(p => p.isAlive && p.id !== target.id);
    const votesReceived = game.votes.size;
    const remainingVotes = eligibleVoters.length - votesReceived;

    embed.addFields(
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
    );

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

function createRoleCard(role) {
    return new EmbedBuilder()
        .setTitle(`${getRoleEmoji(role)} ${role}`)
        .addFields(
            { name: 'Abilities', value: ROLE_ABILITIES[role] },
            { name: 'Win Condition', value: ROLE_WIN_CONDITIONS[role] },
            { name: 'Tips', value: ROLE_TIPS[role] }
        );
}

function createSeerRevealEmbed(target, isWerewolf) {
    return new EmbedBuilder()
        .setColor(0x4B0082)  // Deep purple for mystical effect
        .setTitle('🔮 Initial Vision')
        .setDescription(
            `*As the game begins, your mystical powers reveal a vision of **${target.username}**...*\n\n` +
            `Your vision shows that they are **${isWerewolf ? 'a Werewolf!' : 'Not a Werewolf.'}**`
        )
        .setFooter({ text: 'Use this knowledge wisely to help the village...' });
}

module.exports = { 
    createPlayerListEmbed,
    createNominationEmbed,
    createVotingEmbed,
    createVoteResultsEmbed,
    createDayPhaseEmbed,
    createNominationSelectEmbed,
    createRoleCard,
    createSeerRevealEmbed,
};
