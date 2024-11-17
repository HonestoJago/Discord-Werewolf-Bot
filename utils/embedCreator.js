const { EmbedBuilder } = require('discord.js');
const ROLES = require('../constants/roles');

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

function createVotingEmbed(target, seconder, game) {
    return {
        color: 0x800000, // Deep red for dramatic effect
        title: '⚖️ Time to Vote!',
        description: 
            '*The village gathers to decide the fate of:*\n\n' +
            `# **${target.username}**\n\n` +
            `*Nominated by **${game.players.get(game.nominator).username}**\n` +
            `Seconded by **${seconder.username}***\n\n` +
            '```\nThe accused stands before you. Will justice be served, or will an innocent soul be lost?```',
        fields: [
            { 
                name: '📜 Instructions', 
                value: '• Click `Lynch` to eliminate the player\n• Click `Let Live` to spare them',
                inline: false
            }
        ],
        footer: { 
            text: 'Choose wisely, for your vote may seal their fate...' 
        }
    };
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

function createGameEndEmbed(winners, gameStats) {
    const isWerewolfWin = winners.some(player => player.role === 'werewolf');
    
    // Get all players from gameStats (this will include everyone, not just winners)
    const allPlayers = Array.from(gameStats.players || []); // Add a fallback empty array
    const werewolves = allPlayers.filter(p => p.role === 'werewolf');
    const others = allPlayers.filter(p => p.role !== 'werewolf');
    
    return {
        color: isWerewolfWin ? 0x800000 : 0x008000,
        title: isWerewolfWin ? 
            '🐺 The Werewolves Have Conquered the Village!' : 
            '🎉 The Village Has Triumphed!',
        description: isWerewolfWin ?
            '*Darkness falls permanently as the werewolves claim their final victory...*' :
            '*The village can finally rest, knowing the threat has been eliminated...*',
        fields: [
            ...(isWerewolfWin ? [
                {
                    name: '🐺 The Werewolves',
                    value: werewolves.map(p => p.username).join('\n') || 'None',
                    inline: false
                },
                {
                    name: '👥 Other Players',
                    value: others.map(p => `${p.username} (${p.role})`).join('\n') || 'None',
                    inline: false
                }
            ] : [
                {
                    name: '👑 Victorious Villagers',
                    value: others.map(p => `${p.username} (${p.role})`).join('\n') || 'None',
                    inline: false
                },
                {
                    name: '🐺 The Werewolves Were',
                    value: werewolves.map(p => p.username).join('\n') || 'None',
                    inline: false
                }
            ]),
            {
                name: '📊 Game Statistics',
                value: [
                    `Total Rounds: ${gameStats.rounds}`,
                    `Players: ${gameStats.totalPlayers}`,
                    `Eliminations: ${gameStats.eliminations}`,
                    `Game Duration: ${gameStats.duration}`
                ].join('\n'),
                inline: false
            },
            {
                name: '🎮 New Game',
                value: 'Use `/create` to start a new game!',
                inline: false
            }
        ],
        footer: { 
            text: isWerewolfWin ? 
                'The village lies in ruins, but another will rise...' : 
                'Peace returns to the village, until darkness stirs again...'
        }
    };
}

function createGameWelcomeEmbed() {
    return {
        color: 0x800000,
        title: '🌕 A New Hunt Begins 🐺',
        description: 
            '*The village elder has called for a gathering. Dark rumors spread of wolves among the sheep...*\n\n' +
            '**Game Setup**\n' +
            'This game will be played with video and voice chat:\n' +
            '• During the day, all players will have cameras and mics ON\n' +
            '• During the night, all players will turn cameras and mics OFF\n\n' +
            '**Basic Roles (Automatic)**\n' +
            '• Werewolves (1 per 4 players)\n' +
            '• Seer (1)\n' +
            '• Villagers (remaining players)\n\n' +
            '**Optional Roles**\n' +
            'The following roles can be added to enhance the game:\n' +
            '• 🛡️ Bodyguard: Protects one player each night\n' +
            '• 💘 Cupid: Chooses one player as their lover. If either dies, both die of heartbreak.\n' +
            '• 🏹 Hunter: Takes one player with them when they die',
        fields: [
            {
                name: '📜 How to Join',
                value: 'Click the Join button below or use `/join` to enter the game.',
                inline: false
            },
            {
                name: '⚔️ Optional Roles',
                value: 'Game creator can toggle optional roles using the buttons below.\nThese roles will be randomly assigned when the game starts.',
                inline: false
            }
        ],
        footer: {
            text: 'The hunt begins when the creator clicks Start Game...'
        }
    };
}

function createNightZeroEmbed() {
    return {
        color: 0x2C3E50,
        title: '🌘 Night Zero Descends 🐺',
        description: 
            '*As the first night falls, special roles prepare their actions...*\n\n' +
            '**Seer Action:** You will receive the name of a random non-werewolf player.\n' +
            '**Cupid Action:** If Cupid is active, they will choose one player as their lover.\n\n' +
            'Please wait for all necessary actions to complete. The game will automatically proceed to the Day phase once done.',
        footer: { text: 'The hunt begins quietly...' }
    };
}

function createCupidActionConfirmationEmbed(lover) {
    return {
        color: 0xff69b4,
        title: '💘 Love Blossoms',
        description: 
            `*Cupid has chosen **${lover.username}** as their lover.*\n\n` +
            'If either of you dies, the other will die of heartbreak.',
        footer: { text: 'Love and death are forever intertwined...' }
    };
}

function createGameStartNightZeroEmbed() {
    return {
        color: 0x800000,
        title: '🌕 Night Zero Begins 🐺',
        description: 
            '*The first night has begun. Special roles, take your actions carefully...*\n\n' +
            '**Seer:** Check your DMs for your target.\n' +
            '**Cupid:** If active, use `/action choose_lovers` to select two players as lovers.\n\n' +
            'Your actions will determine the fate of the village. Night will progress automatically once all actions are completed.',
        footer: { text: 'May wisdom and strategy guide you...' }
    };
}

function createNominationResetEmbed() {
    return {
        color: 0xFFA500,
        title: '🔄 Nomination Failed',
        description: 
            '*The previous nomination did not receive a second and has been canceled.*\n\n' +
            'The village may now make another nomination.',
        footer: { text: 'Choose wisely, for the fate of the village hangs in the balance...' }
    };
}

// Add these new functions
function createNightActionEmbed(role, description) {
    const colors = {
        [ROLES.WEREWOLF]: 0x800000,
        [ROLES.SEER]: 0x4B0082,
        [ROLES.BODYGUARD]: 0x4B0082,
        [ROLES.HUNTER]: 0x800000,
        [ROLES.CUPID]: 0xff69b4
    };

    const titles = {
        [ROLES.WEREWOLF]: '🐺 The Hunt Begins',
        [ROLES.SEER]: '🔮 Vision Quest',
        [ROLES.BODYGUARD]: '🛡️ Vigilant Protection',
        [ROLES.HUNTER]: '🏹 Hunter\'s Last Stand',
        [ROLES.CUPID]: '💘 Choose Your Lover'
    };

    const footers = {
        [ROLES.WEREWOLF]: 'Choose wisely, for the village grows suspicious...',
        [ROLES.SEER]: 'The truth lies within your sight...',
        [ROLES.BODYGUARD]: 'Your shield may mean the difference between life and death...',
        [ROLES.HUNTER]: 'Your final shot will not go to waste...',
        [ROLES.CUPID]: 'Love and death are forever intertwined...'
    };

    return {
        color: colors[role],
        title: titles[role],
        description: description || getDefaultDescription(role),
        footer: { text: footers[role] }
    };
}

function getDefaultDescription(role) {
    const descriptions = {
        [ROLES.WEREWOLF]: '*Your fangs gleam in the moonlight as you stalk your prey...*\n\nSelect your victim from the dropdown menu below.',
        [ROLES.SEER]: '*Your mystical powers awaken with the night...*\n\nSelect a player to investigate from the dropdown menu below.',
        [ROLES.BODYGUARD]: '*Your watchful eyes scan the village, ready to shield the innocent...*\n\nSelect a player to protect from the dropdown menu below.',
        [ROLES.HUNTER]: '*With your dying breath, you reach for your bow...*\n\nSelect a player to take with you from the dropdown menu below.',
        [ROLES.CUPID]: '*Your arrows of love are ready to fly...*\n\nSelect a player to be your lover from the dropdown menu below.'
    };
    return descriptions[role];
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
    createGameEndEmbed,
    createGameWelcomeEmbed,
    createNightZeroEmbed,
    createCupidActionConfirmationEmbed,
    createGameStartNightZeroEmbed,
    createNominationResetEmbed,
    createNightActionEmbed
};
