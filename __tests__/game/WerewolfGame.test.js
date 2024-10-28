// __tests__/game/WerewolfGame.test.js

const WerewolfGame = require('../../game/WerewolfGame');
const ROLES = require('../../constants/roles');
const PHASES = require('../../constants/phases');

describe('WerewolfGame', () => {
    let game;
    let mockClient;

    beforeEach(() => {
        mockClient = { channels: { fetch: jest.fn() } };
        game = new WerewolfGame(mockClient, 'guildId', 'channelId', 'creatorId');
    });

    describe('assignRoles', () => {
        test('assigns roles correctly with default setup', async () => {
            // Add players
            for (let i = 0; i < 8; i++) {
                game.addPlayer({ id: `player${i}`, username: `Player${i}` });
            }

            // Select special roles
            game.selectedRoles.set(ROLES.DOCTOR, 1);
            game.selectedRoles.set(ROLES.CUPID, 1);

            await game.assignRoles();

            const roles = Array.from(game.players.values()).map(player => player.role);
            expect(roles.filter(role => role === ROLES.SEER).length).toBe(1);
            expect(roles.filter(role => role === ROLES.WEREWOLF).length).toBe(2); // 1/4 of 8
            expect(roles.filter(role => role === ROLES.DOCTOR).length).toBe(1);
            expect(roles.filter(role => role === ROLES.CUPID).length).toBe(1);
            expect(roles.filter(role => role === ROLES.VILLAGER).length).toBe(3);
        });
    });

    describe('advancePhase', () => {
        test('advances from LOBBY to NIGHT_ZERO', async () => {
            game.phase = PHASES.LOBBY;
            await game.advancePhase();
            expect(game.phase).toBe(PHASES.NIGHT_ZERO);
        });

        test('advances from NIGHT_ZERO to DAY', async () => {
            game.phase = PHASES.NIGHT_ZERO;
            await game.advancePhase();
            expect(game.phase).toBe(PHASES.DAY);
        });
    });
});