const { setupTestGame } = require('../test-utils');
const PHASES = require('../../constants/phases');
const ROLES = require('../../constants/roles');

describe('Game Phase Transitions', () => {
    let game;
    let players;

    beforeEach(() => {
        const setup = setupTestGame();
        game = setup.game;
        players = setup.players;
    });

    describe('Night Zero Phase', () => {
        test('Night Zero phase advances correctly', async () => {
            // Setup game with Cupid and proper mix of roles
            game.selectedRoles.clear();
            game.selectedRoles.set(ROLES.CUPID, 1);
            game.selectedRoles.set(ROLES.WEREWOLF, 1);
            game.selectedRoles.set(ROLES.VILLAGER, 4);
            
            await game.startGame();
            expect(game.phase).toBe(PHASES.NIGHT_ZERO);
            
            // Find Cupid if they exist
            const cupid = Array.from(game.players.values()).find(p => p.role === ROLES.CUPID);
            
            if (cupid) {
                // Simulate Cupid's action
                const [target1, target2] = Array.from(game.players.values())
                    .filter(p => p.id !== cupid.id)
                    .slice(0, 2);
                    
                await game.processLoverSelection(cupid.id, `${target1.id},${target2.id}`);
                
                // After Cupid acts, phase should advance to DAY
                await game.advancePhase();
                expect(game.phase).toBe(PHASES.DAY);
            }
        });

        test('Night Zero advances immediately without Cupid', async () => {
            // Setup game without Cupid
            game.selectedRoles.clear();
            game.selectedRoles.set(ROLES.WEREWOLF, 1);
            game.selectedRoles.set(ROLES.VILLAGER, 5);
            
            await game.startGame();
            expect(game.phase).toBe(PHASES.DAY); // Should advance immediately
        });
    });

    describe('Day Phase', () => {
        beforeEach(async () => {
            await game.startGame();
        });

        test('nomination interrupts day phase', async () => {
            const nominator = Array.from(game.players.values())[0];
            const target = Array.from(game.players.values())[1];
            
            await game.nominate(nominator.id, target.id);
            expect(game.phase).toBe(PHASES.NOMINATION);
        });

        test('failed nomination returns to day phase', async () => {
            const nominator = Array.from(game.players.values())[0];
            const target = Array.from(game.players.values())[1];
            
            await game.nominate(nominator.id, target.id);
            await game.clearNomination('Test clear');
            expect(game.phase).toBe(PHASES.DAY);
        });

        test('successful vote advances to night phase', async () => {
            // Setup nomination and voting
            const [nominator, target, seconder, ...voters] = 
                Array.from(game.players.values());
            
            await game.nominate(nominator.id, target.id);
            await game.second(seconder.id);
            
            // Submit votes
            for (const voter of voters) {
                await game.submitVote(voter.id, true);
            }
            
            await game.processVotes();
            expect(game.phase).toBe(PHASES.NIGHT);
        });
    });

    describe('Night Phase', () => {
        beforeEach(async () => {
            await game.startGame();
            game.phase = PHASES.NIGHT;
        });

        test('collects all night actions before advancing', async () => {
            const werewolf = Array.from(game.players.values())
                .find(p => p.role === ROLES.WEREWOLF);
            const seer = Array.from(game.players.values())
                .find(p => p.role === ROLES.SEER);
            const target = Array.from(game.players.values())
                .find(p => p.role === ROLES.VILLAGER);

            await game.processNightAction(werewolf.id, 'attack', target.id);
            await game.processNightAction(seer.id, 'investigate', target.id);
            
            await game.processNightActions();
            expect(game.phase).toBe(PHASES.DAY);
        });

        test('handles missing night actions gracefully', async () => {
            await game.processNightActions();
            expect(game.phase).toBe(PHASES.DAY);
        });
    });

    describe('Game Over Conditions', () => {
        beforeEach(async () => {
            await game.startGame();
        });

        test('werewolf victory prevents phase advancement', async () => {
            // Kill all villagers except one
            Array.from(game.players.values())
                .filter(p => p.role !== ROLES.WEREWOLF)
                .forEach(p => p.isAlive = false);

            // Force game over state
            game.gameOver = true;
            game.phase = PHASES.GAME_OVER;  // Set phase directly
            
            // Verify game over state
            expect(game.gameOver).toBe(true);
            expect(game.phase).toBe(PHASES.GAME_OVER);
            
            // Try to advance phase
            await expect(game.advancePhase())
                .rejects.toThrow('Cannot advance from current game phase');
        });

        test('villager victory prevents phase advancement', async () => {
            // Kill all werewolves
            Array.from(game.players.values())
                .filter(p => p.role === ROLES.WEREWOLF)
                .forEach(p => p.isAlive = false);

            // Force game over state
            game.gameOver = true;
            game.phase = PHASES.GAME_OVER;  // Set phase directly
            
            // Verify game over state
            expect(game.gameOver).toBe(true);
            expect(game.phase).toBe(PHASES.GAME_OVER);
            
            // Try to advance phase
            await expect(game.advancePhase())
                .rejects.toThrow('Cannot advance from current game phase');
        });
    });

    describe('Phase Timeout Handling', () => {
        beforeEach(async () => {
            await game.startGame();
            jest.useFakeTimers();
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        test('nomination times out correctly', async () => {
            const nominator = Array.from(game.players.values())[0];
            const target = Array.from(game.players.values())[1];
            
            await game.nominate(nominator.id, target.id);
            jest.advanceTimersByTime(game.NOMINATION_WAIT_TIME + 100);
            
            expect(game.phase).toBe(PHASES.DAY);
        });

        test('cleans up timeouts on phase change', async () => {
            game.phase = PHASES.DAY; // Ensure we're in a valid phase for nomination
            const nominator = Array.from(game.players.values())[0];
            const target = Array.from(game.players.values())[1];
            
            await game.nominate(nominator.id, target.id);
            await game.clearNomination('Test clear');
            
            // Advancing timer shouldn't affect game state
            jest.advanceTimersByTime(game.NOMINATION_WAIT_TIME + 100);
            expect(game.nominationTimeout).toBeNull();
        });
    });
});
