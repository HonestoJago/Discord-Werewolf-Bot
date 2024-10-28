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

    describe('Hunter mechanics', () => {
        let game;
        let mockClient;
        let hunter;
        let target;

        beforeEach(() => {
            mockClient = { channels: { fetch: jest.fn() } };
            game = new WerewolfGame(mockClient, 'guildId', 'channelId', 'creatorId');
            
            // Add players
            hunter = { id: 'hunter', username: 'Hunter' };
            target = { id: 'target', username: 'Target' };
            game.addPlayer(hunter);
            game.addPlayer(target);
            
            // Set up Hunter role
            game.players.get(hunter.id).role = ROLES.HUNTER;
        });

        test('Hunter can be added as a role', () => {
            game.addRole(ROLES.HUNTER);
            expect(game.selectedRoles.get(ROLES.HUNTER)).toBe(1);
        });

        test('Only one Hunter can be added', () => {
            game.addRole(ROLES.HUNTER);
            expect(() => game.addRole(ROLES.HUNTER)).toThrow(GameError);
        });

        test('Hunter gets revenge action when killed by werewolves', async () => {
            hunter.isAlive = true;
            target.isAlive = true;

            // Simulate werewolf kill
            await game.processNightAction('werewolf', 'attack', hunter.id);
            expect(game.pendingHunterRevenge).toBe(hunter.id);
        });

        test('Hunter gets revenge action when eliminated by vote', async () => {
            hunter.isAlive = true;
            target.isAlive = true;

            // Simulate village vote
            game.nominatedPlayer = hunter.id;
            game.votes.set('voter1', true); // guilty vote
            await game.processVotes();
            expect(game.pendingHunterRevenge).toBe(hunter.id);
        });

        test('Hunter revenge kills target without revealing Hunter role', async () => {
            hunter.isAlive = false;
            target.isAlive = true;
            game.pendingHunterRevenge = hunter.id;

            const broadcastSpy = jest.spyOn(game, 'broadcastMessage');
            await game.processNightAction(hunter.id, 'hunter_revenge', target.id);

            expect(target.isAlive).toBe(false);
            expect(broadcastSpy).toHaveBeenCalledWith(
                expect.stringContaining('has been eliminated')
            );
            expect(broadcastSpy).not.toHaveBeenCalledWith(
                expect.stringContaining('Hunter')
            );
        });

        test('Only eliminated Hunter can use revenge action', async () => {
            hunter.isAlive = true;
            target.isAlive = true;

            await expect(
                game.processNightAction(hunter.id, 'hunter_revenge', target.id)
            ).rejects.toThrow(GameError);
        });

        test('Hunter revenge action clears after use', async () => {
            hunter.isAlive = false;
            target.isAlive = true;
            game.pendingHunterRevenge = hunter.id;

            await game.processNightAction(hunter.id, 'hunter_revenge', target.id);
            expect(game.pendingHunterRevenge).toBeNull();
        });
    });
});
