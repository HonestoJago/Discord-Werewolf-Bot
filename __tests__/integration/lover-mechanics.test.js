const WerewolfGame = require('../../game/WerewolfGame');
const Player = require('../../game/Player');
const { GameError } = require('../../utils/error-handler');
const PHASES = require('../../constants/phases');
const ROLES = require('../../constants/roles');

describe('Lover Mechanics', () => {
    let game;
    let mockClient;

    beforeEach(() => {
        const mockChannel = {
            send: jest.fn().mockResolvedValue({}),
            awaitMessages: jest.fn()
        };

        mockClient = {
            channels: { 
                fetch: jest.fn().mockResolvedValue(mockChannel)
            },
            users: { 
                fetch: jest.fn().mockResolvedValue({
                    createDM: jest.fn().mockResolvedValue(mockChannel)
                })
            }
        };

        game = new WerewolfGame(mockClient, 'guild123', 'channel123', 'creator123');
        game.broadcastMessage = jest.fn();
    });

    test('Cupid can only choose lovers on Night Zero', async () => {
        // Setup Cupid and target players
        const cupid = new Player('cupid', 'Cupid', mockClient);
        const target1 = new Player('target1', 'Target1', mockClient);
        const target2 = new Player('target2', 'Target2', mockClient);
        
        cupid.assignRole(ROLES.CUPID);
        target1.assignRole(ROLES.VILLAGER);
        target2.assignRole(ROLES.VILLAGER);
        
        [cupid, target1, target2].forEach(p => {
            p.isAlive = true;
            game.players.set(p.id, p);
        });

        // Should work on Night Zero
        game.phase = PHASES.NIGHT_ZERO;
        await expect(
            game.processNightAction(cupid.id, 'choose_lovers', `${target1.id},${target2.id}`)
        ).resolves.not.toThrow();

        // Should fail on regular nights
        game.phase = PHASES.NIGHT;
        await expect(
            game.processNightAction(cupid.id, 'choose_lovers', `${target1.id},${target2.id}`)
        ).rejects.toThrow('Cupid can only choose lovers during Night Zero');
    });

    test('Cupid can choose themselves as a lover', async () => {
        const cupid = new Player('cupid', 'Cupid', mockClient);
        const otherPlayer = new Player('other', 'Other', mockClient);
        
        cupid.assignRole(ROLES.CUPID);
        otherPlayer.assignRole(ROLES.VILLAGER);
        
        [cupid, otherPlayer].forEach(p => {
            p.isAlive = true;
            game.players.set(p.id, p);
        });

        game.phase = PHASES.NIGHT_ZERO;
        await game.processNightAction(cupid.id, 'choose_lovers', `${cupid.id},${otherPlayer.id}`);

        expect(game.lovers.get(cupid.id)).toBe(otherPlayer.id);
        expect(game.lovers.get(otherPlayer.id)).toBe(cupid.id);
    });

    test('lover dies when their partner is killed by werewolves', async () => {
        const lover1 = new Player('lover1', 'Lover1', mockClient);
        const lover2 = new Player('lover2', 'Lover2', mockClient);
        const werewolf = new Player('wolf', 'Werewolf', mockClient);

        lover1.assignRole(ROLES.VILLAGER);
        lover2.assignRole(ROLES.VILLAGER);
        werewolf.assignRole(ROLES.WEREWOLF);

        [lover1, lover2, werewolf].forEach(p => {
            p.isAlive = true;
            game.players.set(p.id, p);
        });

        // Set up lovers
        game.lovers.set(lover1.id, lover2.id);
        game.lovers.set(lover2.id, lover1.id);

        // Werewolf kills one lover
        game.phase = PHASES.NIGHT;
        await game.processNightAction(werewolf.id, 'attack', lover1.id);
        await game.processNightActions();

        // Verify both lovers died
        expect(lover1.isAlive).toBe(false);
        expect(lover2.isAlive).toBe(false);
        expect(game.broadcastMessage).toHaveBeenCalledWith(
            expect.stringMatching(/died of heartbreak/)
        );
    });

    test('lover dies when their partner is eliminated by voting', async () => {
        const lover1 = new Player('lover1', 'Lover1', mockClient);
        const lover2 = new Player('lover2', 'Lover2', mockClient);

        [lover1, lover2].forEach(p => {
            p.assignRole(ROLES.VILLAGER);
            p.isAlive = true;
            game.players.set(p.id, p);
        });

        // Set up lovers
        game.lovers.set(lover1.id, lover2.id);
        game.lovers.set(lover2.id, lover1.id);

        // Set up voting phase
        game.phase = PHASES.VOTING;
        game.nominatedPlayer = lover1.id;
        game.votes.set('voter1', true); // guilty vote

        await game.processVotes();

        // Verify both lovers died
        expect(lover1.isAlive).toBe(false);
        expect(lover2.isAlive).toBe(false);
        expect(game.broadcastMessage).toHaveBeenCalledWith(
            expect.stringMatching(/died of heartbreak/)
        );
    });

    test('lover deaths can trigger win conditions', async () => {
        const lover1 = new Player('lover1', 'Lover1', mockClient);
        const lover2 = new Player('lover2', 'Lover2', mockClient);
        const werewolf = new Player('wolf', 'Werewolf', mockClient);

        lover1.assignRole(ROLES.VILLAGER);
        lover2.assignRole(ROLES.VILLAGER);
        werewolf.assignRole(ROLES.WEREWOLF);

        [lover1, lover2, werewolf].forEach(p => {
            p.isAlive = true;
            game.players.set(p.id, p);
        });

        // Set up lovers
        game.lovers.set(lover1.id, lover2.id);
        game.lovers.set(lover2.id, lover1.id);

        // Kill one lover
        game.phase = PHASES.NIGHT;
        await game.processNightAction(werewolf.id, 'attack', lover1.id);
        await game.processNightActions();

        // Verify werewolf victory (both lovers dead = only werewolf remains)
        expect(game.gameOver).toBe(true);
        expect(game.broadcastMessage).toHaveBeenCalledWith(
            expect.stringMatching(/Werewolves win/)
        );
    });
});
