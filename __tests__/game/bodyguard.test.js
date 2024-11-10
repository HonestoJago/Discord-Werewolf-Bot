const { createMockClient } = require('../helpers/discordMocks');
const WerewolfGame = require('../../game/WerewolfGame');
const NightActionProcessor = require('../../game/NightActionProcessor');
const ROLES = require('../../constants/roles');
const PHASES = require('../../constants/phases');
const { GameError } = require('../../utils/error-handler');

describe('Bodyguard Functionality', () => {
    let game;
    let mockClient;
    let bodyguard;
    let target;
    let werewolf;
    let nightProcessor;

    beforeEach(() => {
        mockClient = createMockClient();
        game = new WerewolfGame(mockClient, 'testGuild', 'testChannel', 'creatorId');
        nightProcessor = new NightActionProcessor(game);

        // Create test players
        bodyguard = {
            id: 'bodyguardId',
            username: 'bodyguard',
            role: ROLES.BODYGUARD,
            isAlive: true,
            sendDM: jest.fn().mockResolvedValue(true)
        };

        target = {
            id: 'targetId',
            username: 'target',
            role: ROLES.VILLAGER,
            isAlive: true,
            isProtected: false,
            sendDM: jest.fn().mockResolvedValue(true)
        };

        werewolf = {
            id: 'werewolfId',
            username: 'werewolf',
            role: ROLES.WEREWOLF,
            isAlive: true,
            sendDM: jest.fn().mockResolvedValue(true)
        };

        // Add players to game
        game.players.set(bodyguard.id, bodyguard);
        game.players.set(target.id, target);
        game.players.set(werewolf.id, werewolf);

        // Set game phase
        game.phase = PHASES.NIGHT;
        game.broadcastMessage = jest.fn().mockResolvedValue(true);

        // Add these lines to properly set up the game state
        game.expectedNightActions = new Set([bodyguard.id, werewolf.id]);
        game.completedNightActions = new Set();
        
        // Mock the advanceToDay method to prevent StringSelectMenuBuilder error
        game.advanceToDay = jest.fn().mockResolvedValue(true);
    });

    describe('Protection Logic', () => {
        test('successfully protects target from werewolf attack', async () => {
            // Set up night actions
            game.nightActions = {
                [bodyguard.id]: { action: 'protect', target: target.id },
                [werewolf.id]: { action: 'attack', target: target.id }
            };

            // Process protection first
            await nightProcessor.processBodyguardProtection();
            expect(target.isProtected).toBe(true);

            // Mock finishNightPhase to prevent errors
            nightProcessor.finishNightPhase = jest.fn().mockResolvedValue(true);

            await nightProcessor.processNightActions();
            expect(target.isAlive).toBe(true);
            expect(game.broadcastMessage).toHaveBeenCalledWith(
                'The Bodyguard successfully protected their target - nobody died tonight!'
            );
        });

        test('protection is cleared after night phase', async () => {
            // Set up and process protection
            game.nightActions = {
                [bodyguard.id]: { action: 'protect', target: target.id }
            };

            await nightProcessor.processBodyguardProtection();
            expect(target.isProtected).toBe(true);

            // Process night actions (which should clear protection)
            await nightProcessor.finishNightPhase();
            expect(target.isProtected).toBe(false);
        });
    });

    describe('Consecutive Nights Restriction', () => {
        test('prevents protecting same target on consecutive nights', async () => {
            // First night protection
            game.nightActions = {
                [bodyguard.id]: { action: 'protect', target: target.id }
            };
            game.lastProtectedPlayer = target.id;  // Set this directly

            // Try to protect same target next night
            await expect(nightProcessor.processNightAction(
                bodyguard.id,
                'protect',
                target.id
            )).rejects.toThrow('Invalid target');  // Match the exact error message
        });

        test('allows protecting different target on consecutive nights', async () => {
            // Set up another potential target
            const newTarget = {
                id: 'newTargetId',
                username: 'newTarget',
                role: ROLES.VILLAGER,
                isAlive: true,
                isProtected: false
            };
            game.players.set(newTarget.id, newTarget);

            // First night protection
            game.nightActions = {
                [bodyguard.id]: { action: 'protect', target: target.id }
            };
            await nightProcessor.processNightActions();

            // Second night, different target
            game.nightActions = {
                [bodyguard.id]: { action: 'protect', target: newTarget.id }
            };
            
            await expect(nightProcessor.processNightAction(
                bodyguard.id,
                'protect',
                newTarget.id
            )).resolves.not.toThrow();
        });
    });

    describe('Edge Cases', () => {
        test('cannot protect dead players', async () => {
            target.isAlive = false;
            
            await expect(nightProcessor.processNightAction(
                bodyguard.id,
                'protect',
                target.id
            )).rejects.toThrow(GameError);
        });

        test('dead bodyguard cannot protect', async () => {
            bodyguard.isAlive = false;
            
            await expect(nightProcessor.processNightAction(
                bodyguard.id,
                'protect',
                target.id
            )).rejects.toThrow(GameError);
        });

        test('protection persists through multiple attacks in same night', async () => {
            const secondWerewolf = {
                id: 'werewolf2Id',
                username: 'werewolf2',
                role: ROLES.WEREWOLF,
                isAlive: true
            };
            game.players.set(secondWerewolf.id, secondWerewolf);
            game.expectedNightActions.add(secondWerewolf.id);

            game.nightActions = {
                [bodyguard.id]: { action: 'protect', target: target.id },
                [werewolf.id]: { action: 'attack', target: target.id },
                [secondWerewolf.id]: { action: 'attack', target: target.id }
            };

            // Mock finishNightPhase to prevent protection clearing
            nightProcessor.finishNightPhase = jest.fn().mockResolvedValue(true);

            // Process bodyguard protection first
            await nightProcessor.processBodyguardProtection();
            expect(target.isProtected).toBe(true);
            
            // Then process night actions
            await nightProcessor.processNightActions();

            expect(target.isAlive).toBe(true);
            expect(target.isProtected).toBe(true);
            expect(game.broadcastMessage).toHaveBeenCalledWith(
                'The Bodyguard successfully protected their target - nobody died tonight!'
            );
        });
    });

    describe('Action Validation', () => {
        test('only bodyguard can use protect action', async () => {
            game.expectedNightActions.add(werewolf.id);
            
            await expect(nightProcessor.processNightAction(
                werewolf.id,
                'protect',
                target.id
            )).rejects.toThrow('Invalid role');  // Match the exact error message
        });

        test('bodyguard cannot protect themselves', async () => {
            await expect(nightProcessor.processNightAction(
                bodyguard.id,
                'protect',
                bodyguard.id
            )).rejects.toThrow('Invalid target');  // Match the exact error message
        });
    });
}); 