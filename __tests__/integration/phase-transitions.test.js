describe('Game Phase Transitions', () => {
    let game;
    let mockClient;

    beforeEach(() => {
        // Setup mock client and game
        mockClient = {
            channels: { 
                fetch: jest.fn().mockResolvedValue({
                    send: jest.fn().mockResolvedValue({ id: 'message123' })
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

    afterEach(() => {
        if (game) {
            game.cleanup();
        }
    });

    test('game progresses from Night Zero to Day without Cupid', async () => {
        // Setup basic game with no Cupid
        const seer = new Player('seer', 'Seer', mockClient);
        const villager = new Player('vil', 'Villager', mockClient);
        
        seer.assignRole(ROLES.SEER);
        villager.assignRole(ROLES.VILLAGER);
        
        [seer, villager].forEach(p => {
            p.isAlive = true;
            game.players.set(p.id, p);
        });

        // Start Night Zero
        await game.nightZero();

        // Should advance to Day 1 automatically
        expect(game.phase).toBe(PHASES.DAY);
        expect(game.round).toBe(1);
    });

    test('game waits for Cupid action before progressing', async () => {
        // Setup game with Cupid
        const cupid = new Player('cupid', 'Cupid', mockClient);
        const target1 = new Player('t1', 'Target1', mockClient);
        const target2 = new Player('t2', 'Target2', mockClient);
        
        cupid.assignRole(ROLES.CUPID);
        [target1, target2].forEach(p => p.assignRole(ROLES.VILLAGER));
        
        [cupid, target1, target2].forEach(p => {
            p.isAlive = true;
            game.players.set(p.id, p);
        });

        // Start Night Zero
        await game.nightZero();
        expect(game.phase).toBe(PHASES.NIGHT_ZERO);

        // Submit Cupid action
        await game.processNightAction(cupid.id, 'choose_lovers', `${target1.id},${target2.id}`);

        // Should advance to Day 1
        expect(game.phase).toBe(PHASES.DAY);
        expect(game.round).toBe(1);
    });

    test('game progresses through complete day-night cycle', async () => {
        // Setup full game
        const werewolf = new Player('wolf', 'Werewolf', mockClient);
        const seer = new Player('seer', 'Seer', mockClient);
        const villager = new Player('vil', 'Villager', mockClient);
        
        werewolf.assignRole(ROLES.WEREWOLF);
        seer.assignRole(ROLES.SEER);
        villager.assignRole(ROLES.VILLAGER);
        
        [werewolf, seer, villager].forEach(p => {
            p.isAlive = true;
            game.players.set(p.id, p);
        });

        // Start in Day phase
        game.phase = PHASES.DAY;
        game.round = 1;

        // Nomination
        await game.nominate(seer.id, villager.id);
        expect(game.phase).toBe(PHASES.NOMINATION);

        // Second
        await game.second(werewolf.id);
        expect(game.phase).toBe(PHASES.VOTING);

        // Voting
        await game.submitVote(seer.id, true);
        await game.submitVote(werewolf.id, true);
        await game.submitVote(villager.id, false);

        // Process votes (should advance to Night)
        await game.processVotes();
        expect(game.phase).toBe(PHASES.NIGHT);

        // Night actions
        await game.processNightAction(werewolf.id, 'attack', seer.id);
        await game.processNightAction(seer.id, 'investigate', werewolf.id);

        // Process night (should advance to Day)
        await game.processNightActions();
        expect(game.phase).toBe(PHASES.DAY);
        expect(game.round).toBe(2);
    });

    test('game ends when win condition met', async () => {
        // Setup near-win scenario
        const werewolf = new Player('wolf', 'Werewolf', mockClient);
        const villager = new Player('vil', 'Villager', mockClient);
        
        werewolf.assignRole(ROLES.WEREWOLF);
        villager.assignRole(ROLES.VILLAGER);
        
        [werewolf, villager].forEach(p => {
            p.isAlive = true;
            game.players.set(p.id, p);
        });

        // Kill villager to trigger werewolf win
        villager.isAlive = false;
        
        // Try to advance phase
        await game.processNightActions();
        
        // Should end game instead of advancing
        expect(game.gameOver).toBe(true);
        expect(game.phase).not.toBe(PHASES.DAY);
    });
});
