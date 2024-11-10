const { createMockClient } = require('../helpers/discordMocks');
const WerewolfGame = require('../../game/WerewolfGame');
const NightActionProcessor = require('../../game/NightActionProcessor');
const ROLES = require('../../constants/roles');
const PHASES = require('../../constants/phases');
const { GameError } = require('../../utils/error-handler');

describe('Seer Functionality', () => {
    let game;
    let mockClient;
    let seer;
    let werewolf;
    let villager;
    let nightProcessor;

    beforeEach(() => {
        mockClient = createMockClient();
        game = new WerewolfGame(mockClient, 'testGuild', 'testChannel', 'creatorId');
        nightProcessor = new NightActionProcessor(game);

        // Create test players
        seer = {
            id: 'seerId',
            username: 'seer',
            role: ROLES.SEER,
            isAlive: true,
            sendDM: jest.fn().mockResolvedValue(true)
        };

        werewolf = {
            id: 'werewolfId',
            username: 'werewolf',
            role: ROLES.WEREWOLF,
            isAlive: true,
            sendDM: jest.fn().mockResolvedValue(true)
        };

        villager = {
            id: 'villagerId',
            username: 'villager',
            role: ROLES.VILLAGER,
            isAlive: true,
            sendDM: jest.fn().mockResolvedValue(true)
        };

        // Add players to game
        game.players.set(seer.id, seer);
        game.players.set(werewolf.id, werewolf);
        game.players.set(villager.id, villager);

        // Set game phase
        game.phase = PHASES.NIGHT;
        game.broadcastMessage = jest.fn().mockResolvedValue(true);

        // Setup night action tracking
        game.expectedNightActions = new Set([seer.id, werewolf.id]);
        game.completedNightActions = new Set();
        
        // Mock game methods
        game.advanceToDay = jest.fn().mockResolvedValue(true);
    });

    describe('Investigation Logic', () => {
        test('correctly identifies werewolf', async () => {
            game.nightActions = {
                [seer.id]: { action: 'investigate', target: werewolf.id }
            };

            await nightProcessor.processSeerInvestigation();
            
            expect(seer.sendDM).toHaveBeenCalledWith(
                expect.stringContaining('Your investigation reveals that **werewolf** is **a Werewolf**.')
            );
        });

        test('correctly identifies non-werewolf', async () => {
            game.nightActions = {
                [seer.id]: { action: 'investigate', target: villager.id }
            };

            await nightProcessor.processSeerInvestigation();
            
            expect(seer.sendDM).toHaveBeenCalledWith(
                expect.stringContaining('Your investigation reveals that **villager** is **Not a Werewolf**.')
            );
        });
    });

    describe('Investigation Restrictions', () => {
        test('cannot investigate dead players', async () => {
            villager.isAlive = false;
            
            await expect(nightProcessor.processNightAction(
                seer.id,
                'investigate',
                villager.id
            )).rejects.toThrow(GameError);
        });

        test('dead seer cannot investigate', async () => {
            seer.isAlive = false;
            
            await expect(nightProcessor.processNightAction(
                seer.id,
                'investigate',
                villager.id
            )).rejects.toThrow(GameError);
        });

        test('seer cannot investigate themselves', async () => {
            await expect(nightProcessor.processNightAction(
                seer.id,
                'investigate',
                seer.id
            )).rejects.toThrow('Invalid target');
        });
    });

    describe('Action Validation', () => {
        test('only seer can use investigate action', async () => {
            await expect(nightProcessor.processNightAction(
                villager.id,
                'investigate',
                werewolf.id
            )).rejects.toThrow('Invalid role');
        });

        test('investigation results are private', async () => {
            game.nightActions = {
                [seer.id]: { action: 'investigate', target: werewolf.id }
            };

            await nightProcessor.processSeerInvestigation();
            
            expect(game.broadcastMessage).not.toHaveBeenCalled();
            expect(werewolf.sendDM).not.toHaveBeenCalled();
            expect(villager.sendDM).not.toHaveBeenCalled();
        });
    });

    describe('Edge Cases', () => {
        test('handles disconnected seer during investigation', async () => {
            // Mock the sendDM to throw a GameError
            seer.sendDM = jest.fn().mockImplementation(() => {
                throw new GameError('DM Failed', 'Failed to send direct message to player.');
            });

            game.nightActions = {
                [seer.id]: { action: 'investigate', target: werewolf.id }
            };

            await expect(nightProcessor.processSeerInvestigation())
                .rejects.toThrow(GameError);
        });

        test('investigation is processed before werewolf kills', async () => {
            game.nightActions = {
                [seer.id]: { action: 'investigate', target: werewolf.id },
                [werewolf.id]: { action: 'attack', target: seer.id }
            };

            // Mock finishNightPhase to prevent errors
            nightProcessor.finishNightPhase = jest.fn().mockResolvedValue(true);

            await nightProcessor.processSeerInvestigation();
            await nightProcessor.processWerewolfAttacks();

            // Seer should receive investigation results even if killed that night
            expect(seer.sendDM).toHaveBeenCalledWith(
                expect.stringContaining('Your investigation reveals that **werewolf** is **a Werewolf**.')
            );
        });
    });

    describe('Seer Investigation Timing', () => {
        test('investigation results are sent before night phase ends', async () => {
            // Setup night actions
            game.nightActions = {
                [seer.id]: { action: 'investigate', target: werewolf.id }
            };

            // Mock methods to track execution order
            const executionOrder = [];
            seer.sendDM = jest.fn().mockImplementation(async (msg) => {
                executionOrder.push('investigation_result');
                return true;
            });
            game.advanceToDay = jest.fn().mockImplementation(async () => {
                executionOrder.push('phase_advance');
                return true;
            });

            // Process night actions
            await nightProcessor.processNightActions();

            // Verify investigation results were sent before phase advance
            expect(executionOrder).toEqual(['investigation_result', 'phase_advance']);
            expect(seer.sendDM).toHaveBeenCalledWith(
                expect.stringContaining('Your investigation reveals that **werewolf** is **a Werewolf**.')
            );
        });

        test('investigation results are sent even if Seer dies', async () => {
            // Setup night actions where Seer investigates but is killed
            game.nightActions = {
                [seer.id]: { action: 'investigate', target: werewolf.id },
                [werewolf.id]: { action: 'attack', target: seer.id }
            };

            // Track message order
            const messages = [];
            seer.sendDM = jest.fn().mockImplementation(async (msg) => {
                messages.push(msg);
                return true;
            });

            // Process night actions
            await nightProcessor.processNightActions();

            // Verify Seer got investigation results before death
            expect(messages[0]).toContain('Your investigation reveals that **werewolf** is **a Werewolf**.');
            expect(seer.isAlive).toBe(false);
        });

        test('investigation results persist after game end', async () => {
            // Setup night actions
            game.nightActions = {
                [seer.id]: { action: 'investigate', target: werewolf.id }
            };

            // Process investigation
            await nightProcessor.processSeerInvestigation();

            // Simulate game end
            game.phase = PHASES.GAME_OVER;

            // Verify investigation results were still sent
            expect(seer.sendDM).toHaveBeenCalledWith(
                expect.stringContaining('Your investigation reveals that **werewolf** is **a Werewolf**.')
            );
        });
    });
}); 