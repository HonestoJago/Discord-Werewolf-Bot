// __tests__/test-utils.js

const Discord = require('discord.js');
const WerewolfGame = require('../game/WerewolfGame');
const Player = require('../game/Player');
const ROLES = require('../constants/roles');
const PHASES = require('../constants/phases');

/**
 * Creates a fully configured test game instance
 * @param {Object} options - Configuration options
 * @param {Map<string, number>} [options.roles] - Custom role configuration
 * @param {string} [options.guildId] - Custom guild ID
 * @param {string} [options.channelId] - Custom channel ID
 */
function createTestGame(options = {}) {
    const mockClient = new Discord.Client();
    const game = new WerewolfGame(
        mockClient, 
        options.guildId || 'guild123', 
        options.channelId || 'channel123', 
        'creator123'
    );
    
    // Configure roles
    game.selectedRoles = options.roles || new Map([
        [ROLES.WEREWOLF, 2],
        [ROLES.SEER, 1],
        [ROLES.DOCTOR, 1],
        [ROLES.VILLAGER, 2],
    ]);

    return { mockClient, game };
}

/**
 * Creates a set of test players with assigned roles
 * @param {Discord.Client} mockClient - The mock Discord client
 * @param {Object} options - Configuration options
 * @param {boolean} [options.allAlive=true] - Whether all players should start alive
 * @param {Object} [options.customRoles] - Custom role assignments
 */
function createTestPlayers(mockClient, options = {}) {
    const players = {
        seer: new Player('seer1', 'Seer', mockClient),
        doctor: new Player('doctor1', 'Doctor', mockClient),
        werewolf1: new Player('wolf1', 'Werewolf1', mockClient),
        werewolf2: new Player('wolf2', 'Werewolf2', mockClient),
        villager1: new Player('vil1', 'Villager1', mockClient),
        villager2: new Player('vil2', 'Villager2', mockClient),
    };

    // Assign roles and ensure they're set correctly
    const roleAssignments = options.customRoles || {
        seer: ROLES.SEER,
        doctor: ROLES.DOCTOR,
        werewolf1: ROLES.WEREWOLF,
        werewolf2: ROLES.WEREWOLF,
        villager1: ROLES.VILLAGER,
        villager2: ROLES.VILLAGER,
    };

    // Explicitly set roles and verify
    Object.entries(roleAssignments).forEach(([playerKey, role]) => {
        const player = players[playerKey];
        player.assignRole(role); // Use assignRole instead of direct assignment
        player.isAlive = options.allAlive !== false;
    });

    return players;
}

/**
 * Simulates a complete voting round
 * @param {WerewolfGame} game - The game instance
 * @param {Object} votes - Map of player IDs to their votes
 * @param {Object} options - Additional options
 * @param {boolean} [options.skipNomination=false] - Skip nomination phase
 */
async function simulateVoting(game, votes, options = {}) {
    if (!options.skipNomination) {
        // Get first alive player as nominator
        const nominator = Object.keys(votes).find(id => 
            game.players.get(id).isAlive
        );
        
        // Get first alive player that isn't the nominator as target
        const target = Object.keys(votes).find(id => 
            id !== nominator && game.players.get(id).isAlive
        );

        // Nominate
        await game.nominate(nominator, target);
        
        // Find a seconder (first alive player who isn't nominator or target)
        const seconder = Object.keys(votes).find(id => 
            id !== nominator && 
            id !== target && 
            game.players.get(id).isAlive
        );

        // Second the nomination
        await game.second(seconder);
    }

    // Submit all votes
    for (const [playerId, vote] of Object.entries(votes)) {
        if (game.players.get(playerId).isAlive) {
            await game.submitVote(playerId, vote);
        }
    }

    return game.processVotes();
}

/**
 * Simulates night actions
 * @param {WerewolfGame} game - The game instance
 * @param {Array<Object>} actions - Array of night actions
 * @param {Object} options - Additional options
 * @param {boolean} [options.autoProcess=true] - Automatically process actions
 */
async function simulateNightActions(game, actions, options = { autoProcess: true }) {
    for (const action of actions) {
        await game.processNightAction(action.playerId, action.type, action.target);
    }

    if (options.autoProcess) {
        return game.processNightActions();
    }
}

/**
 * Advances the game through phases
 * @param {WerewolfGame} game - The game instance
 * @param {string} targetPhase - The target phase to reach
 */
async function advanceToPhase(game, targetPhase) {
    while (game.phase !== targetPhase && !game.gameOver) {
        await game.advancePhase();
    }
}

/**
 * Verifies the state of a player
 * @param {Player} player - The player to verify
 * @param {Object} expectedState - The expected state
 */
function verifyPlayerState(player, expectedState) {
    if (expectedState.isAlive !== undefined) {
        expect(player.isAlive).toBe(expectedState.isAlive);
    }
    if (expectedState.role !== undefined) {
        expect(player.role).toBe(expectedState.role);
    }
    if (expectedState.isProtected !== undefined) {
        expect(player.isProtected).toBe(expectedState.isProtected);
    }
}

/**
 * Verifies the game state
 * @param {WerewolfGame} game - The game instance
 * @param {Object} expectedState - The expected state
 */
function verifyGameState(game, expectedState) {
    if (expectedState.phase !== undefined) {
        expect(game.phase).toBe(expectedState.phase);
    }
    if (expectedState.round !== undefined) {
        expect(game.round).toBe(expectedState.round);
    }
    if (expectedState.gameOver !== undefined) {
        expect(game.gameOver).toBe(expectedState.gameOver);
    }
}

/**
 * Verifies the phase transition
 * @param {WerewolfGame} game - The game instance
 * @param {string} fromPhase - The initial phase
 * @param {string} toPhase - The target phase
 * @param {number} [expectedRound] - The expected round
 */
async function verifyPhaseTransition(game, fromPhase, toPhase, expectedRound) {
    expect(game.phase).toBe(fromPhase);
    await game.advancePhase();
    expect(game.phase).toBe(toPhase);
    if (expectedRound !== undefined) {
        expect(game.round).toBe(expectedRound);
    }
}

// Add the setupTestGame function definition before the exports
function setupTestGame() {
    const mockClient = new Discord.Client();
    const game = new WerewolfGame(
        mockClient, 
        'guild123', 
        'channel123', 
        'creator123'
    );
    
    // Verify the game initialized correctly
    expect(game.phase).toBe(PHASES.LOBBY);
    
    // Create and add players
    const players = createTestPlayers(mockClient);
    Object.values(players).forEach(p => game.players.set(p.id, p));
    
    // Configure default roles
    game.selectedRoles = new Map([
        [ROLES.WEREWOLF, 2],
        [ROLES.SEER, 1],
        [ROLES.DOCTOR, 1],
        [ROLES.VILLAGER, 2],
    ]);
    
    return { game, players, mockClient };
}

// Update exports to include setupTestGame
module.exports = {
    createTestGame,
    createTestPlayers,
    simulateVoting,
    simulateNightActions,
    advanceToPhase,
    verifyPlayerState,
    verifyGameState,
    verifyPhaseTransition,
    setupTestGame
};
