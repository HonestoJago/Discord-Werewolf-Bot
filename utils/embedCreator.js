const { EmbedBuilder } = require('discord.js');
const ROLES = require('../constants/roles');

// Role-specific constants - define these once at the top
const ROLE_ABILITIES = {
    'werewolf': 'Vote each night to eliminate a player',
    'seer': 'Investigate one player each night to learn if they are a werewolf',
    'bodyguard': 'Protect one player each night from werewolf attacks',
    'cupid': 'Choose one player to be your lover at the start of the game. If either lover dies, both die of heartbreak.',
    'hunter': 'Take one player with you when you die',
    'villager': 'Vote during the day to eliminate suspicious players',
    'minion': 'Learn the identity of the werewolves at the start of the game. Win with the werewolves.',
    'sorcerer': 'Each night, investigate one player to learn if they are the Seer. Win with the werewolves.'
};

const ROLE_WIN_CONDITIONS = {
    'werewolf': 'Win when werewolves equal or outnumber villagers',
    'seer': 'Win when all werewolves are eliminated',
    'bodyguard': 'Win when all werewolves are eliminated',
    'cupid': 'Win when all werewolves are eliminated',
    'hunter': 'Win when all werewolves are eliminated',
    'villager': 'Win when all werewolves are eliminated',
    'minion': 'Win when werewolves achieve parity with villagers',
    'sorcerer': 'Win when werewolves achieve parity with villagers'
};

const ROLE_TIPS = {
    'werewolf': 'Try to appear helpful during day discussions. Coordinate with other werewolves at night.',
    'seer': 'Share information carefully - revealing too much too early makes you a target',
    'bodyguard': 'Pay attention to discussions to identify likely werewolf targets',
    'cupid': 'Choose your lover wisely - your fates are linked! Consider picking someone you trust.',
    'hunter': 'Your revenge shot is powerful - use it wisely when eliminated',
    'villager': 'Pay attention to voting patterns and player behavior',
    'minion': 'Help the werewolves without revealing your identity. You know who they are, but they don\'t know you!',
    'sorcerer': 'Use your investigations to find and eliminate the Seer. Help the werewolves without revealing your identity!'
};

const ROLE_EMOJIS = {
    'werewolf': '🐺',
    'seer': '👁️',
    'bodyguard': '🛡️',
    'cupid': '💘',
    'hunter': '🏹',
    'villager': '👥',
    'minion': '🦹',
    'sorcerer': '🧙'
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
        title: '⚖️ The Village Must Decide',
        description: 
            '```diff\n- A PLAYER STANDS ACCUSED\n```\n' +
            `# **${target.username}**\n\n` +
            '*The tension rises as judgment looms...*\n\n' +
            `• Nominated by: **${game.players.get(game.nominator).username}**\n` +
            `• Seconded by: **${seconder.username}**\n\n` +
            '```\nThe fate of the accused now rests in your hands.```',
        fields: [
            { 
                name: '📜 Cast Your Vote', 
                value: '`Lynch` - Condemn the accused to death\n`Let Live` - Show mercy and spare their life',
                inline: false
            }
        ],
        footer: { 
            text: 'Your choice could mean the difference between justice and tragedy...' 
        }
    };
}

function createVoteResultsEmbed(target, voteCounts, eliminated, playerVotes) {
    return {
        color: eliminated ? 0x800000 : 0x006400,
        title: eliminated ? '⚰️ The Village Has Spoken' : '🕊️ Mercy Prevails',
        description: eliminated ? 
            '```diff\n- JUDGMENT HAS BEEN PASSED\n```\n' +
            `*With heavy hearts, the village condemns **${target.username}** to death.*` :
            '```diff\n+ MERCY HAS BEEN GRANTED\n```\n' +
            `*The village shows mercy, and **${target.username}** lives to see another day.*`,
        fields: [
            { 
                name: '📊 The Vote', 
                value: '```yaml\n' +
                    `Death: ${voteCounts.guilty} | Mercy: ${voteCounts.innocent}\n` +
                    '```',
                inline: false 
            },
            { 
                name: '📜 Individual Votes',
                value: Object.entries(playerVotes)
                    .map(([username, vote]) => `${vote ? '🔨' : '💐'} ${username}`)
                    .join('\n') || '*No votes were cast*'
            }
        ],
        footer: { text: eliminated ? 
            'The price of justice is often paid in blood...' : 
            'May this mercy not be misplaced...' 
        }
    };
}

function createDayPhaseEmbed(players, nominationActive = false) {
    // Get counts of living and dead players
    const livingPlayers = Array.from(players.values()).filter(p => p.isAlive);
    const deadPlayers = Array.from(players.values()).filter(p => !p.isAlive);
    
    return {
        color: 0xFFA500, // Orange color for day phase
        title: '☀️ Village Council',
        description: nominationActive ? 
            '*Tensions rise as accusations fly...*' : 
            '*The village square fills with whispered suspicions and wary glances...*',
        fields: [
            {
                name: `🎭 Living Players (${livingPlayers.length})`, 
                value: livingPlayers.length > 0 ?
                    '```yaml\n' +
                    livingPlayers
                        .map(p => `• ${p.username}`)
                        .join('\n') +
                    '\n```' :
                    '*No players remain...*',
                inline: false
            },
            {
                name: `☠️ Fallen Players (${deadPlayers.length})`,
                value: deadPlayers.length > 0 ?
                    deadPlayers
                        .map(p => {
                            const roleReveal = p.role === ROLES.WEREWOLF ? 
                                '🐺 Was a Werewolf' : 
                                '👥 Was not a Werewolf';
                            return `\`${p.username}\` *(${roleReveal})*`;
                        })
                        .join('\n') :
                    '*No deaths yet...*',
                inline: false
            },
            {
                name: '📊 Game Status',
                value: '```diff\n' +
                    `+ Total Players: ${players.size}\n` +
                    `- Required for Majority: ${Math.ceil(livingPlayers.length / 2)}\n` +
                    '```',
                inline: false
            }
        ],
        footer: { 
            text: 'Choose wisely, for the fate of the village hangs in the balance...' 
        }
    };
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
        .setTitle('🔮 Vision Revealed')
        .setDescription(
            `*Your mystical powers reveal the truth about **${target.username}**...*\n\n` +
            `Your vision shows that they are **${isWerewolf ? 'a Werewolf!' : 'Not a Werewolf.'}**`
        )
        .setFooter({ text: 'Use this knowledge wisely to help the village...' });
}

function createGameEndEmbed(winners, gameStats) {
    // If no winners, it's a draw
    if (winners.length === 0) {
        return {
            color: 0x808080, // Gray color for draw
            title: '☠️ Total Destruction!',
            description: 
                '```diff\n! MUTUAL DESTRUCTION\n```\n' +
                '*The village lies in ruins, with no survivors to tell the tale...*',
            fields: [
                {
                    name: '💀 The Fallen',
                    value: Array.from(gameStats.players)
                        .map(p => `\`${p.username}\` *(${p.role})*`)
                        .join('\n') || 'None',
                    inline: false
                },
                {
                    name: '📊 Game Statistics',
                    value: '```diff\n' +
                        `+ Rounds: ${gameStats.rounds}\n` +
                        `+ Players: ${gameStats.totalPlayers}\n` +
                        `- Deaths: ${gameStats.eliminations}\n` +
                        `+ Duration: ${gameStats.duration}\n` +
                        '```',
                    inline: false
                }
            ],
            footer: { 
                text: 'A cautionary tale of suspicion and revenge...' 
            }
        };
    }

    // For games with winners, use existing logic
    const isWerewolfWin = winners.some(player => 
        player.role === ROLES.WEREWOLF || 
        player.role === ROLES.MINION || 
        player.role === ROLES.SORCERER
    );
    const allPlayers = Array.from(gameStats.players || []);
    
    // Group winners and others differently for werewolf win
    const victoriousTeam = allPlayers.filter(p => 
        isWerewolfWin ? 
            (p.role === ROLES.WEREWOLF || p.role === ROLES.MINION || p.role === ROLES.SORCERER) :
            (p.role !== ROLES.WEREWOLF && p.role !== ROLES.MINION && p.role !== ROLES.SORCERER)
    );
    const defeatedTeam = allPlayers.filter(p => 
        isWerewolfWin ? 
            (p.role !== ROLES.WEREWOLF && p.role !== ROLES.MINION && p.role !== ROLES.SORCERER) :
            (p.role === ROLES.WEREWOLF || p.role === ROLES.MINION || p.role === ROLES.SORCERER)
    );
    
    return {
        color: isWerewolfWin ? 0x800000 : 0x008000,
        title: isWerewolfWin ? 
            '🐺 The Werewolves Have Conquered the Village!' : 
            '🎉 The Village Has Triumphed!',
        description: isWerewolfWin ?
            '```diff\n- DARKNESS FALLS FOREVER\n```\n' +
            '*The last screams fade as the werewolves claim their final victory...*' :
            '```diff\n+ LIGHT PREVAILS\n```\n' +
            '*The village can finally rest, knowing the evil has been vanquished...*',
        fields: [
            ...(isWerewolfWin ? [
                {
                    name: '🐺 The Victorious Pack',
                    value: '```yaml\n' +
                        victoriousTeam.map(p => `${p.username} (${p.role})`).join('\n') +
                        '\n```',
                    inline: false
                },
                {
                    name: '☠️ The Fallen Village',
                    value: defeatedTeam.map(p => `\`${p.username}\` *(${p.role})*`).join('\n') || 'None',
                    inline: false
                }
            ] : [
                {
                    name: '👑 The Victorious Village',
                    value: '```yaml\n' +
                        victoriousTeam.map(p => `${p.username} (${p.role})`).join('\n') +
                        '\n```',
                    inline: false
                },
                {
                    name: '⚰️ The Slain Wolves',
                    value: defeatedTeam.map(p => `\`${p.username}\` *(${p.role})*`).join('\n') || 'None',
                    inline: false
                }
            ]),
            {
                name: '📊 Game Statistics',
                value: '```diff\n' +
                    `+ Rounds: ${gameStats.rounds}\n` +
                    `+ Players: ${gameStats.totalPlayers}\n` +
                    `- Deaths: ${gameStats.eliminations}\n` +
                    `+ Duration: ${gameStats.duration}\n` +
                    '```',
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
            '```fix\n' +
            'The village elder has called for a gathering...\n' +
            '```\n' +
            '*Dark rumors spread of wolves hiding among the villagers.*',
        fields: [
            {
                name: '⚠️ Important Requirements',
                value: '```yaml\n' +
                    '• Enable DMs from server members\n' +
                    '• Follow the Werewolf category or enable channel viewing\n' +
                    '• Join the Werewolf voice channel\n' +
                    '• Test your camera and microphone\n' +
                    '```\n' +
                    '*These settings are required for role info and gameplay*',
                inline: false
            },
            {
                name: '📢 Voice Chat Rules',
                value: '```yaml\n' +
                    '• Day Phase: Cameras & Mics ON\n' +
                    '• Night Phase: Cameras & Mics OFF\n' +
                    '• Stay in voice chat throughout the game\n' +
                    '```\n' +
                    '*Please test your setup before readying up!*',
                inline: false
            },
            {
                name: '🎮 How to Play',
                value: 
                    '1. Click `🐺 Join the Hunt` to join\n' +
                    '2. Click `✅ Ready` when your setup is tested and working\n' +
                    '3. Click `ℹ️ View Role Info` to learn about roles\n' +
                    '4. Game creator can toggle optional roles\n' +
                    '5. Game starts when all players are ready',
                inline: false
            }
        ],
        footer: {
            text: 'The fate of the village hangs in the balance...'
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
function createNightActionEmbed(role) {
    const colors = {
        [ROLES.WEREWOLF]: 0x800000,
        [ROLES.SEER]: 0x4B0082,
        [ROLES.BODYGUARD]: 0x4B0082,
        [ROLES.HUNTER]: 0x800000,
        [ROLES.CUPID]: 0xff69b4,
        [ROLES.SORCERER]: 0x4B0082
    };

    const titles = {
        [ROLES.WEREWOLF]: '🐺 The Hunt Begins',
        [ROLES.SEER]: '🔮 Vision Quest',
        [ROLES.BODYGUARD]: '🛡️ Vigilant Protection',
        [ROLES.HUNTER]: '🏹 Hunter\'s Last Stand',
        [ROLES.CUPID]: '💘 Choose Your Lover',
        [ROLES.SORCERER]: '🧙 Dark Divination'
    };

    const descriptions = {
        [ROLES.WEREWOLF]: '*Your fangs gleam in the moonlight as you stalk your prey...*\n\nSelect your victim from the dropdown menu below.',
        [ROLES.SEER]: '*Your mystical powers awaken with the night...*\n\nSelect a player to investigate from the dropdown menu below.',
        [ROLES.BODYGUARD]: '*Your watchful eyes scan the village, ready to shield the innocent...*\n\nSelect a player to protect from the dropdown menu below.',
        [ROLES.HUNTER]: '*With your dying breath, you reach for your bow...*\n\nSelect a player to take with you from the dropdown menu below.',
        [ROLES.CUPID]: '*Your arrows of love are ready to fly...*\n\nSelect a player to be your lover from the dropdown menu below.',
        [ROLES.SORCERER]: '*Your dark powers surge as you seek the Seer...*\n\nSelect a player to investigate from the dropdown menu below.'
    };

    const footers = {
        [ROLES.WEREWOLF]: 'Choose wisely, for the village grows suspicious...',
        [ROLES.SEER]: 'The truth lies within your sight...',
        [ROLES.BODYGUARD]: 'Your shield may mean the difference between life and death...',
        [ROLES.HUNTER]: 'Your final shot will not go to waste...',
        [ROLES.CUPID]: 'Love and death are forever intertwined...',
        [ROLES.SORCERER]: 'Choose wisely - finding the Seer could turn the tide...'
    };

    return {
        color: colors[role],
        title: titles[role],
        description: descriptions[role],
        footer: { text: footers[role] }
    };
}

function createProtectionEmbed(wasAttacked = false) {
    return {
        color: 0x4B0082, // Deep indigo for mystical/protective feel
        title: '🛡️ Protection Prevails',
        description: wasAttacked ?
            '```diff\n+ The Bodyguard\'s vigilance thwarts the wolves\' attack!\n```\n' +
            '*A silent guardian stands watch through the night...*\n\n' +
            '# **The Village Sleeps Peacefully**\n\n' +
            '*Though evil prowled, none shall perish this night.*' :
            '```diff\n+ The Bodyguard stands watch through the quiet night\n```\n' +
            '*A vigilant protector keeps the peace...*\n\n' +
            '# **The Village Rests Undisturbed**\n\n' +
            '*No threats emerged to test their guard.*',
        fields: [
            {
                name: '🌙 Night Results',
                value: wasAttacked ?
                    '• The Werewolves attempted an attack\n• The Bodyguard successfully protected their target\n• No lives were lost' :
                    '• The night passed without incident\n• The Bodyguard\'s watch was uneventful\n• All villagers are safe',
                inline: false
            }
        ],
        footer: {
            text: 'Dawn approaches, and with it, new suspicions will arise...'
        }
    };
}

function createDayTransitionEmbed() {
    return {
        color: 0xFFA500, // Orange for dawn
        title: '☀️ A New Day Dawns',
        description: 
            '```fix\n' +
            'The morning sun rises over the village...\n' +
            '```\n' +
            '*As shadows retreat, the time for discussion begins. Who among you bears the curse of the wolf?*',
        footer: { 
            text: 'Debate wisely, for a wrong accusation could doom the village...' 
        }
    };
}

function createNightTransitionEmbed(players) {
    // Get counts of living and dead players
    const livingPlayers = Array.from(players.values()).filter(p => p.isAlive);
    const deadPlayers = Array.from(players.values()).filter(p => !p.isAlive);
    
    return {
        color: 0x2C3E50, // Dark blue for night
        title: '🌙 Night Falls Once More',
        description: 
            '```diff\n- As darkness envelops the village, danger lurks in the shadows...\n```\n' +
            '**All players:** Please turn off your cameras and microphones now.',
        fields: [
            {
                name: `🎭 Living Players (${livingPlayers.length})`, 
                value: livingPlayers.length > 0 ?
                    '```yaml\n' +
                    livingPlayers
                        .map(p => `• ${p.username}`)
                        .join('\n') +
                    '\n```' :
                    '*No players remain...*',
                inline: false
            },
            {
                name: `☠️ Fallen Players (${deadPlayers.length})`,
                value: deadPlayers.length > 0 ?
                    deadPlayers
                        .map(p => {
                            const roleReveal = p.role === ROLES.WEREWOLF ? 
                                '🐺 Was a Werewolf' : 
                                '👥 Was not a Werewolf';
                            return `\`${p.username}\` *(${roleReveal})*`;
                        })
                        .join('\n') :
                    '*No deaths yet...*',
                inline: false
            },
            {
                name: ' Game Status',
                value: '```diff\n' +
                    `+ Total Players: ${players.size}\n` +
                    `- Required for Majority: ${Math.ceil(livingPlayers.length / 2)}\n` +
                    '```',
                inline: false
            }
        ],
        footer: { 
            text: 'Remain silent until morning comes...' 
        }
    };
}

function createLoverDeathEmbed(deadPlayerName) {
    return {
        color: 0xff69b4,  // Pink color for love theme
        title: '💔 A Heart Breaks',
        description: 
            '```diff\n- LOVE AND DEATH ARE INTERTWINED\n```\n' +
            `*The tragic fate of **${deadPlayerName}** sends ripples through the village...*\n\n` +
            '# **A Bond of Love Claims Another**\n\n' +
            '*Unable to live without their beloved, another soul departs this world...*',
        footer: { 
            text: 'Some bonds transcend even death itself...' 
        }
    };
}

// Add this new function with the other embed creators
function createHunterRevengeEmbed(hunter, target) {
    return {
        color: 0x800000,
        title: '🏹 The Hunter\'s Final Shot',
        description: 
            `*With their dying breath, **${hunter.username}** raises their bow...*\n\n` +
            `In a final act of vengeance, they take **${target.username}** with them to the grave!`,
        footer: { text: 'Even in death, the Hunter\'s aim remains true...' }
    };
}

function createHunterTensionEmbed(hunter) {
    return {
        color: 0x4B0082,
        title: '🏹 The Hunter Falls',
        description: 
            `*With their dying breath, **${hunter.username}** reaches for their bow...*\n\n` +
            'The village holds its breath, sensing that this elimination has set something in motion.\n' +
            'Wait for fate to unfold before proceeding to nightfall.',
        footer: { text: 'Some deaths echo louder than others...' }
    };
}

// For the Hunter's revenge UI
function createHunterRevengePromptEmbed() {
    return {
        color: 0x800000,
        title: '🏹 Hunter\'s Last Shot',
        description: 'You have been eliminated! As the Hunter, you may choose one player to take with you.\n\nSelect your target from the dropdown menu below.',
        footer: { text: 'Choose wisely - your final action could change the course of the game...' }
    };
}

// Add this new function with the other embed creators
function createMinionRevealEmbed(werewolves) {
    return {
        color: 0x800000,
        title: '🦹 Your Werewolf Masters',
        description: 
            '*The werewolves prowl in the darkness, unaware of your loyalty...*\n\n' +
            `The werewolves are: **${werewolves.map(w => w.username).join(', ')}**\n\n` +
            'Help them win, but remember - they don\'t know you\'re on their side!',
        footer: { text: 'Serve from the shadows...' }
    };
}

// Add new embed creator for Sorcerer investigation results
function createSorcererRevealEmbed(target, isSeer) {
    return {
        color: 0x4B0082,  // Deep purple for mystical effect
        title: '🧙 Dark Vision',
        description: 
            `*Your dark powers reveal the truth about **${target.username}**...*\n\n` +
            `Your vision shows that they are **${isSeer ? 'the Seer!' : 'Not the Seer.'}**`,
        footer: { text: 'Use this knowledge to aid the werewolves from the shadows...' }
    };
}

// Add Sorcerer-specific embed creators
function createSorcererActionEmbed() {
    return {
        color: 0x4B0082,
        title: '🧙 Dark Divination',
        description: 
            '*Your dark powers surge as you seek the Seer...*\n\n' +
            'Select a player to investigate from the dropdown menu below.',
        footer: { text: 'Choose wisely - finding the Seer could turn the tide...' }
    };
}

function createGameSetupEmbed(game) {
    return {
        color: 0x0099ff,
        title: '🎮 Game Setup',
        fields: [
            {
                name: 'Players',
                value: `${game.players.size} joined`,
                inline: true
            },
            {
                name: 'Optional Roles',
                value: Array.from(game.selectedRoles.keys())
                    .map(role => `${roleEmojis[role.toLowerCase()] || ''} ${role}`)
                    .join(', ') || 'None',
                inline: true
            }
        ]
    };
}

function createDeathAnnouncementEmbed(target, isWerewolf, isGameEndingDeath) {
    return {
        color: isWerewolf ? 0x008000 : 0x800000,
        title: '🐺 A Grim Discovery',
        description: isWerewolf ?
            `*The village's suspicions were correct! **${target.username}** was indeed a Werewolf!*` :
            `*Alas, **${target.username}** was not a Werewolf. The real beasts still lurk among you...*`,
        footer: { 
            text: isGameEndingDeath ? 
                'The final piece falls into place...' : 
                'The hunt continues...' 
        }
    };
}

// Add this function to embedCreator.js
function createHunterRevengeFallbackEmbed(hunterName) {
    return {
        color: 0x800000,
        title: '🏹 Hunter\'s Revenge Available',
        description: `**${hunterName}**, your DMs appear to be disabled. ` +
            'You can still take your revenge by using the `/action` command with:\n' +
            '• Action: `choose_target`\n' +
            '• Target: (the player you want to take with you)\n\n' +
            'You must use this command in the game channel.',
        footer: { text: 'The Hunter\'s revenge awaits...' }
    };
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
    createNightActionEmbed,
    createProtectionEmbed,
    createDayTransitionEmbed,
    createNightTransitionEmbed,
    createLoverDeathEmbed,
    createHunterRevengeEmbed,
    createHunterTensionEmbed,
    createMinionRevealEmbed,
    createSorcererRevealEmbed,
    createSorcererActionEmbed,
    createGameSetupEmbed,
    createDeathAnnouncementEmbed,
    createHunterRevengeFallbackEmbed,
    createHunterRevengePromptEmbed
};
