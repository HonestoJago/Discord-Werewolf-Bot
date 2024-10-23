const WerewolfGame = require('../../game/WerewolfGame');
const Player = require('../../game/Player');
const { GameError } = require('../../utils/error-handler');
const PHASES = require('../../constants/phases');
const ROLES = require('../../constants/roles');

describe('Night Actions Integration', () => {
    let game;
    let mockClient;

    beforeEach(() => {
        mockClient = {
            channels: { 
                fetch: jest.fn().mockResolvedValue({
                    send: jest.fn()
                })
            },
            users: { 
                fetch: jest.fn().mockResolvedValue({
                    createDM: jest.fn().mockResolvedValue({
                        send: jest.fn()
                    })
                })
            }
        };
        game = new WerewolfGame(mockClient, 'guild123', 'channel123', 'creator123');
    });

    test('night zero workflow', async () => {
        // Setup players
        const cupid = new Player('cupid', 'CupidPlayer', mockClient);
        cupid.assignRole(ROLES.CUPID);
        game.players.set(cupid.id, cupid);

        // Set night zero phase
        game.phase = PHASES.NIGHT_ZERO;

        // Cupid chooses lovers
        await game.processNightAction(cupid.id, 'choose_lovers', 'lover1,lover2');
        expect(game.nightActions[cupid.id]).toBeDefined();
        expect(game.nightActions[cupid.id].action).toBe('choose_lovers');

        // Verify other roles can't act
        const seer = new Player('seer', 'SeerPlayer', mockClient);
        seer.assignRole(ROLES.SEER);
        game.players.set(seer.id, seer);

        await expect(
            game.processNightAction(seer.id, 'investigate', 'target')
        ).rejects.toThrow(new GameError('Invalid action', 'The Seer cannot investigate during Night Zero.'));
    });

    test('regular night phase workflow', async () => {
        // Setup players
        const werewolf = new Player('werewolf', 'WerewolfPlayer', mockClient);
        const seer = new Player('seer', 'SeerPlayer', mockClient);
        const doctor = new Player('doctor', 'DoctorPlayer', mockClient);
        const victim = new Player('victim', 'VictimPlayer', mockClient);

        werewolf.assignRole(ROLES.WEREWOLF);
        seer.assignRole(ROLES.SEER);
        doctor.assignRole(ROLES.DOCTOR);
        victim.assignRole(ROLES.VILLAGER);

        game.players.set(werewolf.id, werewolf);
        game.players.set(seer.id, seer);
        game.players.set(doctor.id, doctor);
        game.players.set(victim.id, victim);

        // Set night phase
        game.phase = PHASES.NIGHT;

        // Process night actions in sequence
        await game.processNightAction(werewolf.id, 'attack', victim.id);
        await game.processNightAction(seer.id, 'investigate', werewolf.id);
        await game.processNightAction(doctor.id, 'protect', victim.id);

        // Verify actions were recorded
        expect(game.nightActions[werewolf.id].target).toBe(victim.id);
        expect(game.nightActions[seer.id].target).toBe(werewolf.id);
        expect(game.nightActions[doctor.id].target).toBe(victim.id);

        // Verify doctor can't protect same target next night
        game.lastProtectedPlayer = victim.id;
        await expect(
            game.processNightAction(doctor.id, 'protect', victim.id)
        ).rejects.toThrow(new GameError('Invalid target', 'You cannot protect the same player two nights in a row.'));
    });
});
